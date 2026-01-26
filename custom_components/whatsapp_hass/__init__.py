"""The WhatsApp Home Assistant Bridge."""
import logging
import requests
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Set up WhatsApp Bridge from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    
    # Internal Add-on URL
    engine_url = "http://127.0.0.1:5002"

    async def handle_send_message(call):
        """Send message via Node.js Engine."""
        contact = call.data.get("contact")
        message = call.data.get("message")
        instance_id = call.data.get("instance_id", 1) # Default to first instance
        
        jid = contact
        if "@" not in jid:
            jid = f"{jid}@s.whatsapp.net"

        try:
            # We skip HA headers here as it's an internal server-to-server call
            response = await hass.async_add_executor_job(
                lambda: requests.post(f"{engine_url}/send", 
                                   json={"instanceId": instance_id, "contact": jid, "message": message}, 
                                   timeout=10)
            )
            response.raise_for_status()
            _LOGGER.info(f"Message sent to {jid}")
        except Exception as e:
            _LOGGER.error(f"Failed to send message via Node Engine: {e}")

    hass.services.async_register(DOMAIN, "send_message", handle_send_message)

    # NO manual panel registration needed!
    # Ingress handles the sidebar automatically via config.yaml

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Unload entry."""
    if not hass.data[DOMAIN]:
        hass.services.async_remove(DOMAIN, "send_message")
    return True