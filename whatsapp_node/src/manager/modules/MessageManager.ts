import { WAMessage, downloadMediaMessage, WASocket, Contact, Chat as BaileysChat } from '@whiskeysockets/baileys';
import { getDb } from '../../db/database';
import { normalizeJid } from '../../utils';
import path from 'path';
import fs from 'fs';

export class MessageManager {
    constructor(private instanceId: number, private sock: WASocket, private io: any, private logger: any) {}

    // --- MASS SYNC HANDLERS ---

    async handleHistorySet(payload: any) {
        const { chats, contacts, messages } = payload;
        const db = getDb();
        console.log(`[Sync ${this.instanceId}]: Processing Initial History Set (${chats?.length || 0} chats, ${contacts?.length || 0} contacts)`);

        db.transaction(() => {
            // 1. First, save all contacts to ensure naming fallbacks exist
            if (contacts) {
                for (const contact of contacts) {
                    if (contact.id.includes('@broadcast')) continue;
                    const normalized = normalizeJid(contact.id);
                    const name = contact.name || contact.notify || contact.verifiedName;
                    if (name) {
                        db.prepare('INSERT INTO contacts (instance_id, jid, name) VALUES (?, ?, ?) ON CONFLICT(instance_id, jid) DO UPDATE SET name = excluded.name').run(this.instanceId, normalized, name);
                    }
                }
            }
            // 2. Then, save all chats
            if (chats) {
                for (const chat of chats) {
                    if (chat.id.includes('@broadcast')) continue;
                    const normalized = normalizeJid(chat.id);
                    const name = chat.name || this.resolveNameFromContacts(normalized);
                    db.prepare('INSERT INTO chats (instance_id, jid, name, unread_count) VALUES (?, ?, ?, ?) ON CONFLICT(instance_id, jid) DO UPDATE SET name = CASE WHEN excluded.name IS NOT NULL AND excluded.name != \'\' THEN excluded.name ELSE chats.name END').run(this.instanceId, normalized, name, chat.unreadCount || 0);
                }
            }
        })();

        // 3. Process historical messages (Outside transaction to handle individual media/logic)
        if (messages) {
            console.log(`[Sync ${this.instanceId}]: Saving ${messages.length} historical messages...`);
            for (const msg of messages) await this.saveMessageToDb(msg);
        }
        this.io.emit('chat_update', { instanceId: this.instanceId });
    }

    async handleChatsUpsert(chats: BaileysChat[]) {
        const db = getDb();
        for (const chat of chats) {
            const normalized = normalizeJid(chat.id);
            const name = chat.name || this.resolveNameFromContacts(normalized);
            db.prepare('INSERT INTO chats (instance_id, jid, name, unread_count) VALUES (?, ?, ?, ?) ON CONFLICT(instance_id, jid) DO UPDATE SET name = excluded.name').run(this.instanceId, normalized, name, chat.unreadCount || 0);
        }
        this.io.emit('chat_update', { instanceId: this.instanceId });
    }

    async handleChatsUpdate(updates: Partial<BaileysChat>[]) {
        const db = getDb();
        for (const update of updates) {
            if (!update.id) continue;
            const normalized = normalizeJid(update.id);
            if (update.unreadCount !== undefined) db.prepare('UPDATE chats SET unread_count = ? WHERE instance_id = ? AND jid = ?').run(update.unreadCount, this.instanceId, normalized);
            if (update.name) db.prepare('UPDATE chats SET name = ? WHERE instance_id = ? AND jid = ?').run(update.name, this.instanceId, normalized);
        }
        this.io.emit('chat_update', { instanceId: this.instanceId });
    }

    async handleContactsUpsert(contacts: Contact[]) {
        const db = getDb();
        for (const contact of contacts) {
            const normalized = normalizeJid(contact.id);
            const name = contact.name || contact.notify || contact.verifiedName;
            if (name) db.prepare('INSERT INTO contacts (instance_id, jid, name) VALUES (?, ?, ?) ON CONFLICT(instance_id, jid) DO UPDATE SET name = excluded.name').run(this.instanceId, normalized, name);
        }
    }

    async handleContactsUpdate(updates: Partial<Contact>[]) {
        const db = getDb();
        for (const update of updates) {
            if (!update.id) continue;
            const normalized = normalizeJid(update.id);
            const name = update.name || update.notify || update.verifiedName;
            if (name) db.prepare('UPDATE contacts SET name = ? WHERE instance_id = ? AND jid = ?').run(name, this.instanceId, normalized);
        }
    }

    // --- LOGIC HELPERS ---

    async handleIncomingMessages(m: { messages: WAMessage[] }) {
        for (const msg of m.messages) await this.saveMessageToDb(msg);
        this.io.emit('chat_update', { instanceId: this.instanceId });
    }

    private resolveNameFromContacts(jid: string): string {
        const db = getDb();
        const contact = db.prepare('SELECT name FROM contacts WHERE instance_id = ? AND jid = ?').get(this.instanceId, jid) as any;
        return contact?.name || jid.split('@')[0];
    }

