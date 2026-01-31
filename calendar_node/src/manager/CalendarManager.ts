import { google } from 'googleapis';
import { GoogleAuthManager } from './GoogleAuthManager';
import { CalendarDatabase } from '../db/CalendarDatabase';
import { CalendarEvent } from '../shared_types';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

export class CalendarManager {
  private authManager: GoogleAuthManager;
  private db: CalendarDatabase;

  constructor(authManager: GoogleAuthManager, db: CalendarDatabase) {
    this.authManager = authManager;
    this.db = db;
  }

  public async listCalendars() {
    const calendar = google.calendar({ version: 'v3', auth: this.authManager.getClient() });
    const res = await calendar.calendarList.list();
    return res.data.items || [];
  }

  public async syncEvents(calendarId: string = 'primary'): Promise<any[]> {
    const calendar = google.calendar({ version: 'v3', auth: this.authManager.getClient() });
    
    logger.info(`Syncing events for calendar: ${calendarId}`);

    const res = await calendar.events.list({
      calendarId: calendarId,
      timeMin: new Date().toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = res.data.items || [];
    for (const event of events) {
      this.db.saveEvent(event, calendarId);
    }

    logger.info(`Synced ${events.length} events`);
    return events;
  }

  public async getAvailableSlots(start: string, end: string): Promise<CalendarEvent[]> {
    // This will eventually use the Shadow DB for conflict resolution
    // and complex logic as per the plan.
    const rawEvents = this.db.getEvents(start, end);
    
    return rawEvents.map((row: any) => ({
      id: row.id,
      calendar_id: row.calendar_id,
      summary: row.summary,
      description: row.description,
      start_time: row.start_time,
      end_time: row.end_time,
      location: row.location,
      status: row.status,
      // Add other fields as needed from JSON if necessary
    }));
  }

  public async createEvent(eventDetails: any) {
    const calendar = google.calendar({ version: 'v3', auth: this.authManager.getClient() });
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: eventDetails,
    });
    
    // Save to shadow DB immediately
    this.db.saveEvent(res.data, 'primary');
    
    return res.data;
  }
}
