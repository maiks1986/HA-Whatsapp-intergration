import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    WASocket,
    ConnectionState,
    Browsers,
    Contact,
    downloadMediaMessage,
    WAMessage
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
    private historyWorker: NodeJS.Timeout | null = null;
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
        if (this.sock) return;
        
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
                INSERT INTO messages 
                (instance_id, whatsapp_id, chat_jid, sender_jid, sender_name, text, type, media_path, status, timestamp, is_from_me, parent_message_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(whatsapp_id) DO UPDATE SET
                text = excluded.text,
                status = excluded.status
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

            const normalizeJid = (jid: string) => jid?.split(':')[0] + (jid?.includes('@') ? '@' + jid.split('@')[1] : '');

            const saveMessageToDb = async (m: WAMessage, instanceId: number) => {
                const message = m.message;
                if (!message) return;

                const jid = normalizeJid(m.key.remoteJid!);
                const whatsapp_id = m.key.id!;
                const timestamp = new Date(Number(m.messageTimestamp) * 1000).toISOString();
                const is_from_me = m.key.fromMe ? 1 : 0;
                const sender_jid = m.key.participant ? normalizeJid(m.key.participant) : jid;
                const sender_name = m.pushName || "Unknown";

                let text = message.conversation || message.extendedTextMessage?.text || "";
                let type: any = 'text';
                let media_path = null;

                // Handle Media
                const mediaType = Object.keys(message)[0];
                if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(mediaType)) {
                    type = mediaType.replace('Message', '');
                    text = (message as any)[mediaType]?.caption || "";
                    
                    try {
                        const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: logger as any, reuploadRequest: this.sock!.updateMediaMessage });
                        const fileName = `${whatsapp_id}.${type === 'audio' ? 'ogg' : type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : 'bin'}`;
                        const dir = process.env.NODE_ENV === 'development' ? './media' : '/data/media';
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        media_path = path.join(dir, fileName);
                        fs.writeFileSync(media_path, buffer);
                    } catch (e) {
                        console.error("Media Download Error:", e);
                    }
                }

                // Handle Edits
                if (message.protocolMessage?.type === 14) { 
                    const editedId = message.protocolMessage.key?.id;
                    const newText = message.protocolMessage.editedMessage?.conversation || message.protocolMessage.editedMessage?.extendedTextMessage?.text;
                    if (editedId && newText) {
                        dbInstance.prepare('UPDATE messages SET text = ? WHERE whatsapp_id = ?').run(newText, editedId);
                    }
                    return;
                }

                // Handle Reactions
                if (message.reactionMessage) {
                    const targetId = message.reactionMessage.key?.id;
                    const emoji = message.reactionMessage.text;
                    if (targetId && emoji) {
                        dbInstance.prepare('INSERT OR REPLACE INTO reactions (instance_id, message_whatsapp_id, sender_jid, emoji) VALUES (?, ?, ?, ?)')
                            .run(instanceId, targetId, sender_jid, emoji);
                    }
                    return;
                }

                insertMessage.run(instanceId, whatsapp_id, jid, sender_jid, sender_name, text, type, media_path, 'sent', timestamp, is_from_me, null);
                upsertChat.run(instanceId, jid, sender_name, 0, timestamp);
                dbInstance.prepare('UPDATE chats SET last_message_text = ?, last_message_timestamp = ? WHERE instance_id = ? AND jid = ?').run(text || `[${type}]`, timestamp, instanceId, jid);
            };

            if (this.sock) {
                const evAny = this.sock.ev as any;

                evAny.on('events', (events: any) => {
                    const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), instanceId: this.id, events }, (k, v) => (typeof v === 'object' && v !== null && k === 'events') ? '[Payload]' : v);
                    this.io.emit('raw_whatsapp_event', { timestamp: new Date().toISOString(), instanceId: this.id, events });
                });

                this.sock.ev.on('connection.update', async (update) => {
                    const { connection, qr } = update;
                    if (qr) this.qr = await qrcode.toDataURL(qr);
                    if (connection === 'open') {
                        this.status = 'connected';
                        dbInstance.prepare('UPDATE instances SET status = ? WHERE id = ?').run('connected', this.id);
                        this.startNamingWorker();
                        this.startDeepHistoryWorker();
                    }
                });

                this.sock.ev.on('creds.update', saveCreds);

                this.sock.ev.on('messages.upsert', async (m) => {
                    for (const msg of m.messages) {
                        await saveMessageToDb(msg, this.id);
                    }
                    this.io.emit('chat_update', { instanceId: this.id });
                });

                this.sock.ev.on('message-receipt.update', (updates) => {
                    for (const { key, receipt } of updates) {
                        const status = receipt.readTimestamp ? 'read' : receipt.receiptTimestamp ? 'delivered' : 'sent';
                        dbInstance.prepare('UPDATE messages SET status = ? WHERE whatsapp_id = ?').run(status, key.id);
                    }
                    this.io.emit('chat_update', { instanceId: this.id });
                });
            }
        } catch (err) {
            console.error(`FATAL ERROR during init:`, err);
        }
    }

    private startNamingWorker() {
        if (this.namingWorker) return;
        this.namingWorker = setInterval(async () => {
            const db = getDb();
            const unnamed = db.prepare(`SELECT jid, name FROM chats WHERE instance_id = ? AND (name LIKE '%@s.whatsapp.net' OR name = 'Unnamed Group' OR name IS NULL OR name = '')`).all(this.id) as any[];
            for (const chat of unnamed) {
                if (chat.jid.endsWith('@g.us')) {
                    try {
                        const metadata = await this.sock?.groupMetadata(chat.jid);
                        if (metadata?.subject) db.prepare('UPDATE chats SET name = ? WHERE instance_id = ? AND jid = ?').run(metadata.subject, this.id, chat.jid);
                    } catch (e) {}
                }
            }
        }, 60000);
    }

    private startDeepHistoryWorker() {
        if (this.historyWorker) return;
        this.historyWorker = setInterval(async () => {
            if (!this.sock || this.status !== 'connected') return;
            const db = getDb();
            const chat = db.prepare(`SELECT jid FROM chats WHERE instance_id = ? AND is_fully_synced = 0 LIMIT 1`).get(this.id) as any;
            if (!chat) { clearInterval(this.historyWorker!); return; }
            try {
                // Fetch 50 messages
                const result = await this.sock.fetchMessageHistory(50, { id: 'dummy', fromMe: false }, 0);
                if (!result) db.prepare('UPDATE chats SET is_fully_synced = 1 WHERE instance_id = ? AND jid = ?').run(this.id, chat.jid);
            } catch (e) {}
        }, 30000);
    }

    async setPresence(presence: 'available' | 'unavailable') {
        this.presence = presence;
        if (this.sock) {
            await this.sock.sendPresenceUpdate(presence);
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
    }

    async deleteAuth() {
        if (this.namingWorker) clearInterval(this.namingWorker);
        if (this.historyWorker) clearInterval(this.historyWorker);
        if (this.sock) { try { await this.sock.logout(); } catch (e) {} this.sock = null; }
        if (fs.existsSync(this.authPath)) fs.rmSync(this.authPath, { recursive: true, force: true });
    }

    async close() {
        if (this.namingWorker) clearInterval(this.namingWorker);
        if (this.historyWorker) clearInterval(this.historyWorker);
        if (this.sock) { this.sock.end(undefined); this.sock = null; }
    }
}
