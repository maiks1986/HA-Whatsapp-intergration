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
    private io: any;

    constructor(id: number, name: string, io: any, debugEnabled: boolean = false) {
        this.id = id;
        this.name = name;
        this.io = io;
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
            }

            // Direct listeners for maximum reliability
            if (this.sock) {
                this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
                const { connection, lastDisconnect, qr } = update;
                console.log(`TRACE [Instance ${this.id}]: connection.update ->`, connection || 'poll');
                
                if (qr) {
                    this.qr = await qrcode.toDataURL(qr);
                    this.status = 'qr_ready';
                }
                if (connection === 'open') {
                    console.log(`TRACE [Instance ${this.id}]: Connection OPEN. Starting discovery...`);
                    this.status = 'connected';
                    this.qr = null;
                    dbInstance.prepare('UPDATE instances SET status = ? WHERE id = ?').run('connected', this.id);
                    
                    const row = dbInstance.prepare('SELECT COUNT(*) as count FROM chats WHERE instance_id = ?').get(this.id) as any;
                    const isEmpty = row?.count === 0;
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

            // Heartbeat: Log EVERY event emitted by the socket
            (this.sock.ev as any).on('events', (events: any) => {
                const names = Object.keys(events);
                if (names.length > 0) {
                    console.log(`TRACE [Instance ${this.id}]: Heartbeat -> [${names.join(', ')}]`);
                }
            });

            const getChatName = (jid: string, existingName?: string | null) => {
                if (existingName && existingName !== jid && !existingName.includes('@')) return existingName;
                if (jid.endsWith('@g.us')) return 'Unnamed Group';
                return jid.split('@')[0];
            };

            this.sock.ev.on('creds.update', () => {
                console.log(`TRACE [Instance ${this.id}]: creds.update`);
                saveCreds();
            });

            this.sock.ev.on('messaging-history.set', async (payload: any) => {
                const { chats, contacts, messages } = payload;
                console.log(`TRACE [Instance ${this.id}]: history.set -> Chats: ${chats?.length || 0}, Contacts: ${contacts?.length || 0}, Messages: ${messages?.length || 0}`);
                
                dbInstance.transaction(() => {
                    // 1. Process Contacts (Identity) - Only save if it's a REAL name
                    if (contacts) {
                        for (const contact of contacts) {
                            if (!isJidValid(contact.id)) continue;
                            const name = contact.name || contact.notify || (contact as any).verifiedName;
                            // Only save to contacts table if we have an actual name (not just the JID)
                            if (name && name !== contact.id && !name.includes('@')) {
                                upsertContact.run(this.id, contact.id, name);
                            }
                        }
                    }

                    // 2. Initial Chat Pass
                    if (chats) {
                        for (const chat of chats) {
                            if (!isJidValid(chat.id)) continue;
                            const ts = chat.conversationTimestamp || chat.lastMessageRecvTimestamp;
                            const isoTs = ts ? new Date(Number(ts) * 1000).toISOString() : null;
                            // Use JID as fallback name in the chats table
                            const name = getChatName(chat.id, chat.name);
                            upsertChat.run(this.id, chat.id, name, chat.unreadCount || 0, isoTs);
                        }
                    }

                    if (messages) {
                        let msgCount = 0;
                        for (const msg of messages) {
                            const text = getMessageText(msg);
                            if (text && isJidValid(msg.key.remoteJid!)) {
                                const jid = msg.key.remoteJid!;
                                const ts = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString();
                                upsertChat.run(this.id, jid, getChatName(jid, msg.pushName), 0, ts);
                                insertMessage.run(this.id, jid, msg.key.participant || jid, msg.pushName || "Unknown", text, msg.key.fromMe ? 1 : 0, ts);
                                dbInstance.prepare(`UPDATE chats SET last_message_text = ?, last_message_timestamp = ? WHERE instance_id = ? AND jid = ? AND (last_message_timestamp IS NULL OR ? >= last_message_timestamp)`).run(text, ts, this.id, jid, ts);
                                msgCount++;
                            }
                        }
                        console.log(`TRACE [Instance ${this.id}]: Successfully linked ${msgCount} history messages.`);
                    }
                })();
                this.io.emit('chat_update', { instanceId: this.id });
            });

            this.sock.ev.on('messages.upsert', (m: any) => {
                if (m.type === 'notify') {
                    console.log(`TRACE [Instance ${this.id}]: messages.upsert (${m.messages.length} msgs)`);
                    for (const msg of m.messages) {
                        const text = getMessageText(msg);
                        if (text && isJidValid(msg.key.remoteJid!)) {
                            const jid = msg.key.remoteJid!;
                            const ts = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString();
                            upsertChat.run(this.id, jid, getChatName(jid, msg.pushName), 0, ts);
                            insertMessage.run(this.id, jid, msg.key.participant || jid, msg.pushName || "Unknown", text, msg.key.fromMe ? 1 : 0, ts);
                            dbInstance.prepare(`UPDATE chats SET last_message_text = ?, last_message_timestamp = ? WHERE instance_id = ? AND jid = ? AND (last_message_timestamp IS NULL OR ? >= last_message_timestamp)`).run(text, ts, this.id, jid, ts);
                            
                            this.io.emit('new_message', { instanceId: this.id, jid, text });
                            this.io.emit('chat_update', { instanceId: this.id });
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
                this.io.emit('chat_update', { instanceId: this.id });
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
                this.io.emit('chat_update', { instanceId: this.id });
            });

            console.log(`TRACE [Instance ${this.id}]: init() successfully completed.`);
        } catch (err) {
            console.error(`TRACE [Instance ${this.id}]: FATAL ERROR during init:`, err);
        }
    }

    private startSyncWatchdog(immediate: boolean = false) {
        this.stopSyncWatchdog();
        const timeout = immediate ? 30000 : 300000; // Wait 30s for fast check, 5m for regular
        console.log(`TRACE [Instance ${this.id}]: Sync Watchdog scheduled in ${timeout/1000}s`);
        this.watchdogTimer = setTimeout(async () => {
            console.log(`TRACE [Instance ${this.id}]: Sync Watchdog executing check...`);
            const dbInstance = getDb();
            const row = dbInstance.prepare('SELECT COUNT(*) as count FROM chats WHERE instance_id = ?').get(this.id) as any;
            const chatCount = row?.count || 0;

            if (chatCount === 0) {
                this.syncRetryCount++;
                console.log(`Instance ${this.id}: No data received after ${timeout/1000}s. Attempt ${this.syncRetryCount}/${this.maxSyncRetries}`);
                
                if (this.syncRetryCount < this.maxSyncRetries) {
                    if (this.isReconnecting) return;
                    this.isReconnecting = true;
                    
                    // If we've tried 3 soft restarts and still nothing, force a Hard Relink (Delete session)
                    if (this.syncRetryCount >= 3) {
                        console.log(`TRACE [Instance ${this.id}]: Sync stuck after 3 attempts. FORCING HARD RELINK (Clearing session)...`);
                        await this.deleteAuth();
                    } else {
                        console.log(`TRACE [Instance ${this.id}]: Triggering soft restart to nudge sync...`);
                        if (this.sock) {
                            try { this.sock.end(undefined); this.sock = null; } catch (e) {}
                        }
                    }

                    setTimeout(async () => {
                        this.isReconnecting = false;
                        await this.init();
                    }, 5000);
                } else {
                    console.error(`Instance ${this.id}: Reached max sync retries. Sync failed.`);
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
