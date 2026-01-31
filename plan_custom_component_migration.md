# Plan: Native HA Integration (The "Personal Secretary" Hub)

## Vision
Migrate from "Ingress Auth" to a **Native Home Assistant Integration**. The Integration (`whatsapp_hass`, potentially renamed to `personal_secretary` later) will act as the central UI host and Proxy. It will connect to multiple "Headless Engines" (WhatsApp, Calendar, Mail).

## 1. Architecture

### A. The Headless Engines (Add-ons)
*   **WhatsApp Node:** `http://localhost:5002`
*   **Calendar Node:** `http://localhost:5003` (Future)
*   **Mail Node:** `http://localhost:5004` (Future)
*   **Security:** Each Engine is protected by a shared `internal_api_key` defined in their configuration. They do NOT handle user sessions anymore. They trust the Integration.

### B. The Integration (`custom_components/whatsapp_hass`)
*   **The Hub:** Handles authentication via HA User Users.
*   **The Router:**
    *   `GET /whatsapp_proxy/*` -> Proxies to `localhost:5002`.
    *   `GET /calendar_proxy/*` -> Proxies to `localhost:5003`.
*   **The UI Host:** Serves the unified React Frontend (which will eventually manage all 3 engines).

## 2. Implementation Steps

### Phase 1: WhatsApp Engine Prep (`whatsapp_node`)
1.  **Config:** Add `internal_api_key` to `config.yaml`.
2.  **Auth Middleware:** Replace complex Ingress/Session logic with a simple:
    ```typescript
    if (req.headers['x-api-key'] === config.internal_api_key) next();
    ```
3.  **API:** Ensure all routes work stateless (no cookies).

### Phase 2: Python Integration (`whatsapp_hass`)
1.  **Config Flow:** Ask user for "Engine Host" (default `localhost`) and "API Key".
2.  **View registration:** Register `HassView` to handle `/api/whatsapp_proxy/{path:.*}`.
3.  **Panel:** Register the Sidebar Panel pointing to the frontend (served via the view or `www`).

### Phase 3: Frontend (`whatsapp_node/frontend`)
1.  **Build:** Configure Vite to output assets to `custom_components/whatsapp_hass/www/dashboard`.
2.  **API Client:** Update `api/index.ts` to point to `/api/whatsapp_proxy/...` instead of relative paths.
3.  **Auth:** Remove Login Screen. If the app loads, we assume the Python integration authenticated the user.

## 3. Future Proofing (Calendar & Mail)
*   When we build `calendar_node`, we simply repeat Phase 1.
*   We update the Python Integration to accept a second host/port for the Calendar.
*   We update the Frontend to have a "Calendar" tab that calls `/api/calendar_proxy/...`.

## 4. Execution Plan (Immediate)
1.  **Engine:** Switch `authMiddleware` to API Key.
2.  **Integration:** Implement the Proxy View in Python.
3.  **Frontend:** Update build path and API base.