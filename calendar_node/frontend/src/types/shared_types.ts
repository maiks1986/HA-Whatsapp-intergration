// Shared Data Transfer Objects (DTOs) for Calendar Master

export interface HealthResponse {
  status: 'ok' | 'error' | 'loading';
  version: string;
  authorized: boolean;
}

export interface AuthUrlResponse {
  url: string;
}

export interface TokenExchangeRequest {
  code: string;
}

export interface TokenExchangeResponse {
  success: boolean;
  tokens?: any; // Keeping 'any' for now as google tokens are complex, but we can refine
  error?: string;
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
}

export interface CalendarEvent {
  id: string;
  calendar_id: string;
  summary: string;
  description?: string;
  start_time: string; // ISO String
  end_time: string;   // ISO String
  location?: string;
  status?: string;
  htmlLink?: string;
}

export interface SyncResponse {
  success: boolean;
  count: number;
}
