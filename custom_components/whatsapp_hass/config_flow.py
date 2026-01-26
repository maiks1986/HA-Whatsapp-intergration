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
                    vol.Optional("monitor_only", default=False, description="Silent Monitor Mode (Download only)"): bool,
                }),
            )

        from .whatsapp_web_client import WhatsAppWebClient
        
        self.account_name = user_input["name"]
        self.monitor_only = user_input.get("monitor_only", False)
        
        await self.async_set_unique_id(self.account_name)
        self._abort_if_unique_id_configured()

        self.user_data_dir = self.hass.config.path(f"whatsapp_hass_sessions/{self.account_name}")
        
        self._client = WhatsAppWebClient(user_data_dir=self.user_data_dir)
        
        try:
            status, qr_base64 = await self.hass.async_add_executor_job(self._client.get_qr_code_or_login)

            if status == "logged_in":
                return self.async_create_entry(
                    title=self.account_name, 
                    data={
                        "name": self.account_name, 
                        "user_data_dir": self.user_data_dir,
                        "monitor_only": self.monitor_only
                    }
                )
            else:
                self.qr_base64 = qr_base64
                return await self.async_step_scan_qr()

        except Exception as e:
            _LOGGER.error("Failed to get QR code or login: %s", e)
            if os.path.exists(self.user_data_dir):
                # If there was an error, clean up the session directory
                # This is a bit aggressive, but for now it's better than leaving a corrupted session
                await self.hass.async_add_executor_job(os.rmdir, self.user_data_dir)

            if self._client:
                await self.hass.async_add_executor_job(self._client.close)
            return self.async_abort(reason="init_error")


    async def async_step_scan_qr(self, user_input=None):
        """Show the QR code and ask the user to scan it."""
        if user_input is None:
            return self.async_show_form(
                step_id="scan_qr",
                description_placeholders={
                    "qr_code_image": f'<img src="data:image/png;base64,{self.qr_base64}">'
                },
                errors={},
            )

        try:
            is_logged_in = await self.hass.async_add_executor_job(self._client.is_logged_in)
            if is_logged_in:
                return self.async_create_entry(
                    title=self.account_name, 
                    data={
                        "name": self.account_name, 
                        "user_data_dir": self.user_data_dir,
                        "monitor_only": self.monitor_only
                    }
                )
            else:
                return self.async_show_form(
                    step_id="scan_qr",
                    description_placeholders={
                        "qr_code_image": f'<img src="data:image/png;base64,{self.qr_base64}">'
                    },
                    errors={"base": "not_logged_in"},
                )
        except Exception as e:
            _LOGGER.error("Failed to check login status: %s", e)
            return self.async_abort(reason="login_check_error")
        finally:
            if self._client:
                await self.hass.async_add_executor_job(self._client.close)
    
    async def async_step_reauth(self, user_input=None):
        """Handle re-authentication."""
        # This will be called if the session becomes invalid.
        # We can implement this later.
        pass
