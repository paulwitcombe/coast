# Coast

Native Omarchy bar plugin for BH2 5HA, Bournemouth Pier and the offshore bay.
Click the wave icon on the left of the bar. Middle-click or press Enter in the
popup to refresh. Escape dismisses it. Colours, font, spacing and borders follow
the active Omarchy theme automatically.

Tide times and chart-datum heights come from the Met Office Bournemouth Pier
page. The top of the panel shows the next tide with a countdown, the one
after it, and a small chart of the water level from 6 hours ago to 18 hours
ahead. The chart is eased between the published highs and lows (a cosine
approximation), so it shows the shape of the tide, not measured levels. Weather and offshore currents come from Open-Meteo; current speed is
converted using the units returned by the API, and the compass points **towards**
the flow (Open-Meteo reports direction as where the current is heading; 0° =
north, 90° = east). Below 0.3 kn the panel flags "near slack water" and dims the
chevrons, because the modelled direction swings while the stream turns. The actual marine model coordinates appear in the popup. This is a
coarse offshore forecast, not a measurement of beach rip currents or a navigation
aid. Wind direction is separately labelled **from**.

No API key or new packages required. Uses Python 3 and the existing Omarchy shell.
Weather/marine feeds are cached for 15 minutes, tides for 6 hours under
`~/.cache/omarchy-coast`. Failed requests retain cached data with a warning;
current conditions older than 2 hours are hidden. UK time uses Europe/London
with automatic daylight-saving changes. Met Office HTML changes may require a
parser update; failure is shown rather than substituted estimated tide times.

Open: `omarchy-shell pdog.coast open`

Disable: `omarchy plugin disable pdog.coast`

The pre-install bar configuration is backed up at
`~/.config/omarchy/shell.json.before-coast`.

Sources:
- https://weather.metoffice.gov.uk/forecast/gcn8t2d23
- https://open-meteo.com/en/docs
- https://open-meteo.com/en/docs/marine-weather-api (Open-Meteo / DWD attribution)

## Swim conditions

The expanded panel screens **cold exposure**, never whether swimming is safe.
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

Click **Change location** under the title (or press `/` while the panel is open).
Search for a town or postcode, optionally followed by a country, then click a
result. Keyboard: Enter searches; Down/Up selects a result; Enter applies it;
Escape closes the picker. Results show region, country, timezone and coordinates
to distinguish namesakes. Choose coastal places; the search also includes inland
places and does not certify beach suitability.

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
Marine coordinates default to the supplied land coordinates if omitted; select
an appropriate offshore point for better coverage. Cache filenames include the
source URL hash, keeping locations separate. Time labels use the configured
location's timezone, including DST. Invalid config fails visibly, never silently
falls back to another beach.

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

Run checks: `python3 -B -m unittest discover -s . -v` (`-B` stops `__pycache__`
being written into the plugin folder, which would reload the shell).

## Favourites

Use **☆ Save** beside the location controls to favourite the current coast;
**★ Saved** removes it. **★ Favourites** opens a dropdown with a rolling wave
edge and staggered entries; select an entry to switch location. Press `f` to
toggle the dropdown and Escape to close it. Longer lists scroll within the menu.
Favourites persist separately from the eight recent locations and are not evicted
by new searches. Existing saved state starts with the active location favourited;
an explicitly empty favourites list stays empty. State writes remain atomic.
