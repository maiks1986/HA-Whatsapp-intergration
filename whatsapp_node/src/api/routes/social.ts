import { Router } from 'express';
import { getDb } from '../../db/database';
import { engineManager } from '../../manager/EngineManager';
import { aiService } from '../../services/AiService';
import { requireAuth } from '../authMiddleware';

export const socialRouter = () => {
    const router = Router();
    const db = getDb();

    router.get('/status/:instanceId', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const updates = db.prepare('SELECT * FROM status_updates WHERE instance_id = ? ORDER BY timestamp DESC LIMIT 100').all(instanceId);
        res.json(updates);
    });

    // Tracking Routes
    router.get('/social/tracked/:instanceId', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const tracked = db.prepare(`
            SELECT tc.*, c.name 
            FROM tracked_contacts tc
            LEFT JOIN contacts c ON tc.jid = c.jid AND tc.instance_id = c.instance_id
            WHERE tc.instance_id = ?
        `).all(instanceId);
        res.json(tracked);
    });

    router.post('/social/tracked', requireAuth, (req, res) => {
        const { instanceId, jid } = req.body;
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (inst && inst.socialManager) {
            inst.socialManager.trackContact(jid);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Instance not found" });
        }
    });

    router.delete('/social/tracked/:instanceId/:jid', requireAuth, (req, res) => {
        const { instanceId, jid } = req.params;
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (inst && inst.socialManager) {
            inst.socialManager.untrackContact(jid);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Instance not found" });
        }
    });

    router.post('/social/nudge', requireAuth, async (req, res) => {
        const { instanceId, jid, tone } = req.body;
        const db = getDb();
        
        // 1. Get last few messages for context
        const messages = db.prepare('SELECT * FROM messages WHERE instance_id = ? AND chat_jid = ? ORDER BY timestamp DESC LIMIT 5').all(instanceId, jid);
        
        // 2. Ask AI to generate a nudge
        const prompt = tone === 'morning' 
            ? "Generate a warm 'Good morning' message. Mention something relevant if you see it in the history, otherwise keep it simple and friendly. No quotes."
            : "Generate a friendly 'How are you?' check-in message. No quotes.";
            
        const draft = await aiService.generateDraft(messages.reverse(), prompt);
        res.json({ nudge: draft });
    });

    router.post('/groups/:instanceId', requireAuth, async (req, res) => {
        const { instanceId } = req.params;
        const { title, participants } = req.body;
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (!inst) return res.status(404).json({ error: "Not found" });
        const group = await inst.createGroup(title, participants);
        res.json(group);
    });

    router.patch('/groups/:instanceId/:jid/participants', requireAuth, async (req, res) => {
        const { instanceId, jid } = req.params;
        const { action, participants } = req.body;
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (!inst) return res.status(404).json({ error: "Not found" });
        await inst.updateGroupParticipants(jid, participants, action);
        res.json({ success: true });
    });

    router.patch('/groups/:instanceId/:jid/metadata', requireAuth, async (req, res) => {
        const { instanceId, jid } = req.params;
        const { subject, description } = req.body;
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (!inst) return res.status(404).json({ error: "Not found" });
        await inst.updateGroupMetadata(jid, { subject, description });
        res.json({ success: true });
    });

    return router;
};
