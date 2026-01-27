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
            const { version, isLatest } = await fetchLatestBaileysVersion();
            const logger = pino({ level: this.debugEnabled ? 'debug' : 'info' }); 

            const upsertContact = db.prepare(`
                INSERT INTO contacts (instance_id, jid, name) 
                VALUES (?, ?, ?)
                ON CONFLICT(instance_id, jid) DO UPDATE SET
                name = CASE WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name ELSE contacts.name END
            `);

            const upsertChat = db.prepare(`
                INSERT INTO chats (instance_id, jid, name, unread_count, last_message_timestamp) 
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(instance_id, jid) DO UPDATE SET
                name = CASE WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name ELSE chats.name END,
                unread_count = excluded.unread_count,
                last_message_timestamp = CASE WHEN excluded.last_message_timestamp IS NOT NULL THEN excluded.last_message_timestamp ELSE chats.last_message_timestamp END
            `);

            const insertMessage = db.prepare(`
                INSERT OR IGNORE INTO messages 
                (instance_id, chat_jid, sender_jid, sender_name, text, is_from_me, timestamp) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            this.sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                browser: Browsers.ubuntu('Chrome'),
                syncFullHistory: true,
                markOnlineOnConnect: true,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 120000,
                logger: logger as any
            });

            if (this.sock) {
                (this.sock as any).ev.process(async (events: any) => {
                    const eventNames = Object.keys(events);
                    if (this.debugEnabled && eventNames.length > 0) {
                        console.log(`DEBUG [Instance ${this.id}]: Raw Events -> ${eventNames.join(', ')}`);
                    }

                    if (events['connection.update']) {
                        const update = events['connection.update'];
                        const { connection, lastDisconnect, qr } = update;
                        if (qr) {
                            this.qr = await qrcode.toDataURL(qr);
                            this.status = 'qr_ready';
                        }
                        if (connection === 'open') {
                            console.log(`TRACE [Instance ${this.id}]: Connection OPEN`);
                            this.status = 'connected';
                            this.qr = null;
                            db.prepare('UPDATE instances SET status = ? WHERE id = ?').run('connected', this.id);
                            this.startSyncWatchdog();
                        }
                        if (connection === 'close') {
                            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                            this.status = 'disconnected';
                            this.sock = null;
                            this.stopSyncWatchdog();
                            db.prepare('UPDATE instances SET status = ? WHERE id = ?').run('disconnected', this.id);
                            if (statusCode === DisconnectReason.loggedOut) {
                                console.log(`TRACE [Instance ${this.id}]: Session logged out. Clearing auth and forcing new QR...`);
                                await this.deleteAuth();
                                await this.init();
                            } else {
                                if (this.isReconnecting) return;
                                this.isReconnecting = true;
                                setTimeout(async () => { this.isReconnecting = false; await this.init(); }, 5000);
                            }
                        }
                    }

                    if (events['creds.update']) saveCreds();

                    // Aggressive Chat & Message Discovery
                    if (events['messaging-history.set']) {
                        const { chats, contacts, messages } = events['messaging-history.set'];
                        console.log(`TRACE [Instance ${this.id}]: History Set -> Chats: ${chats?.length || 0}, Contacts: ${contacts?.length || 0}, Messages: ${messages?.length || 0}`);
                        
                        db.transaction(() => {
                            // 1. Process Contacts (just for identity)
                            if (contacts) {
                                for (const contact of contacts) {
                                    upsertContact.run(this.id, contact.id, contact.name || contact.notify || contact.id.split('@')[0]);
                                }
                            }

                            // 2. Process Chats (only those with activity)
                            if (chats) {
                                for (const chat of chats) {
                                    const ts = chat.conversationTimestamp || chat.lastMessageRecvTimestamp;
                                    if (ts) {
                                        const isoTs = new Date(Number(ts) * 1000).toISOString();
                                        upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0], chat.unreadCount || 0, isoTs);
                                    }
                                }
                            }

                            // 3. Process Historical Messages
                            if (messages) {
                                for (const msg of messages) {
                                    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || "";
                                    if (text) {
                                        const jid = msg.key.remoteJid!;
                                        const ts = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString();
                                        
                                        // Ensure chat entry exists because a message exists
                                        upsertChat.run(this.id, jid, msg.pushName || jid.split('@')[0], 0, ts);
                                        insertMessage.run(this.id, jid, msg.key.participant || jid, msg.pushName || "Unknown", text, msg.key.fromMe ? 1 : 0, ts);
                                    }
                                }
                            }
                        })();
                    }

                    if ((events as any)['chats.set']) {
                        const chats = (events as any)['chats.set'].chats;
                        if (chats) db.transaction(() => {
                            for (const chat of chats) {
                                const ts = chat.conversationTimestamp || chat.lastMessageRecvTimestamp;
                                if (ts) {
                                    const isoTs = new Date(Number(ts) * 1000).toISOString();
                                    upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0], chat.unreadCount || 0, isoTs);
                                }
                            }
                        })();
                    }

                    if (events['chats.upsert']) {
                        const chats = events['chats.upsert'];
                        db.transaction(() => {
                            for (const chat of chats) {
                                const ts = chat.conversationTimestamp || chat.lastMessageRecvTimestamp;
                                const isoTs = ts ? new Date(Number(ts) * 1000).toISOString() : null;
                                upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0], chat.unreadCount || 0, isoTs);
                            }
                        })();
                    }

                    if ((events as any)['contacts.set']) {
                        const contacts = (events as any)['contacts.set'].contacts;
                        if (contacts) db.transaction(() => {
                            for (const contact of contacts) {
                                upsertContact.run(this.id, contact.id, contact.name || contact.notify || contact.id.split('@')[0]);
                            }
                        })();
                    }

                    if (events['contacts.upsert']) {
                        const contacts = events['contacts.upsert'];
                        db.transaction(() => {
                            for (const contact of contacts) {
                                upsertContact.run(this.id, contact.id, contact.name || contact.notify || contact.id.split('@')[0]);
                            }
                        })();
                    }

                    if (events['messages.upsert']) {
                        const m = events['messages.upsert'];
                        if (m.type === 'notify') {
                            for (const msg of m.messages) {
                                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || "";
                                if (text) {
                                    const jid = msg.key.remoteJid!;
                                    const ts = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString();
                                    
                                    // Ensure chat exists
                                    upsertChat.run(this.id, jid, msg.pushName || jid.split('@')[0], 0, ts);
                                    insertMessage.run(this.id, jid, msg.key.participant || jid, msg.pushName || "Unknown", text, msg.key.fromMe ? 1 : 0, ts);

                                    db.prepare(`
                                        UPDATE chats SET last_message_text = ?, last_message_timestamp = ?
                                        WHERE instance_id = ? AND jid = ?
                                    `).run(text, ts, this.id, jid);
                                }
                            }
                        }
                    }
                });
            }
        } catch (err) {
            console.error(`TRACE [Instance ${this.id}]: FATAL ERROR during init:`, err);
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
