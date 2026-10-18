#!/usr/bin/env python3
"""Location-aware coastal feeds. Standard library only; Open-Meteo is cached, ADMIRALTY tides never are."""
import concurrent.futures
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
from location import DEFAULT_LOCATION, load_location
from temperatures import readings
import tides as admiralty

ZONE = ZoneInfo("Europe/London")
CACHE = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "omarchy-coast"

def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def bearing(value):
    return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][int((value % 360 + 11.25) / 22.5) % 16] if number(value) else "—"

def local(timestamp, fmt="%H:%M", zone=ZONE):
    return dt.datetime.fromtimestamp(timestamp, zone).strftime(fmt)

def parse_model(raw):
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get("current"), dict) or not number(data["current"].get("time")):
        raise ValueError("Model response has no timestamped conditions")
    hourly = data.get("hourly", {})
    if hourly and any(len(hourly.get(key, [])) != len(hourly.get("time", [])) for key in ("ocean_current_velocity", "ocean_current_direction")):
        raise ValueError("Incomplete current forecast")
    return data

def download(url, headers=None):
    request = urllib.request.Request(url, headers={"User-Agent": "Coast/1.1 (desktop widget)", **(headers or {})})
    with urllib.request.urlopen(request, timeout=18) as response:
        return response.read().decode("utf-8")

def fetch_live(url, parser, headers=None):
    """Fetch without touching disk: ADMIRALTY Discovery data may not be cached or stored."""
    try:
        return {"data": parser(download(url, headers)), "fetched": time.time(), "error": None}
    except Exception as error:
        return {"data": None, "fetched": None, "error": str(error)}

def fetch(name, url, parser, ttl, headers=None):
    path = CACHE / (name + "-" + hashlib.sha256(url.encode()).hexdigest()[:16] + ".json")
    cached = None
    try:
        cached = json.loads(path.read_text())
        if time.time() - cached["fetched"] < ttl:
            return {**cached, "error": None}
    except (OSError, ValueError, KeyError):
        cached = None
    try:
        result = {"data": parser(download(url, headers)), "fetched": time.time(), "error": None}
        CACHE.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", dir=CACHE, delete=False) as f:
            try:
                json.dump(result, f)
            except Exception:
                os.unlink(f.name)
                raise
        os.replace(f.name, path)
        return result
    except Exception as error:
        return {"data": cached["data"] if cached else None, "fetched": cached["fetched"] if cached else None, "error": str(error)}

def knots(value, unit):
    factors = {"km/h": 1 / 1.852, "m/s": 1.943844, "kn": 1, "knots": 1, "mph": 0.868976}
    return round(value * factors[unit], 2) if number(value) and unit in factors else None

def conditions(code):
    if code == 0: return "Clear"
    if code == 1: return "Mainly clear"
    if code == 2: return "Partly cloudy"
    if code == 3: return "Overcast"
    if code in (45, 48): return "Fog"
    if code in (51, 53, 55, 56, 57): return "Drizzle"
    if code in (61, 63, 65, 66, 67, 80, 81, 82): return "Rain / showers"
    if code in (71, 73, 75, 77, 85, 86): return "Snow"
    if code in (95, 96, 99): return "Thunderstorms"
    return "Unavailable"

def countdown(seconds):
    minutes = max(0, int(round(seconds / 60)))
    hours, rest = divmod(minutes, 60)
    return "in " + " ".join(([str(hours) + "h"] if hours else []) + ([str(rest) + "m"] if rest or not hours else []))

