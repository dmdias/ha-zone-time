"""Zone Time: how long each person spends in each zone, with a dashboard card."""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback
from homeassistant.helpers import config_validation as cv

from .card import async_register_card, async_unregister_card
from .const import CONF_PERSONS, DOMAIN, FRONTEND_URL, SERVICE_REBUILD, VERSION
from .tracker import ZoneTimeTracker

PLATFORMS = [Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
CARD_FILE = Path(__file__).parent / "frontend" / "zone-time-card.js"
MAX_DAYS = 400


def _tracker(hass: HomeAssistant) -> ZoneTimeTracker | None:
    for entry in hass.config_entries.async_loaded_entries(DOMAIN):
        return entry.runtime_data
    return None


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """The card's data API and the rebuild action."""

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "zone_time/data",
            vol.Required("start"): cv.date,
            vol.Required("end"): cv.date,
            vol.Optional("persons"): [cv.entity_id],
        }
    )
    @callback
    def ws_data(hass, connection, msg):
        tracker = _tracker(hass)
        if tracker is None:
            connection.send_error(msg["id"], "not_loaded", "Zone Time is not set up")
            return
        start: date = msg["start"]
        end: date = min(msg["end"], start + timedelta(days=MAX_DAYS))
        persons = [p for p in msg.get("persons", tracker.persons) if p in tracker.persons]
        people = []
        for person in persons:
            state = hass.states.get(person)
            people.append(
                {
                    "entity_id": person,
                    "name": state.name if state else person,
                    "picture": state.attributes.get("entity_picture") if state else None,
                    "zone": state.state if state else None,
                    "days": tracker.daily(person, start, end),
                }
            )
        connection.send_result(msg["id"], {"zones": tracker.zone_labels(), "people": people})

    websocket_api.async_register_command(hass, ws_data)

    async def handle_rebuild(call: ServiceCall) -> ServiceResponse:
        tracker = _tracker(hass)
        if tracker is None:
            return {"days": 0}
        return {"days": await tracker.async_rebuild()}

    hass.services.async_register(DOMAIN, SERVICE_REBUILD, handle_rebuild, supports_response=SupportsResponse.OPTIONAL)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    persons = entry.options.get(CONF_PERSONS) or entry.data.get(CONF_PERSONS) or hass.states.async_entity_ids("person")
    tracker = ZoneTimeTracker(hass, list(persons))
    await tracker.async_start()
    entry.runtime_data = tracker

    if not hass.data.get(f"{DOMAIN}_frontend"):
        await hass.http.async_register_static_paths([StaticPathConfig(FRONTEND_URL, str(CARD_FILE), False)])
        mtime = await hass.async_add_executor_job(lambda: int(CARD_FILE.stat().st_mtime))
        hass.data[f"{DOMAIN}_frontend"] = f"{FRONTEND_URL}?v={VERSION}-{mtime}"
        await async_register_card(hass, FRONTEND_URL, hass.data[f"{DOMAIN}_frontend"])

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        await entry.runtime_data.async_stop()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await async_unregister_card(hass, FRONTEND_URL, hass.data.get(f"{DOMAIN}_frontend", FRONTEND_URL))
