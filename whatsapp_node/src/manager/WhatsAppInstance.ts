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
    public presence: 'available' | 'unavailable' = 'available';
    private authPath: string;
    private namingWorker: NodeJS.Timeout | null = null;
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
            const { version } = await fetchLatestBaileysVersion();
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
                name = CASE WHEN (chats.name IS NULL OR chats.name = '' OR chats.name LIKE '%@s.whatsapp.net' OR chats.name = 'Unnamed Group') AND excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name ELSE chats.name END,
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
                markOnlineOnConnect: this.presence === 'available',
                connectTimeoutMs: 600000,
                defaultQueryTimeoutMs: 600000,
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

            const normalizeJid = (jid: string) => {
                if (!jid) return jid;
                let normalized = jid;
                if (jid.includes(':')) {
                    normalized = jid.replace(/:[0-9]+@/, '@');
                }
                return normalized;
            };

            const getChatName = (jid: string, existingName?: string | null) => {
                const normalized = normalizeJid(jid);
                if (existingName && existingName !== normalized && !existingName.includes('@') && existingName !== 'Unnamed Group') return existingName;
                
                const contact = dbInstance.prepare('SELECT name FROM contacts WHERE instance_id = ? AND jid = ?').get(this.id, normalized) as any;
                if (contact?.name && !contact.name.includes('@')) return contact.name;

                if (normalized.endsWith('@g.us')) return 'Unnamed Group';
                return normalized.split('@')[0];
            };

            if (this.sock) {
                const evAny = this.sock.ev as any;

                // 1. ROBUST CATCH-ALL (Must be first to capture sync)
                const safeStringify = (obj: any) => {
                    const cache = new Set();
                    return JSON.stringify(obj, (key, value) => {
                        if (typeof value === 'object' && value !== null) {
                            if (cache.has(value)) return '[Circular]';
                            cache.add(value);
                        }
                        return value;
                    });
                };

                evAny.on('events', (events: any) => {
                    try {
                        const logPath = process.env.NODE_ENV === 'development' ? './raw_events.log' : '/data/raw_events.log';
                        const logEntry = safeStringify({ timestamp: new Date().toISOString(), instanceId: this.id, events });
                        
                        // Disk log
                        fs.appendFileSync(logPath, logEntry + '\n');

                        // Live stream (only if payload is reasonable size < 50KB to avoid socket hang)
                        if (logEntry.length < 50000) {
                            this.io.emit('raw_whatsapp_event', JSON.parse(logEntry));
                        } else {
                            this.io.emit('raw_whatsapp_event', { 
                                timestamp: new Date().toISOString(), 
                                instanceId: this.id, 
                                events: { info: "Event payload too large for live stream. Check disk logs.", types: Object.keys(events) } 
                            });
                        }
                    } catch (e) {}
                });

                // 2. Standard Logic Handlers
                this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
                    const { connection, lastDisconnect, qr } = update;
                    if (qr) {
                        this.qr = await qrcode.toDataURL(qr);
                        this.status = 'qr_ready';
                    }
                    if (connection === 'open') {
                        this.status = 'connected';
                        this.qr = null;
                        dbInstance.prepare('UPDATE instances SET status = ? WHERE id = ?').run('connected', this.id);
                        this.startNamingWorker();
                    }
                    if (connection === 'close') {
                        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                        this.status = 'disconnected';
                        this.sock = null;
                        dbInstance.prepare('UPDATE instances SET status = ? WHERE id = ?').run('disconnected', this.id);
                        if (statusCode === DisconnectReason.loggedOut) {
                            await this.deleteAuth();
                        } else if (!this.isReconnecting) {
                            setTimeout(() => this.init(), 5000);
                        }
                    }
                });

                this.sock.ev.on('creds.update', saveCreds);

                this.sock.ev.on('messaging-history.set', async (payload: any) => {
                    const { chats, contacts, messages } = payload;
                    dbInstance.transaction(() => {
                        if (contacts) {
                            for (const contact of contacts) {
                                if (!isJidValid(contact.id)) continue;
                                const normalized = normalizeJid(contact.id);
                                const name = contact.name || contact.notify || (contact as any).verifiedName;
                                if (name && name !== normalized && !name.includes('@')) {
                                    upsertContact.run(this.id, normalized, name);
                                }
                            }
                        }
                        if (chats) {
                            for (const chat of chats) {
                                if (!isJidValid(chat.id)) continue;
                                const normalized = normalizeJid(chat.id);
                                const ts = chat.conversationTimestamp || chat.lastMessageRecvTimestamp;
                                const isoTs = ts ? new Date(Number(ts) * 1000).toISOString() : null;
                                upsertChat.run(this.id, normalized, getChatName(normalized, chat.name), chat.unreadCount || 0, isoTs);
                            }
                        }
                        if (messages) {
                            for (const msg of messages) {
                                const text = getMessageText(msg);
                                if (text && isJidValid(msg.key.remoteJid!)) {
                                    const jid = normalizeJid(msg.key.remoteJid!);
                                    const ts = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString();
                                    upsertChat.run(this.id, jid, getChatName(jid, msg.pushName), 0, ts);
                                    insertMessage.run(this.id, jid, normalizeJid(msg.key.participant || jid), msg.pushName || "Unknown", text, msg.key.fromMe ? 1 : 0, ts);
                                    dbInstance.prepare(`UPDATE chats SET last_message_text = ?, last_message_timestamp = ? WHERE instance_id = ? AND jid = ? AND (last_message_timestamp IS NULL OR ? >= last_message_timestamp)`).run(text, ts, this.id, jid, ts);
                                }
                            }
                        }
                    })();
                    this.io.emit('chat_update', { instanceId: this.id });
                });

                this.sock.ev.on('messages.upsert', (m: any) => {
                    if (m.type === 'notify') {
                        for (const msg of m.messages) {
                            const text = getMessageText(msg);
                            if (text && isJidValid(msg.key.remoteJid!)) {
                                const jid = normalizeJid(msg.key.remoteJid!);
                                const ts = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString();
                                upsertChat.run(this.id, jid, getChatName(jid, msg.pushName), 0, ts);
                                insertMessage.run(this.id, jid, normalizeJid(msg.key.participant || jid), msg.pushName || "Unknown", text, msg.key.fromMe ? 1 : 0, ts);
                                dbInstance.prepare(`UPDATE chats SET last_message_text = ?, last_message_timestamp = ? WHERE instance_id = ? AND jid = ? AND (last_message_timestamp IS NULL OR ? >= last_message_timestamp)`).run(text, ts, this.id, jid, ts);
                                this.io.emit('new_message', { instanceId: this.id, jid, text });
                                this.io.emit('chat_update', { instanceId: this.id });
                            }
                        }
                    }
                });

                evAny.on('chats.upsert', (chats: any[]) => {
                    dbInstance.transaction(() => {
                        for (const chat of chats) {
                            if (!isJidValid(chat.id)) continue;
                            const jid = normalizeJid(chat.id);
                            const ts = chat.conversationTimestamp || chat.lastMessageRecvTimestamp;
                            const isoTs = ts ? new Date(Number(ts) * 1000).toISOString() : null;
                            upsertChat.run(this.id, jid, getChatName(jid, chat.name), chat.unread_count || 0, isoTs);
                        }
                    })();
                    this.io.emit('chat_update', { instanceId: this.id });
                });

                evAny.on('contacts.upsert', (contacts: any[]) => {
                    dbInstance.transaction(() => {
                        for (const contact of contacts) {
                            if (isJidValid(contact.id)) {
                                const jid = normalizeJid(contact.id);
                                const name = contact.name || contact.notify;
                                if (name) upsertContact.run(this.id, jid, name);
                            }
                        }
                    })();
                    this.io.emit('chat_update', { instanceId: this.id });
                });
            }
        } catch (err) {
            console.error(`TRACE [Instance ${this.id}]: FATAL ERROR during init:`, err);
        }
    }

    private startNamingWorker() {
        if (this.namingWorker) return;
        console.log(`TRACE [Instance ${this.id}]: Starting background naming worker...`);
        this.namingWorker = setInterval(async () => {
            const db = getDb();
            const unnamed = db.prepare(`
                SELECT jid, name FROM chats 
                WHERE instance_id = ? AND (name LIKE '%@s.whatsapp.net' OR name = 'Unnamed Group' OR name IS NULL OR name = '')
            `).all(this.id) as any[];

            for (const chat of unnamed) {
                if (chat.jid.endsWith('@g.us')) {
                    try {
                        const metadata = await this.sock?.groupMetadata(chat.jid);
                        if (metadata?.subject) {
                            db.prepare('UPDATE chats SET name = ? WHERE instance_id = ? AND jid = ?').run(metadata.subject, this.id, chat.jid);
                        }
                    } catch (e) {}
                } else {
                    const contact = db.prepare('SELECT name FROM contacts WHERE instance_id = ? AND jid = ?').get(this.id, chat.jid) as any;
                    if (contact?.name) {
                        db.prepare('UPDATE chats SET name = ? WHERE instance_id = ? AND jid = ?').run(contact.name, this.id, chat.jid);
                    }
                }
            }
        }, 60000); 
    }

    async setPresence(presence: 'available' | 'unavailable') {
        this.presence = presence;
        if (this.sock) {
            if (presence === 'available') await this.sock.sendPresenceUpdate('available');
            else await this.sock.sendPresenceUpdate('unavailable');
        }
    }

    async reconnect() {
        this.isReconnecting = true;
        if (this.sock) {
            try { this.sock.end(undefined); } catch (e) {}
            this.sock = null;
        }
        await new Promise(r => setTimeout(r, 2000));
        this.isReconnecting = false;
        await this.init();
    }

    async sendMessage(jid: string, text: string) {
        if (!this.sock || this.status !== 'connected') throw new Error("Instance not connected");
        await this.sock.sendMessage(jid, { text });
        const dbInstance = getDb();
        dbInstance.prepare(`INSERT OR IGNORE INTO messages (instance_id, chat_jid, sender_jid, sender_name, text, is_from_me) VALUES (?, ?, ?, ?, ?, ?)`) 
            .run(this.id, jid, 'me', 'Me', text, 1);
        dbInstance.prepare(`UPDATE chats SET last_message_text = ?, last_message_timestamp = CURRENT_TIMESTAMP WHERE instance_id = ? AND jid = ?`) 
            .run(text, this.id, jid);
    }

    async deleteAuth() {
        if (this.namingWorker) clearInterval(this.namingWorker);
        if (this.sock) { try { await this.sock.logout(); } catch (e) {} this.sock = null; }
        if (fs.existsSync(this.authPath)) fs.rmSync(this.authPath, { recursive: true, force: true });
    }

    async close() {
        if (this.namingWorker) clearInterval(this.namingWorker);
        if (this.sock) { this.sock.end(undefined); this.sock = null; }
    }
}
