import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database;

export function initDatabase() {
    const dbPath = process.env.NODE_ENV === 'development' 
        ? path.join(__dirname, '../../whatsapp.db')
        : '/data/whatsapp.db';

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // 1. Core Tables
    db.prepare(`
        CREATE TABLE IF NOT EXISTS instances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            ha_user_id TEXT,
            status TEXT DEFAULT 'disconnected',
            presence TEXT DEFAULT 'available',
            qr TEXT,
            last_seen DATETIME
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS chats (
            instance_id INTEGER,
            jid TEXT NOT NULL,
            name TEXT,
            unread_count INTEGER DEFAULT 0,
            last_message_text TEXT,
            last_message_timestamp DATETIME,
            is_archived INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            is_fully_synced INTEGER DEFAULT 0,
            PRIMARY KEY (instance_id, jid)
        )
    `).run();

    db.prepare(`
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
            timestamp DATETIME,
            is_from_me INTEGER DEFAULT 0,
            parent_message_id TEXT
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS contacts (
            instance_id INTEGER,
            jid TEXT NOT NULL,
            name TEXT,
            PRIMARY KEY (instance_id, jid)
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS status_updates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instance_id INTEGER,
            sender_jid TEXT,
            sender_name TEXT,
            type TEXT,
            text TEXT,
            media_path TEXT,
            timestamp DATETIME
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS reactions (
            instance_id INTEGER,
            message_whatsapp_id TEXT,
            sender_jid TEXT,
            emoji TEXT,
            PRIMARY KEY (instance_id, message_whatsapp_id, sender_jid)
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT,
            is_admin INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // 2. MIGRATIONS (Ensure columns exist for legacy databases)
    const tables = ['chats', 'messages', 'instances'];
    
    // Helper to add column if it doesn't exist
    const ensureColumn = (table: string, column: string, definition: string) => {
        const info = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
        if (!info.find(c => c.name === column)) {
            console.log(`MIGRATION: Adding column '${column}' to table '${table}'`);
            db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
        }
    };

    // Chat Migrations
    ensureColumn('chats', 'is_archived', 'INTEGER DEFAULT 0');
    ensureColumn('chats', 'is_pinned', 'INTEGER DEFAULT 0');
    ensureColumn('chats', 'is_fully_synced', 'INTEGER DEFAULT 0');

    // Message Migrations
    ensureColumn('messages', 'whatsapp_id', 'TEXT');
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_whatsapp_id ON messages(whatsapp_id)').run();
    
    ensureColumn('messages', 'type', "TEXT DEFAULT 'text'");
    ensureColumn('messages', 'media_path', 'TEXT');
    ensureColumn('messages', 'latitude', 'REAL');
    ensureColumn('messages', 'longitude', 'REAL');
    ensureColumn('messages', 'vcard_data', 'TEXT');
    ensureColumn('messages', 'parent_message_id', 'TEXT');
    ensureColumn('messages', 'status', "TEXT DEFAULT 'sent'");

    // Instance Migrations
    ensureColumn('instances', 'presence', "TEXT DEFAULT 'available'");

    console.log('DATABASE: Initialization and Migrations complete.');
}

export function getDb() {
    return db;
}
