import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    WASocket,
    proto
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import http from 'http';
import qrcode from 'qrcode';
import pino from 'pino';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

const logger = pino({ level: 'info' });
const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Serve static React files
const PUBLIC_PATH = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_PATH));

const PORT = 5002;
const AUTH_PATH = '/data/auth_info';

let sock: WASocket | null = null;
let qrData: string | null = null;
let connectionStatus: 'connecting' | 'connected' | 'disconnected' = 'disconnected';

interface LocalMessage {
    account: string;
    chat_name: string;
    sender: string;
    text: string;
    timestamp: string;
}
let messageHistory: LocalMessage[] = [];

async function connectToWhatsApp() {
    logger.info('Initializing WhatsApp connection...');
    connectionStatus = 'connecting';
    
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        logger: logger as any,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrData = qr;
            const qrUrl = await qrcode.toDataURL(qr);
            io.emit('qr', qrUrl);
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            qrData = null;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            qrData = null;
            io.emit('status', 'connected');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                const text = msg.message?.conversation || 
                             msg.message?.extendedTextMessage?.text || 
                             msg.message?.imageMessage?.caption || 
                             "";
                
                if (text || msg.message) {
                    const localMsg: LocalMessage = {
                        account: "Primary",
                        chat_name: msg.key.remoteJid || "Unknown",
                        sender: msg.pushName || "Unknown",
                        text: text || "[Media/Other Message]",
                        timestamp: new Date().toLocaleTimeString()
                    };
                    messageHistory.unshift(localMsg);
                    if(messageHistory.length > 100) messageHistory.pop();
                    io.emit('new_message', localMsg);
                    logger.info(`Message saved: ${localMsg.text}`);
                }
            }
        }
    });
}

// --- API Endpoints ---

app.get('/api/account_status', (req, res) => {
    res.json([{ account: "Primary", status: connectionStatus, last_seen: new Date().toISOString() }]);
});

app.get('/api/messages', (req, res) => {
    res.json(messageHistory);
});

app.post('/api/send_message', async (req, res) => {
    const { contact, message } = req.body;
    if (!sock || connectionStatus !== 'connected') {
        return res.status(500).json({ error: 'WhatsApp not connected' });
    }
    try {
        let jid = contact;
        if (!jid.includes('@')) jid = `${jid}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Debug endpoint for logs
app.get('/api/logs', (req, res) => {
    // This is just a placeholder, real logs are in stdout
    res.json({ info: "Logs are available in the Home Assistant Add-on logs tab." });
});

// Fallback to React index.html
app.get('*', (req, res) => {
    if (fs.existsSync(path.join(PUBLIC_PATH, 'index.html'))) {
        res.sendFile(path.join(PUBLIC_PATH, 'index.html'));
    } else {
        res.send("<h1>Engine Running</h1><p>Frontend build still in progress or not found.</p>");
    }
});

server.listen(PORT, '0.0.0.0', () => {
    logger.info(`WhatsApp Node Engine listening on port ${PORT}`);
    connectToWhatsApp();
});