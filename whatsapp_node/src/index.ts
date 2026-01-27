import express from 'express';
import { Server as SocketServer } from 'socket.io';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db, { initDatabase, closeDatabase } from './db/database';
import { engineManager } from './manager/EngineManager';
import { aiService } from './services/AiService';

process.on('uncaughtException', (err) => {
    console.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

// Add timestamp to console logs
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
    originalLog(`[${new Date().toISOString()}]`, ...args);
};

console.error = (...args) => {
    originalError(`[${new Date().toISOString()}]`, ...args);
};

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

const PUBLIC_PATH = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_PATH));

const PORT = 5002;
const OPTIONS_PATH = '/data/options.json';

const sessions = new Map<string, { id: string, isAdmin: boolean }>();

function getAddonConfig() {
    try {
        if (fs.existsSync(OPTIONS_PATH)) {
            const data = fs.readFileSync(OPTIONS_PATH, 'utf8');
            console.log('DEBUG: Raw Add-on Config:', data);
            return JSON.parse(data);
        } else {
            console.log('DEBUG: Add-on config file NOT found at', OPTIONS_PATH);
        }
    } catch (e) {
        console.error('DEBUG: Error reading add-on config:', e);
    }
    return { password: "" };
}

async function bootstrap() {
    console.log('--- STARTING BOOTSTRAP ---');
    
    const config = getAddonConfig();
    const resetDb = config.reset_database === true || config.reset_database === 'true';

    if (resetDb) {
        console.log('DEBUG: Reset Database flag detected. Wiping activity data...');
        initDatabase(); // Ensure DB is initialized so tables exist
        try {
            db.prepare('DELETE FROM messages').run();
            db.prepare('DELETE FROM chats').run();
            db.prepare('DELETE FROM contacts').run();
            console.log('DEBUG: Activity data wiped. (Instances and Settings preserved)');
            // Small delay to let SQLite finalize
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
            console.error('DEBUG: Failed to wipe activity data:', e);
        }
    } else {
        initDatabase();
    }
    
    const debugEnabled = config.debug_logging === true || config.debug_logging === 'true';
    if (debugEnabled) console.log('DEBUG: Verbose logging enabled');
    
    await engineManager.init(debugEnabled);

    app.use((req, res, next) => {
        console.log(`TRACE [Server]: Incoming ${req.method} ${req.path}`);
        const userId = req.headers['x-hass-user-id'] as string;
        const isAdmin = req.headers['x-hass-is-admin'] === '1' || req.headers['x-hass-is-admin'] === 'true';
        
        if (userId) {
            console.log(`AUTH: User ${userId} authenticated via Ingress (Admin: ${isAdmin})`);
            (req as any).haUser = { id: userId, isAdmin, source: 'ingress' };
            return next();
        }

        const authHeader = req.headers['authorization'];
        const token = authHeader?.split(' ')[1];
        if (token && sessions.has(token)) {
            const session = sessions.get(token);
            console.log(`AUTH: User ${session!.id} authenticated via Direct Token`);
            (req as any).haUser = { id: session!.id, isAdmin: session!.isAdmin, source: 'direct' };
            return next();
        }

        console.log(`AUTH: Unauthenticated request to ${req.path}`);
        console.log('DEBUG: Request Headers:', JSON.stringify(req.headers));
        (req as any).haUser = null;
        next();
    });

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

    const requireAuth = (req: any, res: any, next: any) => {
        if (!req.haUser) return res.status(401).json({ error: "Unauthorized" });
        next();
    };

    app.get('/api/instances', requireAuth, (req, res) => {
        const user = (req as any).haUser;
        console.log(`API: Fetching instances for user ${user.id}`);
        let instances;
        if (user.isAdmin) {
            instances = db.prepare('SELECT * FROM instances').all();
        } else {
            instances = db.prepare('SELECT * FROM instances WHERE ha_user_id = ?').all(user.id);
        }
        res.json(instances);
    });

    app.get('/api/chats/:instanceId', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const user = (req as any).haUser;
        console.log(`API: Fetching chats for instance ${instanceId} (User: ${user.id})`);
        
        const instanceData = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as any;
        if (!user.isAdmin && instanceData?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        const chats = db.prepare(`
            SELECT 
                c.jid, 
                COALESCE(co.name, c.name, c.jid) as name, 
                c.unread_count, 
                c.last_message_text, 
                c.last_message_timestamp
            FROM chats c
            LEFT JOIN contacts co ON c.jid = co.jid AND c.instance_id = co.instance_id
            WHERE c.instance_id = ? 
              AND (c.last_message_text IS NOT NULL OR c.unread_count > 0)
              AND c.jid NOT LIKE '%@broadcast'
            ORDER BY c.last_message_timestamp DESC
        `).all(instanceId);
        console.log(`API: Returning ${chats.length} active chats`);
        res.json(chats);
    });

    app.get('/api/debug/stats', requireAuth, (req, res) => {
        const stats = {
            users: db.prepare('SELECT COUNT(*) as count FROM users').get(),
            instances: db.prepare('SELECT COUNT(*) as count FROM instances').get(),
            chats: db.prepare('SELECT COUNT(*) as count FROM chats').get(),
            messages: db.prepare('SELECT COUNT(*) as count FROM messages').get(),
        };
        console.log('API: Debug Stats requested', stats);
        res.json(stats);
    });

    app.post('/api/instances', requireAuth, async (req, res) => {
        const { name } = req.body;
        const user = (req as any).haUser;
        console.log(`API: Creating new instance '${name}' for user ${user.id}`);
        const result = db.prepare('INSERT INTO instances (name, ha_user_id) VALUES (?, ?)').run(name, user.id);
        const newId = result.lastInsertRowid as number;
        await engineManager.startInstance(newId, name);
        res.json({ id: newId, name });
    });

    app.delete('/api/instances/:id', requireAuth, async (req, res) => {
        const { id } = req.params;
        const user = (req as any).haUser;
        const instanceId = parseInt(id);

        const instanceData = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as any;
        if (!user.isAdmin && instanceData?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        console.log(`API: Hard resetting instance ${instanceId}`);
        const instance = engineManager.getInstance(instanceId);
        if (instance) {
            await instance.deleteAuth();
            await engineManager.stopInstance(instanceId);
        }

        db.prepare('DELETE FROM messages WHERE instance_id = ?').run(instanceId);
        db.prepare('DELETE FROM chats WHERE instance_id = ?').run(instanceId);
        db.prepare('DELETE FROM instances WHERE id = ?').run(instanceId);

        res.json({ success: true });
    });

    app.get('/api/messages/:instanceId/:jid', requireAuth, (req, res) => {
        const { instanceId, jid } = req.params;
        const user = (req as any).haUser;
        console.log(`API: Fetching messages for instance ${instanceId}, chat ${jid}`);
        const instanceData = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as any;
        if (!user.isAdmin && instanceData?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        const messages = db.prepare('SELECT * FROM messages WHERE instance_id = ? AND chat_jid = ? ORDER BY id ASC').all(instanceId, jid);
        res.json(messages);
    });

    app.post('/api/send_message', requireAuth, async (req, res) => {
        const { instanceId, contact, message } = req.body;
        console.log(`API: Sending message to ${contact} via instance ${instanceId}`);
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

    app.post('/api/system/reset', requireAuth, async (req, res) => {
        const user = (req as any).haUser;
        if (!user.isAdmin) return res.status(403).json({ error: "Admin only" });

        console.log('API: FULL SYSTEM RESET REQUESTED');
        const instances = engineManager.getAllInstances();
        for (const inst of instances) {
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

    io.on('connection', (socket) => {
        console.log('WebSocket: Client connected');
        const interval = setInterval(() => {
            const allInstances = engineManager.getAllInstances();
            if (allInstances.length > 0) {
                const status = allInstances.map(i => ({
                    id: i.id,
                    status: i.status,
                    qr: i.qr
                }));
                socket.emit('instances_status', status);
            }
        }, 2000);
        socket.on('disconnect', () => {
            console.log('WebSocket: Client disconnected');
            clearInterval(interval);
        });
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
