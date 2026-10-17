# Coast

Native Omarchy bar plugin for tides, offshore currents, sea temperature and
coastal weather. Bournemouth (BH2 5HA, the pier and the offshore bay) is the
default; other coasts can be chosen from the panel. Click the wave icon on the
left of the bar to open it. Middle-click or press Enter in the popup to refresh.
Escape dismisses it. Colours, font, spacing and borders follow the active
Omarchy theme automatically.

Open: `omarchy-shell pdog.coast open`

Disable: `omarchy plugin disable pdog.coast`

The pre-install bar configuration is backed up at
`~/.config/omarchy/shell.json.before-coast`.

## Panel layout

Everything fits on screen at once, top to bottom:

1. **Location and tide summary.** Two halves with a faint divider midway
   between them.
   - Left, under the **COAST** heading: the location as `Town,CC · detail`
     (for example `Bournemouth,UK · BH2 5HA · Pier & bay`), Favourites / Save,
     Change location, then the **offshore current**: speed, the direction it is
     flowing to, the model time and Refresh. Below 0.3 kn it adds
     "Near slack water · direction unsettled".
   - Right, **NEXT TIDE**: the next high or low, a countdown and height, the tide
     after it, and a chart of the water level from 6 hours ago to 18 hours ahead
     with a marker for now.
2. **Swim conditions · cold exposure.** A boxed temperature check (see below).
3. **Next tides and weather.** The next four highs and lows as a compact table,
   then a divider, then **weather**, **wind** and **waves**.
4. **Current.** A box in the theme's sea colour combining the compass (the
   direction and speed) with the **outlook for the next 12 hours** in two-hour
   steps, plus the offshore model note and grid coordinates.
5. **Footer.** Warnings when a feed is stale or unavailable, when each feed was
   last fetched, and source links.

The sea colour is the theme's `cyan`, read from the active theme's
`colors.toml`, so it changes with the theme (falling back to `#449dab`).

## Data and accuracy

Tide times and chart-datum heights come from the Met Office Bournemouth Pier
page. The tide chart is eased between the published highs and lows (a cosine
approximation), so it shows the shape of the tide, not measured levels.

Weather and offshore currents come from Open-Meteo. Current speed is converted
to knots using the units the API returns. The compass points **towards** the
flow: Open-Meteo reports direction as where the current is heading (0° = north,
90° = east). Below 0.3 kn the chevrons dim, because the modelled direction swings
while the stream turns. The marine model runs at about 8 km resolution and its
coastal accuracy is limited: this is a coarse offshore forecast, not a
measurement of beach rip currents or a navigation aid. Wind direction is
separately labelled **from**.

No API key or new packages required. Uses Python 3 and the existing Omarchy shell.
Weather/marine feeds are cached for 15 minutes, tides for 6 hours under
`~/.cache/omarchy-coast`. Failed requests retain cached data with a warning;
current conditions older than 2 hours are hidden. Times use the location's
timezone with automatic daylight-saving changes. Met Office HTML changes may
require a parser update; failure is shown rather than substituted estimated
tide times.

Sources:
- https://weather.metoffice.gov.uk/forecast/gcn8t2d23
- https://open-meteo.com/en/docs
- https://open-meteo.com/en/docs/marine-weather-api (Open-Meteo / DWD attribution)

## Swim conditions

The swim box screens **cold exposure**, never whether swimming is safe.
It shows sea, air, apparent (feels-like) temperature and the NWS wind-chill index
where applicable (air ≤10°C, wind >3 mph). Neither air index estimates cooling
of a wet swimmer. No swim duration, health, age or wetsuit safety score is given.
No personal health data is collected or stored.

The conservative cold-water alert uses ≤15°C. Water below 20°C or air / feels-like
below 15°C produces a cool-conditions reminder: these are product comfort bands,
not validated safety thresholds. Warmer air never offsets cold water. All
remaining complete readings are labelled “Milder temperatures”, never “safe”.
Missing, invalid or >2-hour-old conditions yield an incomplete check, retaining
any known cold-water warning. Offshore sea estimates may differ from the beach.
Flags, local advice, waves, currents, water quality and personal suitability are
not assessed. Method and source links are available in the panel.

