import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    WASocket,
    Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { getDb } from '../db/database';
import { normalizeJid } from '../utils';

// Modules
import { MessageManager } from './modules/MessageManager';
import { WorkerManager } from './modules/WorkerManager';
import { ChatManager } from './modules/ChatManager';

export class WhatsAppInstance {
    public id: number;
    public name: string;
    public sock: WASocket | null = null;
    public qr: string | null = null;
    public status: string = 'disconnected';
    public presence: 'available' | 'unavailable' = 'available';
    private authPath: string;
    private isReconnecting: boolean = false;
    private debugEnabled: boolean;
    private io: any;
    private logger: any;

    // Managers
    private messageManager: MessageManager | null = null;
    private workerManager: WorkerManager | null = null;
    private chatManager: ChatManager | null = null;

    constructor(id: number, name: string, io: any, debugEnabled: boolean = false) {
        this.id = id;
        this.name = name;
        this.io = io;
        this.debugEnabled = debugEnabled;
        this.authPath = process.env.NODE_ENV === 'development'
            ? path.join(__dirname, `../../auth_info_${id}`)
            : `/data/auth_info_${id}`;
        this.logger = pino({ level: this.debugEnabled ? 'debug' : 'info' });
    }

    async init() {
        if (this.sock) return;
        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            const { version } = await fetchLatestBaileysVersion();
            const dbInstance = getDb();

            this.sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                browser: Browsers.ubuntu('Chrome'),
                syncFullHistory: true,
                markOnlineOnConnect: this.presence === 'available',
                connectTimeoutMs: 600000,
                defaultQueryTimeoutMs: 600000,
                logger: this.logger
            });

            // Initialize Managers
            this.messageManager = new MessageManager(this.id, this.sock, this.io, this.logger);
            this.workerManager = new WorkerManager(this.id, this.sock, () => this.status, () => this.reconnect());
            this.chatManager = new ChatManager(this.id, this.sock, this.io);

            // Connection Updates
            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr) this.qr = await qrcode.toDataURL(qr);
                
                if (connection === 'open') {
                    this.status = 'connected';
                    dbInstance.prepare('UPDATE instances SET status = ? WHERE id = ?').run('connected', this.id);
                    this.workerManager?.startAll();
                }

                if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    this.status = 'disconnected';
                    this.sock = null;
                    dbInstance.prepare('UPDATE instances SET status = ? WHERE id = ?').run('disconnected', this.id);
                    
                    if (statusCode === DisconnectReason.loggedOut) {
                        await this.deleteAuth();
                    } else {
                        if (!this.isReconnecting) {
                            console.log(`[Instance ${this.id}]: Connection closed (${statusCode}), reconnecting in 5s...`);
                            setTimeout(() => this.reconnect(), 5000);
                        }
                    }
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            // Events
            (this.sock.ev as any).on('events', (events: any) => {
                this.io.emit('raw_whatsapp_event', { timestamp: new Date().toISOString(), instanceId: this.id, events });
            });

            this.sock.ev.on('messaging-history.set', (payload) => this.messageManager?.handleHistorySet(payload));
            this.sock.ev.on('chats.upsert', (chats) => this.messageManager?.handleChatsUpsert(chats));
            this.sock.ev.on('chats.update', (updates) => this.messageManager?.handleChatsUpdate(updates));
            this.sock.ev.on('contacts.upsert', (contacts) => this.messageManager?.handleContactsUpsert(contacts));
            this.sock.ev.on('contacts.update', (updates) => this.messageManager?.handleContactsUpdate(updates));

            this.sock.ev.on('messages.upsert', (m) => this.messageManager?.handleIncomingMessages(m));

            this.sock.ev.on('message-receipt.update', (updates) => {
                for (const { key, receipt } of updates) {
                    const status = receipt.readTimestamp ? 'read' : receipt.receiptTimestamp ? 'delivered' : 'sent';
                    dbInstance.prepare('UPDATE messages SET status = ? WHERE whatsapp_id = ?').run(status, key.id);
                }
                this.io.emit('chat_update', { instanceId: this.id });
            });

            this.sock.ev.on('presence.update', (update) => {
                this.io.emit('presence_update', { instanceId: this.id, jid: normalizeJid(update.id), presence: update.presences });
            });

        } catch (err) {
            console.error(`FATAL ERROR during init:`, err);
        }
    }

    async setPresence(presence: 'available' | 'unavailable') {
        this.presence = presence;
        if (this.sock) await this.sock.sendPresenceUpdate(presence);
    }

    async reconnect() {
        this.isReconnecting = true;
        this.workerManager?.stopAll();
        if (this.sock) { try { this.sock.end(undefined); } catch (e) {} this.sock = null; }
        await new Promise(r => setTimeout(r, 2000));
        this.isReconnecting = false;
        await this.init();
    }

    async sendMessage(jid: string, text: string) {
        if (!this.sock || this.status !== 'connected') throw new Error("Instance not connected");
        await this.sock.sendMessage(normalizeJid(jid), { text });
    }

    // Delegated methods
    async createGroup(title: string, participants: string[]) { return this.chatManager?.createGroup(title, participants); }
    async updateGroupParticipants(jid: string, p: string[], a: any) { return this.chatManager?.updateGroupParticipants(jid, p, a); }
    async updateGroupMetadata(jid: string, u: any) { return this.chatManager?.updateGroupMetadata(jid, u); }
    async modifyChat(jid: string, action: any) { return this.chatManager?.modifyChat(jid, action); }

    async deleteAuth() {
        this.workerManager?.stopAll();
        if (this.sock) { try { await this.sock.logout(); } catch (e) {} this.sock = null; }
        if (fs.existsSync(this.authPath)) fs.rmSync(this.authPath, { recursive: true, force: true });
    }

    async close() {
        this.workerManager?.stopAll();
        if (this.sock) { this.sock.end(undefined); this.sock = null; }
    }
}
