import Database from 'better-sqlite3';
import path from 'path';

// Use /data for Home Assistant Add-on persistence
const DB_PATH = process.env.NODE_ENV === 'development' 
    ? path.join(__dirname, '../../whatsapp.db')
    : '/data/whatsapp.db';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
    if (!db) {
        console.log('TRACE [Database]: Opening connection to', DB_PATH);
        db = new Database(DB_PATH, { timeout: 10000 }); 
        db.pragma('journal_mode = WAL'); 
    }
    return db;
}

export function initDatabase() {
    console.log('TRACE [Database]: Initializing tables...');
    const database = getDb();
    
    database.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user'
        );

        CREATE TABLE IF NOT EXISTS instances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner_id INTEGER,
            ha_user_id TEXT,
            status TEXT DEFAULT 'disconnected',
            last_seen DATETIME,
            FOREIGN KEY(owner_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS contacts (
            instance_id INTEGER,
            jid TEXT,
            name TEXT,
            PRIMARY KEY(instance_id, jid),
            FOREIGN KEY(instance_id) REFERENCES instances(id)
        );

        CREATE TABLE IF NOT EXISTS chats (
            instance_id INTEGER,
            jid TEXT,
            name TEXT,
            unread_count INTEGER DEFAULT 0,
            last_message_text TEXT,
            last_message_timestamp DATETIME,
            is_fully_synced INTEGER DEFAULT 0,
            is_archived INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            PRIMARY KEY(instance_id, jid),
            FOREIGN KEY(instance_id) REFERENCES instances(id)
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instance_id INTEGER,
            whatsapp_id TEXT UNIQUE,
            chat_jid TEXT,
            sender_jid TEXT,
            sender_name TEXT,
            text TEXT,
            type TEXT DEFAULT 'text',
            media_path TEXT,
            latitude REAL,
            longitude REAL,
            vcard_data TEXT,
            status TEXT DEFAULT 'sent',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_from_me INTEGER,
            parent_message_id TEXT,
            FOREIGN KEY(instance_id) REFERENCES instances(id)
        );

        CREATE TABLE IF NOT EXISTS reactions (
            instance_id INTEGER,
            message_whatsapp_id TEXT,
            sender_jid TEXT,
            emoji TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(instance_id, message_whatsapp_id, sender_jid),
            FOREIGN KEY(instance_id) REFERENCES instances(id),
            FOREIGN KEY(message_whatsapp_id) REFERENCES messages(whatsapp_id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS status_updates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instance_id INTEGER,
            sender_jid TEXT,
            sender_name TEXT,
            type TEXT,
            text TEXT,
            media_path TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(instance_id) REFERENCES instances(id)
        );
    `);

    console.log('Database initialized successfully at', DB_PATH);
}

export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        console.log('Database connection closed.');
    }
}