## Locations

Click **Change location** under the heading (or press `/` while the panel is open).
Search for a town or postcode, optionally followed by a country, then click a
result. Keyboard: Enter searches; Down/Up selects a result; Enter applies it;
Escape closes the picker. Results show `Town,CC · region`, then the timezone and
coordinates to distinguish namesakes. Choose coastal places; the search also
includes inland places and does not certify beach suitability.

Country abbreviations come from the search result's ISO code, written `UK`
rather than `GB`. Locations saved without one get it from their timezone via the
system tzdata table.

The last eight locations are saved, keeping Bournemouth available. The picker
also offers °C/°F; the chosen unit is carried across subsequent location changes.
Active location and recents are saved atomically at
`~/.config/omarchy/coast/locations.json` (respects `XDG_CONFIG_HOME`), outside the
plugin directory so selections do not trigger shell reloads. Old readings are
cleared when changing location; selection is disabled during an active fetch.
Search uses Open-Meteo / GeoNames and sends the typed query to that service.

Bournemouth is the initial default. For advanced configuration, edit the active
location in the saved state file. Before any picker selection, a legacy
`location.json` beside `coast.py` is also accepted, for example:

```json
{
  "name": "Sydney",
  "detail": "Bondi Beach",
  "country": "AU",
  "latitude": -33.8915,
  "longitude": 151.2767,
  "marineLatitude": -33.90,
  "marineLongitude": 151.30,
  "timezone": "Australia/Sydney",
  "temperatureUnit": "C",
  "tideUrl": null
}
```

Use an IANA timezone and `C` or `F` for display. Assessment inputs remain Celsius.
`country` is optional. Marine coordinates default to the supplied land
coordinates if omitted; select an appropriate offshore point for better coverage.
Cache filenames include the source URL hash, keeping locations separate. Invalid
config fails visibly, never silently falls back to another beach.

Weather and marine model coverage is global but availability and coastal accuracy
vary. Tides currently support only explicitly configured Met Office forecast
pages; omitting `tideUrl` disables tides. Search selections have no tide provider,
except the recognised Bournemouth entry. Worldwide tide-provider adapters,
localisation and broader unit preferences remain future work. Returned marine
grid cells more than 30 km from the selected location are withheld; this is a
coverage guard, not a guarantee of beach-level accuracy.

Before public distribution, obtain water-safety and jurisdiction-specific legal
review of the claims and method. Avoid medical profiling and “safe to swim”
clearance. Adding a disclaimer alone does not validate a safety feature.

## Favourites

Use **☆ Save** beside the location controls to favourite the current coast;
**★ Saved** removes it. **★ Favourites** opens a dropdown with a rolling wave
edge and staggered entries; select an entry to switch location. Press `f` to
toggle the dropdown and Escape to close it. Longer lists scroll within the menu.
Favourites persist separately from the eight recent locations and are not evicted
by new searches. Existing saved state starts with the active location favourited;
an explicitly empty favourites list stays empty. State writes remain atomic.

## Files

- `Widget.qml`: bar button and panel.
- `CurrentCompass.qml`: the current compass dial; no shell imports, so it can be
  rendered on its own to check orientation.
- `coast.py`: fetches, caches and combines the feeds into one report.
- `location.py`: location search, recents, favourites and saved state.
- `swim.py`: the cold-exposure check.

## Development

Run checks: `python3 -B -m unittest discover -s . -v` (`-B` stops `__pycache__`
being written into the plugin folder, which would reload the shell).

Saving files under `~/.config/omarchy/plugins/` hot-reloads the plugin, but the
shell can keep a cached copy of the old widget. If a change doesn't appear, run
`omarchy restart shell`.
