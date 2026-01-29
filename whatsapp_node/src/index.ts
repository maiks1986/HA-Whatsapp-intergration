// Add timestamp to console logs IMMEDIATELY
const originalLog = console.log;
const originalError = console.error;
console.log = (...args) => originalLog(`[${new Date().toISOString()}]`, ...args);
console.error = (...args) => originalError(`[${new Date().toISOString()}]`, ...args);

import express from 'express';
import { Server as SocketServer } from 'socket.io';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { initDatabase } from './db/database';
import { engineManager } from './manager/EngineManager';

// Auth Middleware
import { identityResolver } from './api/authMiddleware';

// Routes
import { authRouter } from './api/routes/auth';
import { instancesRouter } from './api/routes/instances';
import { messagingRouter } from './api/routes/messaging';
import { socialRouter } from './api/routes/social';
import { systemRouter } from './api/routes/system';

// Utils
import { normalizeJid } from './utils';

process.on('uncaughtException', (err) => console.error('CRITICAL Exception:', err));
process.on('unhandledRejection', (reason, promise) => console.error('CRITICAL Rejection:', promise, 'reason:', reason));

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

const PUBLIC_PATH = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_PATH));

const MEDIA_PATH = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../media') : '/data/media';
app.use('/media', express.static(MEDIA_PATH));

const OPTIONS_PATH = '/data/options.json';
const getAddonConfig = () => {
    try {
        if (fs.existsSync(OPTIONS_PATH)) return JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
    } catch (e) {}
    return { password: "" };
};

async function bootstrap() {
    console.log('--- STARTING BOOTSTRAP ---');
    try {
        const fixes = require('./last_fixes.json');
        console.log('--- BUILD VERSION INFO ---');
        console.log(`Timestamp: ${fixes.timestamp}`);
        console.log(`Description: ${fixes.description}`);
        console.log('--------------------------');
    } catch (e) {
        console.log('Build version info not found.');
    }

    await new Promise(r => setTimeout(r, 5000));

    const config = getAddonConfig();
    initDatabase();
    
    const debugEnabled = config.debug_logging === true || config.debug_logging === 'true';
    await engineManager.init(io, debugEnabled);

    // Global Identity Resolver
    app.use(identityResolver);

    // Mount Routes
    app.use('/api/auth', authRouter(getAddonConfig));
    app.use('/api/instances', instancesRouter());
    app.use('/api', messagingRouter());
    app.use('/api', socialRouter());
    app.use('/api', systemRouter());

    io.on('connection', (socket) => {
        socket.on('subscribe_raw_events', () => (socket as any).raw_debug = true);
        const interval = setInterval(() => {
            const all = engineManager.getAllInstances();
            if (all.length > 0) socket.emit('instances_status', all.map(i => ({ id: i.id, status: i.status, presence: i.presence, qr: i.qr })));
        }, 2000);
        socket.on('disconnect', () => clearInterval(interval));
    });

    app.get('*', (req, res) => {
        const file = path.join(PUBLIC_PATH, 'index.html');
        if (fs.existsSync(file)) res.sendFile(file);
        else res.send("<h1>WhatsApp Pro</h1><p>Frontend loading...</p>");
    });

    server.listen(5002, '0.0.0.0', () => console.log(`WhatsApp Pro Backend listening on port 5002`));
}

bootstrap().catch(err => console.error('Fatal bootstrap error:', err));