import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { loadConfig } from './utils';
import { GoogleAuthManager } from './manager/GoogleAuthManager';
import { CalendarDatabase } from './db/CalendarDatabase';
import { CalendarManager } from './manager/CalendarManager';
import { 
  HealthResponse, 
  AuthUrlResponse, 
  TokenExchangeRequest, 
  TokenExchangeResponse,
  CalendarListEntry,
  CalendarEvent,
  SyncResponse,
  TokenExchangeRequestSchema
} from './shared_schemas';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const app = express();
const PORT = process.env.PORT || 5003;
const config = loadConfig();

// Initialize Managers
const db = new CalendarDatabase();
const calendarManager = new CalendarManager(db);

// Main Google Instance Initialization
const MAIN_INSTANCE_ID = 'main_google';
const authManager = new GoogleAuthManager(
  config.google_client_id,
  config.google_client_secret,
  process.env.REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob'
);

// Register the main instance
calendarManager.registerGoogleInstance(MAIN_INSTANCE_ID, authManager);

// Log Last Fix Information
try {
  const lastFixes = JSON.parse(fs.readFileSync(path.join(__dirname, 'last_fixes.json'), 'utf8'));
  logger.info(`[SYSTEM] Last Fix: ${lastFixes.description}`);
} catch (err) {
  logger.warn('Could not load last_fixes.json');
}

app.use(cors());
app.use(express.json());

// Initialize Auth
authManager.loadTokens().then(loaded => {
  if (loaded) {
    logger.info('Google Calendar tokens loaded');
    // Ensure instance is in DB
    db.saveInstance({
      id: MAIN_INSTANCE_ID,
      name: 'Main Google Account',
      type: 'google',
      config: {},
      is_active: true
    });
    // Initial sync
    calendarManager.syncAll().catch((err: any) => logger.error('Initial sync failed', err));
  } else {
    logger.warn('No Google Calendar tokens found. Authentication required.');
  }
});

// Basic Health Check
app.get('/health', (req: Request, res: Response<HealthResponse>) => {
  res.json({ 
    status: 'ok', 
    version: '1.0.0.0006',
    authorized: authManager.isAuthorized()
  });
});

// Auth Endpoints
app.get('/api/auth/url', (req: Request, res: Response<AuthUrlResponse>) => {
  const url = authManager.getAuthUrl();
  res.json({ url });
});

app.post('/api/auth/token', async (req: Request, res: Response<TokenExchangeResponse>) => {
  const validationResult = TokenExchangeRequestSchema.safeParse(req.body);
  
  if (!validationResult.success) {
    return res.status(400).json({ 
      success: false, 
      error: validationResult.error.errors[0].message 
    });
  }

  const { code } = validationResult.data;

  try {
    await authManager.setTokens(code);
    logger.info('Successfully authorized with Google');
    
    db.saveInstance({
      id: MAIN_INSTANCE_ID,
      name: 'Main Google Account',
      type: 'google',
      config: {},
      is_active: true
    });

    calendarManager.syncAll().catch((err: any) => logger.error('Post-auth sync failed', err));
    
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Failed to exchange code', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Calendar API Endpoints
app.get('/api/calendar/list', async (req: Request, res: Response<CalendarListEntry[] | { error: string }>) => {
  try {
    const calendars = await calendarManager.listCalendars(MAIN_INSTANCE_ID);
    const mapped: CalendarListEntry[] = calendars.map((cal: any) => ({
      id: cal.id,
      summary: cal.summary || 'Unknown',
      description: cal.description,
      primary: cal.primary,
      backgroundColor: cal.backgroundColor,
      foregroundColor: cal.foregroundColor
    }));
    res.json(mapped);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/calendar/events', async (req: Request, res: Response<CalendarEvent[] | { error: string }>) => {
  const { start, end } = req.query;
  try {
    const events = await calendarManager.getAvailableSlots(
      (start as string) || new Date().toISOString(),
      (end as string) || new Date(Date.now() + 86400000).toISOString()
    );
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/sync', async (req: Request, res: Response<SyncResponse | { error: string }>) => {
  try {
    await calendarManager.syncAll();
    res.json({ success: true, count: 0 }); // Count logic can be improved later
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  const publicPath = path.join(__dirname, 'public');
  if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(publicPath, 'index.html'));
    });
  }
}

app.listen(PORT, () => {
  logger.info(`Calendar Master running on port ${PORT}`);
});