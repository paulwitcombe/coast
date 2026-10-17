"""ADMIRALTY UK Tidal API (UK Hydrographic Office): nearest station and its highs and lows.

Needs a free Discovery subscription key, read from ADMIRALTY_API_KEY or
~/.config/omarchy/coast/admiralty-key. Event times come back in UTC.
"""
import datetime as dt
import json
import math
import os
from pathlib import Path

BASE = "https://admiraltyapi.azure-api.net/uktidalapi/api/V1/"
KEY_PATH = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "omarchy" / "coast" / "admiralty-key"
# Beyond this a station's times no longer describe the chosen beach.
MAX_STATION_KM = 30


def api_key(path=KEY_PATH):
    key = os.environ.get("ADMIRALTY_API_KEY", "").strip()
    if key:
        return key
    try:
        return path.read_text().strip() or None
    except OSError:
        return None


def headers(key):
    return {"Ocp-Apim-Subscription-Key": key}


def distance_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    a = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


def parse_stations(raw):
    data = json.loads(raw)
    stations = []
    for feature in data.get("features", []) if isinstance(data, dict) else []:
        try:
            lon, lat = feature["geometry"]["coordinates"][:2]
            props = feature["properties"]
            stations.append({"id": str(props["Id"]), "name": str(props["Name"]),
                             "latitude": float(lat), "longitude": float(lon)})
        except (KeyError, TypeError, ValueError):
            continue
    if not stations:
        raise ValueError("No tidal stations returned")
    return stations


def nearest_station(stations, latitude, longitude, limit=MAX_STATION_KM):
    best, best_km = None, None
    for station in stations or []:
        km = distance_km(latitude, longitude, station["latitude"], station["longitude"])
        if best_km is None or km < best_km:
            best, best_km = station, km
    if best is None or best_km > limit:
        return None
    return dict(best, distance=round(best_km, 1))


def parse_events(raw):
    data = json.loads(raw)
    events = []
    for event in data if isinstance(data, list) else []:
        kind = {"HighWater": "high", "LowWater": "low"}.get(event.get("EventType"))
        height = event.get("Height")
        if not kind or not isinstance(event.get("DateTime"), str) or isinstance(height, bool) or not isinstance(height, (int, float)):
            continue
        stamp = dt.datetime.fromisoformat(event["DateTime"].replace("Z", "")).replace(tzinfo=dt.timezone.utc).timestamp()
        events.append({"time": stamp, "kind": kind, "height": round(height, 2)})
    if not events:
        raise ValueError("No tide events returned")
    return sorted(events, key=lambda e: e["time"])
