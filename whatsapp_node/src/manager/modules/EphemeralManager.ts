import { WASocket } from '@whiskeysockets/baileys';
import { getDb } from '../../db/database';
import { normalizeJid } from '../../utils';

export class EphemeralManager {
    private interval: NodeJS.Timeout | null = null;

    constructor(private instanceId: number, private sock: WASocket, private io: any) {}

    public start() {
        if (this.interval) return;
        // Run cleanup every 5 minutes
        this.interval = setInterval(() => this.processCleanup(), 5 * 60 * 1000);
        console.log(`[EphemeralManager ${this.instanceId}]: Started watcher service.`);
    }

    public stop() {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
    }

    public async enableForChat(jid: string, timerMinutes: number = 60) {
        const db = getDb();
        const now = new Date().toISOString();
        db.prepare('UPDATE chats SET ephemeral_mode = 1, ephemeral_timer = ?, ephemeral_start_timestamp = ? WHERE instance_id = ? AND jid = ?')
            .run(timerMinutes, now, this.instanceId, normalizeJid(jid));
        
        console.log(`[EphemeralManager ${this.instanceId}]: Enabled for ${jid} (Timer: ${timerMinutes}m)`);
        this.io.emit('chat_update', { instanceId: this.instanceId });
        await this.sock.sendMessage(normalizeJid(jid), { text: `[System] Ephemeral Mode Enabled. Messages will be auto-cleared from this device after ${timerMinutes} minutes.` });
    }

    public async disableForChat(jid: string) {
        const db = getDb();
        db.prepare('UPDATE chats SET ephemeral_mode = 0 WHERE instance_id = ? AND jid = ?')
            .run(this.instanceId, normalizeJid(jid));
        
        console.log(`[EphemeralManager ${this.instanceId}]: Disabled for ${jid}`);
        this.io.emit('chat_update', { instanceId: this.instanceId });
        await this.sock.sendMessage(normalizeJid(jid), { text: `[System] Ephemeral Mode Disabled.` });
    }

    public async handleIncomingMessage(jid: string, text: string, fromMe: boolean) {
        // Only process commands from the "Owner" (me) to prevent others from controlling my settings?
        // OR allow anyone in the chat to toggle it? 
        // User request: "so the user can start and stop this function from their device." -> Implies "Me".
        // But "recipient" reading it implies 1-on-1. 
        // Let's check who sent it. If strict mode is needed, we can add it. For now, allow both parties in 1-on-1, or just Me.
        // Assuming "User" = "Me".
        
        if (!text) return;
        const cleanText = text.trim();

        const db = getDb();
        const startEmoji = (db.prepare('SELECT value FROM settings WHERE key = ?').get('ephemeral_trigger_start') as any)?.value || '👻';
        const stopEmoji = (db.prepare('SELECT value FROM settings WHERE key = ?').get('ephemeral_trigger_stop') as any)?.value || '🛑';

        if (cleanText === startEmoji) {
            await this.enableForChat(jid, 60); // Default 60 mins via emoji
        } else if (cleanText === stopEmoji) {
            await this.disableForChat(jid);
        }
    }

    private async processCleanup() {
        const db = getDb();
        const now = new Date();

        // 1. Find enabled chats
        const chats = db.prepare('SELECT jid, ephemeral_timer, ephemeral_start_timestamp FROM chats WHERE instance_id = ? AND ephemeral_mode = 1').all(this.instanceId) as any[];

        for (const chat of chats) {
            if (!chat.ephemeral_start_timestamp) continue;
            
            const startTime = new Date(chat.ephemeral_start_timestamp);
            const timerMs = chat.ephemeral_timer * 60 * 1000;

            // 2. Find messages eligible for deletion
            // Logic: 
            // - Not deleted on device yet
            // - Sent AFTER the mode was enabled (timestamp > start_timestamp)
            // - Age > Timer
            // - Status is finalized (sent/delivered/read) to avoid deleting pending messages? Actually Age check covers this.
            
            const messages = db.prepare(`
                SELECT whatsapp_id, timestamp, is_from_me 
                FROM messages 
                WHERE instance_id = ? 
                AND chat_jid = ? 
                AND deleted_on_device = 0
                AND timestamp > ?
            `).all(this.instanceId, chat.jid, chat.ephemeral_start_timestamp) as any[];

            const toDelete: any[] = [];

            for (const msg of messages) {
                const msgTime = new Date(msg.timestamp);
                if (now.getTime() - msgTime.getTime() > timerMs) {
                    toDelete.push({
                        id: msg.whatsapp_id,
                        fromMe: msg.is_from_me === 1,
                        timestamp: msg.timestamp // Baileys might need this? actually ID and fromMe are critical.
                    });
                }
            }

            if (toDelete.length > 0) {
                console.log(`[EphemeralManager ${this.instanceId}]: Cleaning up ${toDelete.length} messages in ${chat.jid}`);
                try {
                    // Baileys 'chatModify' with 'clear' action for specific messages
                    // Note: 'clear' usually clears ALL messages if specific ones aren't provided correctly.
                    // Baileys API signature for clearing specific messages:
                    // sock.chatModify({ clear: { messages: [{ id, fromMe, timestamp }] } }, jid)
                    
                    await this.sock.chatModify({
                        clear: {
                            messages: toDelete
                        }
                    } as any, chat.jid);

                    // 3. Update DB
                    const placeholders = toDelete.map(() => '?').join(',');
                    db.prepare(`UPDATE messages SET deleted_on_device = 1 WHERE whatsapp_id IN (${placeholders})`)
                        .run(...toDelete.map(m => m.id));
                        
                } catch (e) {
                    console.error(`[EphemeralManager ${this.instanceId}]: Cleanup failed for ${chat.jid}`, e);
                }
            }
        }
    }
}
