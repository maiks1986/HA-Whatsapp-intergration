# Plan: Profile Picture Worker (Queue-Based)

## Objective
Automatically fetch and store profile pictures for all contacts and groups after the initial sync is complete.

## 1. Architecture

### Database Changes
*   `contacts`: Column `profile_picture` (TEXT) already exists (added in `.0008` migration).
*   `chats`: Column `profile_picture` (TEXT) - Need to add this if we want group icons.

### Backend Logic (`whatsapp_node`)
1.  **Module:** `ProfilePictureManager.ts`
    *   **Queue System:** A simple array or Set of JIDs to process.
    *   **Worker Loop:** Runs every X seconds (e.g., 2s) to process 1 item from the queue.
    *   **Rate Limiting:** Ensure we don't call `sock.profilePictureUrl` too fast.
    *   **Prioritization:**
        *   Priority 1: Active chats (from `chats` table).
        *   Priority 2: Contacts with missing pictures.

2.  **Triggers:**
    *   **Initial Sync Complete:** When `messaging-history.set` finishes or `connection.update` is open, enqueue all known contacts/chats.
    *   **New Contact/Chat:** `contacts.upsert` / `chats.upsert` -> Enqueue immediately.
    *   **Missing Picture:** If UI requests a picture and it's missing, maybe enqueue it? (Backend driven is safer).

3.  **Storage:**
    *   Fetch URL -> Download Image -> Save to `/data/media/avatars/`.
    *   Update DB with local path (or URL if we just want to cache the link, but local is better for privacy/offline).
    *   *Correction:* Saving thousands of images might bloat storage. Storing the *URL* is easier but URLs expire. Storing the *File* is robust.
    *   **Decision:** Store the **File**.
    *   **Path:** `/data/media/avatars/<jid>.jpg`.

### Implementation Details (`ProfilePictureManager.ts`)
```typescript
export class ProfilePictureManager {
    private queue: string[] = [];
    private processing = false;

    // ... init ...

    public enqueue(jids: string[]) {
        // Add unique JIDs to queue
    }

    private async processQueue() {
        if (this.queue.length === 0) return;
        const jid = this.queue.shift();
        
        try {
            const url = await this.sock.profilePictureUrl(jid, 'image'); // 'image' = high res, 'preview' = low
            // Download and save
            // Update DB
        } catch (e) {
            // 401/404 means no profile pic or private
            // Update DB to 'none' so we don't retry forever
        }
    }
}
```

## 2. Integration
*   **`WhatsAppInstance.ts`:** Initialize `ProfilePictureManager`.
*   **`MessageManager.ts`:** Call `enqueue` when new contacts/chats appear.

## 3. Database Migration
*   Add `profile_picture` to `chats` table (if missing).
*   Add `profile_picture_timestamp` to track when we last fetched it (to refresh periodically).

## 4. Risks
*   **Rate Limits:** WhatsApp is strict. We should stick to 1 fetch every 2-5 seconds.
*   **Storage:** 5000 contacts * 50KB = 250MB. Acceptable for HA Add-on.

## 5. Execution Steps
1.  **Migrate:** Add columns.
2.  **Create:** `ProfilePictureManager.ts`.
3.  **Integrate:** Hook into `WhatsAppInstance`.
4.  **UI:** Update frontend to display the image.