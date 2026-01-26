import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    WASocket,
    ConnectionState,
    Browsers,
    Contact
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import db from '../db/database';
import path from 'path';
import fs from 'fs';
import pino from 'pino';

export class WhatsAppInstance {
    public id: number;
    public name: string;
    public sock: WASocket | null = null;
    public qr: string | null = null;
    public status: string = 'disconnected';
    private authPath: string;
    private syncRetryCount: number = 0;
    private maxSyncRetries: number = 10;
    private watchdogTimer: NodeJS.Timeout | null = null;
    private isReconnecting: boolean = false;
    private debugEnabled: boolean;

    constructor(id: number, name: string, debugEnabled: boolean = false) {
        this.id = id;
        this.name = name;
        this.debugEnabled = debugEnabled;
        this.authPath = process.env.NODE_ENV === 'development'
            ? path.join(__dirname, `../../auth_info_${id}`)
            : `/data/auth_info_${id}`;
    }

    async init() {
        if (this.sock) {
            console.log(`TRACE [Instance ${this.id}]: init() called but socket already exists. Skipping.`);
            return;
        }

        console.log(`TRACE [Instance ${this.id}]: Starting init(). Auth Path: ${this.authPath}`);
        
        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            console.log(`TRACE [Instance ${this.id}]: Auth state loaded. Has credentials: ${!!state.creds}`);
            
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`TRACE [Instance ${this.id}]: Using Baileys v${version} (Latest: ${isLatest})`);

            const logger = pino({ level: this.debugEnabled ? 'debug' : 'info' }); 

