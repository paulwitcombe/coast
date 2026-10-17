"""Explicit location settings; no silently inherited Bournemouth tide source."""
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import urllib.request
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

DEFAULT_LOCATION = {"name": "Bournemouth", "detail": "BH2 5HA · Pier & bay",
                    "latitude": 50.716, "longitude": -1.88,
                    "marineLatitude": 50.70, "marineLongitude": -1.88,
                    "timezone": "Europe/London", "country": "UK", "temperatureUnit": "C",
                    "tideUrl": "https://weather.metoffice.gov.uk/forecast/gcn8t2d23"}


def country_abbreviation(code):
    """Short display form of an ISO 3166 code; the UK is written UK rather than GB."""
    code = str(code or "").strip().upper()
    return "UK" if code == "GB" else code


def country_for_timezone(timezone, table="/usr/share/zoneinfo/zone.tab"):
    """Fallback for locations saved without a country: tzdata maps each zone to one country."""
    try:
        with open(table, encoding="utf-8") as f:
            for line in f:
                fields = line.split("\t")
                if len(fields) >= 3 and not line.startswith("#") and fields[2].strip() == timezone:
                    return country_abbreviation(fields[0])
    except OSError:
        pass
    return ""


STATE_PATH = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "omarchy" / "coast" / "locations.json"


def validate_location(settings):
    if not isinstance(settings, dict):
        raise ValueError("Location must be an object")
    settings = dict(settings)
    for key in ("name", "timezone"):
        if not isinstance(settings.get(key), str) or not settings[key].strip():
            raise ValueError("Location requires " + key)
    for key, limit in (("latitude", 90), ("longitude", 180), ("marineLatitude", 90), ("marineLongitude", 180)):
        if key.startswith("marine") and key not in settings:
            settings[key] = settings.get(key[6:].lower())
        value = settings.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > limit:
            raise ValueError("Invalid location " + key)
    ZoneInfo(settings["timezone"])
    settings.setdefault("temperatureUnit", "C")
    if settings["temperatureUnit"] not in ("C", "F"):
        raise ValueError("temperatureUnit must be C or F")
    settings.setdefault("detail", "Coastal conditions")
    settings.setdefault("tideUrl", None)
    if not settings.get("country"):
        settings["country"] = country_for_timezone(settings["timezone"])
    if settings["tideUrl"] and not str(settings["tideUrl"]).startswith("https://weather.metoffice.gov.uk/forecast/"):
        raise ValueError("Only Met Office tide pages are currently supported")
    return settings


def load_location(path=None):
    if path is None and STATE_PATH.exists():
        return validate_location(json.loads(STATE_PATH.read_text())["active"])
    path = Path(path) if path else Path(__file__).with_name("location.json")
    return validate_location(json.loads(path.read_text())) if path.exists() else dict(DEFAULT_LOCATION)


def location_key(location):
    return (location["name"], location["latitude"], location["longitude"])


def saved_locations(path=STATE_PATH):
    if path.exists():
        state = json.loads(path.read_text())
        return {"active": validate_location(state["active"]),
                "saved": [validate_location(value) for value in state["saved"]],
                "favourites": [validate_location(value) for value in state.get("favourites", [state["active"]])]}
    active = load_location() if path == STATE_PATH else dict(DEFAULT_LOCATION)
    return {"active": active, "saved": [active] if location_key(active) == location_key(DEFAULT_LOCATION) else [active, dict(DEFAULT_LOCATION)], "favourites": [active]}


def select_location(location, path=STATE_PATH):
    location = validate_location(location)
    state = saved_locations(path)
    recent = [location] + [item for item in state["saved"] if location_key(item) != location_key(location)]
    # Keep Bournemouth available even after several searches.
    home = dict(DEFAULT_LOCATION, temperatureUnit=location["temperatureUnit"])
    recent = [item for item in recent if location_key(item) != location_key(home)]
    recent = ([location] + recent) if location_key(location) == location_key(home) else recent
    if location_key(location) != location_key(home):
        recent = recent[:7] + [home]
    else:
        recent = recent[:8]
    state = {"active": location, "saved": recent, "favourites": state["favourites"]}
    return write_state(state, path)


def toggle_favourite(location, path=STATE_PATH):
    location = validate_location(location)
    state = saved_locations(path)
    existing = state["favourites"]
    if any(location_key(item) == location_key(location) for item in existing):
        state["favourites"] = [item for item in existing if location_key(item) != location_key(location)]
    else:
        state["favourites"] = existing + [location]
    return write_state(state, path)


def write_state(state, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as f:
            temporary = f.name
            json.dump(state, f, ensure_ascii=False, allow_nan=False, indent=2)
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return state


def search_results(data):
    results = []
    for item in data.get("results", []):
        try:
            location = validate_location({"name": item.get("name"), "latitude": item.get("latitude"),
                "longitude": item.get("longitude"), "timezone": item.get("timezone"),
                "detail": str(item.get("admin1") or item.get("country") or "Coastal conditions"),
                "country": country_abbreviation(item.get("country_code"))})
        except (ValueError, TypeError, KeyError):
            continue
        if location["name"].lower() == "bournemouth" and abs(location["latitude"] - DEFAULT_LOCATION["latitude"]) < 0.05 and abs(location["longitude"] - DEFAULT_LOCATION["longitude"]) < 0.05:
            location = dict(DEFAULT_LOCATION)
        results.append(location)
    return results


def search(query):
    query = query.strip()
    if len(query) < 2:
        raise ValueError("Enter at least two characters")
    url = "https://geocoding-api.open-meteo.com/v1/search?" + urlencode({"name": query, "count": 8, "language": "en", "format": "json"})
    request = urllib.request.Request(url, headers={"User-Agent": "Coast/1.1 (desktop widget)"})
    with urllib.request.urlopen(request, timeout=12) as response:
        data = json.load(response)
    if data.get("error"):
        raise ValueError(data.get("reason", "Search unavailable"))
    return {"results": search_results(data), "query": query}


def main():
    try:
        action = sys.argv[1] if len(sys.argv) > 1 else "list"
        if action == "search":
            result = search(sys.argv[2])
        elif action == "select":
            result = select_location(json.loads(sys.argv[2]))
        elif action == "favourite":
            result = toggle_favourite(json.loads(sys.argv[2]))
        elif action == "list":
            result = saved_locations()
        else:
            raise ValueError("Unknown location action")
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
