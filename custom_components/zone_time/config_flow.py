"""Config flow for Zone Time: which persons to follow."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import CONF_PERSONS, DOMAIN


def _schema(default: list[str]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(CONF_PERSONS, default=default): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="person", multiple=True)
            )
        }
    )


class ZoneTimeConfigFlow(ConfigFlow, domain=DOMAIN):
    """One entry for the whole house."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title="Zone Time", data={}, options=user_input)
        return self.async_show_form(step_id="user", data_schema=_schema(self.hass.states.async_entity_ids("person")))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return ZoneTimeOptionsFlow()


class ZoneTimeOptionsFlow(OptionsFlow):
    """Change the persons."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        current = self.config_entry.options.get(CONF_PERSONS) or self.hass.states.async_entity_ids("person")
        return self.async_show_form(step_id="init", data_schema=_schema(current))
