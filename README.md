# WhatsApp for Home Assistant (Browserless)

This project provides a professional, browserless WhatsApp integration for Home Assistant using **Node.js (TypeScript)** and **Python**.

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=maiks1986&repository=HA-Whatsapp-intergration&category=integration)
[![Open your Home Assistant instance and show the add-on store with a specific repository enabled.](https://my.home-assistant.io/badges/supervisor_add_repo.svg)](https://my.home-assistant.io/redirect/supervisor_add_repo/?repository=https%3A%2F%2Fgithub.com%2Fmaiks1986%2FHA-Whatsapp-intergration)

## 🚀 Two-Step Installation

To run this on your Raspberry Pi, you need to install both the **Engine** (Add-on) and the **Integration** (HACS).

### 1. Install the WhatsApp Engine (Add-on)
The engine handles the heavy lifting using the stable Baileys library.
*   Click the **"Add Repository"** button above.
*   In Home Assistant, go to **Settings > Add-ons > Add-on Store**.
*   Search for **"WhatsApp Node Engine"** and click **Install**.
*   Click **Start**.

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
