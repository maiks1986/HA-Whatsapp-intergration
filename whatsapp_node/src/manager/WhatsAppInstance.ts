import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    WASocket,
    Browsers,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import NodeCache from 'node-cache';
import { getDb } from '../db/database';
import { normalizeJid } from '../utils';

// Modules
import { MessageManager } from './modules/MessageManager';
import { WorkerManager } from './modules/WorkerManager';
import { ChatManager } from './modules/ChatManager';
import { QRManager } from './modules/QRManager';
import { EphemeralManager } from './modules/EphemeralManager';
import { StealthManager } from './modules/StealthManager';

export class WhatsAppInstance {
    public id: number;
    public name: string;
    public sock: WASocket | null = null;
    // public qr: string | null = null; // Removed in favor of getter
    public status: string = 'disconnected';
    public presence: 'available' | 'unavailable' = 'available';
    private authPath: string;
    private logPath: string;
    private isReconnecting: boolean = false;
    private debugEnabled: boolean;
    private io: any;
    private logger: any;
    private msgRetryCounterCache: NodeCache;

    // Managers
    private messageManager: MessageManager | null = null;
    private workerManager: WorkerManager | null = null;
    private chatManager: ChatManager | null = null;
    public ephemeralManager: EphemeralManager | null = null;
    public stealthManager: StealthManager | null = null;
    private qrManager: QRManager;
    
    // Health Monitor
    private errorCount: number = 0;
    private lastErrorTime: number = 0;

    constructor(id: number, name: string, io: any, debugEnabled: boolean = false) {
        this.id = id;
        this.name = name;
        this.io = io;
        this.debugEnabled = debugEnabled;
        this.authPath = process.env.NODE_ENV === 'development'
            ? path.join(__dirname, `../../auth_info_${id}`)
            : `/data/auth_info_${id}`;
        this.logPath = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../../raw_events.log') : '/data/raw_events.log';
        this.logger = pino({ level: this.debugEnabled ? 'debug' : 'info' });
        this.qrManager = new QRManager();
        this.msgRetryCounterCache = new NodeCache();
        
        console.log(`[WhatsAppInstance ${this.id}]: Log Path set to: ${this.logPath}`);
        try {
            fs.appendFileSync(this.logPath, `[${new Date().toISOString()}] Instance ${this.id} initialized.\n`);
        } catch (e) {
            console.error(`[WhatsAppInstance ${this.id}]: FAILED TO WRITE TO LOG FILE!`, e);
        }
    }

    get qr(): string | null {
        return this.qrManager.getQr();
    }

    async init() {
        if (this.sock) return;
        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            const { version } = await fetchLatestBaileysVersion();
            const dbInstance = getDb();

            this.sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, this.logger),
                },
                printQRInTerminal: false,
                browser: Browsers.ubuntu('Chrome'),
                syncFullHistory: true,
                markOnlineOnConnect: this.presence === 'available',
                connectTimeoutMs: 120000, // Increased to 2m
                defaultQueryTimeoutMs: 120000,
                generateHighQualityLinkPreview: true,
                logger: this.logger,
                msgRetryCounterCache: this.msgRetryCounterCache
            });

            // 1. ATTACH ROBUST EVENT LOGGING
            const trackedEvents: any[] = [
                'connection.update', 'creds.update', 'messaging-history.set',
                'chats.upsert', 'chats.update', 'chats.delete',
                'presence.update', 'contacts.upsert', 'contacts.update',
                'messages.delete', 'messages.update', 'messages.upsert',
                'message-receipt.update', 'groups.update', 'group-participants.update'
            ];

            for (const eventName of trackedEvents) {
                this.sock.ev.on(eventName, (data) => {
                    const eventData = { 
                        timestamp: new Date().toISOString(), 
                        instanceId: this.id, 
                        type: eventName, 
                        payload: data 
                    };
                    
                    // Emit live
                    this.io.emit('raw_whatsapp_event', eventData);
                    
                    // Save to file
                    try {
                        fs.appendFileSync(this.logPath, JSON.stringify(eventData) + '\n');
                    } catch (e) {}

                    // Special Case: Auto-Reset on Bad MAC/Session Errors
                    if (eventName === 'connection.update' && data.lastDisconnect?.error) {
                        const errMessage = data.lastDisconnect.error.toString();
                        if (errMessage.includes('Bad MAC') || errMessage.includes('SessionError')) {
                            console.error(`[Instance ${this.id}]: CRITICAL - Detected Session Corruption. Deleting Auth.`);
                            this.deleteAuth().then(() => {
                                this.status = 'disconnected';
                                this.emitStatusUpdate();
                            });
                        }
                    }
                });
            }

            // 2. Initialize Managers
            this.messageManager = new MessageManager(this.id, this.sock, this.io, this.logger);
            this.workerManager = new WorkerManager(this.id, this.sock, () => this.status, () => this.reconnect());
            this.chatManager = new ChatManager(this.id, this.sock, this.io);
            this.ephemeralManager = new EphemeralManager(this.id, this.sock, this.io);
            this.ephemeralManager.start();
            this.stealthManager = new StealthManager(this.id, this.sock);
            this.stealthManager.start();

            // Connection Updates
            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    await this.qrManager.processUpdate(qr);
                    this.emitStatusUpdate();
                }
                
                if (connection === 'open') {
                    this.status = 'connected';
                    this.qrManager.clear();
                    dbInstance.prepare('UPDATE instances SET status = ? WHERE id = ?').run('connected', this.id);
                    this.workerManager?.startAll();
                    this.emitStatusUpdate();
                }

                if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    this.status = 'disconnected';
                    this.sock = null;
                    this.qrManager.clear();
                    dbInstance.prepare('UPDATE instances SET status = ? WHERE id = ?').run('disconnected', this.id);
                    this.emitStatusUpdate();
                    
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

            // Sync Listeners
            this.sock.ev.on('messaging-history.set', (payload) => this.messageManager?.handleHistorySet(payload));
            this.sock.ev.on('chats.upsert', (chats) => this.messageManager?.handleChatsUpsert(chats));
            this.sock.ev.on('chats.update', (updates) => this.messageManager?.handleChatsUpdate(updates));
            this.sock.ev.on('contacts.upsert', (contacts) => this.messageManager?.handleContactsUpsert(contacts));
            this.sock.ev.on('contacts.update', (updates) => this.messageManager?.handleContactsUpdate(updates));

            this.sock.ev.on('messages.upsert', async (m) => {
                this.messageManager?.handleIncomingMessages(m);
                
                // Ephemeral Trigger Check
                if (m.messages[0].message) {
                    const msg = m.messages[0];
                    const jid = normalizeJid(msg.key.remoteJid!);
                    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
                    const isFromMe = msg.key.fromMe || false;
                    if (text) {
                        this.ephemeralManager?.handleIncomingMessage(jid, text, isFromMe);
                    }
                }
            });

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
        this.emitStatusUpdate();
    }

    private emitStatusUpdate() {
        if (this.io) {
            this.io.emit('instances_status', [{
                id: this.id,
                status: this.status,
                presence: this.presence,
                qr: this.qrManager.getQr()
            }]);
        }
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
