"""Binary sensor platform for WhatsApp Pro."""
from homeassistant.components.binary_sensor import BinarySensorEntity, BinarySensorDeviceClass
from homeassistant.core import HomeAssistant
from .const import DOMAIN

async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities):
    """Set up the binary sensor platform."""
    # Note: We reuse the existing sensor logic/coordinator if needed, 
    # but for simplicity, let's just use the main status sensor.
    pass

# (Reserved for future specialized binary sensors like 'New Message Received')
