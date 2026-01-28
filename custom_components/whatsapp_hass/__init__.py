"""The Ultimate WhatsApp Home Assistant Bridge."""
import logging
import aiohttp
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers import config_validation as cv, device_registry as dr
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor", "binary_sensor"]

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Set up WhatsApp Bridge from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    
    # Internal Add-on Engine URL
    engine_url = "http://127.0.0.1:5002"
    
    # Track internal session for engine communication
    session = aiohttp.ClientSession()
    hass.data[DOMAIN][entry.entry_id] = {
        "engine_url": engine_url,
        "session": session
    }

    device_registry = dr.async_get(hass)
    device_registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, "engine")},
        name="WhatsApp Node Engine",
        manufacturer="Maiks86",
        model="Ultimate Multi-Instance",
        sw_version="1.8.0"
    )

    async def engine_api_call(method: str, path: str, data: dict = None):
        """Helper to call Node.js Engine."""
        url = f"{engine_url}{path}"
        try:
            async with session.request(method, url, json=data, timeout=10) as response:
                if response.status >= 400:
                    _LOGGER.error(f"Engine API Error {response.status} on {path}")
                    return None
                return await response.json()
        except Exception as e:
            _LOGGER.error(f"Failed to communicate with Node Engine at {url}: {e}")
            return None

    # --- SERVICES ---

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

    async def handle_modify_chat(call: ServiceCall):
        """Pin, Archive, or Delete a chat."""
        jid = call.data.get("jid")
        action = call.data.get("action") # archive, pin, delete
        instance_id = call.data.get("instance_id", 1)
        await engine_api_call("POST", f"/api/chats/{instance_id}/{jid}/modify", {"action": action})

    async def handle_set_presence(call: ServiceCall):
        """Set instance online/offline state."""
        instance_id = call.data.get("instance_id", 1)
        presence = call.data.get("presence") # available, unavailable
        await engine_api_call("POST", f"/api/instances/{instance_id}/presence", {"presence": presence})

    async def handle_create_group(call: ServiceCall):
        """Create a new WhatsApp group."""
        instance_id = call.data.get("instance_id", 1)
        title = call.data.get("title")
        participants = call.data.get("participants", [])
        await engine_api_call("POST", f"/api/groups/{instance_id}", {
            "title": title,
            "participants": participants
        })

    # Register Services
    hass.services.async_register(DOMAIN, "send_message", handle_send_message)
    hass.services.async_register(DOMAIN, "modify_chat", handle_modify_chat)
    hass.services.async_register(DOMAIN, "set_presence", handle_set_presence)
    hass.services.async_register(DOMAIN, "create_group", handle_create_group)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Unload entry."""
    data = hass.data[DOMAIN].pop(entry.entry_id)
    await data["session"].close()
    
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.services.async_remove(DOMAIN, "send_message")
        hass.services.async_remove(DOMAIN, "modify_chat")
        hass.services.async_remove(DOMAIN, "set_presence")
        hass.services.async_remove(DOMAIN, "create_group")

    return unload_ok
