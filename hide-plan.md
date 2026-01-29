# Plan: Ephemeral Message Watcher (Modular System)

## Core Philosophy: Modularization
To prevent regression and accidental deletion, all logic related to Ephemeral Messages will be encapsulated in a single, dedicated module.

## 1. File Structure
*   **Backend:** `whatsapp_node/src/manager/modules/EphemeralManager.ts`
    *   This class will handle the database polling, logic, and Baileys interaction.
    *   It will expose public methods like `start()`, `stop()`, `enableForChat()`, `disableForChat()`.
    *   It will be instantiated once in `WhatsAppInstance` and kept as a property `this.ephemeralManager`.

## 2. Database Changes
*   **Migrations:**
    *   `chats`: `ephemeral_mode` (INT), `ephemeral_timer` (INT), `ephemeral_start_ts` (INT/TEXT).
    *   `messages`: `deleted_on_device` (INT).
    *   `settings`: 
        *   `ephemeral_trigger_start` (default: 👻)
        *   `ephemeral_trigger_stop` (default: 🛑)

## 3. The `EphemeralManager` Class
```typescript
export class EphemeralManager {
    constructor(private instanceId: number, private sock: any) {}

    public start() {
        // Start the 5-minute interval loop
    }

    public async enableForChat(jid: string, timerMinutes: number) {
        // Update DB
    }

    public async disableForChat(jid: string) {
        // Update DB
    }

    private async processCleanup() {
        // 1. Query candidate messages
        // 2. Batch by chat
        // 3. Execute sock.chatModify({ clear: ... })
        // 4. Update messages as deleted_on_device
    }
    
    public async handleIncomingMessage(jid: string, text: string) {
       // Check settings for start/stop emojis
       // Toggle mode if matched
    }
}
```

## 4. Integration Points
*   **`WhatsAppInstance.ts`:**
    *   Import `EphemeralManager`.
    *   `this.ephemeralManager = new EphemeralManager(this.id, this.sock);`
    *   `this.ephemeralManager.start();`
*   **`messaging.ts` (Routes):**
    *   Add route `POST /api/chats/:jid/ephemeral` -> delegates to `instance.ephemeralManager`.
*   **`MessageManager.ts`:**
    *   Call `instance.ephemeralManager.handleIncomingMessage(jid, text)` on every new message.

## 5. Frontend
*   **`ChatView.tsx`:** Add the UI toggle.
*   **`SettingsModal.tsx`:** Add inputs for "Start Emoji" and "Stop Emoji".

## 6. Execution Plan
1.  **Migrate:** Update `database.ts` with new columns.
2.  **Create:** `EphemeralManager.ts` with the logic.
3.  **Integrate:** Wire it into `WhatsAppInstance.ts` and `messaging.ts`.
4.  **Feature:** Add emoji detection in `MessageManager`.
5.  **UI:** Add the button in `ChatView.tsx` and settings in `SettingsModal.tsx`.
