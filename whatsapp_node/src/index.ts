import express from 'express';
import { Server as SocketServer } from 'socket.io';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db, { initDatabase } from './db/database';
import { engineManager } from './manager/EngineManager';
import { aiService } from './services/AiService';

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Serve static React files
const PUBLIC_PATH = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_PATH));

const PORT = 5002;
const OPTIONS_PATH = '/data/options.json';

// In-memory session store for direct access
const sessions = new Map<string, { id: string, isAdmin: boolean }>();

function getAddonConfig() {
    try {
        if (fs.existsSync(OPTIONS_PATH)) {
            return JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
        }
    } catch (e) {}
    return { password: "" };
}

async function bootstrap() {
    initDatabase();
    await engineManager.init();

    // Hybrid Auth Middleware
    app.use((req, res, next) => {
        // 1. Check for HA Ingress Headers
        const userId = req.headers['x-hass-user-id'] as string;
        const isAdmin = req.headers['x-hass-is-admin'] === '1' || req.headers['x-hass-is-admin'] === 'true';
        
        if (userId) {
            (req as any).haUser = { id: userId, isAdmin, source: 'ingress' };
            return next();
        }

        // 2. Check for Session Token (Direct Access)
        const authHeader = req.headers['authorization'];
        const token = authHeader?.split(' ')[1];
        if (token && sessions.has(token)) {
            const session = sessions.get(token);
            (req as any).haUser = { id: session!.id, isAdmin: session!.isAdmin, source: 'direct' };
            return next();
        }

        // 3. Unauthenticated - Mark as Guest
        (req as any).haUser = null;
        next();
    });

    // --- Auth API ---

    app.get('/api/auth/status', (req, res) => {
        const user = (req as any).haUser;
        res.json({ 
            authenticated: !!user,
            source: user?.source || null,
            isAdmin: user?.isAdmin || false,
            needsPassword: !user && getAddonConfig().password !== ""
        });
    });

    app.post('/api/auth/login', (req, res) => {
        const { password } = req.body;
        const config = getAddonConfig();

        if (config.password && password === config.password) {
            const token = uuidv4();
            sessions.set(token, { id: 'direct_admin', isAdmin: true });
            return res.json({ success: true, token });
        }
        res.status(401).json({ error: "Invalid password" });
    });

    // --- Protected API Middleware ---
    const requireAuth = (req: any, res: any, next: any) => {
        if (!req.haUser) return res.status(401).json({ error: "Unauthorized" });
        next();
    };

    // --- API Endpoints ---
    
    app.get('/api/instances', requireAuth, (req, res) => {
        const user = (req as any).haUser;
        let instances;
        if (user.isAdmin) {
            instances = db.prepare('SELECT * FROM instances').all();
        } else {
            instances = db.prepare('SELECT * FROM instances WHERE ha_user_id = ?').all(user.id);
        }
        res.json(instances);
    });

    app.post('/api/instances', requireAuth, async (req, res) => {
        const { name } = req.body;
        const user = (req as any).haUser;
        const result = db.prepare('INSERT INTO instances (name, ha_user_id) VALUES (?, ?)').run(name, user.id);
        const newId = result.lastInsertRowid as number;
        await engineManager.startInstance(newId, name);
        res.json({ id: newId, name });
    });

    app.get('/api/messages/:instanceId/:jid', requireAuth, (req, res) => {
        const { instanceId, jid } = req.params;
        const user = (req as any).haUser;
        const instance = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as any;
        if (!user.isAdmin && instance?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        const messages = db.prepare('SELECT * FROM messages WHERE instance_id = ? AND chat_jid = ? ORDER BY id ASC').all(instanceId, jid);
        res.json(messages);
    });

    app.post('/api/send_message', requireAuth, async (req, res) => {
        const { instanceId, contact, message } = req.body;
        const user = (req as any).haUser;
        const instanceData = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as any;
        if (!user.isAdmin && instanceData?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        const instance = engineManager.getInstance(instanceId);
        if (!instance) return res.status(404).json({ error: "Instance not found" });
        try {
            await instance.sendMessage(contact, message);
            res.json({ success: true });
        } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/settings', requireAuth, (req, res) => {
        const user = (req as any).haUser;
        if (!user.isAdmin) return res.status(403).json({ error: "Admin only" });
        const { key, value } = req.body;
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
        if (key === 'gemini_api_key') aiService.reset();
        res.json({ success: true });
    });

    app.get('/api/settings/:key', requireAuth, (req, res) => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(req.params.key) as any;
        res.json({ value: row?.value || "" });
    });

    app.post('/api/ai/analyze', requireAuth, async (req, res) => {
        const { messages } = req.body;
        const intent = await aiService.analyzeIntent(messages);
        res.json({ intent });
    });

    app.post('/api/ai/draft', requireAuth, async (req, res) => {
        const { messages, steer } = req.body;
        const draft = await aiService.generateDraft(messages, steer);
        res.json({ draft });
    });

    app.get('*', (req, res) => {
        if (fs.existsSync(path.join(PUBLIC_PATH, 'index.html'))) {
            res.sendFile(path.join(PUBLIC_PATH, 'index.html'));
        } else {
            res.send("<h1>WhatsApp Pro System</h1><p>Frontend loading...</p>");
        }
    });

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`WhatsApp Pro Backend listening on port ${PORT}`);
    });
}

bootstrap().catch(err => {
    console.error('Fatal bootstrap error:', err);
});
