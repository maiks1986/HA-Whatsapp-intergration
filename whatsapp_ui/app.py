from flask import Flask, render_template, request, jsonify
import requests
import logging
import time
import os
import json
import sqlite3
import google.generativeai as genai
from datetime import datetime
from whatsapp_web_client import WhatsAppWebClient
import threading

app = Flask(__name__)

# --- Configuration ---
CONFIG_FILE = 'config.json'
DB_FILE = 'whatsapp.db'
config = {}

# Global Client Instance for Gateway Mode
whatsapp_client = None
client_lock = threading.Lock()

def load_config():
    global config
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                config = json.load(f)
        except Exception as e:
            logging.error(f"Failed to load config: {e}")
    else:
        # Default empty config
        config = {
            "ha_url": "",
            "ha_token": "",
            "gemini_api_key": ""
        }

def save_config(new_config):
    global config
    config.update(new_config)
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=4)
        
        # Re-configure Gemini if key changed
        if config.get("gemini_api_key"):
            genai.configure(api_key=config["gemini_api_key"])
            global model
            model = genai.GenerativeModel('gemini-2.0-flash-exp')
            
    except Exception as e:
        logging.error(f"Failed to save config: {e}")

# Database Initialization
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    # Messages table
    c.execute('''CREATE TABLE IF NOT EXISTS messages
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  account TEXT,
                  chat_name TEXT,
                  sender TEXT,
                  text TEXT,
                  timestamp TEXT,
                  UNIQUE(account, chat_name, timestamp, text))''')
    
    # Account Status table
    c.execute('''CREATE TABLE IF NOT EXISTS account_status
                 (account TEXT PRIMARY KEY,
                  status TEXT,
                  last_seen TEXT)''')
    conn.commit()
    conn.close()

# Load config on startup
load_config()
init_db()

# Initialize Gemini if key exists
model = None
if config.get("gemini_api_key"):
    genai.configure(api_key=config["gemini_api_key"])
    model = genai.GenerativeModel('gemini-2.0-flash-exp')

# Set up basic logging
logging.basicConfig(level=logging.INFO)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/connect')
def connect():
    return render_template('connect.html')

@app.route('/api/start_connection', methods=['POST'])
def start_connection():
    global whatsapp_client
    with client_lock:
        if whatsapp_client:
            whatsapp_client.close()
        
        # Sessions will be stored in a local folder
        session_dir = os.path.abspath("whatsapp_sessions")
        os.makedirs(session_dir, exist_ok=True)
        whatsapp_client = WhatsAppWebClient(user_data_dir=session_dir)
        
        try:
            status, data = whatsapp_client.get_qr_code_or_login()
            return jsonify({"status": status, "qr_code": data})
        except Exception as e:
            logging.error(f"Failed to start connection: {e}")
            return jsonify({"error": str(e)}), 500

@app.route('/api/check_login', methods=['GET'])
def check_login():
    if not whatsapp_client:
        return jsonify({"status": "not_started"})
    
    try:
        is_logged_in = whatsapp_client.is_logged_in()
        return jsonify({"status": "logged_in" if is_logged_in else "qr_pending"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/settings')
def settings():
    return render_template('settings.html')

@app.route('/api/settings', methods=['GET', 'POST'])
def api_settings():
    if request.method == 'GET':
        return jsonify(config)
    elif request.method == 'POST':
        new_settings = request.json
        save_config(new_settings)
        return jsonify({"success": True})

@app.route('/webhook', methods=['POST'])
def webhook():
    """Endpoint to receive real-time messages from Home Assistant."""
    data = request.json
    if data:
        logging.info(f"Received message via webhook: {data}")
        # data format expected: {sender:..., text:..., timestamp:..., account:..., chat_name:...}
        # Fallbacks for legacy format
        account = data.get('account', 'Unknown')
        chat_name = data.get('chat_name', 'Unknown')
        sender = data.get('sender', 'Unknown')
        text = data.get('text', '')
        timestamp = data.get('timestamp', datetime.now().isoformat())

        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        try:
            c.execute("INSERT OR IGNORE INTO messages (account, chat_name, sender, text, timestamp) VALUES (?, ?, ?, ?, ?)",
                      (account, chat_name, sender, text, timestamp))
            conn.commit()
        except Exception as e:
            logging.error(f"DB Error: {e}")
        finally:
            conn.close()

    return "OK", 200

@app.route('/api/upload_history', methods=['POST'])
def upload_history():
    """Endpoint to receive bulk history from Home Assistant."""
    data = request.json
    account = data.get('account')
    history = data.get('history', {}) # {chat_name: [messages]}
    
    if not account:
        return jsonify({"error": "Account name required"}), 400

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    count = 0
    try:
        for chat_name, messages in history.items():
            for msg in messages:
                # msg string format: "[timestamp] Sender: Text"
                # We need to parse it simply
                timestamp = "Unknown"
                sender = "Unknown"
                text = msg
                
                # Simple parsing (matches logic in HA integration)
                import re
                match = re.match(r"\[(.*?)\]\s(.*?):\s(.*)", msg)
                if match:
                    timestamp = match.group(1)
                    sender = match.group(2)
                    text = match.group(3)
                
                c.execute("INSERT OR IGNORE INTO messages (account, chat_name, sender, text, timestamp) VALUES (?, ?, ?, ?, ?)",
                          (account, chat_name, sender, text, timestamp))
                count += 1
        conn.commit()
        logging.info(f"Uploaded {count} historical messages for {account}")
    except Exception as e:
        logging.error(f"DB Error during history upload: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

    return jsonify({"success": True, "count": count})

@app.route('/api/update_status', methods=['POST'])
def update_status():
    """Update connection status for an account."""
    data = request.json
    account = data.get('account')
    status = data.get('status') # 'online', 'offline'
    
    if not account or not status:
        return jsonify({"error": "Account and status required"}), 400

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO account_status (account, status, last_seen) VALUES (?, ?, ?)",
              (account, status, datetime.now().isoformat()))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/account_status', methods=['GET'])
def get_account_status():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM account_status")
    rows = c.fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])

