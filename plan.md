# WhatsApp Pro for Home Assistant - Project Plan

## 🎯 Vision
Build a private, multi-instance, AI-powered WhatsApp CRM running natively on Home Assistant.

## 🏗 Architecture
- **Backend:** Node.js + TypeScript + Baileys (Multi-device protocol)
- **Database:** SQLite (Persistent storage for messages, users, instances, and chats)
- **Frontend:** React + Vite + Tailwind CSS (Full WhatsApp-style UI)
- **AI:** Google Gemini 1.5 Flash (Intent analysis and reply drafting)
- **Security:** Home Assistant Native Ingress (Auto-Auth & Multi-User) + Direct Access Password

---

## 🚀 What We Are Building

### 📱 Professional WhatsApp Clone UI
- **Dual-Pane Layout**: A modern sidebar for navigation and a spacious main area for conversations.
- **Dynamic Chat List**: Real-time searchable list of all active WhatsApp conversations with unread counts and message previews.
- **Message History**: Full scrollable history loaded directly from our local SQLite database.
- **Account Switcher**: A dedicated vertical navigation bar to toggle between multiple linked WhatsApp accounts instantly.
- **Contacts View**: Dedicated tab to manage and start chats with resolved contacts.

### 🧠 Gemini AI Brain
- **Intent Distillation**: Analyzes the last 20 messages of any chat to display the user's core intent (e.g., "Seeking Technical Support").
- **Smart Drafts**: Generates context-aware replies based on conversation history.
- **Steering Control**: A dedicated input to guide the AI's tone and direction (e.g., "Be more professional" or "Politely decline").
- **Manual Control**: AI-generated text is placed in the textbox for review, never auto-sent. Includes an **Eraser** button for quick clearing.

### 🛠️ Enterprise-Grade Foundation
- **Local Persistence**: Every message and contact is stored in `whatsapp.db` on your hardware. We read from our own DB first.
- **Multi-User Identity**: Securely binds WhatsApp instances to specific Home Assistant users.
- **Hybrid Security**: 
  - **Ingress**: Seamless, zero-login access when used via the Home Assistant sidebar.
  - **Direct Access**: Password-protected login screen for access via direct IP (outside HA).
  - **30-Day Persistence**: Cookie-based authentication for external web sessions.
- **Centralized Settings**: Secure management of Gemini API keys and system configurations.

---

## 🚀 Ultimate Edition Additions

### 📱 Rich Messaging UI
- **Media Engine**: Full rendering support for Images, Videos (mp4), Audio (ogg), and Documents.
- **Message Lifecycle**: Visual indicators for Sent, Delivered, and Read (Blue Ticks).
- **Interactions**: Real-time Emoji Reaction display under message bubbles.
- **Chronological Flow**: Standardized message sorting (oldest top, newest bottom).

### 🧠 Social & Presence
- **Live Presence**: Real-time "Typing..." and "Recording..." indicators via Socket.io.
- **WhatsApp Status**: Capture and store contact "Stories" in a dedicated data layer.
- **Group Mastery**: UI/Engine support for Creating groups and managing participants.

### 🛠️ Advanced Sync & Utilities
- **Deep History Worker**: Background process progressively pulling full chat history from the phone.
- **JID Normalization**: Intelligent handling of multi-device IDs (@lid) to prevent split threads.
- **Advanced Search**: Filter and find messages by text or media type.
- **Chat Management**: Pin, Archive, or Delete conversations with full sync to the phone.

---

## 🚦 Roadmap

### ✅ Phase 1: Database & Multi-Instance Core (COMPLETED v1.1.0)
- [x] SQLite schema design (`users`, `instances`, `messages`, `chats`).
- [x] Multi-Instance Manager logic.
- [x] Persistent message logging.

### ✅ Phase 2: The "WhatsApp Pro" UI (COMPLETED v1.1.7)
- [x] Implement Tailwind CSS for professional styling.
- [x] Dual-Pane layout (Sidebar for chats, Main for messages).
- [x] Real-time chat list synchronization with unread counts.
- [x] Chat Switcher and history loading.

### ✅ Phase 3: Gemini AI Integration (COMPLETED v1.1.7)
- [x] Settings page for Gemini API Keys.
- [x] Intent Analysis Engine (last 20 messages).
- [x] Smart Suggestion Engine with "Steer" functionality.

### ✅ Phase 4: Auth & Security (COMPLETED v1.1.7)
- [x] Home Assistant Ingress integration (Skip login screen).
- [x] Identity Mapping (Bind instances to HA User IDs).
- [x] Direct Access Password protection.

### ✅ Phase 5-8: Ultimate Feature Rollout (v1.7.7 Experimental)
- [x] Rich Media Infrastructure & UI.
- [x] Social Presence & Status Capture.
- [x] Chat Management (Archive/Pin/Delete).
- [x] Fullstack Type Safety & Generic API Callers.

---

## 🧪 Verification TODO List (v1.7.x)

### 1. Messaging & Media
- [ ] Verify Image/Video/Audio rendering in chat bubbles.
- [ ] Test Message Editing (Edit a msg on phone, check if it updates in HA).
- [ ] Test Reactions (React on phone, check if emoji appears in HA).
- [ ] Verify "Blue Ticks" status transitions.

### 2. Synchronization
- [ ] Confirm "Deep History Worker" is pulling old messages.
- [ ] Test JID Normalization (Multi-device thread merging).
- [ ] Verify all chats show up in sidebar immediately.

### 3. Presence & Social
- [ ] Verify "Typing..." status appears in Sidebar.
- [ ] Check `status_updates` table for captured contact stories.
- [ ] Test Group Creation from the UI/API.

---

## 🛠️ Instructions for Missing Features
If any feature in the **Ultimate Feature Set** is found to be missing or malfunctioning:
1. Create a new file named `TODO_MISSING.md`.
2. List the specific failure or missing component.
3. Describe the expected behavior vs. current behavior.
4. Call **Agent 1** to orchestrate the fix.