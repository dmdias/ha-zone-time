# Zone Time

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)
[![GitHub release](https://img.shields.io/github/release/dmdias/ha-zone-time.svg)](https://github.com/dmdias/ha-zone-time/releases)
[![Validate](https://github.com/dmdias/ha-zone-time/actions/workflows/validate.yml/badge.svg)](https://github.com/dmdias/ha-zone-time/actions/workflows/validate.yml)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-PayPal-ffdd00?logo=buymeacoffee&logoColor=black)](https://www.paypal.com/donate/?business=dmdias%40gmail.com&currency_code=EUR&item_name=Zone+Time)

How long each person spends in each zone of the Home Assistant map: at home,
at work, at school, outside every zone. Per day, week, month and year, with a
dashboard card to browse any past period.

## Contents

- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [The card](#the-card)
- [Entities](#entities)
- [Actions](#actions)
- [How the time is counted](#how-the-time-is-counted)
- [Troubleshooting](#troubleshooting)
- [Support the project](#support-the-project)
- [Author](#author)
- [License](#license)

## What you get

- **Time per zone, per person**: today, this week, this month and this year,
  as sensors with one attribute per zone.
- **A dashboard card**:
  - pick a person (or both side by side) and a day, week, month or year;
  - move with ◀ ▶ to any past period;
  - a donut and bars with the hours and share of each zone;
  - a 24-hour timeline of the day;
  - stacked bars per day or per month. Tap a bar to open that period.
- **History kept forever**: the hours per day and zone are stored by the
  integration, so they do not depend on how many days the recorder keeps.
- **A head start**: when set up, the days still in the Home Assistant history
  are imported.
- **New zones just work**: a zone added to the map is counted from then on,
  with no configuration.

## Requirements

- Home Assistant 2025.1 or newer.
- Persons with a device tracker (for example the companion app), so their
  state is the zone they are in.

## Installation

1. HACS → **⋮ → Custom repositories** → add
   `https://github.com/dmdias/ha-zone-time` with type **Integration**.

   [![Open your Home Assistant instance and open this repository inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=dmdias&repository=ha-zone-time&category=integration)
2. Search **Zone Time** → **Download**, and restart Home Assistant.
3. **Settings → Devices & services → Add integration → Zone Time**.

   [![Open your Home Assistant instance and start setting up Zone Time.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=zone_time)
4. Choose the persons to follow (all by default) and submit.
5. Reload the browser. On the companion app, also clear its cache.

## Configuration

**Settings → Devices & services → Zone Time → Configure** changes the persons.
Zones need no configuration: every zone a person enters is counted.

## The card

The integration loads the card on every dashboard, so there is no resource to
add. Edit a dashboard → **Add card** → **Zone Time**, or use YAML:

```yaml
type: custom:zone-time-card
people:            # optional, default: every person the integration follows
  - person.ana
```

It looks best in a view of type **Panel**.

- **Person**: one person, or *Both* for every person side by side.
- **Period**: Day, Week, Month or Year. **◀ ▶** move to the previous or
  next period, **Today** comes back.
- **Summary**: total time tracked, a donut and a bar per zone with the hours
  and the share.
- **Day**: a 24-hour timeline. Hover a block to see the zone and the times.
  The timeline needs the person history, so it is shown for recent days.
- **Week and month**: a stacked bar per day. **Year**: per month. Tap a bar
  to open that day or month.

## Entities

For a person *Ana*, a device **Zone time Ana** with:

| Entity | Description |
|---|---|
| `sensor.zone_time_ana_today` | Hours tracked today |
| `sensor.zone_time_ana_this_week` | Hours tracked this week (Monday to Sunday) |
| `sensor.zone_time_ana_this_month` | Hours tracked this month |
| `sensor.zone_time_ana_this_year` | Hours tracked this year |

Each sensor has one attribute per zone with its hours, for example
`Home: 14.2`, `Work: 8.1`, `outside_zones: 1.7`. The entity ids follow the
Home Assistant language (in Portuguese, `sensor.tempo_por_zona_ana_hoje`, …).

Use them in automations or templates, for example:

```yaml
{{ state_attr('sensor.zone_time_ana_today', 'Work') }}
```

## Actions

### `zone_time.rebuild`

Recalculates the days still in the Home Assistant history (for example after
fixing a zone's radius). Days older than the history are kept as they are.

## How the time is counted

- A person's state is the zone they are in. Every change closes the time
  spent in the previous zone, split at midnight into days.
- `not_home` (no zone) is shown as *Outside zones*.
- Time while the person's state is unknown or unavailable is not counted, and
  neither is time while Home Assistant is stopped. The total of a day can
  therefore be a little under 24 hours.
- Data is stored in `.storage/zone_time`.

## Troubleshooting

**The card says "Custom element doesn't exist: zone-time-card"**
Reload the browser. On the companion app, clear its cache and close the app
completely.

**A zone is missing**
A zone appears once someone has been in it. Check that the person's state
actually shows that zone (the device tracker must report a location inside it).

**The total of a day is under 24 hours**
The time while Home Assistant was restarting, or while the person's state was
unknown, is not counted.

## Support the project

If this is useful to you, you can buy me a coffee ☕. Thank you!

<a href="https://www.paypal.com/donate/?business=dmdias%40gmail.com&currency_code=EUR&item_name=Zone+Time"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-Donate%20with%20PayPal-ffdd00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy me a coffee"></a>

Bug reports and ideas are welcome in the [issues](https://github.com/dmdias/ha-zone-time/issues).

## Author

**Daniel Dias** ([@dmdias](https://github.com/dmdias)).

## License

[GPL-3.0](LICENSE).
