import { WASocket } from '@whiskeysockets/baileys';
import { getDb } from '../../db/database';
import { normalizeJid } from '../../utils';

export class WorkerManager {
    private namingWorker: NodeJS.Timeout | null = null;
    private historyWorker: NodeJS.Timeout | null = null;
    private nudgeTimer: NodeJS.Timeout | null = null;

    constructor(private instanceId: number, private sock: WASocket, private status: () => string, private reconnect: () => void) {}

    startAll() {
        this.startNamingWorker();
        this.startDeepHistoryWorker();
        this.startAutoNudgeWorker();
    }

    stopAll() {
        if (this.namingWorker) clearInterval(this.namingWorker);
        if (this.historyWorker) clearInterval(this.historyWorker);
        if (this.nudgeTimer) clearInterval(this.nudgeTimer);
    }

    private startNamingWorker() {
        if (this.namingWorker) return;
        this.namingWorker = setInterval(async () => {
            const db = getDb();
            const unnamed = db.prepare(`SELECT jid FROM chats WHERE instance_id = ? AND (name LIKE '%@s.whatsapp.net' OR name = 'Unnamed Group' OR name IS NULL OR name = '')`).all(this.instanceId) as any[];
            for (const chat of unnamed) {
                const normalized = normalizeJid(chat.jid);
                if (normalized.endsWith('@g.us')) {
                    try {
                        const metadata = await this.sock.groupMetadata(normalized);
                        if (metadata?.subject) db.prepare('UPDATE chats SET name = ? WHERE instance_id = ? AND jid = ?').run(metadata.subject, this.instanceId, normalized);
                    } catch (e) {}
                }
            }
        }, 60000);
    }

    private startDeepHistoryWorker() {
        if (this.historyWorker) return;
        this.historyWorker = setInterval(async () => {
            if (this.status() !== 'connected') return;
            const db = getDb();
            const chat = db.prepare(`SELECT jid FROM chats WHERE instance_id = ? AND is_fully_synced = 0 LIMIT 1`).get(this.instanceId) as any;
            if (!chat) { clearInterval(this.historyWorker!); this.historyWorker = null; return; }
            
            try {
                const oldest = db.prepare('SELECT whatsapp_id, timestamp, is_from_me FROM messages WHERE instance_id = ? AND chat_jid = ? ORDER BY timestamp ASC LIMIT 1').get(this.instanceId, chat.jid) as any;
                const oldestKey = oldest ? { id: oldest.whatsapp_id, remoteJid: chat.jid, fromMe: !!oldest.is_from_me } : undefined;
                const oldestTs = oldest ? Math.floor(new Date(oldest.timestamp).getTime()/1000) : 0;

                const result = await this.sock.fetchMessageHistory(100, oldestKey as any, oldestTs);
                if (!result || result === '') {
                    db.prepare('UPDATE chats SET is_fully_synced = 1 WHERE instance_id = ? AND jid = ?').run(this.instanceId, chat.jid);
                }
            } catch (e) {}
        }, 15000);
    }

    private startAutoNudgeWorker() {
        if (this.nudgeTimer) clearInterval(this.nudgeTimer);
        this.nudgeTimer = setInterval(async () => {
            const db = getDb();
            const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('auto_nudge_enabled') as any;
            if (setting?.value === 'false') return;

            const chatCount = db.prepare('SELECT COUNT(*) as count FROM chats WHERE instance_id = ?').get(this.instanceId) as any;
            if (chatCount?.count === 0 && this.status() === 'connected') {
                console.log(`[Instance ${this.instanceId}]: Auto-Nudge triggered.`);
                this.reconnect();
            }
        }, 600000);
    }
}
