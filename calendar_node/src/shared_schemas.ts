import { z } from 'zod';

// --- Roles and Types ---

export const CalendarRoleSchema = z.enum([
  'primary',        // Main appointments
  'private',        // Private appointments (blocks time, hidden details)
  'fixed',          // Recurring/Routine (Vaste Afspraken)
  'presence',       // Drives HA sensors (Justin Thuis/School)
  'social_slots',   // Shared availability (Adriana)
  'external',       // Read-only feeds (School Holidays)
  'ignore'          // Specifically excluded
]);
export type CalendarRole = z.infer<typeof CalendarRoleSchema>;

export const InstanceTypeSchema = z.enum(['google', 'ics']);
export type InstanceType = z.infer<typeof InstanceTypeSchema>;

// --- Instance Schemas ---

export const InstanceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: InstanceTypeSchema,
  config: z.any(), // JSON config for OAuth or ICS URL
  is_active: z.boolean(),
});
export type Instance = z.infer<typeof InstanceSchema>;

// --- Core Response Schemas ---

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'error', 'loading']),
  version: z.string(),
  authorized: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const AuthUrlResponseSchema = z.object({
  url: z.string().url(),
});
export type AuthUrlResponse = z.infer<typeof AuthUrlResponseSchema>;

// --- Request Schemas ---

export const TokenExchangeRequestSchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
});
export type TokenExchangeRequest = z.infer<typeof TokenExchangeRequestSchema>;

export const TokenExchangeResponseSchema = z.object({
  success: z.boolean(),
  tokens: z.any().optional(), // Can refine this later if we want strict Google Token typing
  error: z.string().optional(),
});
export type TokenExchangeResponse = z.infer<typeof TokenExchangeResponseSchema>;

// --- Calendar Data Schemas ---

export const CalendarListEntrySchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  primary: z.boolean().optional(),
  backgroundColor: z.string().optional(),
  foregroundColor: z.string().optional(),
});
export type CalendarListEntry = z.infer<typeof CalendarListEntrySchema>;

export const CalendarEventSchema = z.object({
  id: z.string(),
  calendar_id: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  start_time: z.string().datetime(), // Enforces ISO 8601
  end_time: z.string().datetime(),
  location: z.string().optional(),
  status: z.string().optional(),
  htmlLink: z.string().optional(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const SyncResponseSchema = z.object({
  success: z.boolean(),
  count: z.number(),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;