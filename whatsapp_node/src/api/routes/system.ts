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
        const instanceId = parseInt(req.query.instanceId as string) || 0;
        const row = db.prepare('SELECT value FROM settings WHERE instance_id = ? AND key = ?').get(instanceId, req.params.key) as any;
        // Fallback to global if instance specific not found?
        if (!row && instanceId !== 0) {
             const globalRow = db.prepare('SELECT value FROM settings WHERE instance_id = 0 AND key = ?').get(req.params.key) as any;
             return res.json({ value: globalRow?.value || "" });
        }
        res.json({ value: row?.value || "" });
    });

    router.post('/settings', requireAuth, (req, res) => {
        const user = (req as any).haUser;
        if (!user.isAdmin) return res.status(403).json({ error: "Admin only" });
        
        const { key, value, instanceId } = req.body;
        const targetInstance = instanceId !== undefined ? instanceId : 0;
        
        db.prepare('INSERT OR REPLACE INTO settings (instance_id, key, value) VALUES (?, ?, ?)').run(targetInstance, key, value);
        if (key === 'gemini_api_key' && targetInstance === 0) aiService.reset();
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

    router.post('/system/repair', requireAuth, async (req, res) => {
        const user = (req as any).haUser;
        if (!user.isAdmin) return res.status(403).json({ error: "Admin only" });
        
        // 1. Capture current instances state
        const activeInstances = engineManager.getAllInstances().map(inst => ({
            id: inst.id,
            name: inst.name,
            presence: (inst as any).presence || 'unavailable'
        }));

        // 2. Stop all instances
        for (const inst of activeInstances) {
            await engineManager.stopInstance(inst.id);
        }

        // 3. Wipe volatile DB data
        db.prepare('DELETE FROM messages').run();
        db.prepare('DELETE FROM chats').run();
        db.prepare('DELETE FROM contacts').run();
        db.prepare('DELETE FROM reactions').run();
        db.prepare('DELETE FROM status_updates').run();
        
        // 4. Clear avatars
        const avatarDir = process.env.NODE_ENV === 'development' ? './media/avatars' : '/data/media/avatars';
        if (fs.existsSync(avatarDir)) {
            const files = fs.readdirSync(avatarDir);
            for (const file of files) fs.unlinkSync(path.join(avatarDir, file));
        }

        // 5. Force Deep Re-sync (Soft wipe auth files except creds)
        for (const instInfo of activeInstances) {
            const authPath = process.env.NODE_ENV === 'development'
                ? path.join(__dirname, `../../../auth_info_${instInfo.id}`)
                : `/data/auth_info_${instInfo.id}`;
            
            if (fs.existsSync(authPath)) {
                const files = fs.readdirSync(authPath);
                for (const file of files) {
                    if (file !== 'creds.json') {
                        fs.rmSync(path.join(authPath, file), { recursive: true, force: true });
                    }
                }
            }
            
            // 6. Restart instance
            await engineManager.startInstance(instInfo.id, instInfo.name, instInfo.presence as any);
        }
        
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

    // Stealth Scheduler Routes
    router.get('/stealth/schedules/:instanceId', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const schedules = db.prepare('SELECT * FROM stealth_schedules WHERE instance_id = ?').all(instanceId) as any[];
        for (const s of schedules) {
            s.targets = db.prepare('SELECT contact_jid FROM stealth_targets WHERE schedule_id = ?').all(s.id);
        }
        res.json(schedules);
    });

    router.post('/stealth/schedules', requireAuth, (req, res) => {
        const { instanceId, name, start_time, end_time, days, mode, targets } = req.body;
        const info = db.prepare('INSERT INTO stealth_schedules (instance_id, name, start_time, end_time, days, mode) VALUES (?, ?, ?, ?, ?, ?)').run(instanceId, name, start_time, end_time, JSON.stringify(days), mode);
        const scheduleId = info.lastInsertRowid;

        if (targets && Array.isArray(targets)) {
            const stmt = db.prepare('INSERT INTO stealth_targets (schedule_id, contact_jid) VALUES (?, ?)');
            for (const jid of targets) stmt.run(scheduleId, jid);
        }
        res.json({ success: true, id: scheduleId });
    });

    router.delete('/stealth/schedules/:id', requireAuth, (req, res) => {
        db.prepare('DELETE FROM stealth_targets WHERE schedule_id = ?').run(req.params.id);
        db.prepare('DELETE FROM stealth_schedules WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    });

    return router;
};
