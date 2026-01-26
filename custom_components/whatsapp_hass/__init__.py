"""The WhatsApp integration."""
import asyncio
import logging
import os
import datetime
import requests
import re
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# This should be made configurable
WEB_UI_BASE = "http://localhost:5001"
WEBHOOK_URL = f"{WEB_UI_BASE}/webhook"
STATUS_URL = f"{WEB_UI_BASE}/api/update_status"
HISTORY_URL = f"{WEB_UI_BASE}/api/upload_history"

async def async_setup_entry(hass, entry):
    """Set up WhatsApp from a config entry."""
    from .whatsapp_web_client import WhatsAppWebClient
    
    hass.data.setdefault(DOMAIN, {})
    
    user_data_dir = entry.data["user_data_dir"]
    account_name = entry.data["name"]
    
    client = WhatsAppWebClient(user_data_dir=user_data_dir)
    
    # Run client in background
    task = hass.async_create_task(run_client(client, hass, entry))
    
    hass.data[DOMAIN][entry.entry_id] = {
        "client": client,
        "task": task,
        "name": account_name
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
            await hass.async_add_executor_job(target_client.send_message, contact, message)
        except Exception as e:
            _LOGGER.error("Failed to send message: %s", e)
            hass.components.persistent_notification.async_create(
                f"Failed to send message to {contact} from {sender}: {e}",
                title="WhatsApp Integration Error",
                notification_id=f"whatsapp_error_{sender}"
            )

    # Register service only if not already registered
    if not hass.services.has_service(DOMAIN, "send_message"):
        hass.services.async_register(DOMAIN, "send_message", handle_send_message)

    return True

def post_to_webhook(message_data):
    """Send message data to the webhook in a separate thread."""
    try:
        requests.post(WEBHOOK_URL, json=message_data, timeout=5)
    except requests.RequestException as e:
        _LOGGER.error(f"Failed to send message to webhook: {e}")

def update_status(account, status):
    """Send status update to Web UI."""
    try:
        requests.post(STATUS_URL, json={"account": account, "status": status}, timeout=5)
    except requests.RequestException as e:
        _LOGGER.error(f"Failed to update status: {e}")

def upload_history(account, history_data):
    """Upload bulk history to Web UI."""
    try:
        requests.post(HISTORY_URL, json={"account": account, "history": history_data}, timeout=10)
    except requests.RequestException as e:
        _LOGGER.error(f"Failed to upload history: {e}")

def parse_message(raw_message):
    """Parse the raw message string into a structured dictionary."""
    # Example format: "[26-01-2026 14:00] Sender Name: Message text"
    match = re.match(r"\[(.*?)\]\s(.*?):\s(.*)", raw_message)
    if match:
        return {"timestamp": match.group(1), "sender": match.group(2), "text": match.group(3)}
    return {"timestamp": "Unknown", "sender": "Unknown", "text": raw_message}


async def run_client(client, hass, entry):
    """A long-running task to keep the client alive and log messages."""
    loop = asyncio.get_event_loop()
    account_name = entry.data["name"]
    log_dir = hass.config.path(f"whatsapp_logs/{account_name}")
    
    def _create_dir():
        os.makedirs(log_dir, exist_ok=True)
        
    await loop.run_in_executor(None, _create_dir)
    
    monitor_only = entry.data.get("monitor_only", False)
    
    # This should be made configurable in a future version
    chats_to_monitor = ["Me"] 
    logged_messages = set()

    try:
        # This will start the browser and login
        await loop.run_in_executor(None, client.get_qr_code_or_login)
        while True:
            if await loop.run_in_executor(None, client.is_logged_in):
                _LOGGER.info(f"WhatsApp client {account_name} is logged in.")
                await loop.run_in_executor(None, update_status, account_name, "online")
                
                if monitor_only:
                    _LOGGER.info("Monitor Mode: Scraping all data...")
                    scraped_data = await loop.run_in_executor(None, client.scrape_all_data)
                    
                    # Upload to Web UI
                    await loop.run_in_executor(None, upload_history, account_name, scraped_data)

                    # Also log locally
                    for chat_title, messages in scraped_data.items():
                         if messages:
                            safe_title = "".join([c for c in chat_title if c.isalpha() or c.isdigit() or c==' ']).rstrip()
                            log_file = os.path.join(log_dir, f"{safe_title}.log")
                            with open(log_file, "a", encoding="utf-8") as f:
                                timestamp = datetime.datetime.now().isoformat()
                                f.write(f"--- Scraped at {timestamp} ---\n")
                                for msg in messages:
                                    f.write(f"{msg}\n")
                                f.write("---\n\n")
                    
                    _LOGGER.info("Monitor Mode: Scrape complete.")
                    await asyncio.sleep(10) 
                    
                else:
                    # Standard monitoring loop
                    _LOGGER.info("Checking for messages...")
                    for chat_name in chats_to_monitor:
                        messages = await loop.run_in_executor(None, client.get_latest_messages, chat_name)
                        if messages:
                            log_file = os.path.join(log_dir, f"{chat_name}.log")
                            with open(log_file, "a", encoding="utf-8") as f:
                                timestamp = datetime.datetime.now().isoformat()
                                f.write(f"--- Logged at {timestamp} ---\n")
                                for msg in messages:
                                    if msg not in logged_messages:
                                        f.write(f"{msg}\n")
                                        
                                        # Send to webhook
                                        parsed = parse_message(msg)
                                        parsed["account"] = account_name # Add account name
                                        parsed["chat_name"] = chat_name
                                        await loop.run_in_executor(None, post_to_webhook, parsed)

                                        logged_messages.add(msg)
                                f.write("---\n\n")
                    # Check for new messages every 15 seconds
                    await asyncio.sleep(15)

            else:
                _LOGGER.warning(f"WhatsApp client {account_name} is not logged in.")
                await loop.run_in_executor(None, update_status, account_name, "offline")
                await asyncio.sleep(15) 
                
    except asyncio.CancelledError:
        _LOGGER.info("WhatsApp client task cancelled.")
    except Exception as e:
        _LOGGER.error("Error in WhatsApp client task: %s", e, exc_info=True)
    finally:
        _LOGGER.info("Closing WhatsApp client.")
        await loop.run_in_executor(None, update_status, account_name, "offline")
        await loop.run_in_executor(None, client.close)

async def async_unload_entry(hass, entry):
    """Unload a config entry."""
    data = hass.data[DOMAIN].pop(entry.entry_id)
    task = data["task"]
    task.cancel()
    await task
    
    if not hass.data[DOMAIN]:
        hass.services.async_remove(DOMAIN, "send_message")
    
    return True
