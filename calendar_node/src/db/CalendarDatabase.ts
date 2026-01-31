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
    // Events table for shadow calendar
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        calendar_id TEXT,
        summary TEXT,
        description TEXT,
        start_time TEXT,
        end_time TEXT,
        location TEXT,
        status TEXT,
        updated TEXT,
        raw_json TEXT
      );
      
      CREATE TABLE IF NOT EXISTS sync_state (
        calendar_id TEXT PRIMARY KEY,
        next_sync_token TEXT,
        last_sync_time TEXT
      );
    `);
    
    logger.info('Calendar database initialized at ' + DB_PATH);
  }

  public saveEvent(event: any, calendarId: string) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO events (id, calendar_id, summary, description, start_time, end_time, location, status, updated, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      calendarId,
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
