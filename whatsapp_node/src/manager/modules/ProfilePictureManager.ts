import { WASocket } from '@whiskeysockets/baileys';
import { getDb } from '../../db/database';
import { normalizeJid } from '../../utils';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

export class ProfilePictureManager {
    private queue: Set<string> = new Set();
    private interval: NodeJS.Timeout | null = null;
    private processing = false;
    private avatarDir: string;

    constructor(private instanceId: number, private sock: WASocket) {
        this.avatarDir = process.env.NODE_ENV === 'development' 
            ? path.join(__dirname, '../../../../media/avatars') 
            : '/data/media/avatars';
        this.ensureDir();
    }

    private ensureDir() {
        if (!fs.existsSync(this.avatarDir)) {
            fs.mkdirSync(this.avatarDir, { recursive: true });
        }
    }

    public start() {
        if (this.interval) return;
        // Process 1 item every 3 seconds to be safe
        this.interval = setInterval(() => this.processNext(), 3000);
        console.log(`[ProfilePictureManager ${this.instanceId}]: Started worker.`);
    }

    public stop() {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
    }

    public enqueue(jids: string[]) {
        for (const jid of jids) {
            if (jid.includes('@broadcast') || jid === 'status@broadcast') continue;
            this.queue.add(normalizeJid(jid));
        }
        if (!this.interval) this.start();
    }

    private async processNext() {
        if (this.processing || this.queue.size === 0) return;
        this.processing = true;

        const jid = this.queue.values().next().value;
        if (!jid) {
            this.processing = false;
            return;
        }
        this.queue.delete(jid);

        try {
            // Check if we recently updated this (e.g. < 24h)
            // Skip check for now to force initial sync, logic can be added later
            
            // console.log(`[ProfilePictureManager]: Fetching for ${jid}`);
            const url = await this.sock.profilePictureUrl(jid, 'image'); // 'image' = high res
            
            if (url) {
                const response = await axios.get(url, { responseType: 'arraybuffer' });
                const fileName = `${jid.replace(/[^a-zA-Z0-9]/g, '_')}.jpg`; // Safe filename
                const filePath = path.join(this.avatarDir, fileName);
                
                fs.writeFileSync(filePath, response.data);
                
                const db = getDb();
                const now = new Date().toISOString();
                const relativePath = `avatars/${fileName}`;

                // Update both tables just in case
                db.prepare('UPDATE contacts SET profile_picture = ?, profile_picture_timestamp = ? WHERE instance_id = ? AND jid = ?')
                    .run(relativePath, now, this.instanceId, jid);
                
                db.prepare('UPDATE chats SET profile_picture = ?, profile_picture_timestamp = ? WHERE instance_id = ? AND jid = ?')
                    .run(relativePath, now, this.instanceId, jid);
            }
        } catch (e: any) {
            // 401/404/400 means no profile pic or privacy restricted
            // Mark as 'none' to avoid re-fetching constantly? Or just update timestamp
            const db = getDb();
            const now = new Date().toISOString();
            // Only update timestamp to skip it next time, don't clear existing pic if temporary error
            // But if it's 404/401/410, it's gone/private
            if (e?.data === 401 || e?.data === 404 || e?.data === 410 || (e?.message && e.message.includes('not-authorized'))) {
                 db.prepare('UPDATE contacts SET profile_picture = NULL, profile_picture_timestamp = ? WHERE instance_id = ? AND jid = ?')
                    .run(now, this.instanceId, jid);
                 db.prepare('UPDATE chats SET profile_picture = NULL, profile_picture_timestamp = ? WHERE instance_id = ? AND jid = ?')
                    .run(now, this.instanceId, jid);
            }
        } finally {
            this.processing = false;
        }
    }
}
