# WhatsApp Pro for Home Assistant - Project Plan

## 🎯 Vision
Build a private, multi-instance, AI-powered WhatsApp CRM running natively on Home Assistant.

## 🏗 Architecture
- **Backend:** Node.js + TypeScript + Baileys (Multi-device protocol)
- **Database:** SQLite (Persistent storage for messages, users, and instances)
- **Frontend:** React + Vite + Tailwind CSS (WhatsApp-style UI)
- **AI:** Google Gemini 1.5 Flash (Intent analysis and reply drafting)
- **Security:** Home Assistant Native Ingress (Auto-Auth & Multi-User)

---

## 🚦 Roadmap

### ✅ Phase 1: Database & Multi-Instance Core (COMPLETED v1.1.0)
- [x] SQLite schema design (`users`, `instances`, `messages`).
- [x] Multi-Instance Manager logic.
- [x] Persistent message logging.

### ✅ Phase 2: The "WhatsApp Pro" UI (COMPLETED v1.1.1)
- [x] Implement Tailwind CSS for professional styling.
- [x] Create Dual-Pane layout (Sidebar for chats, Main for messages).
- [x] Build Instance Switcher (sidebar).
- [x] Implement Chat Controls (Clear button, AI Draft field).

### ✅ Phase 3: Gemini AI Integration (COMPLETED v1.1.2)
- [x] Settings page for Gemini API Keys.
- [x] Intent Analysis Engine (last 20 messages).
- [x] Smart Suggestion Engine with "Steer" functionality.

### ✅ Phase 4: Auth & Security (COMPLETED v1.1.2)
- [x] Home Assistant Ingress integration (Skip login screen).
- [x] Identity Mapping (Bind instances to HA User IDs).
- [x] Admin vs User privacy logic.

---

## 📝 Current Status
The "WhatsApp Pro" system is now feature-complete for the core vision. It is a secure, multi-user, AI-assisted WhatsApp dashboard running entirely on your Raspberry Pi.