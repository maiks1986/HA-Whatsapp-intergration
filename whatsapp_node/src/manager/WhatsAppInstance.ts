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
                this.qr = await qrcode.toDataURL(qr);
                this.status = 'qr_ready';
            }

            if (connection === 'open') {
                this.status = 'connected';
                this.qr = null;
                db.prepare('UPDATE instances SET status = ? WHERE id = ?').run('connected', this.id);
            }

            if (connection === 'close') {
                this.status = 'disconnected';
                db.prepare('UPDATE instances SET status = ? WHERE id = ?').run('disconnected', this.id);
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) this.init();
            }
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('messages.upsert', async m => {
            if (m.type === 'notify') {
                for (const msg of m.messages) {
                    const text = msg.message?.conversation || 
                                 msg.message?.extendedTextMessage?.text || 
                                 msg.message?.imageMessage?.caption || "";
                    
                    if (text) {
                        db.prepare(`
                            INSERT OR IGNORE INTO messages 
                            (instance_id, chat_jid, sender_jid, sender_name, text, is_from_me) 
                            VALUES (?, ?, ?, ?, ?, ?)
                        `).run(
                            this.id, 
                            msg.key.remoteJid, 
                            msg.key.participant || msg.key.remoteJid,
                            msg.pushName || "Unknown",
                            text,
                            msg.key.fromMe ? 1 : 0
                        );
                    }
                }
            }
        });
    }

    async sendMessage(jid: string, text: string) {
        if (!this.sock || this.status !== 'connected') throw new Error("Instance not connected");
        await this.sock.sendMessage(jid, { text });
    }

    async close() {
        if (this.sock) {
            this.sock.logout();
            this.sock = null;
        }
    }
}
