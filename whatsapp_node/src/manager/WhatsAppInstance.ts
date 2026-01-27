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
import { getDb } from '../db/database';
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

            const dbInstance = getDb();

            const upsertContact = dbInstance.prepare(`
                INSERT INTO contacts (instance_id, jid, name) 
                VALUES (?, ?, ?)
                ON CONFLICT(instance_id, jid) DO UPDATE SET
                name = CASE WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name ELSE contacts.name END
            `);

            const upsertChat = dbInstance.prepare(`
                INSERT INTO chats (instance_id, jid, name, unread_count, last_message_timestamp) 
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(instance_id, jid) DO UPDATE SET
                name = CASE WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name ELSE chats.name END,
                unread_count = excluded.unread_count,
                last_message_timestamp = CASE WHEN excluded.last_message_timestamp IS NOT NULL THEN excluded.last_message_timestamp ELSE chats.last_message_timestamp END
            `);

            const insertMessage = dbInstance.prepare(`
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

            const getMessageText = (m: any) => {
                const msg = m.message;
                if (!msg) return "";
                return msg.conversation || 
                       msg.extendedTextMessage?.text || 
                       msg.imageMessage?.caption || 
                       msg.videoMessage?.caption ||
                       msg.templateButtonReplyMessage?.selectedDisplayText ||
                       msg.buttonsResponseMessage?.selectedDisplayText ||
                       msg.listResponseMessage?.title ||
                       "";
            };

            const isJidValid = (jid: string) => {
                return jid && !jid.includes('@broadcast') && jid !== 'status@broadcast';
            };

            if (this.sock) {
                // Catch-all tracer for raw events
                this.sock.ev.on('connection.update', (update) => {
                    console.log(`TRACE [Instance ${this.id}]: Event -> connection.update`, JSON.stringify(update));
                });

                this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
                    const { connection, lastDisconnect, qr } = update;
                    if (qr) {
                        this.qr = await qrcode.toDataURL(qr);
                        this.status = 'qr_ready';
                    }
                    if (connection === 'open') {
                        console.log(`TRACE [Instance ${this.id}]: Connection OPEN`);
                        this.status = 'connected';
                        this.qr = null;
                        dbInstance.prepare('UPDATE instances SET status = ? WHERE id = ?').run('connected', this.id);
                        
                        const row = dbInstance.prepare('SELECT COUNT(*) as count FROM chats WHERE instance_id = ?').get(this.id) as any;
                        const isEmpty = row?.count === 0;
                        if (isEmpty) console.log(`TRACE [Instance ${this.id}]: DB Empty. Triggering fast sync watchdog.`);
                        this.startSyncWatchdog(isEmpty);
                    }
                    if (connection === 'close') {
                        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                        console.log(`TRACE [Instance ${this.id}]: Connection CLOSED (Status: ${statusCode})`);
                        this.status = 'disconnected';
                        this.sock = null;
                        this.stopSyncWatchdog();
                        dbInstance.prepare('UPDATE instances SET status = ? WHERE id = ?').run('disconnected', this.id);
                        if (statusCode === DisconnectReason.loggedOut) {
                            console.log(`TRACE [Instance ${this.id}]: Logged out. Wiping session...`);
                            await this.deleteAuth();
                            await this.init();
                        } else {
                            if (this.isReconnecting) return;
                            this.isReconnecting = true;
                            setTimeout(async () => { this.isReconnecting = false; await this.init(); }, 5000);
                        }
                    }
                });

                this.sock.ev.on('creds.update', () => {
                    console.log(`TRACE [Instance ${this.id}]: creds.update`);
                    saveCreds();
                });

                this.sock.ev.on('messaging-history.set', async (payload: any) => {
                    const { chats, contacts, messages } = payload;
                    console.log(`TRACE [Instance ${this.id}]: HistorySet -> Chats: ${chats?.length || 0}, Contacts: ${contacts?.length || 0}, Messages: ${messages?.length || 0}`);
                    
                    dbInstance.transaction(() => {
                        if (contacts) {
                            for (const contact of contacts) {
                                if (isJidValid(contact.id)) {
                                    const name = contact.name || contact.notify;
                                    if (name) upsertContact.run(this.id, contact.id, name);
                                    else dbInstance.prepare('INSERT OR IGNORE INTO contacts (instance_id, jid, name) VALUES (?, ?, ?)').run(this.id, contact.id, contact.id.split('@')[0]);
                                }
                            }
                        }
                        if (chats) {
                            for (const chat of chats) {
                                if (!isJidValid(chat.id)) continue;
                                const ts = chat.conversationTimestamp || chat.lastMessageRecvTimestamp;
                                const isoTs = ts ? new Date(Number(ts) * 1000).toISOString() : null;
                                upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0], chat.unreadCount || 0, isoTs);
                            }
                        }
                        if (messages) {
                            let msgCount = 0;
                            for (const msg of messages) {
                                const text = getMessageText(msg);
                                if (text && isJidValid(msg.key.remoteJid!)) {
                                    const jid = msg.key.remoteJid!;
                                    const ts = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString();
                                    upsertChat.run(this.id, jid, msg.pushName || jid.split('@')[0], 0, ts);
                                    insertMessage.run(this.id, jid, msg.key.participant || jid, msg.pushName || "Unknown", text, msg.key.fromMe ? 1 : 0, ts);
                                    msgCount++;
                                }
                            }
                            console.log(`TRACE [Instance ${this.id}]: Imported ${msgCount} history messages`);
                        }
                    })();
                });

                this.sock.ev.on('messages.upsert', (m: any) => {
                    if (m.type === 'notify') {
                        console.log(`TRACE [Instance ${this.id}]: messages.upsert (${m.messages.length} msgs)`);
                        for (const msg of m.messages) {
                            const text = getMessageText(msg);
                            if (text && isJidValid(msg.key.remoteJid!)) {
                                const jid = msg.key.remoteJid!;
                                const ts = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString();
                                upsertChat.run(this.id, jid, msg.pushName || jid.split('@')[0], 0, ts);
                                insertMessage.run(this.id, jid, msg.key.participant || jid, msg.pushName || "Unknown", text, msg.key.fromMe ? 1 : 0, ts);
                                dbInstance.prepare(`UPDATE chats SET last_message_text = ?, last_message_timestamp = ? WHERE instance_id = ? AND jid = ?`).run(text, ts, this.id, jid);
                            }
                        }
                    }
                });

                // Extra fallback listeners for individual updates
                const evAny = this.sock.ev as any;
                evAny.on('chats.upsert', (chats: any[]) => {
                    console.log(`TRACE [Instance ${this.id}]: chats.upsert (${chats.length} items)`);
                    dbInstance.transaction(() => {
                        for (const chat of chats) {
                            if (!isJidValid(chat.id)) continue;
                            const ts = chat.conversationTimestamp || chat.lastMessageRecvTimestamp;
                            const isoTs = ts ? new Date(Number(ts) * 1000).toISOString() : null;
                            upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0], chat.unreadCount || 0, isoTs);
                        }
                    })();
                });

                evAny.on('contacts.upsert', (contacts: any[]) => {
                    console.log(`TRACE [Instance ${this.id}]: contacts.upsert (${contacts.length} items)`);
                    dbInstance.transaction(() => {
                        for (const contact of contacts) {
                            if (isJidValid(contact.id)) {
                                const name = contact.name || contact.notify;
                                if (name) upsertContact.run(this.id, contact.id, name);
                            }
                        }
                                    })();
                                });
                    
                                console.log(`TRACE [Instance ${this.id}]: init() successfully completed.`);
                            }
                            } catch (err) {
                                console.error(`TRACE [Instance ${this.id}]: FATAL ERROR during init:`, err);
                            }
                        }
    private startSyncWatchdog(immediate: boolean = false) {
        this.stopSyncWatchdog();
        // Increased to 5 minutes to allow for large history syncs, but check faster if immediate is requested
        const timeout = immediate ? 10000 : 300000;
        this.watchdogTimer = setTimeout(async () => {
            const dbInstance = getDb();
            const row = dbInstance.prepare('SELECT COUNT(*) as count FROM chats WHERE instance_id = ?').get(this.id) as any;
            const chatCount = row?.count || 0;

            if (chatCount === 0) {
                this.syncRetryCount++;
                console.log(`Instance ${this.id}: Watchdog alert! No chats found in DB after ${timeout/1000}s. Attempt ${this.syncRetryCount}/${this.maxSyncRetries}`);
                
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
        }, timeout); 
    }

    private stopSyncWatchdog() {
        console.log(`TRACE [Instance ${this.id}]: stopSyncWatchdog() called`);
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    async sendMessage(jid: string, text: string) {
        console.log(`TRACE [Instance ${this.id}]: sendMessage(${jid}) called`);
        if (!this.sock || this.status !== 'connected') throw new Error("Instance not connected");
        await this.sock.sendMessage(jid, { text });
        
        const dbInstance = getDb();
        dbInstance.prepare(`
            INSERT OR IGNORE INTO messages 
            (instance_id, chat_jid, sender_jid, sender_name, text, is_from_me) 
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(this.id, jid, 'me', 'Me', text, 1);

        dbInstance.prepare(`
            UPDATE chats SET last_message_text = ?, last_message_timestamp = CURRENT_TIMESTAMP
            WHERE instance_id = ? AND jid = ?
        `).run(text, this.id, jid);
    }

    async deleteAuth() {
        console.log(`TRACE [Instance ${this.id}]: deleteAuth() called`);
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
        console.log(`TRACE [Instance ${this.id}]: close() called`);
        this.stopSyncWatchdog();
        if (this.sock) {
            this.sock.end(undefined);
            this.sock = null;
        }
    }
}