def tide_curve(events, now, before=6 * 3600, after=18 * 3600, step=900):
    """Approximate water level from now-6h to now+18h: cosine between the published highs and lows.

    Only spans covered by consecutive events are drawn; x is the fraction of the window.
    """
    events = sorted(events, key=lambda e: e["time"])
    start, span = now - before, before + after
    points = []
    for i in range(span // step + 1):
        t = start + i * step
        for a, b in zip(events, events[1:]):
            if a["time"] <= t <= b["time"]:
                share = (1 - math.cos(math.pi * (t - a["time"]) / (b["time"] - a["time"]))) / 2
                points.append([round(i * step / span, 4), round(a["height"] + (b["height"] - a["height"]) * share, 3)])
                break
    if len(points) < 2:
        return None
    heights = [h for _, h in points]
    return {"points": points, "low": min(heights), "high": max(heights), "now": round(before / span, 4),
            "events": [{"x": round((e["time"] - start) / span, 4), "kind": e["kind"]} for e in events if start <= e["time"] <= start + span]}

def grid_distance(location, model):
    """Distance from selected shore location to the returned offshore grid cell."""
    if not all(number(model.get(key)) for key in ("latitude", "longitude")):
        return None
    lat1, lat2 = map(math.radians, (location["latitude"], model["latitude"]))
    delta_lon = math.radians(model["longitude"] - location["longitude"])
    a = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(delta_lon/2)**2
    return round(6371 * 2 * math.asin(math.sqrt(min(1, max(0, a)))), 1)

def build_report(sources, now=None, location=None, station=None):
    now = time.time() if now is None else now
    location = dict(DEFAULT_LOCATION) if location is None else location
    zone = ZoneInfo(location["timezone"])
    def at(stamp, fmt="%H:%M"):
        return local(stamp, fmt, zone)
    tides, weather, marine = sources
    today = at(now, "%Y-%m-%d")
    events = [dict(e, label=at(e["time"], "%a %H:%M")) for e in (tides["data"] or []) if at(e["time"], "%Y-%m-%d") >= today]
    upcoming = [e for e in events if e["time"] >= now]
    w = (weather["data"] or {}).get("current", {})
    m = (marine["data"] or {}).get("current", {})
    # Expired model conditions cannot masquerade as a live direction arrow.
    if not number(w.get("time")) or abs(now - w["time"]) > 7200: w = {}
    if not number(m.get("time")) or abs(now - m["time"]) > 7200: m = {}
    md = marine["data"] or {}
    distance = grid_distance(location, md)
    nearby = distance is None or distance <= 30
    if not nearby:
        m = {}
    # Only trust temperature and wind readings whose units are confirmed.
    wu = (weather["data"] or {}).get("current_units", {})
    mu = md.get("current_units", {})
    sea = m.get("sea_surface_temperature") if mu.get("sea_surface_temperature") == "°C" else None
    air = w.get("temperature_2m") if wu.get("temperature_2m") == "°C" else None
    feels = w.get("apparent_temperature") if wu.get("apparent_temperature") == "°C" else None
    wind = w.get("wind_speed_10m") if wu.get("wind_speed_10m") in ("mp/h", "mph") else None
    temperatures = readings(sea, air, feels, wind)
    temperatures["times"] = "Sea model " + (at(m["time"]) if m else "—") + " · air model " + (at(w["time"]) if w else "—")
    speed = knots(m.get("ocean_current_velocity"), md.get("current_units", {}).get("ocean_current_velocity"))
    direction = m.get("ocean_current_direction") if speed is not None and speed > 0 else None
    hourly = md.get("hourly", {}) if nearby else {}
    forecast = []
    for i, stamp in enumerate(hourly.get("time", [])):
        if now <= stamp <= now + 12 * 3600:
            velocity = knots(hourly.get("ocean_current_velocity", [])[i], md.get("hourly_units", {}).get("ocean_current_velocity"))
            angle = hourly.get("ocean_current_direction", [])[i] if velocity is not None and velocity > 0 else None
            forecast.append({"time": at(stamp), "speed": velocity, "direction": angle, "bearing": bearing(angle)})
    warnings = ["Tides: unavailable"] if tides["error"] and not tides.get("note") else []
    warnings += [name + ": cached / unavailable" for name, source in (("Weather", weather), ("Currents", marine)) if source["error"]]
    if tides.get("note"): warnings.append(tides["note"])
    if not w: warnings.append("Weather conditions unavailable or expired")
    if not m: warnings.append("Current conditions unavailable or expired")
    if not nearby: warnings.append("No nearby marine grid: offshore readings withheld (more than 30 km from this location)")
    if not tides.get("skipped") and not tides.get("note") and not any(e["time"] >= now for e in events): warnings.append("No upcoming tide times available")
    return {
        "updated": at(now), "tides": events[:12], "location": location, "temperatures": temperatures,
        "nextTide": dict(upcoming[0], due=countdown(upcoming[0]["time"] - now)) if upcoming else None,
        "followingTide": upcoming[1] if len(upcoming) > 1 else None,
        "tideCurve": tide_curve(tides["data"] or [], now),
        "tideStation": station if tides["data"] else None, "tideNote": tides.get("note"),
        # Handed back by the panel while it stays open, so the countdown can tick without refetching.
        "tideHold": {"events": tides["data"], "station": station, "fetched": tides["fetched"]} if tides["data"] else None,
        "weather": {**w, "summary": conditions(w.get("weather_code")), "windBearing": bearing(w.get("wind_direction_10m"))},
        "marine": {"speed": speed, "direction": direction, "bearing": bearing(direction), "wave": m.get("wave_height"), "temperature": sea, "time": at(m["time"]) if m else "—", "latitude": md.get("latitude"), "longitude": md.get("longitude"), "distance": distance},
        "forecast": forecast, "warnings": warnings,
        "fetched": {name: at(source["fetched"], "%d %b %H:%M") if source["fetched"] else "never" for name, source in zip(("tides", "weather", "marine"), sources)}
    }

def source_urls(location):
    weather = "https://api.open-meteo.com/v1/forecast?" + urlencode({
        "latitude": location["latitude"], "longitude": location["longitude"],
        "current": "temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,weather_code",
        "wind_speed_unit": "mph", "temperature_unit": "celsius", "timeformat": "unixtime"})
    marine = "https://marine-api.open-meteo.com/v1/marine?" + urlencode({
        "latitude": location["marineLatitude"], "longitude": location["marineLongitude"],
        "current": "ocean_current_velocity,ocean_current_direction,wave_height,sea_surface_temperature",
        "hourly": "ocean_current_velocity,ocean_current_direction", "timeformat": "unixtime", "forecast_days": 2})
    return weather, marine


UNAVAILABLE = "Tide data temporarily unavailable"


def no_tides(note):
    return {"data": None, "fetched": None, "error": note, "note": note}


# The panel is closed: tides are not fetched, so nothing from ADMIRALTY is held.
SKIPPED = {"data": None, "fetched": None, "error": None, "note": None, "skipped": True}


def held_tides(text):
    """Events the open panel already holds in memory, passed back on its next tick."""
    held = json.loads(text)
    events = [e for e in held["events"] if number(e.get("time")) and e.get("kind") in ("high", "low") and number(e.get("height"))]
    if not events or not number(held.get("fetched")):
        raise ValueError("No held tide events")
    return {"data": events, "fetched": held["fetched"], "error": None}, held.get("station")


def tide_source(location):
    """Live events for the nearest ADMIRALTY station, or a reason there are none.

    Discovery terms forbid caching or storing, so both requests go straight to the
    API and nothing is written to disk.
    """
    key = admiralty.api_key()
    if not key:
        return no_tides("Tide times need a free ADMIRALTY API key (see README)"), None
    auth = admiralty.headers(key)
    stations = fetch_live(admiralty.BASE + "Stations", admiralty.parse_stations, auth)
    if not stations["data"]:
        return no_tides(UNAVAILABLE), None
    station = admiralty.nearest_station(stations["data"], location["latitude"], location["longitude"])
    if not station:
        return no_tides("No UK tidal station within %d km of this location" % admiralty.MAX_STATION_KM), None
    url = admiralty.BASE + "Stations/" + station["id"] + "/TidalEvents?duration=7"
    events = fetch_live(url, admiralty.parse_events, auth)
    # Quota exceeded (403), outages and bad replies all read the same in the panel.
    return (events, station) if events["data"] else (no_tides(UNAVAILABLE), None)


def main(args=sys.argv[1:]):
    """No arguments: weather and currents only. --tides: fetch tides live. --held JSON: reuse the panel's."""
    location = load_location()
    weather_url, marine_url = source_urls(location)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        weather = pool.submit(fetch, "weather", weather_url, parse_model, 900)
        marine = pool.submit(fetch, "marine", marine_url, parse_model, 900)
        if args[:1] == ["--tides"]:
            tides, station = pool.submit(tide_source, location).result()
        elif args[:1] == ["--held"] and len(args) > 1:
            tides, station = held_tides(args[1])
        else:
            tides, station = SKIPPED, None
        print(json.dumps(build_report([tides, weather.result(), marine.result()], location=location, station=station), allow_nan=False))

if __name__ == "__main__":
    main()
