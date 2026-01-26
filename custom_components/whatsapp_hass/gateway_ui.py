from flask import Flask, render_template, request, jsonify
import logging
import os
import asyncio
import base64

# Define paths relative to this file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, 
            template_folder=TEMPLATE_DIR,
            static_folder=STATIC_DIR)

# Shared state
hass_instance = None
wa_client = None

def start_gateway(hass, client):
    global hass_instance, wa_client
    hass_instance = hass
    wa_client = client
    # Run Flask
    app.run(host='0.0.0.0', port=5001, debug=False, use_reloader=False)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/connect')
def connect():
    return render_template('connect.html')

@app.route('/api/start_connection', methods=['POST'])
def start_connection():
    # Bridge to the async client
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        status, data = loop.run_until_complete(wa_client.get_qr_code_or_login())
        return jsonify({"status": status, "qr_code": data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        loop.close()

@app.route('/api/check_login', methods=['GET'])
def check_login():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        is_logged_in = loop.run_until_complete(wa_client.is_logged_in())
        return jsonify({"status": "logged_in" if is_logged_in else "qr_pending"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        loop.close()

@app.route('/api/messages', methods=['GET'])
def get_messages():
    # This would normally pull from the DB
    return jsonify([])

@app.route('/api/account_status', methods=['GET'])
def get_account_status():
    return jsonify([{"account": "Default", "status": "online", "last_seen": "Now"}])