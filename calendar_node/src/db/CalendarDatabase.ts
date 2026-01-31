import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const DB_PATH = process.env.DB_PATH || '/data/calendar.db';

export class CalendarDatabase {
  private db: Database.Database;

  constructor() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(DB_PATH);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS instances (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        config TEXT, -- JSON
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS calendars (
        id TEXT PRIMARY KEY,
        instance_id TEXT,
        external_id TEXT, -- Google ID or Feed URL
        summary TEXT,
        role TEXT DEFAULT 'ignore',
        sync_token TEXT,
        last_sync TEXT,
        FOREIGN KEY(instance_id) REFERENCES instances(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        calendar_id TEXT,
        instance_id TEXT,
        summary TEXT,
        description TEXT,
        start_time TEXT,
        end_time TEXT,
        location TEXT,
        status TEXT,
        updated TEXT,
        raw_json TEXT,
        FOREIGN KEY(calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
        FOREIGN KEY(instance_id) REFERENCES instances(id) ON DELETE CASCADE
      );
    `);
    
    logger.info('Calendar database initialized with multi-instance support');
  }

  public saveInstance(instance: any) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO instances (id, name, type, config, is_active)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(instance.id, instance.name, instance.type, JSON.stringify(instance.config), instance.is_active ? 1 : 0);
  }

  public getInstances() {
    return this.db.prepare('SELECT * FROM instances').all();
  }

  public saveCalendar(cal: any) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO calendars (id, instance_id, external_id, summary, role, sync_token, last_sync)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(cal.id, cal.instance_id, cal.external_id, cal.summary, cal.role, cal.sync_token, cal.last_sync);
  }

  public saveEvent(event: any, calendarId: string, instanceId: string) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO events (id, calendar_id, instance_id, summary, description, start_time, end_time, location, status, updated, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      calendarId,
      instanceId,
      event.summary || '',
      event.description || '',
      event.start?.dateTime || event.start?.date || '',
      event.end?.dateTime || event.end?.date || '',
      event.location || '',
      event.status || '',
      event.updated || '',
      JSON.stringify(event)
    );
  }

  public getCalendarsByRole(role: string) {
    return this.db.prepare('SELECT * FROM calendars WHERE role = ?').all(role);
  }

  public getEvents(startTime: string, endTime: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM events 
      WHERE start_time < ? AND end_time > ?
      ORDER BY start_time ASC
    `);
    return stmt.all(endTime, startTime);
  }

  public close() {
    this.db.close();
  }
}
