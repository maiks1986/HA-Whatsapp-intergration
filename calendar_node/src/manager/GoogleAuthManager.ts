import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const TOKEN_PATH = process.env.TOKEN_PATH || '/data/tokens.json';

export class GoogleAuthManager {
  private oauth2Client: any;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;

    this.oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );
  }

  public getAuthUrl() {
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  public async setTokens(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    this.saveTokens(tokens);
    return tokens;
  }

  public async loadTokens() {
    if (fs.existsSync(TOKEN_PATH)) {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      this.oauth2Client.setCredentials(tokens);
      
      // Handle token expiration
      this.oauth2Client.on('tokens', (newTokens: any) => {
        if (newTokens.refresh_token) {
          // Merge with old tokens to keep refresh_token
          const mergedTokens = { ...tokens, ...newTokens };
          this.saveTokens(mergedTokens);
        } else {
          this.saveTokens({ ...tokens, ...newTokens });
        }
      });

      return true;
    }
    return false;
  }

  private saveTokens(tokens: any) {
    const dir = path.dirname(TOKEN_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    logger.info('Tokens saved to ' + TOKEN_PATH);
  }

  public getClient() {
    return this.oauth2Client;
  }

  public isAuthorized() {
    return !!this.oauth2Client.credentials.access_token;
  }
}
