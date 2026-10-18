// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: water;

// Coast for iOS (Scriptable): tides, offshore current, sea temperature and coastal
// weather, in the Omarchy style. Home screen and lock screen widgets, and the full
// panel when opened in the app. https://github.com/paulwitcombe/coast
//
// Tide times come from the ADMIRALTY UK Tidal API and need your own free key, kept
// in the iOS Keychain. Discovery terms forbid caching or storing tide data, so it is
// fetched live on every run and only ever held in memory. Widgets ask iOS to refresh
// at most hourly to stay well inside the 10,000 requests a month.

// Omarchy theme colours (Tokyo Night). `python3 -B ios/theme.py` prints this line
// for your current Omarchy theme.
const THEME = {"background": "#1a1b26", "foreground": "#a9b1d6", "accent": "#7aa2f7", "sea": "#449dab", "urgent": "#f7768e"}

// The installer replaces "dev" with the commit it downloaded.
const VERSION = "dev"
const ADMIRALTY = "https://admiraltyapi.azure-api.net/uktidalapi/api/V1/"
const KEY_NAME = "coast.admiralty-key"
// Beyond this a station's times no longer describe the chosen beach.
const MAX_STATION_KM = 30
// Far above any real reply (the station list is ~120 KB).
const MAX_CHARS = 5000000
const UNAVAILABLE = "Tide data temporarily unavailable"
const DEFAULT_LOCATION = {name: "Bournemouth", detail: "BH2 5HA · Pier & bay", country: "UK",
  latitude: 50.716, longitude: -1.88, marineLatitude: 50.70, marineLongitude: -1.88,
  timezone: "Europe/London", temperatureUnit: "C"}

// ---- Readings: the same rules as the Omarchy plugin's Python ----

function number(v) { return typeof v === "number" && isFinite(v) }

function bearing(v) {
  if (!number(v)) return "—"
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
  return names[Math.floor((((v % 360) + 360) % 360 + 11.25) / 22.5) % 16]
}

function arrow(d) { return number(d) ? ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"][Math.round((((d % 360) + 360) % 360) / 45) % 8] : "·" }

function round(v, places) { const f = Math.pow(10, places); return Math.round(v * f) / f }

function knots(v, unit) {
  const factors = {"km/h": 1 / 1.852, "m/s": 1.943844, "kn": 1, "knots": 1, "mph": 0.868976}
  return number(v) && unit in factors ? round(v * factors[unit], 2) : null
}

function conditions(code) {
  if (code === 0) return "Clear"
  if (code === 1) return "Mainly clear"
  if (code === 2) return "Partly cloudy"
  if (code === 3) return "Overcast"
  if ([45, 48].includes(code)) return "Fog"
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle"
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain / showers"
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow"
  if ([95, 96, 99].includes(code)) return "Thunderstorms"
  return "Unavailable"
}

function countdown(seconds) {
  const minutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return "in " + [hours ? hours + "h" : "", rest || !hours ? rest + "m" : ""].filter(Boolean).join(" ")
}

function valid(v, low, high) { return number(v) && v >= low && v <= high }

// NWS exposed-skin index; only defined at <=10 C and >3 mph.
function windChill(air, wind) {
  if (!valid(air, -90, 60) || !valid(wind, 0, 250) || air > 10 || wind <= 3) return null
  const f = air * 1.8 + 32
  const chill = 35.74 + 0.6215 * f - 35.75 * Math.pow(wind, 0.16) + 0.4275 * f * Math.pow(wind, 0.16)
  return round((chill - 32) / 1.8, 1)
}

function readings(sea, air, feels, wind) {
  air = valid(air, -90, 60) ? air : null
  return {sea: valid(sea, -3, 45) ? sea : null, air, feels: valid(feels, -110, 80) ? feels : null,
    windChill: windChill(air, valid(wind, 0, 250) ? wind : null)}
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180
  const a = Math.pow(Math.sin((lat2 - lat1) * r / 2), 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin((lon2 - lon1) * r / 2), 2)
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))))
}

// ---- Times in the location's timezone ----

