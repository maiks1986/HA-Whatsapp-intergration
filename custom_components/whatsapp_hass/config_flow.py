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
                    vol.Required("name", description="A unique name for this WhatsApp account"): str,
                    vol.Optional("web_ui_url", default="http://localhost:5001", description="URL of the Web UI (e.g. http://192.168.1.10:5001)"): str,
                    vol.Optional("monitor_only", default=False, description="Silent Monitor Mode (Download only)"): bool,
                }),
            )

        from .whatsapp_web_client import WhatsAppWebClient
        
        self.account_name = user_input["name"]
        self.web_ui_url = user_input.get("web_ui_url", "http://localhost:5001")
        self.monitor_only = user_input.get("monitor_only", False)
        
        await self.async_set_unique_id(self.account_name)
        self._abort_if_unique_id_configured()

        return self.async_create_entry(
            title=self.account_name, 
            data={
                "name": self.account_name, 
                "monitor_only": self.monitor_only,
                "web_ui_url": self.web_ui_url
            }
        )

    async def async_step_reauth(self, user_input=None):
        """Handle re-authentication."""
        # This will be called if the session becomes invalid.
        # We can implement this later.
        pass
