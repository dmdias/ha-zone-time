"""Counts how long each person spends in each zone.

The person state is the zone the person is in ("home", a zone name, or
"not_home"). Every change closes the time spent in the previous zone, split
at local midnight into per-day buckets: {person: {"YYYY-MM-DD": {zone: seconds}}}.
The buckets are kept in ``.storage/zone_time`` with no expiry, so any past
day, week, month or year can be shown. Time while Home Assistant is stopped
is not counted. The first time (and with the ``zone_time.rebuild`` action)
the buckets are filled from the recorder history of the persons.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
import logging
from typing import Any

from homeassistant.components.recorder import get_instance, history
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import FLUSH_SECONDS, IGNORED_STATES, OUTSIDE, SIGNAL_UPDATE, STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)


def _day(moment: datetime) -> str:
    return dt_util.as_local(moment).date().isoformat()


class ZoneTimeTracker:
    """Per-day time in each zone for a set of persons."""

    def __init__(self, hass: HomeAssistant, persons: list[str]) -> None:
        self.hass = hass
        self.persons = persons
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.days: dict[str, dict[str, dict[str, float]]] = {}
        self._open: dict[str, tuple[str | None, datetime]] = {}  # person -> (zone, since)
        self._unsubs: list = []

    # ----- lifecycle -----

    async def async_start(self) -> None:
        data = await self._store.async_load() or {}
        self.days = data.get("days", {})
        now = dt_util.utcnow()
        missing = [p for p in self.persons if p not in self.days]
        if missing:
            await self.async_rebuild(missing, until=now)
        for person in self.persons:
            self.days.setdefault(person, {})
            self._open[person] = (self._zone_of(self.hass.states.get(person)), now)
        self._unsubs.append(async_track_state_change_event(self.hass, self.persons, self._on_change))
        self._unsubs.append(async_track_time_interval(self.hass, self._tick, timedelta(seconds=FLUSH_SECONDS)))
        self._save()

    async def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        self._flush(dt_util.utcnow())
        await self._store.async_save(self._data())

    def _data(self) -> dict[str, Any]:
        return {"days": self.days}

    def _save(self) -> None:
        self._store.async_delay_save(self._data, 30)

    # ----- counting -----

    @staticmethod
    def _zone_of(state) -> str | None:
        if state is None or state.state in IGNORED_STATES:
            return None
        return state.state

    def _add(self, person: str, zone: str | None, start: datetime, end: datetime) -> None:
        """Add the time between start and end to the zone, split at local midnight."""
        if zone is None or end <= start:
            return
        buckets = self.days.setdefault(person, {})
        cursor = start
        while cursor < end:
            local = dt_util.as_local(cursor)
            midnight = dt_util.start_of_local_day(local.date() + timedelta(days=1))
            stop = min(end, midnight)
            day = buckets.setdefault(local.date().isoformat(), {})
            day[zone] = round(day.get(zone, 0.0) + (stop - cursor).total_seconds(), 1)
            cursor = stop

    def _flush(self, now: datetime) -> None:
        for person, (zone, since) in self._open.items():
            self._add(person, zone, since, now)
            self._open[person] = (zone, now)

    @callback
    def _on_change(self, event: Event[EventStateChangedData]) -> None:
        person = event.data["entity_id"]
        now = dt_util.utcnow()
        zone, since = self._open.get(person, (None, now))
        self._add(person, zone, since, now)
        self._open[person] = (self._zone_of(event.data["new_state"]), now)
        self._save()
        async_dispatcher_send(self.hass, SIGNAL_UPDATE)

    @callback
    def _tick(self, now: datetime) -> None:
        self._flush(dt_util.utcnow())
        self._save()
        async_dispatcher_send(self.hass, SIGNAL_UPDATE)

    # ----- history -----

    async def async_rebuild(self, persons: list[str] | None = None, until: datetime | None = None) -> int:
        """Fill the buckets from the recorder history; returns the number of days rebuilt."""
        persons = persons or self.persons
        until = until or dt_util.utcnow()
        start = until - timedelta(days=3650)
        rebuilt = 0
        for person in persons:
            states = await get_instance(self.hass).async_add_executor_job(
                lambda p=person: history.state_changes_during_period(
                    self.hass, start, until, entity_id=p, no_attributes=True, include_start_time_state=True
                )
            )
            rows = states.get(person, [])
            if not rows:
                continue
            first_day = _day(rows[0].last_changed)
            fresh: dict[str, dict[str, float]] = {}
            saved = self.days
            self.days = {person: fresh}
            for current, following in zip(rows, rows[1:] + [None]):
                end = following.last_changed if following else until
                self._add(person, self._zone_of(current), current.last_changed, end)
            self.days = saved
            buckets = self.days.setdefault(person, {})
            for day, zones in fresh.items():
                if day >= first_day:
                    buckets[day] = zones
                    rebuilt += 1
            # The open segment now starts where the history ends
            if person in self._open:
                self._open[person] = (self._zone_of(rows[-1]), until)
        self._save()
        async_dispatcher_send(self.hass, SIGNAL_UPDATE)
        _LOGGER.debug("Rebuilt %s days of zone time from the history", rebuilt)
        return rebuilt

    # ----- reading -----

    def totals(self, person: str, start: date, end: date) -> dict[str, float]:
        """Hours per zone from start (inclusive) to end (exclusive), with the time still running."""
        out: dict[str, float] = {}
        buckets = self.days.get(person, {})
        first, last = start.isoformat(), end.isoformat()
        for day, zones in buckets.items():
            if first <= day < last:
                for zone, seconds in zones.items():
                    out[zone] = out.get(zone, 0.0) + seconds / 3600
        zone, since = self._open.get(person, (None, None))
        if zone and since:
            now = dt_util.utcnow()
            cursor = since
            while cursor < now:
                local = dt_util.as_local(cursor)
                midnight = dt_util.start_of_local_day(local.date() + timedelta(days=1))
                stop = min(now, midnight)
                if first <= local.date().isoformat() < last:
                    out[zone] = out.get(zone, 0.0) + (stop - cursor).total_seconds() / 3600
                cursor = stop
        return out

    def daily(self, person: str, start: date, end: date) -> dict[str, dict[str, float]]:
        """Hours per zone for each day from start (inclusive) to end (exclusive)."""
        out: dict[str, dict[str, float]] = {}
        day = start
        while day < end:
            totals = self.totals(person, day, day + timedelta(days=1))
            if totals:
                out[day.isoformat()] = {z: round(h, 3) for z, h in totals.items()}
            day += timedelta(days=1)
        return out

    def zone_labels(self) -> dict[str, str | None]:
        """Zone keys seen or defined, in display order, with their names (None: outside zones)."""
        labels: dict[str, str | None] = {}
        home = self.hass.states.get("zone.home")
        labels["home"] = home.name if home else "Home"
        for state in sorted(self.hass.states.async_all("zone"), key=lambda s: s.name.lower()):
            if state.entity_id != "zone.home" and not state.attributes.get("passive"):
                labels[state.name] = state.name
        seen = {z for buckets in self.days.values() for zones in buckets.values() for z in zones}
        for zone in sorted(seen - set(labels) - {OUTSIDE}):
            labels[zone] = zone
        labels[OUTSIDE] = None
        return labels