function parts(stamp, zone) {
  const out = {}
  new Intl.DateTimeFormat("en-GB", {timeZone: zone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).formatToParts(new Date(stamp * 1000)).forEach(p => { out[p.type] = p.value })
  return out
}
function clock(stamp, zone) { const p = parts(stamp, zone); return p.hour + ":" + p.minute }
function dayKey(stamp, zone) { const p = parts(stamp, zone); return p.year + "-" + p.month + "-" + p.day }
function dayClock(stamp, zone) { const p = parts(stamp, zone); return p.weekday + " " + p.hour + ":" + p.minute }
function dateClock(stamp, zone) {
  const p = parts(stamp, zone)
  const month = new Intl.DateTimeFormat("en-GB", {timeZone: zone, month: "short"}).format(new Date(stamp * 1000))
  return p.day + " " + month + " " + p.hour + ":" + p.minute
}

// ---- ADMIRALTY ----

function parseStations(data) {
  const stations = []
  for (const feature of (data && Array.isArray(data.features) ? data.features : [])) {
    try {
      const [lon, lat] = feature.geometry.coordinates
      const id = String(feature.properties.Id), name = String(feature.properties.Name)
      if (number(lat) && number(lon) && feature.properties.Id != null) stations.push({id, name, latitude: lat, longitude: lon})
    } catch (e) { continue }
  }
  if (!stations.length) throw new Error("No tidal stations returned")
  return stations
}

function nearestStation(stations, latitude, longitude, limit = MAX_STATION_KM) {
  let best = null, bestKm = null
  for (const s of stations || []) {
    const km = distanceKm(latitude, longitude, s.latitude, s.longitude)
    if (bestKm === null || km < bestKm) { best = s; bestKm = km }
  }
  return best && bestKm <= limit ? Object.assign({}, best, {distance: round(bestKm, 1)}) : null
}

// Event times come back in UTC without a zone.
function parseEvents(data) {
  const events = []
  for (const e of Array.isArray(data) ? data : []) {
    const kind = {HighWater: "high", LowWater: "low"}[e && e.EventType]
    if (!kind || typeof e.DateTime !== "string" || !number(e.Height)) continue
    const stamp = Date.parse(e.DateTime.replace(/Z$/, "") + "Z") / 1000
    if (number(stamp)) events.push({time: stamp, kind, height: round(e.Height, 2)})
  }
  if (!events.length) throw new Error("No tide events returned")
  return events.sort((a, b) => a.time - b.time)
}

// Approximate water level from now-6h to now+18h: cosine between the published highs
// and lows. Only spans covered by consecutive events are drawn.
function tideCurve(events, now, before = 6 * 3600, after = 18 * 3600, step = 900) {
  events = events.slice().sort((a, b) => a.time - b.time)
  const start = now - before, span = before + after, points = []
  for (let i = 0; i <= span / step; i++) {
    const t = start + i * step
    for (let j = 0; j + 1 < events.length; j++) {
      const a = events[j], b = events[j + 1]
      if (a.time <= t && t <= b.time) {
        const share = (1 - Math.cos(Math.PI * (t - a.time) / (b.time - a.time))) / 2
        points.push([round(i * step / span, 4), round(a.height + (b.height - a.height) * share, 3)])
        break
      }
    }
  }
  if (points.length < 2) return null
  const heights = points.map(p => p[1])
  return {points, low: Math.min(...heights), high: Math.max(...heights), now: round(before / span, 4),
    events: events.filter(e => e.time >= start && e.time <= start + span).map(e => ({x: round((e.time - start) / span, 4), kind: e.kind}))}
}

// ---- Open-Meteo ----

function query(params) { return Object.keys(params).map(k => k + "=" + encodeURIComponent(params[k])).join("&") }

function sourceUrls(location) {
  return {
    weather: "https://api.open-meteo.com/v1/forecast?" + query({latitude: location.latitude, longitude: location.longitude,
      current: "temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,weather_code",
      wind_speed_unit: "mph", temperature_unit: "celsius", timeformat: "unixtime"}),
    marine: "https://marine-api.open-meteo.com/v1/marine?" + query({latitude: location.marineLatitude, longitude: location.marineLongitude,
      current: "ocean_current_velocity,ocean_current_direction,wave_height,sea_surface_temperature",
      hourly: "ocean_current_velocity,ocean_current_direction", timeformat: "unixtime", forecast_days: 2})
  }
}

function parseModel(data) {
  if (!data || typeof data !== "object" || !data.current || !number(data.current.time)) throw new Error("Model response has no timestamped conditions")
  const hourly = data.hourly || {}
  if (data.hourly && ["ocean_current_velocity", "ocean_current_direction"].some(k => (hourly[k] || []).length !== (hourly.time || []).length))
    throw new Error("Incomplete current forecast")
  return data
}

// ---- Report ----

function noTides(note) { return {data: null, fetched: null, error: note, note} }

async function source(getJSON, url, parser, headers) {
  try { return {data: parser(await getJSON(url, headers)), fetched: Date.now() / 1000, error: null} }
  catch (e) { return {data: null, fetched: null, error: String(e && e.message || e)} }
}

async function tideSource(location, key, getJSON) {
  if (!key) return {source: noTides("Tide times need a free ADMIRALTY API key"), station: null}
  const auth = {"Ocp-Apim-Subscription-Key": key}
  const stations = await source(getJSON, ADMIRALTY + "Stations", parseStations, auth)
  if (!stations.data) return {source: noTides(UNAVAILABLE), station: null}
  const station = nearestStation(stations.data, location.latitude, location.longitude)
  if (!station) return {source: noTides("No UK tidal station within " + MAX_STATION_KM + " km of this location"), station: null}
  const events = await source(getJSON, ADMIRALTY + "Stations/" + encodeURIComponent(station.id) + "/TidalEvents?duration=7", parseEvents, auth)
  // Quota exceeded (403), outages and bad replies all read the same.
  return events.data ? {source: events, station} : {source: noTides(UNAVAILABLE), station: null}
}

async function loadReport(location, key, getJSON) {
  const urls = sourceUrls(location)
  const [weather, marine, tides] = await Promise.all([
    source(getJSON, urls.weather, parseModel), source(getJSON, urls.marine, parseModel), tideSource(location, key, getJSON)])
  return buildReport([tides.source, weather, marine], Date.now() / 1000, location, tides.station)
}

function buildReport(sources, now, location, station) {
  const [tides, weather, marine] = sources
  const zone = location.timezone
  const today = dayKey(now, zone)
  const events = (tides.data || []).filter(e => dayKey(e.time, zone) >= today).map(e => Object.assign({}, e, {label: dayClock(e.time, zone)}))
  const upcoming = events.filter(e => e.time >= now)
  let w = (weather.data || {}).current || {}
  let m = (marine.data || {}).current || {}
  // Expired model conditions cannot masquerade as a live direction arrow.
  if (!number(w.time) || Math.abs(now - w.time) > 7200) w = {}
  if (!number(m.time) || Math.abs(now - m.time) > 7200) m = {}
  const md = marine.data || {}
  const distance = number(md.latitude) && number(md.longitude) ? round(distanceKm(location.latitude, location.longitude, md.latitude, md.longitude), 1) : null
  const nearby = distance === null || distance <= 30
  if (!nearby) m = {}
  // Only trust temperature and wind readings whose units are confirmed.
  const wu = (weather.data || {}).current_units || {}, mu = md.current_units || {}
  const temperatures = readings(
    mu.sea_surface_temperature === "°C" ? m.sea_surface_temperature : null,
    wu.temperature_2m === "°C" ? w.temperature_2m : null,
    wu.apparent_temperature === "°C" ? w.apparent_temperature : null,
    ["mp/h", "mph"].includes(wu.wind_speed_10m) ? w.wind_speed_10m : null)
  temperatures.times = "Sea model " + (m.time ? clock(m.time, zone) : "—") + " · air model " + (w.time ? clock(w.time, zone) : "—")
  const speed = knots(m.ocean_current_velocity, mu.ocean_current_velocity)
  const direction = speed !== null && speed > 0 ? m.ocean_current_direction : null
  const hourly = nearby ? md.hourly || {} : {}
  const forecast = []
  ;(hourly.time || []).forEach((stamp, i) => {
    if (stamp < now || stamp > now + 12 * 3600) return
    const velocity = knots((hourly.ocean_current_velocity || [])[i], (md.hourly_units || {}).ocean_current_velocity)
    const angle = velocity !== null && velocity > 0 ? (hourly.ocean_current_direction || [])[i] : null
    forecast.push({time: clock(stamp, zone), speed: velocity, direction: angle, bearing: bearing(angle)})
  })
  const warnings = [["Weather", weather], ["Currents", marine]].filter(([, s]) => s.error).map(([name]) => name + ": unavailable")
  if (tides.note) warnings.push(tides.note)
  if (!Object.keys(w).length) warnings.push("Weather conditions unavailable or expired")
  if (!Object.keys(m).length) warnings.push("Current conditions unavailable or expired")
  if (!nearby) warnings.push("No nearby marine grid: offshore readings withheld (more than 30 km from this location)")
  if (!tides.note && !upcoming.length) warnings.push("No upcoming tide times available")
  const fetched = s => s.fetched ? dateClock(s.fetched, zone) : "never"
  return {
    updated: clock(now, zone), tides: events.slice(0, 12), location, temperatures,
    nextTide: upcoming[0] ? Object.assign({}, upcoming[0], {due: countdown(upcoming[0].time - now)}) : null,
    followingTide: upcoming[1] || null,
    tideCurve: tideCurve(tides.data || [], now),
    tideStation: tides.data ? station : null, tideNote: tides.note || null,
    weather: Object.assign({}, w, {summary: conditions(w.weather_code), windBearing: bearing(w.wind_direction_10m)}),
    marine: {speed, direction, bearing: bearing(direction), wave: number(m.wave_height) ? m.wave_height : null,
      temperature: temperatures.sea, time: m.time ? clock(m.time, zone) : "—", latitude: md.latitude, longitude: md.longitude, distance},
    forecast, warnings,
    fetched: {tides: fetched(tides), weather: fetched(weather), marine: fetched(marine)}
  }
}

// ---- Formatting ----

function value(v, suffix) { return number(v) ? v.toFixed(1) + suffix : "—" }
function temperature(v, unit) { return number(v) ? value(unit === "F" ? v * 1.8 + 32 : v, unit === "F" ? "°F" : "°C") : "—" }
function coordinate(v, positive, negative) { return number(v) ? Math.abs(v).toFixed(3) + "°" + (v >= 0 ? positive : negative) : "—" }
function placeName(location) { return location.name + (location.country ? "," + location.country : "") }
function tideHeadline(t) { return (t.kind === "high" ? "↑ High " : "↓ Low ") + t.label.slice(-5) }
function escapeHTML(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]) }

