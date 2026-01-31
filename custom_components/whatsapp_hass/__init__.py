"""The Ultimate WhatsApp Home Assistant Bridge."""
import logging
import aiohttp
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.config_entries import ConfigEntry
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers import config_validation as cv, device_registry as dr
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor", "binary_sensor"]

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Set up WhatsApp Bridge from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    
    host = entry.data.get("engine_host", "localhost")
    port = entry.data.get("engine_port", 5002)
    api_key = entry.data.get("api_key", "")
    
    engine_url = f"http://{host}:{port}"
    
    session = aiohttp.ClientSession()
    hass.data[DOMAIN][entry.entry_id] = {
        "engine_url": engine_url,
        "api_key": api_key,
        "session": session
    }

    # Register Panel
    # Note: We need to serve the frontend assets. 
    # For now, we point to the Ingress URL or a View.
    # Ideally, we serve static files from 'www'.
    
    # Path to the build output (we will need to copy frontend/dist to custom_components/whatsapp_hass/www)
    # hass.http.register_static_path("/whatsapp_hass_static", hass.config.path("custom_components/whatsapp_hass/www"), cache_headers=False)

    hass.components.frontend.async_register_panel(
        "whatsapp",
        "WhatsApp",
        "mdi:whatsapp",
        frontend_url_path="whatsapp",
        module_url=None, # We will use an iframe or custom element later
        # For simple iframe to the engine (if exposed):
        # url=engine_url 
        # But we want internal proxy.
        # So we register a View that serves the HTML.
    )

    # Register Proxy View
    hass.http.register_view(WhatsAppProxyView(hass, engine_url, api_key))

    # --- SERVICES ---
    async def engine_api_call(method: str, path: str, data: dict = None):
        """Helper to call Node.js Engine."""
        url = f"{engine_url}{path}"
        headers = {"x-api-key": api_key}
        try:
            async with session.request(method, url, json=data, headers=headers, timeout=10) as response:
                if response.status >= 400:
                    _LOGGER.error(f"Engine API Error {response.status} on {path}")
                    return None
                return await response.json()
        except Exception as e:
            _LOGGER.error(f"Failed to communicate with Node Engine at {url}: {e}")
            return None

    async def handle_send_message(call: ServiceCall):
        """Send a text message."""
        contact = call.data.get("contact")
        message = call.data.get("message")
        instance_id = call.data.get("instance_id", 1)
        await engine_api_call("POST", "/api/send_message", {
            "instanceId": instance_id,
            "contact": contact,
            "message": message
        })

    # Register Services
    hass.services.async_register(DOMAIN, "send_message", handle_send_message)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Unload entry."""
    data = hass.data[DOMAIN].pop(entry.entry_id)
    await data["session"].close()
    
    hass.components.frontend.async_remove_panel("whatsapp")
    
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


class WhatsAppProxyView(HomeAssistantView):
    """Proxy view for WhatsApp Engine."""
    url = "/api/whatsapp_proxy/{path:.*}"
    name = "api:whatsapp_proxy"
    requires_auth = True # HA Auth required!

    def __init__(self, hass, engine_url, api_key):
        self.hass = hass
        self.engine_url = engine_url
        self.api_key = api_key
        self.session = aiohttp.ClientSession()

    async def _handle(self, request, path):
        # Forward request to Node Engine
        target_url = f"{self.engine_url}/api/{path}"
        
        # Stream data? Or simple JSON?
        # For simplicity, assume JSON for API calls.
        # If we need websockets, that's harder in Python Views.
        
        method = request.method
        data = None
        if method in ['POST', 'PUT']:
            data = await request.json()

        headers = {"x-api-key": self.api_key}
        
        async with self.session.request(method, target_url, json=data, headers=headers) as resp:
            # Forward response back to UI
            text = await resp.text()
            return aiohttp.web.Response(text=text, status=resp.status, content_type=resp.content_type)

    async def get(self, request, path): return await self._handle(request, path)
    async def post(self, request, path): return await self._handle(request, path)
    async def delete(self, request, path): return await self._handle(request, path)
    async def put(self, request, path): return await self._handle(request, path)