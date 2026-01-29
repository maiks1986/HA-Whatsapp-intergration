import { Router } from 'express';
import { getDb } from '../../db/database';
import { engineManager } from '../../manager/EngineManager';
import { requireAuth } from '../authMiddleware';

export const instancesRouter = () => {
    const router = Router();
    const db = getDb();

    router.get('/', requireAuth, (req, res) => {
        const user = (req as any).haUser;
        let instances;
        if (user.isAdmin) {
            instances = db.prepare('SELECT * FROM instances').all();
        } else {
            instances = db.prepare('SELECT * FROM instances WHERE ha_user_id = ?').all(user.id);
        }
        res.json(instances);
    });

    router.post('/', requireAuth, async (req, res) => {
        const { name } = req.body;
        const user = (req as any).haUser;
        const result = db.prepare('INSERT INTO instances (name, ha_user_id) VALUES (?, ?)').run(name, user.id);
        const newId = result.lastInsertRowid as number;
        await engineManager.startInstance(newId, name);
        res.json({ id: newId, name });
    });

    router.delete('/:id', requireAuth, async (req, res) => {
        const { id } = req.params;
        const user = (req as any).haUser;
        const instanceId = parseInt(id);

        const instanceData = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as any;
        if (!user.isAdmin && instanceData?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        const instance = engineManager.getInstance(instanceId);
        if (instance) {
            await instance.deleteAuth();
            await engineManager.stopInstance(instanceId);
        }

        db.prepare('DELETE FROM contacts WHERE instance_id = ?').run(instanceId);
        db.prepare('DELETE FROM status_updates WHERE instance_id = ?').run(instanceId);
        db.prepare('DELETE FROM reactions WHERE instance_id = ?').run(instanceId);
        db.prepare('DELETE FROM messages WHERE instance_id = ?').run(instanceId);
        db.prepare('DELETE FROM chats WHERE instance_id = ?').run(instanceId);
        db.prepare('DELETE FROM instances WHERE id = ?').run(instanceId);

        res.json({ success: true });
    });

    router.post('/:id/reconnect', requireAuth, async (req, res) => {
        const instance = engineManager.getInstance(parseInt(req.params.id));
        if (!instance) return res.status(404).json({ error: "Not found" });
        await instance.reconnect();
        res.json({ success: true });
    });

    router.post('/:id/presence', requireAuth, async (req, res) => {
        const { presence } = req.body;
        const instance = engineManager.getInstance(parseInt(req.params.id));
        if (!instance) return res.status(404).json({ error: "Not found" });
        await instance.setPresence(presence);
        res.json({ success: true });
    });

    return router;
};
