"""The WhatsApp integration."""
import asyncio
import logging
import os
import datetime
import requests
import re
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(hass, entry):
    """Set up WhatsApp from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    
    account_name = entry.data["name"]
    web_ui_url = entry.data.get("web_ui_url", "http://localhost:5001")
    
    hass.data[DOMAIN][entry.entry_id] = {
        "name": account_name,
        "web_ui_url": web_ui_url
    }

    async def handle_send_message(call):
        """Handle the send_message service call globally."""
        sender = call.data.get("sender")
        contact = call.data.get("contact")
        message = call.data.get("message")
        
        # Find the client for the specified sender
        target_client = None
        for entry_id, data in hass.data[DOMAIN].items():
            if data.get("name") == sender:
                target_client = data["client"]
                break
        
        if not target_client:
            _LOGGER.error(f"No WhatsApp account found with name: {sender}")
            hass.components.persistent_notification.async_create(
                f"No WhatsApp account found with name: {sender}",
                title="WhatsApp Integration Error",
                notification_id=f"whatsapp_error_missing_sender"
            )
            return

        try:
            proxy_url = f"{web_ui_url}/api/proxy_send_message"
            requests.post(proxy_url, json={"contact": contact, "message": message}, timeout=10)
        except Exception as e:
            _LOGGER.error("Failed to send message via proxy: %s", e)
            hass.components.persistent_notification.async_create(
                f"Failed to send message to {contact} from {sender}: {e}",
                title="WhatsApp Integration Error",
                notification_id=f"whatsapp_error_{sender}"
            )

    # Register service only if not already registered
    if not hass.services.has_service(DOMAIN, "send_message"):
        hass.services.async_register(DOMAIN, "send_message", handle_send_message)

    # Register Sidebar Panel
    if web_ui_url:
        hass.components.frontend.async_register_panel(
            "iframe",
            "whatsapp",
            "mdi:whatsapp",
            title="WhatsApp",
            url=web_ui_url,
            require_admin=True,
        )

    return True

def post_to_webhook(message_data, base_url):
    """Send message data to the webhook in a separate thread."""
    try:
        url = f"{base_url}/webhook"
        requests.post(url, json=message_data, timeout=5)
    except requests.RequestException as e:
        _LOGGER.error(f"Failed to send message to webhook: {e}")

def update_status(account, status, base_url):
    """Send status update to Web UI."""
    try:
        url = f"{base_url}/api/update_status"
        requests.post(url, json={"account": account, "status": status}, timeout=5)
    except requests.RequestException as e:
        _LOGGER.error(f"Failed to update status: {e}")

def upload_history(account, history_data, base_url):
    """Upload bulk history to Web UI."""
    try:
        url = f"{base_url}/api/upload_history"
        requests.post(url, json={"account": account, "history": history_data}, timeout=10)
    except requests.RequestException as e:
        _LOGGER.error(f"Failed to upload history: {e}")

def parse_message(raw_message):
    """Parse the raw message string into a structured dictionary."""
    # Example format: "[26-01-2026 14:00] Sender Name: Message text"
    match = re.match(r"\[(.*?)\]\s(.*?):\s(.*)", raw_message)
    if match:
        return {"timestamp": match.group(1), "sender": match.group(2), "text": match.group(3)}
    return {"timestamp": "Unknown", "sender": "Unknown", "text": raw_message}

async def async_unload_entry(hass, entry):
    """Unload a config entry."""
    hass.data[DOMAIN].pop(entry.entry_id)
    
    if not hass.data[DOMAIN]:
        hass.services.async_remove(DOMAIN, "send_message")
        hass.components.frontend.async_remove_panel("whatsapp")
    
    return True
