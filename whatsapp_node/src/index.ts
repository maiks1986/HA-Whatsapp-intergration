import express from 'express';
import { Server as SocketServer } from 'socket.io';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDb } from './db/database';
import { engineManager } from './manager/EngineManager';
import { aiService } from './services/AiService';
import { AddonConfig, AuthUser, Instance, Chat, Message } from './types';
import { normalizeJid } from './utils';

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

const MEDIA_PATH = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../media') : '/data/media';
app.use('/media', express.static(MEDIA_PATH));

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
    
    // 1. Give the OS/Supervisor time to release any previous locks
    console.log('DEBUG: Waiting 5s for system to settle...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const config = getAddonConfig();
    const resetDb = config.reset_database === true || config.reset_database === 'true';

    // 2. Resilient Database Initialization
    let retryCount = 0;
    const maxRetries = 5;
    while (retryCount < maxRetries) {
        try {
            initDatabase();
            break; 
        } catch (err) {
            retryCount++;
            console.error(`DEBUG: Database init failed (attempt ${retryCount}/${maxRetries}):`, err);
            if (retryCount >= maxRetries) throw err;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    const db = getDb();

    if (resetDb) {
        console.log('DEBUG: Reset Database flag detected. Wiping activity data...');
        try {
            db.transaction(() => {
                db.prepare('DELETE FROM messages').run();
                db.prepare('DELETE FROM chats').run();
                // contacts are now preserved to maintain identity across resets
            })();
            console.log('DEBUG: Activity data wiped. (Instances, Settings, and Contacts preserved)');
            console.log('DEBUG: Optimization complete.');
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (e) {
            console.error('DEBUG: Failed to wipe activity data:', e);
        }
    }
    
    const debugEnabled = config.debug_logging === true || config.debug_logging === 'true';
    if (debugEnabled) console.log('DEBUG: Verbose logging enabled');
    
    await engineManager.init(io, debugEnabled);

        app.use((req, res, next) => {
            console.log(`TRACE [Server]: Incoming ${req.method} ${req.path}`);
            const userId = req.headers['x-hass-user-id'] as string;
            const isAdmin = req.headers['x-hass-is-admin'] === '1' || req.headers['x-hass-is-admin'] === 'true';
            
            // 1. Check for Ingress Headers (Auto-Login)
            if (userId) {
                console.log(`AUTH: User ${userId} authenticated via Ingress (Admin: ${isAdmin})`);
                (req as any).haUser = { id: userId, isAdmin, source: 'ingress' } as AuthUser;
                return next();
            }
    
            // 2. Check for Session Cookie
            const cookieToken = req.headers.cookie?.split('; ').find(row => row.startsWith('direct_token='))?.split('=')[1];
            
            // 3. Check for Auth Header (Backwards compatibility)
            const authHeader = req.headers['authorization'];
            const token = cookieToken || authHeader?.split(' ')[1];
    
            if (token && sessions.has(token)) {
                const session = sessions.get(token);
                console.log(`AUTH: User ${session!.id} authenticated via Token`);
                (req as any).haUser = { id: session!.id, isAdmin: session!.isAdmin, source: 'direct' } as AuthUser;
                return next();
            }
    
            console.log(`AUTH: Unauthenticated request to ${req.path}`);
            (req as any).haUser = null;
            next();
        });
    
        app.get('/api/auth/status', (req, res) => {
            const user = (req as any).haUser as AuthUser | null;
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
                res.cookie('direct_token', token, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false });
                return res.json({ success: true, token });
            }
            res.status(401).json({ error: "Invalid password" });
        });
    
        app.post('/api/auth/ha_login', async (req, res) => {
            const { haUrl, haToken } = req.body;
            try {
                const response = await axios.get(`${haUrl}/api/config`, {
                    headers: { 'Authorization': `Bearer ${haToken}` }
                });
                if (response.data && response.data.version) {
                    const token = uuidv4();
                    sessions.set(token, { id: `ha_${response.data.location_name || 'user'}`, isAdmin: true });
                    res.cookie('direct_token', token, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false });
                    return res.json({ success: true, token });
                }
            } catch (e) {}
            res.status(401).json({ error: "Invalid HA Credentials" });
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
                c.name, 
                c.unread_count, 
                c.last_message_text, 
                c.last_message_timestamp,
                c.is_archived,
                c.is_pinned
            FROM chats c
            WHERE c.instance_id = ? 
              AND c.jid NOT LIKE '%@broadcast'
            ORDER BY c.is_pinned DESC, c.last_message_timestamp DESC
        `).all(instanceId) as Chat[];
        console.log(`API: Returning ${chats.length} active chats`);
        res.json(chats);
    });

    app.get('/api/contacts/:instanceId', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const user = (req as any).haUser;
        
        const instanceData = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as any;
        if (!user.isAdmin && instanceData?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        const contacts = db.prepare('SELECT * FROM contacts WHERE instance_id = ? ORDER BY name ASC').all(instanceId);
        res.json(contacts);
    });

    app.post('/api/instances/:id/reconnect', requireAuth, async (req, res) => {
        const { id } = req.params;
        const instance = engineManager.getInstance(parseInt(id));
        if (!instance) return res.status(404).json({ error: "Not found" });
        await instance.reconnect();
        res.json({ success: true });
    });

    app.post('/api/instances/:id/presence', requireAuth, async (req, res) => {
        const { id } = req.params;
        const { presence } = req.body;
        const instance = engineManager.getInstance(parseInt(id));
        if (!instance) return res.status(404).json({ error: "Not found" });
        await instance.setPresence(presence);
        res.json({ success: true });
    });

    // --- PHASE 2 SOCIAL ENDPOINTS ---
    app.get('/api/status/:instanceId', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const updates = db.prepare('SELECT * FROM status_updates WHERE instance_id = ? ORDER BY timestamp DESC LIMIT 100').all(instanceId);
        res.json(updates);
    });

    app.post('/api/groups/:instanceId', requireAuth, async (req, res) => {
        const { instanceId } = req.params;
        const { title, participants } = req.body;
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (!inst) return res.status(404).json({ error: "Not found" });
        const group = await inst.createGroup(title, participants);
        res.json(group);
    });

    app.patch('/api/groups/:instanceId/:jid/participants', requireAuth, async (req, res) => {
        const { instanceId, jid } = req.params;
        const { action, participants } = req.body;
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (!inst) return res.status(404).json({ error: "Not found" });
        await inst.updateGroupParticipants(jid, participants, action);
        res.json({ success: true });
    });

    app.patch('/api/groups/:instanceId/:jid/metadata', requireAuth, async (req, res) => {
        const { instanceId, jid } = req.params;
        const { subject, description } = req.body;
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (!inst) return res.status(404).json({ error: "Not found" });
        await inst.updateGroupMetadata(jid, { subject, description });
        res.json({ success: true });
    });

    // --- PHASE 3 UTILITY ENDPOINTS ---
    app.get('/api/messages/:instanceId/search', requireAuth, (req, res) => {
        const { instanceId } = req.params;
        const { query, type, jid } = req.query;
        let sql = 'SELECT * FROM messages WHERE instance_id = ?';
        const params: any[] = [instanceId];

        if (jid) {
            sql += ' AND chat_jid = ?';
            params.push(normalizeJid(jid as string));
        }
        if (query) {
            sql += ' AND text LIKE ?';
            params.push(`%${query}%`);
        }
        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }
        sql += ' ORDER BY timestamp DESC LIMIT 100';

        const results = db.prepare(sql).all(...params);
        res.json(results);
    });

    app.post('/api/chats/:instanceId/:jid/modify', requireAuth, async (req, res) => {
        const { instanceId, jid } = req.params;
        const normalized = normalizeJid(jid);
        const { action } = req.body; 
        const inst = engineManager.getInstance(parseInt(instanceId));
        if (!inst) return res.status(404).json({ error: "Not found" });
        await inst.modifyChat(normalized, action);
        res.json({ success: true });
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

    app.get('/api/debug/raw_logs', requireAuth, (req, res) => {
        const limit = parseInt(req.query.limit as string) || 50;
        const logPath = process.env.NODE_ENV === 'development' ? './raw_events.log' : '/data/raw_events.log';
        
        if (!fs.existsSync(logPath)) return res.json([]);

        try {
            const data = fs.readFileSync(logPath, 'utf8');
            const lines = data.trim().split('\n').slice(-limit);
            const logs = lines.map(l => JSON.parse(l));
            res.json(logs);
        } catch (e) {
            res.status(500).json({ error: "Failed to read logs" });
        }
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
        const { instanceId } = req.params;
        const jid = normalizeJid(req.params.jid);
        const user = (req as any).haUser as AuthUser;
        console.log(`API: Fetching messages for instance ${instanceId}, chat ${jid}`);
        const instanceData = db.prepare('SELECT ha_user_id FROM instances WHERE id = ?').get(instanceId) as Instance | undefined;
        if (!user.isAdmin && instanceData?.ha_user_id !== user.id) return res.status(403).json({ error: "Access Denied" });

        const messages = db.prepare('SELECT * FROM messages WHERE instance_id = ? AND chat_jid = ? ORDER BY timestamp ASC').all(instanceId, jid) as any[];
        
        // Attach reactions to each message
        for (const msg of messages) {
            msg.reactions = db.prepare('SELECT sender_jid, emoji FROM reactions WHERE instance_id = ? AND message_whatsapp_id = ?').all(instanceId, msg.whatsapp_id);
        }

        res.json(messages);
    });

    app.post('/api/send_message', requireAuth, async (req, res) => {
        const { instanceId, contact, message } = req.body;
        const jid = normalizeJid(contact);
        console.log(`API: Sending message to ${jid} via instance ${instanceId}`);
        const instance = engineManager.getInstance(instanceId);
        if (!instance) return res.status(404).json({ error: "Instance not found" });
        try {
            await instance.sendMessage(jid, message);
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
        console.log(`TRACE [WebSocket]: Client connected (${socket.id})`);
        
        // Debug: Listen for raw event requests
        socket.on('subscribe_raw_events', () => {
            console.log(`TRACE [WebSocket]: Client ${socket.id} subscribed to raw events`);
            (socket as any).raw_debug = true;
        });

        let lastStatusJson = '';
        const interval = setInterval(() => {
            const allInstances = engineManager.getAllInstances();
            if (allInstances.length > 0) {
                const status = allInstances.map(i => ({
                    id: i.id,
                    status: i.status,
                    presence: i.presence,
                    qr: i.qr ? 'YES' : 'NO'
                }));
                const currentStatusJson = JSON.stringify(status);
                if (currentStatusJson !== lastStatusJson) {
                    console.log(`TRACE [WebSocket]: Broadcasting status change:`, currentStatusJson);
                    lastStatusJson = currentStatusJson;
                }
                socket.emit('instances_status', allInstances.map(i => ({
                    id: i.id,
                    status: i.status,
                    presence: i.presence,
                    qr: i.qr
                })));
            }
        }, 2000);
        socket.on('disconnect', () => {
            console.log(`TRACE [WebSocket]: Client disconnected (${socket.id})`);
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