    async saveMessageToDb(m: WAMessage) {
        try {
            const message = m.message;
            if (!message) return;

            const db = getDb();
            const jid = normalizeJid(m.key.remoteJid!);
            const whatsapp_id = m.key.id || `fallback_${Date.now()}_${Math.random()}`;
            const timestamp = new Date(Number(m.messageTimestamp) * 1000).toISOString();
            const is_from_me = m.key.fromMe ? 1 : 0;
            const sender_jid = m.key.participant ? normalizeJid(m.key.participant) : jid;

            // IDENTITY RESOLUTION: The Chat identity should always be the contact name (1-on-1) or group subject.
            let chatIdentityName = this.resolveNameFromContacts(jid);

            if (jid === 'status@broadcast') {
                await this.handleStatusUpdate(m);
                return;
            }

            let text = message.conversation || message.extendedTextMessage?.text || "";
            let type: any = 'text';
            let media_path = null;
            let latitude = null;
            let longitude = null;
            let vcard_data = null;

            const mediaType = Object.keys(message)[0];
            if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(mediaType)) {
                type = mediaType.replace('Message', '');
                text = (message as any)[mediaType]?.caption || "";
                try {
                    const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: this.logger, reuploadRequest: this.sock.updateMediaMessage });
                    const fileName = `${whatsapp_id}.${type === 'audio' ? 'ogg' : type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : 'bin'}`;
                    const dir = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../../../media') : '/data/media';
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    media_path = path.join(dir, fileName);
                    fs.writeFileSync(media_path, buffer);
                } catch (e) {}
            }

            if (message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3) {
                type = 'poll';
                const poll = message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3;
                text = `Poll: ${poll?.name}\nOptions: ${poll?.options?.map(o => o.optionName).join(', ')}`;
            }

            if (message.locationMessage || message.liveLocationMessage) {
                type = 'location';
                const loc = message.locationMessage || message.liveLocationMessage;
                latitude = loc?.degreesLatitude;
                longitude = loc?.degreesLongitude;
                text = `Location: ${latitude}, ${longitude}`;
            }

            if (message.contactMessage || message.contactsArrayMessage) {
                type = 'vcard';
                vcard_data = message.contactMessage ? message.contactMessage.vcard : JSON.stringify(message.contactsArrayMessage?.contacts?.map(c => c.vcard) || []);
                text = "Shared Contact Card";
            }

            if (message.protocolMessage?.type === 14) {
                const editedId = message.protocolMessage.key?.id;
                const newText = message.protocolMessage.editedMessage?.conversation || message.protocolMessage.editedMessage?.extendedTextMessage?.text;
                if (editedId && newText) db.prepare('UPDATE messages SET text = ? WHERE whatsapp_id = ?').run(newText, editedId);
                return;
            }

            if (message.reactionMessage) {
                const targetId = message.reactionMessage.key?.id;
                const emoji = message.reactionMessage.text;
                if (targetId && emoji) {
                    db.prepare('INSERT OR REPLACE INTO reactions (instance_id, message_whatsapp_id, sender_jid, emoji) VALUES (?, ?, ?, ?)')
                        .run(this.instanceId, targetId, sender_jid, emoji);
                }
                return;
            }

            // Save Message
            db.prepare(`
                INSERT INTO messages 
                (instance_id, whatsapp_id, chat_jid, sender_jid, sender_name, text, type, media_path, latitude, longitude, vcard_data, status, timestamp, is_from_me) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(whatsapp_id) DO UPDATE SET text = excluded.text, status = excluded.status
            `).run(this.instanceId, whatsapp_id, jid, sender_jid, m.pushName || "Unknown", text, type, media_path, latitude, longitude, vcard_data, 'sent', timestamp, is_from_me);

            // Save/Update Chat with Identity Name (Ensures it doesn't change to "Me" or individual sender name)
            db.prepare(`
                INSERT INTO chats (instance_id, jid, name, unread_count, last_message_timestamp) 
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(instance_id, jid) DO UPDATE SET
                name = CASE WHEN (chats.name IS NULL OR chats.name = '' OR chats.name LIKE '%@s.whatsapp.net' OR chats.name = 'Unnamed Group') AND excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name ELSE chats.name END,
                last_message_timestamp = CASE WHEN excluded.last_message_timestamp IS NOT NULL THEN excluded.last_message_timestamp ELSE chats.last_message_timestamp END
            `).run(this.instanceId, jid, chatIdentityName, 0, timestamp);

            db.prepare('UPDATE chats SET last_message_text = ?, last_message_timestamp = ? WHERE instance_id = ? AND jid = ?').run(text || `[${type}]`, timestamp, this.instanceId, jid);
            this.io.emit('new_message', { instanceId: this.instanceId, jid, text });
        } catch (err) {
            console.error(`[MessageManager ${this.instanceId}]: CRITICAL Error saving message:`, err);
        }
    }

    private async handleStatusUpdate(m: WAMessage) {
        const message = m.message;
        const sender_jid = normalizeJid(m.key.participant || m.key.remoteJid!);
        const sender_name = m.pushName || "Unknown";
        const timestamp = new Date(Number(m.messageTimestamp) * 1000).toISOString();
        let text = message?.conversation || message?.extendedTextMessage?.text || "";
        let type = 'text';
        let media_path = null;
        const mediaType = message ? Object.keys(message)[0] : '';
        if (['imageMessage', 'videoMessage'].includes(mediaType)) {
            type = mediaType.replace('Message', '');
            try {
                const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: this.logger, reuploadRequest: this.sock.updateMediaMessage });
                const fileName = `status_${m.key.id}.${type === 'image' ? 'jpg' : 'mp4'}`;
                const dir = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../../../media') : '/data/media';
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                media_path = path.join(dir, fileName);
                fs.writeFileSync(media_path, buffer);
            } catch (e) {}
        }
        getDb().prepare(`INSERT INTO status_updates (instance_id, sender_jid, sender_name, type, text, media_path, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(this.instanceId, sender_jid, sender_name, type, text, media_path, timestamp);
        this.io.emit('status_update', { instanceId: this.instanceId });
    }
}