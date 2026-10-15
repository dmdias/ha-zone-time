"""Constants for Zone Time."""
from typing import Final

DOMAIN: Final = "zone_time"
VERSION: Final = "0.1.0"

CONF_PERSONS: Final = "persons"

STORAGE_KEY: Final = "zone_time"
STORAGE_VERSION: Final = 1

FRONTEND_URL: Final = "/zone_time/zone-time-card.js"
SIGNAL_UPDATE: Final = "zone_time_update"
SERVICE_REBUILD: Final = "rebuild"

OUTSIDE: Final = "not_home"  # person state outside every zone
IGNORED_STATES: Final = ("unknown", "unavailable")
FLUSH_SECONDS: Final = 60
