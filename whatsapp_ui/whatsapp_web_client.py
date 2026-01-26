from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import base64

from selenium.webdriver.common.keys import Keys
import time

import logging
_LOGGER = logging.getLogger(__name__)

class WhatsAppWebClient:
    def __init__(self, user_data_dir=None):
        self._driver = None
        self._user_data_dir = user_data_dir

    def get_qr_code_or_login(self):
        """
        Navigates to WhatsApp Web. If a session exists, it will be used.
        If not, it will return a QR code for login.
        Returns a tuple: (status, data)
        status can be "logged_in" or "qr_code"
        data is the QR code base64 string if status is "qr_code", otherwise None.
        """
        chrome_options = Options()
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        
        # Check for common binary paths (especially for Home Assistant/Docker)
        import os
        possible_binaries = [
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
        ]
        for path in possible_binaries:
            if os.path.exists(path):
                chrome_options.binary_location = path
                break

        if self._user_data_dir:
            chrome_options.add_argument(f"--user-data-dir={self._user_data_dir}")
        
        try:
            service = Service(ChromeDriverManager().install())
            self._driver = webdriver.Chrome(service=service, options=chrome_options)
        except Exception as e:
            _LOGGER.error(f"Failed to start Chrome: {e}")
            # Fallback for systems where webdriver-manager might fail but chromedriver is in PATH
            try:
                self._driver = webdriver.Chrome(options=chrome_options)
            except Exception as e2:
                _LOGGER.error(f"Fallback also failed: {e2}")
                raise Exception("Google Chrome or Chromium is not installed or not found. Please install it on your Home Assistant server.")
        
        self._driver.get("https://web.whatsapp.com")
        
        # Check if we are already logged in
        try:
            # A selector that only exists when logged in
            # This is a likely candidate, but might need updating
            chat_list_selector = "#side" 
            WebDriverWait(self._driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, chat_list_selector))
            )
            return "logged_in", None
        except:
            # Not logged in, get the QR code
            pass

        # If not logged in, get the QR code
        wait = WebDriverWait(self._driver, 30)
        qr_canvas_selector = "canvas"
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, qr_canvas_selector)))
        
        self._driver.save_screenshot("debug_screenshot.png")
        
        qr_canvas = self._driver.find_element(By.CSS_SELECTOR, qr_canvas_selector)
        
        qr_base64 = self._driver.execute_script(
            "return arguments[0].toDataURL('image/png').substring(21);", 
            qr_canvas
        )

        return "qr_code", qr_base64

    def send_message(self, contact_name, message):
        """
        Sends a message to a contact.
        NOTE: This method uses time.sleep() which is not ideal.
        A better implementation would use WebDriverWait.
        The selectors used are likely to change and may need updating.
        """
        if not self.is_logged_in():
            # In a real scenario, we should try to login first.
            # For now, we assume the user is logged in.
            # We can also check if the driver is running and start it if not.
            raise Exception("Not logged in. Please reload the integration.")

        # Find the search box for chats
        search_box_selector = 'div[contenteditable="true"][data-tab="3"]'
        try:
            search_box = WebDriverWait(self._driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, search_box_selector))
            )
            search_box.click()
            search_box.send_keys(contact_name)
            time.sleep(2)

            # Find the contact in the search results
            contact_selector = f'//span[@title="{contact_name}"]'
            contact_element = WebDriverWait(self._driver, 10).until(
                EC.presence_of_element_located((By.XPATH, contact_selector))
            )
            contact_element.click()
            time.sleep(2)

            # Find the message box
            message_box_selector = 'div[contenteditable="true"][data-tab="10"]'
            message_box = WebDriverWait(self._driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, message_box_selector))
            )
            message_box.click()
            message_box.send_keys(message)
            message_box.send_keys(Keys.ENTER)
            time.sleep(1)
        except Exception as e:
            _LOGGER.error("Failed to send message: %s", e)
            self._driver.save_screenshot("send_message_error.png")
            raise

    def get_latest_messages(self, chat_name):
        """
        Gets the latest messages from a chat.
        This is a very basic and fragile implementation.
        """
        if not self.is_logged_in():
            raise Exception("Not logged in.")

        try:
            # A bit of a hack to open the chat. This will send an empty message.
            # A better way would be to just search and click.
            self.send_message(chat_name, "") 

            message_selector = '.message-in, .message-out'
            messages = self._driver.find_elements(By.CSS_SELECTOR, message_selector)
            
            parsed_messages = []
            for msg in messages[-10:]: # Get last 10 messages
                try:
                    text_element = msg.find_element(By.CSS_SELECTOR, '.copyable-text')
                    # The data-pre-plain-text attribute contains sender and time
                    meta_data = text_element.get_attribute('data-pre-plain-text')
                    text = text_element.text
                    parsed_messages.append(f"{meta_data} {text}")
                except:
                    pass # Ignore messages that are not simple text
            
            return parsed_messages
        except Exception as e:
            _LOGGER.error(f"Failed to get messages from {chat_name}: {e}")
            self._driver.save_screenshot(f"get_messages_error_{chat_name}.png")
            return []

    def scrape_all_data(self):
        """
        Scrapes data from the top 10 chats.
        Returns a dictionary: {chat_name: [messages]}
        """
        if not self.is_logged_in():
             return {}

        data = {}
        try:
            # Get the list of chats in the sidebar
            # The selector for chat items in the list. This is fragile.
            # Assuming a generic container for now.
            # A better approach is to use keyboard navigation or specific aria-labels.
            # For this prototype, we'll try to find elements with a specific class or structure.
            # WhatsApp Web uses virtual list, so only visible chats are in DOM.
            
            # Let's try to find chat rows.
            chat_row_selector = 'div[role="listitem"]' # Common for WA Web
            chat_rows = self._driver.find_elements(By.CSS_SELECTOR, chat_row_selector)
            
            # We take only top 10 to be fast
            for i in range(min(10, len(chat_rows))):
                try:
                    # We need to re-find elements because DOM updates on click
                    chat_rows = self._driver.find_elements(By.CSS_SELECTOR, chat_row_selector)
                    row = chat_rows[i]
                    
                    # Click to open
                    row.click()
                    time.sleep(1) # Wait for chat to load
                    
                    # Get Chat Title
                    # This selector is for the header title
                    header_title_selector = 'header span[title]'
                    try:
                        header_element = self._driver.find_element(By.CSS_SELECTOR, header_title_selector)
                        chat_title = header_element.get_attribute("title")
                    except:
                        chat_title = f"Unknown_Chat_{i}"

                    # Scrape messages
                    message_selector = '.message-in, .message-out'
                    messages = self._driver.find_elements(By.CSS_SELECTOR, message_selector)
                    
                    parsed_messages = []
                    for msg in messages[-20:]: # Get last 20 messages
                        try:
                            text_element = msg.find_element(By.CSS_SELECTOR, '.copyable-text')
                            meta_data = text_element.get_attribute('data-pre-plain-text')
                            text = text_element.text
                            parsed_messages.append(f"{meta_data} {text}")
                        except:
                            pass
                    
                    data[chat_title] = parsed_messages
                    _LOGGER.info(f"Scraped {len(parsed_messages)} messages from {chat_title}")

                except Exception as inner_e:
                    _LOGGER.error(f"Error scraping chat index {i}: {inner_e}")
                    continue

        except Exception as e:
            _LOGGER.error(f"Error in scrape_all_data: {e}")
        
        return data

    def is_logged_in(self):
        """
        Checks if the user is logged in.
        """
        if not self._driver:
            return False
        try:
            # A selector that only exists when logged in
            chat_list_selector = "#side" 
            self._driver.find_element(By.CSS_SELECTOR, chat_list_selector)
            return True
        except:
            return False

    def close(self):
        if self._driver:
            self._driver.quit()
            self._driver = None
