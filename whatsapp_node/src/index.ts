import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    WASocket
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import http from 'http';
import qrcode from 'qrcode';
import pino from 'pino';
import cors from 'cors';
import path from 'path';

const logger = pino({ level: 'info' });
const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

const PORT = 5002;
const AUTH_PATH = path.join(__dirname, '../auth_info');

let sock: WASocket | null = null;
let qrData: string | null = null;
let connectionStatus: 'connecting' | 'connected' | 'disconnected' = 'disconnected';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: true,
        logger: logger as any,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrData = qr;
            logger.info('New QR Code generated');
            io.emit('qr', await qrcode.toDataURL(qr));
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            logger.info({ error: lastDisconnect?.error }, `Connection closed, reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            qrData = null;
            logger.info('Opened connection');
            io.emit('status', 'connected');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                if (!msg.key.fromMe) {
                    logger.info(`Received message from ${msg.key.remoteJid}: ${msg.message?.conversation}`);
                    // Here we can push to HA webhook
                }
            }
        }
    });
}

// --- API Endpoints ---

app.get('/status', (req, res) => {
    res.json({ status: connectionStatus, has_qr: !!qrData });
});

app.post('/send', async (req, res) => {
    const { jid, message } = req.body;
    if (!sock || connectionStatus !== 'connected') {
        return res.status(500).json({ error: 'WhatsApp not connected' });
    }
    try {
        const result = await sock.sendMessage(jid, { text: message });
        res.json({ success: true, result });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Simple UI to show QR
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>WhatsApp Node Gateway</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>WhatsApp Node Engine</h1>
                <div id="status">Status: ${connectionStatus}</div>
                <div id="qr-container" style="margin-top: 20px;">
                    ${qrData ? '<h3>Scan this QR Code:</h3><div id="qrcode"></div>' : '<h3>Connected!</h3>'}
                </div>
                <script src="/socket.io/socket.io.js"></script>
                <script>
                    const socket = io();
                    const qrDiv = document.getElementById('qrcode');
                    socket.on('qr', (url) => {
                        qrDiv.innerHTML = '<img src="' + url + '" />';
                    });
                    socket.on('status', (s) => {
                        document.getElementById('status').innerText = 'Status: ' + s;
                        if(s === 'connected') document.getElementById('qr-container').innerHTML = '<h3>Connected!</h3>';
                    });
                </script>
            </body>
        </html>
    `);
});

server.listen(PORT, () => {
    logger.info(`WhatsApp Node Engine listening on port ${PORT}`);
    connectToWhatsApp();
});
