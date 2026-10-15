"""Hours in each zone today, this week, this month and this year, per person."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN, OUTSIDE, SIGNAL_UPDATE
from .tracker import ZoneTimeTracker

PERIODS = ("today", "week", "month", "year")


def period_range(period: str, today: date) -> tuple[date, date]:
    if period == "today":
        return today, today + timedelta(days=1)
    if period == "week":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=7)
    if period == "month":
        start = today.replace(day=1)
        return start, (start + timedelta(days=32)).replace(day=1)
    return today.replace(month=1, day=1), today.replace(year=today.year + 1, month=1, day=1)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    tracker: ZoneTimeTracker = entry.runtime_data
    async_add_entities(ZoneTimeSensor(tracker, person, period) for person in tracker.persons for period in PERIODS)


class ZoneTimeSensor(SensorEntity):
    """Total hours tracked in a period; one attribute per zone."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.HOURS
    _attr_state_class = SensorStateClass.TOTAL
    _attr_suggested_display_precision = 1
    _attr_icon = "mdi:map-clock"

    def __init__(self, tracker: ZoneTimeTracker, person: str, period: str) -> None:
        self._tracker = tracker
        self._person = person
        self._period = period
        self._attr_translation_key = period
        self._attr_unique_id = f"{person}_{period}"
        state = tracker.hass.states.get(person)
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, person)},
            translation_key="person",
            translation_placeholders={"name": state.name if state else person.split(".", 1)[1]},
            entry_type=DeviceEntryType.SERVICE,
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATE, self._refresh))

    @callback
    def _refresh(self) -> None:
        self.async_write_ha_state()

    def _totals(self) -> dict[str, float]:
        start, end = period_range(self._period, dt_util.now().date())
        return self._tracker.totals(self._person, start, end)

    @property
    def native_value(self) -> float:
        return round(sum(self._totals().values()), 2)

    @property
    def last_reset(self):
        start, _ = period_range(self._period, dt_util.now().date())
        return dt_util.start_of_local_day(start)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        labels = self._tracker.zone_labels()
        totals = self._totals()
        attrs: dict[str, Any] = {}
        for key, label in labels.items():
            name = "outside_zones" if key == OUTSIDE else label
            attrs[name] = round(totals.get(key, 0.0), 2)
        for key, hours in totals.items():
            if key not in labels:
                attrs[key] = round(hours, 2)
        return attrs
