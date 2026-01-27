import Database from 'better-sqlite3';
import path from 'path';

// Use /data for Home Assistant Add-on persistence
const DB_PATH = process.env.NODE_ENV === 'development' 
    ? path.join(__dirname, '../../whatsapp.db')
    : '/data/whatsapp.db';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
    if (!db) {
        db = new Database(DB_PATH, { timeout: 10000 }); // Added 10s timeout for I/O waits
        db.pragma('journal_mode = WAL'); // Use Write-Ahead Logging for better concurrency
    }
    return db;
}

export function initDatabase() {
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
            PRIMARY KEY(instance_id, jid),
            FOREIGN KEY(instance_id) REFERENCES instances(id)
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instance_id INTEGER,
            chat_jid TEXT,
            sender_jid TEXT,
            sender_name TEXT,
            text TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_from_me INTEGER,
            UNIQUE(instance_id, chat_jid, text, timestamp),
            FOREIGN KEY(instance_id) REFERENCES instances(id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
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