import { Router } from 'express';
import { getDb } from '../../db/database';
import { engineManager } from '../../manager/EngineManager';
import { normalizeJid } from '../../utils';
import { requireAuth } from '../authMiddleware';
import { Chat, AuthUser, Instance } from '../../types';

export const messagingRouter = () => {
    const router = Router();
    const db = getDb();

    router.get('/chats/:instanceId', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const user = (req as any).haUser;
        const instanceData = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as any;
        if (!user.isAdmin && instanceData?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        const chats = db.prepare(`
            SELECT 
                c.jid, 
                COALESCE(co.name, c.name, c.jid) as name, 
                SUM(c.unread_count) as unread_count, 
                MAX(c.last_message_text) as last_message_text, 
                MAX(c.last_message_timestamp) as last_message_timestamp,
                MAX(c.is_archived) as is_archived,
                MAX(c.is_pinned) as is_pinned,
                MAX(c.ephemeral_mode) as ephemeral_mode,
                MAX(c.ephemeral_timer) as ephemeral_timer,
                COALESCE(c.profile_picture, co.profile_picture) as profile_picture
            FROM chats c
            LEFT JOIN contacts co ON c.jid = co.jid AND c.instance_id = co.instance_id
            WHERE c.instance_id = ? 
              AND c.jid NOT LIKE '%@broadcast'
              AND (c.last_message_timestamp IS NOT NULL OR c.is_pinned = 1 OR c.unread_count > 0)
            GROUP BY COALESCE(co.lid, c.jid)
            ORDER BY MAX(c.is_pinned) DESC, MAX(c.last_message_timestamp) DESC
        `).all(instanceId) as Chat[];
        res.json(chats);
    });

    router.get('/contacts/:instanceId', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const user = (req as any).haUser;
        const instanceData = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as any;
        if (!user.isAdmin && instanceData?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        // Explicitly select columns or * is fine if we added it
        const contacts = db.prepare('SELECT instance_id, jid, name, lid, profile_picture FROM contacts WHERE instance_id = ? ORDER BY name ASC').all(instanceId);
        res.json(contacts);
    });

    router.get('/messages/:instanceId/:jid', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const jid = normalizeJid(req.params.jid);
        const user = (req as any).haUser as AuthUser;
        const instanceData = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as Instance | undefined;
        if (!user.isAdmin && instanceData?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        // UNIFIED HISTORY: Fetch messages for BOTH the requested JID and its linked LID/Phone JID
        const messages = db.prepare(`
            SELECT m.* 
            FROM messages m
            WHERE m.instance_id = ? 
              AND (
                m.chat_jid = ? 
                OR m.chat_jid = (SELECT lid FROM contacts WHERE jid = ? AND instance_id = ?)
                OR m.chat_jid = (SELECT jid FROM contacts WHERE lid = ? AND instance_id = ?)
              )
            ORDER BY m.timestamp ASC
        `).all(instanceId, jid, jid, instanceId, jid, instanceId) as any[];

        for (const msg of messages) {
            msg.reactions = db.prepare('SELECT sender_jid, emoji FROM reactions WHERE instance_id = ? AND message_whatsapp_id = ?').all(instanceId, msg.whatsapp_id);
        }
        res.json(messages);
    });

    router.get('/messages/:instanceId/search', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const { query, type, jid } = req.query;
        let sql = 'SELECT * FROM messages WHERE instance_id = ?';
        const params: any[] = [instanceId];
        if (jid) { sql += ' AND chat_jid = ?'; params.push(normalizeJid(jid as string)); }
        if (query) { sql += ' AND text LIKE ?'; params.push(`%${query}%`); }
        if (type) { sql += ' AND type = ?'; params.push(type); }
        sql += ' ORDER BY timestamp DESC LIMIT 100';
        res.json(db.prepare(sql).all(...params));
    });

    router.post('/send_message', requireAuth, async (req, res) => {
        const { instanceId, contact, message } = req.body;
        const jid = normalizeJid(contact);
        const instance = engineManager.getInstance(instanceId);
        if (!instance) return res.status(404).json({ error: "Instance not found" });
        try {
            await instance.sendMessage(jid, message);
            res.json({ success: true });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    router.post('/chats/:instanceId/:jid/modify', requireAuth, async (req, res) => {
        const { instanceId, jid } = req.params;
        const normalized = normalizeJid(jid);
        const { action } = req.body; 
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (!inst) return res.status(404).json({ error: "Not found" });
        await inst.modifyChat(normalized, action);
        res.json({ success: true });
    });

    router.post('/chats/:instanceId/:jid/ephemeral', requireAuth, async (req, res) => {
        const { instanceId, jid } = req.params;
        const { enabled, timer } = req.body;
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (!inst || !inst.ephemeralManager) return res.status(404).json({ error: "Not found" });
        
        if (enabled) {
            await inst.ephemeralManager.enableForChat(jid, timer || 60);
        } else {
            await inst.ephemeralManager.disableForChat(jid);
        }
        res.json({ success: true });
    });

    return router;
};
