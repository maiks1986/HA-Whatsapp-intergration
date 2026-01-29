import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../../db/database';
import { engineManager } from '../../manager/EngineManager';
import { aiService } from '../../services/AiService';
import { requireAuth } from '../authMiddleware';

export const systemRouter = () => {
    const router = Router();
    const db = getDb();

    router.get('/settings/:key', requireAuth, (req, res) => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(req.params.key) as any;
        res.json({ value: row?.value || "" });
    });

    router.post('/settings', requireAuth, (req, res) => {
        const user = (req as any).haUser;
        if (!user.isAdmin) return res.status(403).json({ error: "Admin only" });
        const { key, value } = req.body;
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
        if (key === 'gemini_api_key') aiService.reset();
        res.json({ success: true });
    });

    router.post('/system/reset', requireAuth, async (req, res) => {
        const user = (req as any).haUser;
        if (!user.isAdmin) return res.status(403).json({ error: "Admin only" });
        for (const inst of engineManager.getAllInstances()) {
            await inst.deleteAuth();
            await engineManager.stopInstance(inst.id);
        }
        db.prepare('DELETE FROM messages').run();
        db.prepare('DELETE FROM chats').run();
        db.prepare('DELETE FROM contacts').run();
        db.prepare('DELETE FROM instances').run();
        db.prepare('DELETE FROM settings').run();
        res.json({ success: true });
    });

    router.get('/debug/stats', requireAuth, (req, res) => {
        res.json({
            users: db.prepare('SELECT COUNT(*) as count FROM users').get(),
            instances: db.prepare('SELECT COUNT(*) as count FROM instances').get(),
            chats: db.prepare('SELECT COUNT(*) as count FROM chats').get(),
            messages: db.prepare('SELECT COUNT(*) as count FROM messages').get(),
        });
    });

    router.get('/debug/raw_logs', requireAuth, (req, res) => {
        const limit = parseInt(req.query.limit as string) || 50;
        const logPath = process.env.NODE_ENV === 'development' ? './raw_events.log' : '/data/raw_events.log';
        if (!fs.existsSync(logPath)) return res.json([]);
        try {
            const data = fs.readFileSync(logPath, 'utf8');
            const lines = data.trim().split('\n').slice(-limit);
            res.json(lines.map(l => JSON.parse(l)));
        } catch (e) { res.status(500).json({ error: "Failed to read logs" }); }
    });

    router.get('/debug/db/:table', requireAuth, (req, res) => {
        const { table } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        
        const allowedTables = ['messages', 'chats', 'contacts', 'instances', 'settings'];
        if (!allowedTables.includes(table)) return res.status(400).json({ error: "Invalid table" });

        try {
            const data = db.prepare(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(limit, offset);
            res.json(data);
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    router.post('/ai/analyze', requireAuth, async (req, res) => {
        const intent = await aiService.analyzeIntent(req.body.messages);
        res.json({ intent });
    });

    router.post('/ai/draft', requireAuth, async (req, res) => {
        const { messages, steer } = req.body;
        const draft = await aiService.generateDraft(messages, steer);
        res.json({ draft });
    });

    return router;
};