@app.route('/api/messages', methods=['GET'])
def get_messages():
    """Endpoint for the frontend to fetch messages."""
    # Optional filtering
    account = request.args.get('account')
    
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    query = "SELECT * FROM messages ORDER BY id DESC LIMIT 50"
    params = ()
    
    if account:
        query = "SELECT * FROM messages WHERE account = ? ORDER BY id DESC LIMIT 50"
        params = (account,)

    c.execute(query, params)
    rows = c.fetchall()
    conn.close()
    
    # Convert rows to dicts and reverse to show oldest first (top to bottom) if desired
    # or keep newest first. Let's keep newest first for log style.
    messages = [dict(row) for row in rows]
    return jsonify(messages)

@app.route('/api/generate_suggestions', methods=['POST'])
def generate_suggestions():
    """
    Generates reply suggestions using Gemini.
    """
    conversation = request.json.get('conversation', [])
    logging.info(f"Generating suggestions for conversation...")
    
    if not model:
        return jsonify(["Error: Gemini API Key not configured. Please go to Settings."])

    # Construct prompt
    prompt = "You are an assistant helping me reply to WhatsApp messages. Here is the conversation history:\n\n"
    for msg in conversation[-10:]: # Use last 10 messages for context
        sender = msg.get('sender', 'Unknown')
        text = msg.get('text', '')
        prompt += f"{sender}: {text}\n"
    
    prompt += "\nBased on the above, generate 3 distinct, casual, and relevant short replies that I could send next. Mimic the style of the user if possible. Return ONLY the 3 replies, separated by a pipe character (|)."

    try:
        response = model.generate_content(prompt)
        text_response = response.text.strip()
        suggestions = [s.strip() for s in text_response.split('|')]
        # Fallback if splitting fails
        if len(suggestions) < 2:
             suggestions = text_response.split('\n')
        
        return jsonify(suggestions[:3])
    except Exception as e:
        logging.error(f"Gemini API Error: {e}")
        return jsonify(["Error generating suggestions."])


@app.route('/api/send_message', methods=['POST'])
def send_message():
    """Endpoint for the frontend to send a message via Home Assistant."""
    data = request.json
    sender = data.get('sender')
    contact = data.get('contact')
    message = data.get('message')

    if not sender or not contact or not message:
        return jsonify({"error": "Sender, contact, and message are required"}), 400
    
    ha_url = config.get("ha_url")
    ha_token = config.get("ha_token")

    if not ha_url or not ha_token:
        return jsonify({"error": "Home Assistant URL and Token not configured. Please go to Settings."}), 500

    service_url = f"{ha_url}/api/services/whatsapp_hass/send_message"
    headers = {
        "Authorization": f"Bearer {ha_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "sender": sender,
        "contact": contact,
        "message": message,
    }

    try:
        response = requests.post(service_url, headers=headers, json=payload)
        response.raise_for_status()
        logging.info(f"Successfully called send_message service for contact: {contact} from {sender}")
        return jsonify({"success": True, "ha_response": response.json()})
    except requests.exceptions.RequestException as e:
        logging.error(f"Error calling Home Assistant service: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/proxy_send_message', methods=['POST'])
def proxy_send_message():
    """Endpoint for HA to send a message via this gateway's browser."""
    data = request.json
    contact = data.get('contact')
    message = data.get('message')

    if not whatsapp_client:
        return jsonify({"error": "WhatsApp client not running on gateway"}), 500

    try:
        whatsapp_client.send_message(contact, message)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def monitoring_thread():
    """Background task to poll WhatsApp and push to HA."""
    logging.info("Starting monitoring thread...")
    logged_messages = set()
    while True:
        if whatsapp_client and whatsapp_client.is_logged_in():
            try:
                # For this prototype, we monitor "Me" or recent chats
                # In a full version, this would be more dynamic
                chats = ["Me"] 
                for chat in chats:
                    messages = whatsapp_client.get_latest_messages(chat)
                    for msg in messages:
                        if msg not in logged_messages:
                            logging.info(f"New message from {chat}: {msg}")
                            # Push to HA if configured
                            ha_url = config.get("ha_url")
                            if ha_url:
                                try:
                                    # Simple webhook push to HA (if HA supports it)
                                    # Or we just store it locally and HA polls
                                    pass 
                                except:
                                    pass
                            logged_messages.add(msg)
            except Exception as e:
                logging.error(f"Error in monitoring: {e}")
        time.sleep(15)

# Start background monitor
threading.Thread(target=monitoring_thread, daemon=True).start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)