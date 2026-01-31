# The "Personal Secretary" Ecosystem: Master Plan

## 1. Vision
We are building a suite of cooperating Home Assistant Add-ons that act as a "Personal Secretary". The system observes communication (WhatsApp, Mail), reasons about it (Gemini AI), and acts on it (Calendar, Reminders).

**Core Philosophy:** "Easy to Install, Modular to Maintain."

## 2. Repository Structure (Monorepo)
The repository `HA-Whatsapp-intergration` (likely to be renamed `HA-Personal-Ecosystem` in Git) contains multiple Add-ons:

```text
/
├── whatsapp_node/       # [EXISTING] The "Social Engine"
│   ├── Purpose: Connects to WhatsApp, tracks presence, sends/receives messages.
│   └── Status: Stable (v1.9.1.0038). Features: Social Sensors, Ephemeral Mode, AI Nudge.
│
├── calendar_node/       # [NEXT UP] The "Time Master"
│   ├── Purpose: Manages Google Calendars, resolves conflicts, finds free slots.
│   └── Status: Scaffolding only.
│
└── mail_node/           # [FUTURE] The "Mail Gate"
    ├── Purpose: IMAP/SMTP bridge to read/send emails.
    └── Status: Planned.
```

## 3. The "Intelligence Layer" (Gemini AI)
Currently, `whatsapp_node` has its own `AiService.ts`.
**Future Goal:** Centralize this or ensure all nodes use the same shared config/key structure.
*   **Model:** `gemini-2.5-flash-lite` (Cost-effective, high throughput).
*   **Role:**
    *   **Parser:** Extracts dates/intents from chat/mail.
    *   **Drafter:** Writes replies.
    *   **Decision Maker:** "Should I put this on the work calendar or personal?"

## 4. The "Calendar Master" (Detailed Plan for Next Agent)

### A. Core Responsibilities
1.  **Auth:** Manage Google OAuth2 tokens (Headless UI flow).
2.  **API:** Expose REST endpoints for other Add-ons:
    *   `POST /api/calendar/check-availability` (Input: "Tomorrow 2pm")
    *   `POST /api/calendar/insert` (Input: JSON Event)
    *   `GET /api/calendar/summary` (Input: "Today")
3.  **Shadow DB:** Maintain a local SQLite mirror of the calendar for instant queries (avoiding API latency/limits during "thinking" phases).

### B. Tech Stack
*   **Base:** Node.js (TypeScript), Express, SQLite (better-sqlite3).
*   **Google:** `googleapis` library.
*   **Frontend:** React (Vite) for the Config/Auth dashboard.

### C. Immediate Tasks
1.  **Initialize:** Run `npm init` in `calendar_node`.
2.  **Config:** Create `config.yaml` for Home Assistant (ingress: true).
3.  **Auth:** Build the OAuth2 flow.
4.  **Integration:** Modify `whatsapp_node` to *discover* `calendar_node` (try `http://local-calendar-node:5003`).

## 5. Deployment Strategy
*   **One Repo URL:** The user adds this single repo to HA Store.
*   **Multi-Addon:** They see "Social Engine" and "Calendar Master" as separate installs.
*   **Zero-Config Link:** Add-ons talk via Docker/HA internal network. No manual IP setup.

## 6. Current Status of `whatsapp_node`
*   **Version:** 1.9.1.0038
*   **Key Features:**
    *   **Social Sensors:** Tracks contacts to HA Sensors.
    *   **Stealth Mode:** Schedule privacy settings.
    *   **Ephemeral:** "Delete for Me" automation.
    *   **Robustness:** Auto-resets corrupted sessions, retries syncs.
    *   **Ingress:** Fully working auto-login.

## 7. Handover Instruction
**To the next Agent:**
Your primary focus is **bootstrapping the `calendar_node`**.
1.  Read this plan.
2.  Set up `calendar_node/package.json`, `tsconfig.json`, `Dockerfile`.
3.  Implement the basic Express server.
4.  Build the Google Auth flow.