            this.sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                browser: Browsers.ubuntu('Chrome'),
                syncFullHistory: false,
                markOnlineOnConnect: true,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 120000,
                logger: logger as any
            });

            console.log(`TRACE [Instance ${this.id}]: Socket created. Attaching listeners...`);

            this.sock.ev.process((events) => {
                const eventNames = Object.keys(events);
                if (this.debugEnabled && eventNames.length > 0) {
                    console.log(`DEBUG [Instance ${this.id}]: Raw Events -> ${eventNames.join(', ')}`);
                }

                if (events['connection.update']) {
                    const update = events['connection.update'];
                    const { connection, lastDisconnect, qr } = update;
                    
                    if (qr) {
                        console.log(`TRACE [Instance ${this.id}]: Connection Update -> QR Generated`);
                        this.qr = qrcode.toDataURL(qr) as any; // Note: toDataURL is async, this might need handling
                        this.status = 'qr_ready';
                    }

                    if (connection === 'open') {
                        console.log(`TRACE [Instance ${this.id}]: Connection Update -> OPEN`);
                        this.status = 'connected';
                        this.qr = null;
                        db.prepare('UPDATE instances SET status = ? WHERE id = ?').run('connected', this.id);
                        this.startSyncWatchdog();
                    }

                    if (connection === 'close') {
                        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                        console.log(`TRACE [Instance ${this.id}]: Connection Update -> CLOSED (Status: ${statusCode})`);
                        this.status = 'disconnected';
                        this.qr = null;
                        this.stopSyncWatchdog();
                        this.sock = null;
                        
                        db.prepare('UPDATE instances SET status = ? WHERE id = ?').run('disconnected', this.id);
                        
                        if (statusCode !== DisconnectReason.loggedOut) {
                            if (this.isReconnecting) return;
                            this.isReconnecting = true;
                            console.log(`TRACE [Instance ${this.id}]: Reconnecting in 5s...`);
                            setTimeout(async () => {
                                this.isReconnecting = false;
                                await this.init();
                            }, 5000);
                        }
                    }
                }

                if (events['creds.update']) {
                    console.log(`TRACE [Instance ${this.id}]: Credentials updated`);
                    saveCreds();
                }

                if (events['messaging-history.set']) {
                    const { chats, contacts, messages } = events['messaging-history.set'];
                    console.log(`TRACE [Instance ${this.id}]: messaging-history.set -> Chats: ${chats?.length || 0}, Contacts: ${contacts?.length || 0}, Messages: ${messages?.length || 0}`);
                    if (chats && chats.length > 0) {
                        this.syncRetryCount = 0;
                        db.transaction(() => {
                            for (const chat of chats) {
                                upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0], chat.unreadCount || 0);
                            }
                        })();
                        console.log(`TRACE [Instance ${this.id}]: Initialized ${chats.length} chats from history`);
                    }
                }

                if (events['chats.upsert']) {
                    const chats = events['chats.upsert'];
                    console.log(`TRACE [Instance ${this.id}]: chats.upsert -> ${chats.length} items`);
                    this.syncRetryCount = 0;
                    for (const chat of chats) {
                        upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0], chat.unreadCount || 0);
                    }
                }

                if (events['contacts.upsert']) {
                    const contacts = events['contacts.upsert'];
                    console.log(`TRACE [Instance ${this.id}]: contacts.upsert -> ${contacts.length} items`);
                    this.syncRetryCount = 0;
                    for (const contact of contacts) {
                        upsertChat.run(this.id, contact.id, contact.name || contact.notify || contact.id.split('@')[0], 0);
                    }
                }

                if (events['messages.upsert']) {
                    const m = events['messages.upsert'];
                    if (m.type === 'notify') {
                        console.log(`TRACE [Instance ${this.id}]: messages.upsert -> ${m.messages.length} messages`);
                        for (const msg of m.messages) {
                            const text = msg.message?.conversation || 
                                         msg.message?.extendedTextMessage?.text || 
                                         msg.message?.imageMessage?.caption || "";
                            
                            if (text) {
                                const jid = msg.key.remoteJid!;
                                db.prepare(`
                                    INSERT OR IGNORE INTO messages 
                                    (instance_id, chat_jid, sender_jid, sender_name, text, is_from_me) 
                                    VALUES (?, ?, ?, ?, ?, ?)
                                `).run(this.id, jid, msg.key.participant || jid, msg.pushName || "Unknown", text, msg.key.fromMe ? 1 : 0);

                                db.prepare(`
                                    INSERT INTO chats (instance_id, jid, last_message_text, last_message_timestamp)
                                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                                    ON CONFLICT(instance_id, jid) DO UPDATE SET
                                    last_message_text = excluded.last_message_text,
                                    last_message_timestamp = CURRENT_TIMESTAMP
                                `).run(this.id, jid, text);
                            }
                        }
                    }
                }
            });

            const upsertChat = db.prepare(`
                INSERT INTO chats (instance_id, jid, name, unread_count) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT(instance_id, jid) DO UPDATE SET
                name = CASE WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name ELSE chats.name END,
                unread_count = excluded.unread_count
            `);

            // Legacy direct listeners (some versions of baileys prefer these)
            (this.sock.ev as any).on('contacts.set', (payload: any) => {
                const contacts = payload.contacts || [];
                console.log(`TRACE [Instance ${this.id}]: contacts.set -> ${contacts.length} items`);
                if (contacts.length > 0) this.syncRetryCount = 0;
                for (const contact of contacts) {
                    upsertChat.run(this.id, contact.id, contact.name || contact.notify || contact.id.split('@')[0], 0);
                }
            });

        } catch (err) {
            console.error(`TRACE [Instance ${this.id}]: FATAL ERROR during init:`, err);
        }
    }
    }

    private startSyncWatchdog() {
        this.stopSyncWatchdog();
        // Increased to 5 minutes to allow for large history syncs
        this.watchdogTimer = setTimeout(async () => {
            const row = db.prepare('SELECT COUNT(*) as count FROM chats WHERE instance_id = ?').get(this.id) as any;
            const chatCount = row?.count || 0;

            if (chatCount === 0) {
                this.syncRetryCount++;
                console.log(`Instance ${this.id}: Watchdog alert! No chats found in DB after 300s. Attempt ${this.syncRetryCount}/${this.maxSyncRetries}`);
                
                if (this.syncRetryCount < this.maxSyncRetries) {
                    if (this.isReconnecting) return;
                    this.isReconnecting = true;
                    console.log(`Instance ${this.id}: Triggering soft restart to force sync...`);
                    if (this.sock) {
                        try { 
                            this.sock.end(undefined); 
                            this.sock = null;
                        } catch (e) {}
                    }
                    setTimeout(async () => {
                        this.isReconnecting = false;
                        await this.init();
                    }, 5000);
                } else {
                    console.error(`Instance ${this.id}: Reached max sync retries. Please check if the account is actually active or try a Hard Reset.`);
                }
            } else {
                console.log(`Instance ${this.id}: Watchdog satisfied. Found ${chatCount} chats in database.`);
            }
        }, 300000); 
    }

    private stopSyncWatchdog() {
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    async sendMessage(jid: string, text: string) {
        if (!this.sock || this.status !== 'connected') throw new Error("Instance not connected");
        await this.sock.sendMessage(jid, { text });
        
        db.prepare(`
            INSERT OR IGNORE INTO messages 
            (instance_id, chat_jid, sender_jid, sender_name, text, is_from_me) 
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(this.id, jid, 'me', 'Me', text, 1);

        db.prepare(`
            UPDATE chats SET last_message_text = ?, last_message_timestamp = CURRENT_TIMESTAMP
            WHERE instance_id = ? AND jid = ?
        `).run(text, this.id, jid);
    }

    async deleteAuth() {
        this.stopSyncWatchdog();
        if (this.sock) {
            try { await this.sock.logout(); } catch (e) {}
            this.sock = null;
        }
        if (fs.existsSync(this.authPath)) {
            fs.rmSync(this.authPath, { recursive: true, force: true });
        }
        this.syncRetryCount = 0;
    }

    async close() {
        this.stopSyncWatchdog();
        if (this.sock) {
            this.sock.end(undefined);
            this.sock = null;
        }
    }
}
