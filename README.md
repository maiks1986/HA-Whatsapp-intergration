# Maiks AI Secretary Add-ons

This repository provides a suite of professional Home Assistant Add-ons designed to act as a **Personal AI Secretary**. Currently focusing on a browserless WhatsApp integration, with Google Calendar and Mail modules coming soon.

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=maiks1986&repository=HA-Personal-Ecosystem&category=integration)
[![Open your Home Assistant instance and show the add-on store with a specific repository enabled.](https://my.home-assistant.io/badges/supervisor_add_repo.svg)](https://my.home-assistant.io/redirect/supervisor_add_repo/?repository=https%3A%2F%2Fgithub.com%2Fmaiks1986%2FHA-Whatsapp-intergration)

## 📦 Available Add-ons

### 1. WhatsApp Node Engine (Social & Presence)
The core messaging engine handling the heavy lifting using the stable Baileys library.
*   **Features:** Multi-device support, Presence Sensors (HA integration), AI Message Drafting, Ephemeral Mode.
*   **Installation:** In Home Assistant, go to **Settings > Add-ons > Add-on Store**, add this repo, search for **"WhatsApp Node Engine"** and click **Install**.

### 2. Google Calendar Master (Coming Soon)
A specialized module to manage complex scheduling and conflict resolution.

---

## 🚀 Installation (WhatsApp)

### 2. Install the Integration (HACS)
The integration connects Home Assistant to the engine.
*   Click the **"HACS"** button above to add it.
*   Restart Home Assistant.
*   Go to **Settings > Devices & Services > Add Integration**.
*   Search for **"WhatsApp Integration"**.

---

## 🛠 Features
*   **No Browser Needed:** Runs natively on Raspberry Pi (no RAM-hungry Chrome).
*   **Type-Safe:** Engine written in TypeScript for maximum stability.
*   **Multi-Device:** Your phone doesn't need to stay online.
*   **Sidebar Dashboard:** Access your chats directly from the Home Assistant sidebar.

## 📖 Usage
Once connected, you can send messages via the `whatsapp_hass.send_message` service:

```yaml
service: whatsapp_hass.send_message
data:
  contact: "31612345678" # Phone number with country code
  message: "Hello from Home Assistant!"
```

---
*Maintained by Maiks*
