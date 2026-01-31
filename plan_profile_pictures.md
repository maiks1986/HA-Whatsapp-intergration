# Plan: Profile Picture Worker (Queue-Based)

## Objective
Automatically fetch and store profile pictures for all contacts and groups after the initial sync is complete.

## 1. Architecture

### Database Changes
*   `contacts`: Column `profile_picture` (TEXT) already exists.
*   `chats`: Column `profile_picture` (TEXT) - Need to add this if we want group icons.
*   `contacts` & `chats`: Add `profile_picture_timestamp` (DATETIME) to track last fetch.

### Backend Logic (`whatsapp_node`)
1.  **Module:** `src/manager/modules/ProfilePictureManager.ts`
    *   **Queue System:** A generic queue to manage JIDs.
    *   **Worker Loop:** Uses `setInterval` to process 1 item every 2-5 seconds.
    *   **Rate Limiting:** Critical to avoid bans/throttling.
    *   **Storage:** `/data/media/avatars/`.

2.  **Logic Flow:**
    *   **Enqueue:** When contacts/chats are synced, add them to the queue.
    *   **Process:**
        *   Take JID.
        *   Call `sock.profilePictureUrl(jid, 'image')`.
        *   If URL exists:
            *   Download image buffer (using axios or fetch).
            *   Save to disk: `avatars/<jid>.jpg`.
            *   Update DB: `profile_picture = path`, `timestamp = now`.
        *   If Error (404/401/400):
            *   Update DB: `profile_picture = 'none'`, `timestamp = now` (to avoid immediate retry).

### Implementation Details (`ProfilePictureManager.ts`)
```typescript
import { WASocket } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

export class ProfilePictureManager {
    private queue: Set<string> = new Set();
    private interval: NodeJS.Timeout | null = null;
    private processing = false;

    constructor(private instanceId: number, private sock: WASocket) {
        this.ensureDir();
    }

    private ensureDir() {
        // Create /data/media/avatars
    }

    public enqueue(jids: string[]) {
        jids.forEach(jid => this.queue.add(jid));
        this.start();
    }

    public start() {
        if (this.interval) return;
        this.interval = setInterval(() => this.processNext(), 3000); // 3s delay
    }

    private async processNext() {
        if (this.processing || this.queue.size === 0) return;
        this.processing = true;
        
        const jid = this.queue.values().next().value;
        this.queue.delete(jid);

        try {
            // Fetch & Save Logic
        } catch (e) {
            // Error handling
        } finally {
            this.processing = false;
        }
    }
}
```

## 2. Integration
*   **`WhatsAppInstance.ts`:**
    *   Initialize `ProfilePictureManager`.
    *   Pass it to `MessageManager` (or expose it) so `MessageManager` can enqueue items during sync.
*   **`MessageManager.ts`:**
    *   In `handleContactsUpsert`, call `profilePictureManager.enqueue(contacts.map(c => c.id))`.
    *   In `handleChatsUpsert`, call `enqueue(chats.map(c => c.id))`.

## 3. Execution Steps
1.  **Migrate:** Add columns to `chats` and timestamps.
2.  **Create:** `ProfilePictureManager.ts`.
3.  **Integrate:** Wire into `WhatsAppInstance` and `MessageManager`.
4.  **UI:** Update `ChatView` and `ChatList` to serve/display the image.
    *   Need a route: `GET /media/avatars/:filename`.
    *   Or serve `/data/media` statically (already done in `index.ts`).
