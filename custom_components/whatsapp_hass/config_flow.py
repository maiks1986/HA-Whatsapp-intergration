import voluptuous as vol
from homeassistant import config_entries, core
from .const import DOMAIN
import logging
import os

_LOGGER = logging.getLogger(__name__)

class WhatsAppConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self):
        self._client = None
        self.user_data_dir = None
        self.account_name = None
        self.qr_base64 = None
        self.monitor_only = False

    async def async_step_user(self, user_input=None):
        """Handle a flow initiated by the user."""
        if user_input is None:
            return self.async_show_form(
                step_id="user",
                data_schema=vol.Schema({
                    vol.Required("engine_host", default="a0d7b954-whatsapp-node-engine"): str,
                    vol.Required("engine_port", default=5002): int,
                    vol.Required("api_key", description="Internal API Key from Add-on Config"): str,
                }),
            )

        await self.async_set_unique_id("whatsapp_engine")
        self._abort_if_unique_id_configured()

        return self.async_create_entry(
            title="WhatsApp Engine", 
            data={
                "engine_host": user_input["engine_host"],
                "engine_port": user_input["engine_port"],
                "api_key": user_input["api_key"]
            }
        )

    async def async_step_reauth(self, user_input=None):
        """Handle re-authentication."""
        # This will be called if the session becomes invalid.
        # We can implement this later.
        pass
