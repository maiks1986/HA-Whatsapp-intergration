"""The WhatsApp integration."""
import asyncio
import logging
import os
import subprocess
import threading
import sys
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.network import get_url
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# Global storage for the UI thread
UI_THREAD = None

def ensure_dependencies():
    """Install dependencies at runtime to avoid manifest conflicts."""
    packages = ["playwright>=1.45.0", "google-generativeai>=0.7.2"]
    for package in packages:
        try:
            # Check if already installed
            pkg_name = package.split('>=')[0].replace('-', '_')
            if pkg_name == "google_generativeai":
                import google.generativeai
            else:
                __import__(pkg_name)
        except ImportError:
            _LOGGER.info(f"Installing missing dependency: {package}")
            try:
                subprocess.run([sys.executable, "-m", "pip", "install", package], check=True)
            except Exception as e:
                _LOGGER.error(f"Failed to install {package}: {e}")

    # After installing playwright, install chromium
    try:
        _LOGGER.info("Ensuring Playwright chromium is installed...")
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
    except Exception as e:
        _LOGGER.error(f"Failed to run playwright install: {e}")

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Set up WhatsApp from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    
    # Run installation in executor to avoid blocking
    await hass.async_add_executor_job(ensure_dependencies)

    # Defer import of client until dependencies are likely installed
    from .whatsapp_web_client import WhatsAppWebClient

    # Initialize client
    user_data_dir = hass.config.path(f"whatsapp_sessions/{entry.data['name']}")
    os.makedirs(user_data_dir, exist_ok=True)
    client = WhatsAppWebClient(user_data_dir=user_data_dir)
    
    # Start the Web UI Gateway locally on the HA server
    global UI_THREAD
    if UI_THREAD is None:
        from .gateway_ui import start_gateway
        UI_THREAD = threading.Thread(target=start_gateway, args=(hass, client), daemon=True)
        UI_THREAD.start()
        _LOGGER.info("WhatsApp Web UI Gateway started on port 5001")

    hass.data[DOMAIN][entry.entry_id] = {
        "client": client,
        "name": entry.data["name"]
    }

    # Determine URL for the sidebar panel
    try:
        base_url = get_url(hass, allow_internal=True, allow_ip=True)
        # Replace the port 8123 with 5001
        panel_url = base_url.rsplit(":", 1)[0] + ":5001"
    except:
        panel_url = "/local/whatsapp_redirect" # Fallback if URL cannot be determined

    # Register Sidebar Panel
    hass.components.frontend.async_register_panel(
        "iframe",
        "whatsapp",
        "mdi:whatsapp",
        title="WhatsApp",
        url=panel_url,
        require_admin=True,
    )

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Unload a config entry."""
    data = hass.data[DOMAIN].pop(entry.entry_id)
    await data["client"].close()
    
    if not hass.data[DOMAIN]:
        hass.components.frontend.async_remove_panel("whatsapp")
    
    return True
