import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    WASocket,
    ConnectionState,
    Browsers
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

        console.log(`Instance ${this.id}: Initializing with Baileys v${version.join('.')}`);

        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: true, // Force full history sync
            markOnlineOnConnect: true
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
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                console.log(`Instance ${this.id}: Connection closed. Status: ${statusCode}`);
                
                this.status = 'disconnected';
                db.prepare('UPDATE instances SET status = ? WHERE id = ?').run('disconnected', this.id);
                
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log(`Instance ${this.id}: Reconnecting...`);
                    setTimeout(() => this.init(), 5000); // 5s delay before reconnect
                }
            }
        });

        this.sock.ev.on('creds.update', saveCreds);

        // Track ALL events for debugging
        this.sock.ev.process(async (events) => {
            if (events['messaging-history.set']) {
                const { chats, messages } = events['messaging-history.set'];
                console.log(`Instance ${this.id}: Received history set. Chats: ${chats.length}, Messages: ${messages.length}`);
                
                const upsertChat = db.prepare(`
                    INSERT INTO chats (instance_id, jid, name, unread_count) 
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(instance_id, jid) DO UPDATE SET
                    name = CASE WHEN excluded.name IS NOT NULL THEN excluded.name ELSE chats.name END,
                    unread_count = excluded.unread_count
                `);

                db.transaction(() => {
                    for (const chat of chats) {
                        upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0], chat.unreadCount || 0);
                    }
                })();
            }

            if (events['chats.upsert']) {
                console.log(`Instance ${this.id}: Chats upserted: ${events['chats.upsert'].length}`);
                const upsertChat = db.prepare(`
                    INSERT INTO chats (instance_id, jid, name) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(instance_id, jid) DO UPDATE SET 
                    name = CASE WHEN excluded.name IS NOT NULL THEN excluded.name ELSE chats.name END
                `);
                for (const chat of events['chats.upsert']) {
                    upsertChat.run(this.id, chat.id, chat.name || chat.id.split('@')[0]);
                }
            }

            if (events['messages.upsert']) {
                const { messages: newMsgs, type } = events['messages.upsert'];
                if (type === 'notify') {
                    for (const msg of newMsgs) {
                        const text = msg.message?.conversation || 
                                     msg.message?.extendedTextMessage?.text || 
                                     msg.message?.imageMessage?.caption || "";
                        
                        if (text) {
                            const jid = msg.key.remoteJid!;
                            console.log(`Instance ${this.id}: New message from ${jid}`);
                            
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
            }
        });
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
            INSERT INTO chats (instance_id, jid, last_message_text, last_message_timestamp)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(instance_id, jid) DO UPDATE SET
            last_message_text = excluded.last_message_text,
            last_message_timestamp = CURRENT_TIMESTAMP
        `).run(this.id, jid, text);
    }

    async close() {
        if (this.sock) {
            this.sock.logout();
            this.sock = null;
        }
    }
}
