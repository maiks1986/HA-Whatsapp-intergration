import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    WASocket,
    ConnectionState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import db from '../db/database';
import path from 'path';
import fs from 'fs';

export class WhatsAppInstance {
    public id: number;
    public name: string;
    public sock: WASocket | null = null;
    public qr: string | null = null;
    public status: string = 'disconnected';
    private authPath: string;

    constructor(id: number, name: string) {
        this.id = id;
        this.name = name;
        this.authPath = process.env.NODE_ENV === 'development'
            ? path.join(__dirname, `../../auth_info_${id}`)
            : `/data/auth_info_${id}`;
    }

    async init() {
        const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false
        });

        this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log(`Instance ${this.id}: New QR Code generated`);
                this.qr = await qrcode.toDataURL(qr);
                this.status = 'qr_ready';
            }

            if (connection === 'open') {
                console.log(`Instance ${this.id}: Connected successfully`);
                this.status = 'connected';
                this.qr = null;
                db.prepare('UPDATE instances SET status = ? WHERE id = ?').run('connected', this.id);
            }

            if (connection === 'close') {
                console.log(`Instance ${this.id}: Connection closed`);
                this.status = 'disconnected';
                db.prepare('UPDATE instances SET status = ? WHERE id = ?').run('disconnected', this.id);
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log(`Instance ${this.id}: Reconnecting...`);
                    this.init();
                }
            }
        });

        this.sock.ev.on('creds.update', saveCreds);

        // Sync Chats
        this.sock.ev.on('messaging-history.set', ({ chats }) => {
            console.log(`Instance ${this.id}: Syncing ${chats.length} chats from history`);
            const upsertChat = db.prepare(`
                INSERT INTO chats (instance_id, jid, name, unread_count) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT(instance_id, jid) DO UPDATE SET
                name = excluded.name,
                unread_count = excluded.unread_count
            `);
            for (const chat of chats) {
                upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0], chat.unreadCount || 0);
            }
        });

        this.sock.ev.on('chats.upsert', (chats) => {
            const upsertChat = db.prepare(`
                INSERT INTO chats (instance_id, jid, name) 
                VALUES (?, ?, ?)
                ON CONFLICT(instance_id, jid) DO UPDATE SET name = excluded.name
            `);
            for (const chat of chats) {
                upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0]);
            }
        });

        this.sock.ev.on('messages.upsert', async m => {
            if (m.type === 'notify') {
                for (const msg of m.messages) {
                    const text = msg.message?.conversation || 
                                 msg.message?.extendedTextMessage?.text || 
                                 msg.message?.imageMessage?.caption || "";
                    
                    if (text) {
                        const jid = msg.key.remoteJid!;
                        // Save Message
                        db.prepare(`
                            INSERT OR IGNORE INTO messages 
                            (instance_id, chat_jid, sender_jid, sender_name, text, is_from_me) 
                            VALUES (?, ?, ?, ?, ?, ?)
                        `).run(
                            this.id, 
                            jid, 
                            msg.key.participant || jid,
                            msg.pushName || "Unknown",
                            text,
                            msg.key.fromMe ? 1 : 0
                        );

                        // Update Chat "Last Message"
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
        });
    }

    async sendMessage(jid: string, text: string) {
        if (!this.sock || this.status !== 'connected') throw new Error("Instance not connected");
        await this.sock.sendMessage(jid, { text });
        
        // Log outgoing message to DB
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

    async close() {
        if (this.sock) {
            this.sock.logout();
            this.sock = null;
        }
    }
}