function countryAbbreviation(code) { code = String(code || "").trim().toUpperCase(); return code === "GB" ? "UK" : code }

function validLocation(l) {
  return !!l && typeof l.name === "string" && l.name.trim() && typeof l.timezone === "string" &&
    valid(l.latitude, -90, 90) && valid(l.longitude, -180, 180)
}

// A geocoding result (Open-Meteo / GeoNames) as a Coast location.
function searchLocation(item) {
  if (!validLocation(item)) return null
  if (String(item.name).toLowerCase() === "bournemouth" && Math.abs(item.latitude - DEFAULT_LOCATION.latitude) < 0.05 &&
      Math.abs(item.longitude - DEFAULT_LOCATION.longitude) < 0.05) return Object.assign({}, DEFAULT_LOCATION)
  return {name: item.name, detail: String(item.admin1 || item.country || "Coastal conditions"), country: countryAbbreviation(item.country_code),
    latitude: item.latitude, longitude: item.longitude, marineLatitude: item.latitude, marineLongitude: item.longitude,
    timezone: item.timezone, temperatureUnit: "C"}
}

function sameLocation(a, b) { return !!a && !!b && a.name === b.name && a.latitude === b.latitude && a.longitude === b.longitude }

// ---- Full panel (HTML in the Omarchy style) ----

function tideSVG(curve, w, h, theme) {
  if (!curve) return ""
  const span = Math.max(0.1, curve.high - curve.low)
  const y = height => (h - 6 - (height - curve.low) / span * (h - 12)).toFixed(1)
  const line = curve.points.map((p, i) => (i ? "L" : "M") + (p[0] * w).toFixed(1) + " " + y(p[1])).join(" ")
  const first = curve.points[0][0] * w, last = curve.points[curve.points.length - 1][0] * w
  const near = x => curve.points.reduce((best, p) => Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best)
  const dots = curve.events.map(e => { const p = near(e.x); return Math.abs(p[0] - e.x) > 0.02 ? "" : `<circle cx="${(e.x * w).toFixed(1)}" cy="${y(p[1])}" r="2.5" fill="${theme.accent}" opacity="0.6"/>` }).join("")
  const now = near(curve.now), nowX = (curve.now * w).toFixed(1)
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="chart">
    <path d="M${first.toFixed(1)} ${h} L${line.slice(1)} L${last.toFixed(1)} ${h} Z" fill="${theme.accent}" fill-opacity="0.12"/>
    <path d="${line}" fill="none" stroke="${theme.accent}" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${dots}
    <rect x="${nowX}" y="0" width="1" height="${h}" fill="${theme.foreground}" opacity="0.3"/>
    ${Math.abs(now[0] - curve.now) <= 0.02 ? `<circle cx="${nowX}" cy="${y(now[1])}" r="4.5" fill="${theme.accent}" stroke="${theme.background}" stroke-width="2"/>` : ""}
  </svg>`
}

// The compass points where the current flows TOWARDS, clockwise from north.
function compassSVG(direction, weak, theme) {
  const has = number(direction)
  // Same geometry as CurrentCompass.qml: an 84-unit arrow box centred on the dial, chevron tips
  // 56, 36 and 16 units down it, arms hanging from the tip so each points up (north) at 0°.
  const chevrons = [0, 1, 2].map(i => `<g class="chev c${i}" transform="translate(85 ${43 + 56 - i * 20})">
      <rect x="-2.5" y="0" width="5" height="23" rx="2.5" fill="${theme.sea}" transform="rotate(-45)"/>
      <rect x="-2.5" y="0" width="5" height="23" rx="2.5" fill="${theme.sea}" transform="rotate(45)"/></g>`).join("")
  const labels = ["N", "E", "S", "W"].map((l, i) => {
    const a = i * Math.PI / 2
    return `<text x="${(85 + Math.sin(a) * 76).toFixed(1)}" y="${(85 - Math.cos(a) * 76).toFixed(1)}" fill="${theme.sea}" font-size="13" text-anchor="middle" dominant-baseline="central">${l}</text>`
  }).join("")
  return `<svg viewBox="0 0 170 170" class="compass${weak ? " weak" : ""}">
    <circle cx="85" cy="85" r="66" fill="none" stroke="${theme.sea}" stroke-opacity="0.55"/>
    ${labels}
    ${has ? `<g transform="rotate(${direction} 85 85)">${chevrons}</g>` : `<text x="85" y="85" fill="${theme.sea}" font-size="40" text-anchor="middle" dominant-baseline="central">—</text>`}
  </svg>`
}

// Added after the page has loaded, so a slow font download never leaves the panel blank.
const FONT_LOADER = `<script>addEventListener("load", () => { const l = document.createElement("link"); l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"; document.head.appendChild(l) })</script>`

// Shown the moment the script opens, while the feeds load.
function loadingHTML(state, theme) {
  const loc = state.active
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${FONT_LOADER}
<style>html { background: ${theme.background}; } body { margin: 0; font: 14px/1.45 "JetBrains Mono", ui-monospace, Menlo, monospace; color: ${theme.foreground};
  padding: calc(env(safe-area-inset-top) + 12px) 12px; } .panel { border: 2px solid ${theme.accent}; padding: 18px 16px; }
.heading { font-weight: 700; letter-spacing: 1.5px; color: ${theme.accent}; } .indent { padding-left: 3ch; margin-top: 7px; } .dim { opacity: 0.6; font-size: 12px; }</style>
</head><body><main class="panel"><div class="heading">COAST</div>
<div class="indent dim">${escapeHTML(placeName(loc))} · ${escapeHTML(loc.detail || "Coastal conditions")}</div>
<div class="indent" style="margin-top:18px">Loading tides, currents and weather…</div></main></body></html>`
}

function panelHTML(report, state, theme, notice) {
  const r = report || {}, loc = r.location || state.active, unit = loc.temperatureUnit || "C"
  const marine = r.marine || {}, weather = r.weather || {}, temps = r.temperatures || {}
  const slack = number(marine.speed) && marine.speed < 0.3
  const next = r.nextTide, then = r.followingTide
  const favourite = state.favourites.some(f => sameLocation(f, loc))
  const tideNote = escapeHTML(r.tideNote || "Tide times unavailable")
  const steps = (r.forecast || []).filter((v, i) => i % 2 === 0).slice(0, 6)
  const upcoming = (r.tides || []).filter(t => t.time * 1000 >= Date.now()).slice(0, 4)
  const list = (items, attr) => items.map((l, i) => `<button class="place" data-${attr}="${i}"><span class="accent">${escapeHTML(l.name)}</span><small>${escapeHTML(l.detail || "")}</small></button>`).join("")
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${FONT_LOADER}
<style>
:root { --bg: ${theme.background}; --fg: ${theme.foreground}; --accent: ${theme.accent}; --sea: ${theme.sea}; --urgent: ${theme.urgent}; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: var(--bg); color-scheme: dark; -webkit-text-size-adjust: 100%; overflow-x: hidden; }
body { font: 14px/1.45 "JetBrains Mono", ui-monospace, Menlo, monospace; color: var(--fg);
  padding: calc(env(safe-area-inset-top) + 12px) 12px calc(env(safe-area-inset-bottom) + 16px); }
.panel { border: 2px solid var(--accent); padding: 18px 16px; max-width: 900px; margin: 0 auto; }
.accent { color: var(--accent); } .sea { color: var(--sea); }
.label { font-size: 12px; letter-spacing: 1px; opacity: 0.65; text-transform: uppercase; }
.small { font-size: 12px; } .dim { opacity: 0.6; } .gap > * + * { margin-top: 7px; }
.heading { font-weight: 700; letter-spacing: 1.5px; color: var(--accent); }
.indent { padding-left: 3ch; }
a { text-decoration: none; }
button { font: inherit; color: var(--accent); background: none; border: 0; cursor: pointer; text-align: left; }
.links { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12px; }
.big { font-size: 34px; font-weight: 700; line-height: 1.1; }
.headline { font-size: 26px; font-weight: 700; color: var(--accent); }
hr { border: 0; border-top: 1px solid var(--fg); opacity: 0.15; margin: 14px 0; }
.top { display: grid; gap: 14px; }
.tide .chart { display: block; width: 100%; height: 110px; margin-top: 10px; }
.axis { position: relative; height: 18px; font-size: 12px; opacity: 0.55; }
.axis span { position: absolute; } .axis .now { transform: translateX(-50%); opacity: 1; }
.box { border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); background: color-mix(in srgb, var(--accent) 4%, transparent);
  border-radius: 8px; padding: 14px; margin: 14px 0; }
.grid4 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 8px 0; }
.reading { font-size: 20px; }
.tides { display: grid; grid-template-columns: auto auto auto; gap: 10px 2ch; width: max-content; margin: 10px 0; }
.weather { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
.card { border: 1px solid color-mix(in srgb, var(--sea) 50%, transparent); background: color-mix(in srgb, var(--sea) 8%, transparent);
  border-radius: 8px; padding: 14px 16px; margin: 14px 0; color: var(--sea); }
.current { display: flex; align-items: center; gap: 14px; }
.compass { width: 108px; height: 108px; flex: none; }
.compass.weak .chev { opacity: 0.5; }
.chev { animation: pulse 3.2s infinite ease-in-out; opacity: 0.2; }
.c1 { animation-delay: 0.74s; } .c2 { animation-delay: 1.47s; }
@keyframes pulse { 0%, 100% { opacity: 0.18; } 20% { opacity: 0.85; } 45% { opacity: 0.18; } }
.outlook { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; margin-top: 8px; }
.outlook .dir { font-size: 22px; }
.outlook .small { font-size: 11px; white-space: nowrap; }
.sea hr, .card hr { border-color: var(--sea); opacity: 0.35; }
.warn { color: var(--urgent); font-size: 12px; margin-top: 12px; }
.picker { display: none; } body.picking .picker { display: block; }
.field { display: flex; gap: 12px; margin: 10px 0; }
input { flex: 1; min-width: 0; font: inherit; font-size: 16px; color: var(--fg); background: transparent; border: 1px solid var(--accent); border-radius: 4px; padding: 8px; }
.place { display: block; width: 100%; padding: 8px; margin-top: 4px; border-radius: 4px; background: color-mix(in srgb, var(--accent) 5%, transparent); }
.place small { display: block; color: var(--fg); opacity: 0.6; font-size: 12px; }
@media (min-width: 700px) {
  .top { grid-template-columns: auto 1px 1fr; gap: 20px; } .top .vline { background: var(--fg); opacity: 0.15; }
  .grid4 { grid-template-columns: repeat(4, 1fr); }
  .lower { display: grid; grid-template-columns: auto 1px 1fr; gap: 20px; align-items: center; } .lower .vline { background: var(--fg); opacity: 0.15; align-self: stretch; }
  .weather { margin-top: 0; }
}
</style></head><body>
<main class="panel">
  ${notice ? `<p class="small accent" style="margin-bottom:12px">${escapeHTML(notice)}</p>` : ""}
  <section class="top">
    <div class="gap">
      <div class="heading">COAST</div>
      <div class="indent gap">
        <div class="small dim">${escapeHTML(placeName(loc))} · ${escapeHTML(loc.detail || "Coastal conditions")}</div>
        <div class="links"><button data-action="favourite">${favourite ? "★ Saved" : "☆ Save"}</button><button onclick="togglePicker()">⌖ Change location</button></div>
        <div class="label" style="margin-top:12px">Offshore current</div>
        <div class="big">${value(marine.speed, " kn")}</div>
        <div>${number(marine.direction) ? "Flowing to " + marine.bearing + " · " + Math.round(marine.direction) + "°" : "Direction unavailable"}</div>
        ${slack ? `<div class="small accent">Near slack water · direction unsettled</div>` : ""}
        <div class="links"><span class="dim" style="color:var(--fg)">Model time ${escapeHTML(marine.time || "—")}</span><button data-action="refresh">↻ Refresh</button></div>
      </div>
    </div>
    <div class="vline"></div>
    <div class="tide gap">
      <div class="label">Next tide</div>
      ${next ? `<div class="headline">${tideHeadline(next)}</div>
        <div>${next.due} · ${next.height.toFixed(1)} m</div>` : `<div class="small dim">${tideNote}</div>`}
      ${then ? `<div class="small dim">Then ${then.kind} ${then.label.slice(-5)} · ${then.height.toFixed(1)} m</div>` : ""}
      ${r.tideCurve ? tideSVG(r.tideCurve, 300, 110, theme) + `<div class="axis"><span style="left:0">−6h</span><span class="now" style="left:${r.tideCurve.now * 100}%">now</span><span style="right:0">+18h</span></div>` : ""}
    </div>
  </section>
  <hr>
  <section class="picker">
    <div class="label accent" style="opacity:1">Choose a coastal location</div>
    <div class="field"><input id="q" placeholder="Town, country" autocomplete="off" enterkeyhint="search"><button onclick="search()">Search</button></div>
    <div id="msg" class="small dim">Search worldwide. Include the country to distinguish places with the same name.</div>
    <div id="results"></div>
    ${state.favourites.length ? `<div class="label accent" style="opacity:1;margin-top:14px">Favourites</div>${list(state.favourites, "favourite")}` : ""}
    ${state.recents.length ? `<div class="label accent" style="opacity:1;margin-top:14px">Recent locations</div>${list(state.recents, "recent")}` : ""}
    <div class="links" style="margin-top:14px"><span class="label">Temperature</span>
      <button data-action="unit:C">°C${unit === "C" ? " ✓" : ""}</button><button data-action="unit:F">°F${unit === "F" ? " ✓" : ""}</button>
      <button data-action="key">ADMIRALTY key</button><button data-action="update">Update Coast</button></div>
    <p class="small dim" style="margin-top:10px">Choose a coastal place. Offshore coverage varies; tide times cover UK coasts (ADMIRALTY). Search: Open-Meteo / GeoNames.</p>
    <hr>
  </section>
  <section class="box">
    <div class="label accent" style="opacity:1">Temperatures</div>
    <div class="grid4">
      ${[["Sea", temps.sea], ["Air", temps.air], ["Feels like", temps.feels], ["Wind chill", temps.windChill]].map(([l, v]) =>
        `<div><div class="label">${l}</div><div class="reading">${temperature(v, unit)}</div></div>`).join("")}
    </div>
    <div class="small dim">Sea is an offshore model estimate and can differ at the beach. Wind chill is shown only at air ≤10°C with wind &gt;3 mph. ${escapeHTML(temps.times || "")}</div>
  </section>
  <section class="lower">
    <div>
      <div class="accent" style="letter-spacing:1px">NEXT TIDES · ${escapeHTML(String(loc.name).toUpperCase())}</div>
      ${upcoming.length ? `<div class="tides">${upcoming.map(t => `<span>${escapeHTML(t.label)}</span><span>${t.kind === "high" ? "↑ High water" : "↓ Low water"}</span><span>${t.height.toFixed(1)} m</span>`).join("")}</div>`
        : `<div class="dim" style="margin:10px 0">${tideNote}</div>`}
      ${r.tideStation ? `<div class="small dim">Station: ${escapeHTML(r.tideStation.name)} · ${r.tideStation.distance} km<br>Chart datum · curve approximate</div>` : ""}
    </div>
    <div class="vline"></div>
    <div class="weather">
      ${[["Weather", temperature(weather.temperature_2m, unit), weather.summary || "—"], ["Wind", value(weather.wind_speed_10m, " mph"), "From " + (weather.windBearing || "—")],
        ["Waves", value(marine.wave, " m"), "Sea " + temperature(marine.temperature, unit)]].map(([l, v, s]) =>
        `<div><div class="label">${l}</div><div class="reading">${v}</div><div class="small dim">${escapeHTML(s)}</div></div>`).join("")}
    </div>
  </section>
  <section class="card">
    <div class="current">
      ${compassSVG(marine.direction, slack, theme)}
      <div class="gap">
        <div class="small" style="letter-spacing:1px">CURRENT</div>
        <div class="headline" style="color:var(--sea)">${slack ? "Slack" : number(marine.direction) ? arrow(marine.direction) + " " + marine.bearing : "—"}</div>
        <div>${value(marine.speed, " kn")}</div>
        ${slack && number(marine.direction) ? `<div class="small" style="opacity:0.8">Unsettled · ${arrow(marine.direction)} ${marine.bearing}</div>` : ""}
      </div>
    </div>
    <hr>
    <div class="small" style="letter-spacing:1px">OUTLOOK · NEXT 12 HOURS</div>
    <div class="outlook">${steps.map(s => `<div><div class="small">${s.time}</div><div class="dir">${arrow(s.direction)}</div><div class="small">${value(s.speed, " kn")}</div></div>`).join("")}</div>
    <p class="small" style="opacity:0.8;margin-top:12px">Offshore model ~8 km resolution; not beach rip currents or navigation guidance. Grid: ${coordinate(marine.latitude, "N", "S")}, ${coordinate(marine.longitude, "E", "W")}</p>
  </section>
  ${(r.warnings || []).length ? `<div class="warn">${escapeHTML(r.warnings.join(" · "))}</div>` : ""}
  <p class="small dim" style="margin-top:12px">Fetched: tides ${escapeHTML((r.fetched || {}).tides || "—")} · weather ${escapeHTML((r.fetched || {}).weather || "—")} · marine ${escapeHTML((r.fetched || {}).marine || "—")}</p>
  <div class="links" style="margin-top:10px">${r.tideStation ? `<a class="accent" href="https://developer.admiralty.co.uk/">Tides: ADMIRALTY / UKHO ↗</a>` : ""}<a class="accent" href="https://open-meteo.com/">Open-Meteo / DWD ↗</a></div>
  <p class="small dim" style="margin-top:10px">Coast for iOS · version ${escapeHTML(VERSION)}</p>
</main>
<script>
// Each tap opens a coast:// link, which the script catches instead of loading.
function send(action) { location.href = "coast://run?a=" + encodeURIComponent(action) }
document.addEventListener("click", e => {
  const b = e.target.closest("[data-action=refresh], [data-action=update]")
  if (b) b.textContent = b.dataset.action === "update" ? "Downloading…" : "Updating…"
}, true)
const found = []
document.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return
  if (b.dataset.action) send(b.dataset.action)
  else if (b.dataset.result) send("select:" + JSON.stringify(found[+b.dataset.result]))
  else if (b.dataset.favourite) send("pick:favourite:" + b.dataset.favourite)
  else if (b.dataset.recent) send("pick:recent:" + b.dataset.recent)
})
document.querySelectorAll("a").forEach(a => a.addEventListener("click", e => { e.preventDefault(); send("open:" + a.href) }))
function togglePicker() { document.body.classList.toggle("picking"); if (document.body.classList.contains("picking")) document.getElementById("q").focus() }
document.getElementById("q").addEventListener("keydown", e => { if (e.key === "Enter") search() })
${searchLocation.toString()}
${countryAbbreviation.toString()}
${validLocation.toString()}
${valid.toString()}
${number.toString()}
const DEFAULT_LOCATION = ${JSON.stringify(DEFAULT_LOCATION)}
function escapeHTML(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]) }
async function search() {
  const q = document.getElementById("q").value.trim(), msg = document.getElementById("msg"), out = document.getElementById("results")
  out.innerHTML = ""; found.length = 0
  if (q.length < 2) { msg.textContent = "Enter at least two characters."; return }
  msg.textContent = "Searching…"
  try {
    const res = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=" + encodeURIComponent(q))
    const data = await res.json()
    ;(data.results || []).map(searchLocation).filter(Boolean).forEach(l => found.push(l))
    out.innerHTML = found.map((l, i) => '<button class="place" data-result="' + i + '"><span class="accent">' + escapeHTML(l.name + (l.country ? "," + l.country : "") + " · " + l.detail) +
      '</span><small>' + escapeHTML(l.timezone + " · " + l.latitude.toFixed(3) + ", " + l.longitude.toFixed(3)) + '</small></button>').join("")
    msg.textContent = found.length ? "Choose a result below." : "No matches. Try a nearby coastal town."
  } catch (e) { msg.textContent = "Search failed. Check your connection and try again." }
}
</script>
</body></html>`
}

// ---- Widgets ----

function mono(size, bold) {
  try { return bold ? Font.boldMonospacedSystemFont(size) : Font.regularMonospacedSystemFont(size) }
  catch (e) { return new Font(bold ? "Menlo-Bold" : "Menlo", size) }
}

function chartImage(curve, w, h, theme) {
  const dc = new DrawContext()
  dc.size = new Size(w, h); dc.opaque = false; dc.respectScreenScale = true
  const span = Math.max(0.1, curve.high - curve.low)
  const at = p => new Point(p[0] * w, h - 4 - (p[1] - curve.low) / span * (h - 8))
  const fill = new Path(), line = new Path()
  fill.move(new Point(curve.points[0][0] * w, h)); line.move(at(curve.points[0]))
  curve.points.forEach(p => { fill.addLine(at(p)); line.addLine(at(p)) })
  fill.addLine(new Point(curve.points[curve.points.length - 1][0] * w, h)); fill.closeSubpath()
  dc.addPath(fill); dc.setFillColor(new Color(theme.accent, 0.15)); dc.fillPath()
  dc.addPath(line); dc.setStrokeColor(new Color(theme.accent)); dc.setLineWidth(2); dc.strokePath()
  dc.setFillColor(new Color(theme.foreground, 0.3)); dc.fillRect(new Rect(curve.now * w, 0, 1, h))
  const now = curve.points.reduce((best, p) => Math.abs(p[0] - curve.now) < Math.abs(best[0] - curve.now) ? p : best)
  if (Math.abs(now[0] - curve.now) <= 0.02) { const c = at(now); dc.setFillColor(new Color(theme.accent)); dc.fillEllipse(new Rect(c.x - 3.5, c.y - 3.5, 7, 7)) }
  return dc.getImage()
}

function compassImage(direction, weak, size, theme) {
  const dc = new DrawContext()
  dc.size = new Size(size, size); dc.opaque = false; dc.respectScreenScale = true
  const c = size / 2, r = size * 0.4
  dc.setStrokeColor(new Color(theme.sea, 0.55)); dc.setLineWidth(1)
  dc.strokeEllipse(new Rect(c - r, c - r, r * 2, r * 2))
  dc.setTextColor(new Color(theme.sea)); dc.setFont(mono(size * 0.11, false)); dc.setTextAlignedCenter()
  dc.drawTextInRect("N", new Rect(c - 8, c - r - size * 0.1, 16, size * 0.12))
  if (number(direction)) {
    // Three chevrons along the flow, pointing downstream (clockwise from north).
    const a = direction * Math.PI / 180
    const rotate = (x, y) => new Point(c + x * Math.cos(a) - y * Math.sin(a), c + x * Math.sin(a) + y * Math.cos(a))
    const arm = r * 0.33
    ;[0, 1, 2].forEach(i => {
      const tipY = r * 0.5 - i * r * 0.45
      const p = new Path()
      p.move(rotate(-arm, tipY + arm)); p.addLine(rotate(0, tipY)); p.addLine(rotate(arm, tipY + arm))
      dc.addPath(p); dc.setStrokeColor(new Color(theme.sea, (weak ? 0.5 : 1) * (0.45 + i * 0.25))); dc.setLineWidth(size * 0.05); dc.strokePath()
    })
  }
  return dc.getImage()
}

function addText(stack, text, size, color, bold, opacity) {
  const t = stack.addText(String(text))
  t.font = mono(size, bold); t.textColor = new Color(color, opacity == null ? 1 : opacity); t.lineLimit = 1; t.minimumScaleFactor = 0.7
  return t
}

function buildWidget(report, family, theme, problem) {
  const w = new ListWidget()
  w.backgroundColor = new Color(theme.background)
  w.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000)
  const fg = theme.foreground, accent = theme.accent, sea = theme.sea
  const r = report || {}, loc = r.location || DEFAULT_LOCATION, unit = loc.temperatureUnit || "C"
  const next = r.nextTide, marine = r.marine || {}, temps = r.temperatures || {}
  const tideLine = next ? tideHeadline(next) : "No tide times"
  // The arrow points where the current flows; below 0.3 kn the direction means little.
  const currentLine = number(marine.speed) && marine.speed < 0.3 ? "Slack · " + value(marine.speed, " kn")
    : number(marine.direction) ? arrow(marine.direction) + " " + marine.bearing + " " + value(marine.speed, " kn") : "Current —"

  if (family === "accessoryInline") { w.addText(next ? "Tide " + tideLine + " · " + next.due.replace(/^in /, "") : "Current " + currentLine.replace(/^Current /, "")); return w }
  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true
    const s = w.addStack(); s.layoutVertically(); s.centerAlignContent()
    addText(s, next ? (next.kind === "high" ? "↑" : "↓") : "·", 14, fg, true).centerAlignText()
    addText(s, next ? next.label.slice(-5) : "—", 11, fg, true).centerAlignText()
    return w
  }
  if (family === "accessoryRectangular") {
    // Labelled lines in the lock screen's own font, which is narrower than monospace.
    const line = (label, text) => {
      const row = w.addStack(); row.centerAlignContent()
      const l = row.addText(label + " "); l.font = Font.boldSystemFont(15); l.lineLimit = 1
      const v = row.addText(text); v.font = Font.systemFont(15); v.lineLimit = 1; v.minimumScaleFactor = 0.6
    }
    // Short enough to fit at full size: the arrow already says high (↑) or low (↓).
    line("Tide", next ? (next.kind === "high" ? "↑ " : "↓ ") + next.label.slice(-5) + " · " + next.due.replace(/^in /, "") : (r.tideNote ? "unavailable" : "—"))
    line("Current", currentLine.replace(/^Current /, ""))
    line("Sea", temperature(temps.sea, unit))
    return w
  }

  const pad = family === "small" ? 14 : 16
  w.setPadding(pad, pad, pad, pad)
  const head = w.addStack(); head.centerAlignContent()
  addText(head, "COAST", 11, accent, true)
  head.addSpacer(6)
  addText(head, placeName(loc), 11, fg, false, 0.6)
  w.addSpacer(family === "small" ? 6 : 8)
  if (problem) { addText(w, problem, 12, fg, false, 0.8).lineLimit = 4; return w }

  const tide = s => {
    addText(s, "NEXT TIDE", 10, fg, false, 0.65)
    addText(s, tideLine, family === "small" ? 18 : 20, accent, true)
    addText(s, next ? next.due + " · " + next.height.toFixed(1) + " m" : (r.tideNote || "Tide times unavailable"), 12, fg, false).lineLimit = next ? 1 : 2
    if (r.followingTide) addText(s, "Then " + r.followingTide.kind + " " + r.followingTide.label.slice(-5), 11, fg, false, 0.65)
  }
  if (family === "small") {
    tide(w)
    w.addSpacer()
    addText(w, currentLine, 12, sea, true)
    addText(w, "Sea " + temperature(temps.sea, unit), 11, fg, false, 0.7)
    return w
  }

  const row = w.addStack(); row.layoutHorizontally()
  const left = row.addStack(); left.layoutVertically(); tide(left)
  row.addSpacer(10)
  const right = row.addStack(); right.layoutVertically()
  const compass = right.addImage(compassImage(marine.direction, number(marine.speed) && marine.speed < 0.3, 64, theme))
  compass.imageSize = new Size(52, 52)
  addText(right, currentLine, 11, sea, true)
  w.addSpacer(8)
  if (r.tideCurve) { const img = w.addImage(chartImage(r.tideCurve, 300, family === "medium" ? 34 : 70, theme)); img.imageSize = new Size(300, family === "medium" ? 34 : 70) }
  if (family === "medium") return w

  w.addSpacer(10)
  const list = (r.tides || []).filter(t => t.time * 1000 >= Date.now()).slice(0, 4)
  list.forEach(t => {
    const line = w.addStack()
    addText(line, t.label, 12, fg, false); line.addSpacer(10)
    addText(line, t.kind === "high" ? "↑ High" : "↓ Low", 12, fg, false); line.addSpacer()
    addText(line, t.height.toFixed(1) + " m", 12, fg, false)
  })
  w.addSpacer(10)
  const temp = w.addStack()
  ;[["SEA", temps.sea], ["AIR", temps.air], ["FEELS", temps.feels]].forEach(([l, v], i) => {
    if (i) temp.addSpacer()
    const s = temp.addStack(); s.layoutVertically()
    addText(s, l, 10, fg, false, 0.65); addText(s, temperature(v, unit), 14, fg, false)
  })
  w.addSpacer()
  addText(w, r.tideStation ? "Tides: ADMIRALTY · " + r.tideStation.name : "Open-Meteo", 9, fg, false, 0.45)
  return w
}

// ---- Scriptable glue ----

async function scriptableJSON(url, headers) {
  const request = new Request(url)
  request.headers = Object.assign({"User-Agent": "Coast/1.1 (iOS Scriptable)"}, headers || {})
  request.timeoutInterval = 12
  // The API key must only ever reach the host it was sent to.
  if (headers) request.onRedirect = () => null
  const text = await request.loadString()
  const code = request.response && request.response.statusCode
  if (code !== 200) throw new Error("HTTP " + code)
  if (text.length > MAX_CHARS) throw new Error("Response too large")
  return JSON.parse(text)
}

// Downloads the latest Coast from GitHub and saves it over this script. The latest commit's
// exact file is used because the plain link is cached for a few minutes; if GitHub's API
// refuses (it limits requests per network), a fresh copy of main is used instead.
const REPO = "paulwitcombe/coast"
async function latestScript() {
  try {
    const latest = new Request("https://api.github.com/repos/" + REPO + "/commits/main")
    latest.headers = {"Accept": "application/vnd.github+json"}
    latest.timeoutInterval = 15
    const commit = await latest.loadJSON()
    if (/^[0-9a-f]{40}$/.test(commit.sha || "")) {
      const request = new Request("https://raw.githubusercontent.com/" + REPO + "/" + commit.sha + "/ios/Coast.js")
      request.timeoutInterval = 15
      const code = await request.loadString()
      if (request.response.statusCode === 200) return {code, version: commit.sha.slice(0, 7)}
    }
  } catch (e) {}
  const request = new Request("https://raw.githubusercontent.com/" + REPO + "/main/ios/Coast.js?fresh=" + Date.now())
  request.timeoutInterval = 15
  const code = await request.loadString()
  if (request.response.statusCode !== 200) throw new Error("GitHub answered " + request.response.statusCode)
  return {code, version: "main " + new Date().toISOString().slice(0, 16).replace("T", " ")}
}

// Saving over the running script can make Scriptable stop it, so `announce` shows the
// result in the panel before the file is written.
async function selfUpdate(announce) {
  const {code, version} = await latestScript()
  if (!code.includes("Coast for iOS (Scriptable)") || !code.includes('const VERSION = "dev"')) throw new Error("the download wasn't the Coast script")
  if (version === VERSION) return "Coast is already up to date (version " + version + ")."
  const here = module.filename
  const fm = here.includes("/Mobile Documents/") ? FileManager.iCloud() : FileManager.local()
  const stamped = code.replace('const VERSION = "dev"', 'const VERSION = "' + version + '"')
  const done = "Updated to version " + version + ". Close and reopen Coast to use it; widgets catch up within the hour."
  await announce(done)
  fm.writeString(here, stamped)
  if (fm.readString(here) !== stamped) throw new Error("saved, but reading it back gave a different file")
  return done
}

// Locations, favourites and units only: never tide data.
const STATE_FILE = "coast-state.json"
function stateFiles() { const fm = FileManager.local(); return {fm, path: fm.joinPath(fm.documentsDirectory(), STATE_FILE)} }
function loadState() {
  const {fm, path} = stateFiles()
  let state = null
  try { state = JSON.parse(fm.readString(path)) } catch (e) { state = null }
  if (!state || !validLocation(state.active)) state = {active: Object.assign({}, DEFAULT_LOCATION), favourites: [Object.assign({}, DEFAULT_LOCATION)], recents: []}
  state.favourites = (state.favourites || []).filter(validLocation)
  state.recents = (state.recents || []).filter(validLocation)
  return state
}
function saveState(state) { const {fm, path} = stateFiles(); fm.writeString(path, JSON.stringify(state)) }

function choose(state, location) {
  location = Object.assign({}, location, {temperatureUnit: state.active.temperatureUnit || "C"})
  state.active = location
  state.recents = [location].concat(state.recents.filter(l => !sameLocation(l, location))).slice(0, 8)
  saveState(state)
}

async function askForKey(replacing) {
  const alert = new Alert()
  alert.title = replacing ? "Replace ADMIRALTY key" : "ADMIRALTY key"
  alert.message = "Tide times use the free ADMIRALTY UK Tidal API. Sign up at developer.admiralty.co.uk, subscribe to UK Tidal API – Discovery, then paste the Primary key from your Profile page. It is kept in the iOS Keychain."
  alert.addSecureTextField("Primary key", "")
  alert.addAction("Save")
  alert.addCancelAction(replacing ? "Cancel" : "Skip for now")
  if (await alert.presentAlert() !== 0) return null
  const key = alert.textFieldValue(0).replace(/\s+/g, "")
  if (key) Keychain.set(KEY_NAME, key)
  return key || null
}

function storedKey() { return Keychain.contains(KEY_NAME) ? Keychain.get(KEY_NAME) : null }

function widgetLocation(state) {
  const wanted = String(args.widgetParameter || "").trim().toLowerCase()
  return (wanted && state.favourites.concat(state.recents).find(l => l.name.toLowerCase() === wanted)) || state.active
}

async function runWidget() {
  const state = loadState()
  const location = widgetLocation(state)
  const key = storedKey()
  let report = null, problem = null
  try { report = await loadReport(location, key, scriptableJSON) } catch (e) { problem = "Coastal feeds unavailable." }
  if (!key && !problem) report.tideNote = "Open Coast in Scriptable to add your ADMIRALTY key"
  Script.setWidget(buildWidget(report, config.widgetFamily, THEME, problem))
}

async function runApp() {
  const state = loadState()
  let key = storedKey() || await askForKey(false)
  const load = async () => { try { return await loadReport(state.active, key, scriptableJSON) } catch (e) { return null } }
  // Show the panel straight away, then fill it in when the feeds arrive.
  const view = new WebView()
  // Taps arrive as coast:// navigations; everything else (the page, its font) loads normally.
  const queue = []
  let wake = null
  view.shouldAllowRequest = request => {
    const url = String(request.url || "")
    if (!url.startsWith("coast://")) return true
    const at = url.indexOf("?a=")
    if (at >= 0) queue.push(decodeURIComponent(url.slice(at + 3)))
    if (wake && queue.length) { wake(); wake = null }
    return false
  }
  const nextAction = () => new Promise(resolve => { if (queue.length) resolve(); else wake = resolve }).then(() => queue.shift())
  await view.loadHTML(loadingHTML(state, THEME))
  let open = true
  const closed = view.present(true).then(() => { open = false })
  let report = await load()
  if (!open) return Script.complete()
  await view.loadHTML(panelHTML(report, state, THEME))
  while (open) {
    const action = await Promise.race([closed.then(() => null), nextAction()])
    if (!action || !open) break
    let fetchAgain = false, notice = ""
    if (action === "refresh") fetchAgain = true
    else if (action === "update") {
      try { notice = await selfUpdate(message => view.loadHTML(panelHTML(report, state, THEME, message))) } catch (e) { notice = "Update failed: " + (e && e.message || e) + ". Check your connection and try again." }
    }
    else if (action === "favourite") {
      const has = state.favourites.some(f => sameLocation(f, state.active))
      state.favourites = has ? state.favourites.filter(f => !sameLocation(f, state.active)) : state.favourites.concat([state.active])
      saveState(state)
    } else if (action.startsWith("unit:")) {
      state.active.temperatureUnit = action.slice(5) === "F" ? "F" : "C"
      if (report) report.location = state.active
      saveState(state)
    } else if (action === "key") {
      const replaced = await askForKey(true)
      if (replaced) { key = replaced; fetchAgain = true }
    } else if (action.startsWith("select:")) {
      let location = null
      try { location = JSON.parse(action.slice(7)) } catch (e) { location = null }
      if (validLocation(location)) { choose(state, location); fetchAgain = true }
    } else if (action.startsWith("pick:")) {
      const [, list, index] = action.split(":")
      const location = (list === "favourite" ? state.favourites : state.recents)[+index]
      if (location) { choose(state, location); fetchAgain = true }
    } else if (action.startsWith("open:")) {
      const url = action.slice(5)
      if (/^https:\/\/(developer\.admiralty\.co\.uk|open-meteo\.com)\//.test(url)) Safari.open(url)
      continue
    }
    if (fetchAgain) report = await load()
    await view.loadHTML(panelHTML(report, state, THEME, notice))
  }
  Script.complete()
}

const core = {buildWidget, chartImage, compassImage, bearing, arrow, knots, conditions, countdown, windChill, readings, distanceKm, parseStations, nearestStation,
  parseEvents, tideCurve, parseModel, buildReport, loadReport, sourceUrls, panelHTML, loadingHTML, searchLocation, escapeHTML, clock, dayClock, DEFAULT_LOCATION, THEME, UNAVAILABLE}

if (typeof config === "undefined") module.exports = core
else if (config.runsInWidget) runWidget().then(() => Script.complete())
else runApp()
