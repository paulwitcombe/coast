import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo
from unittest.mock import patch
from coast import SKIPPED, build_report, held_tides, no_tides, tide_source
from location import DEFAULT_LOCATION
import coast
import tides

STATIONS = json.dumps({"type": "FeatureCollection", "features": [
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-1.866666, 50.716666]},
     "properties": {"Id": "0037", "Name": "Bournemouth", "Country": "England"}},
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-1.95, 50.68]},
     "properties": {"Id": "0036", "Name": "Poole (Entrance)", "Country": "England"}},
    {"type": "Feature", "geometry": None, "properties": {"Id": "bad"}}]})


ZONE = ZoneInfo("Europe/London")


class TideTests(unittest.TestCase):
    def test_events_are_utc_and_shown_in_local_time(self):
        raw = json.dumps([
            {"EventType": "LowWater", "DateTime": "2026-10-17T19:27:00", "Height": 1.2535},
            {"EventType": "HighWater", "DateTime": "2026-12-17T12:00:00", "Height": 1.8},
            {"EventType": "Unknown", "DateTime": "2026-10-17T20:00:00", "Height": 1.0},
            {"EventType": "HighWater", "DateTime": "2026-10-17T23:14:00", "Height": True}])
        events = tides.parse_events(raw)
        self.assertEqual([e["kind"] for e in events], ["low", "high"])
        self.assertEqual(events[0]["height"], 1.25)
        # 19:27 UTC is 20:27 BST in October, and 12:00 UTC stays 12:00 GMT in December.
        self.assertEqual(dt.datetime.fromtimestamp(events[0]["time"], ZONE).strftime("%H:%M"), "20:27")
        self.assertEqual(dt.datetime.fromtimestamp(events[1]["time"], ZONE).strftime("%H:%M"), "12:00")
        with self.assertRaises(ValueError):
            tides.parse_events("[]")

    def test_nearest_station_within_limit(self):
        stations = tides.parse_stations(STATIONS)
        self.assertEqual(len(stations), 2)
        station = tides.nearest_station(stations, 50.716, -1.88)
        self.assertEqual((station["id"], station["name"], station["distance"]), ("0037", "Bournemouth", 0.9))
        self.assertIsNone(tides.nearest_station(stations, -33.87, 151.21))
        self.assertIsNone(tides.nearest_station([], 50.7, -1.9))
        with self.assertRaises(ValueError):
            tides.parse_stations('{"features": []}')

    def test_key_from_environment_or_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "admiralty-key"
            with patch.dict("os.environ", {"ADMIRALTY_API_KEY": ""}):
                self.assertIsNone(tides.api_key(path))
                path.write_text("abc123\n")
                self.assertEqual(tides.api_key(path), "abc123")
            with patch.dict("os.environ", {"ADMIRALTY_API_KEY": " env-key "}):
                self.assertEqual(tides.api_key(path), "env-key")

    def test_missing_key_and_distant_location_explain_why(self):
        with patch("tides.api_key", return_value=None):
            source, station = tide_source(DEFAULT_LOCATION)
        self.assertIsNone(station)
        self.assertIn("API key", source["note"])
        fake = lambda url, parser, headers=None: {"data": parser(STATIONS), "fetched": 0, "error": None}
        with patch("tides.api_key", return_value="k"), patch("coast.fetch_live", side_effect=fake):
            source, station = tide_source(dict(DEFAULT_LOCATION, latitude=-33.87, longitude=151.21))
        self.assertIsNone(station)
        self.assertIn("No UK tidal station", source["note"])

    def test_tides_are_never_written_to_disk(self):
        events = json.dumps([{"EventType": "HighWater", "DateTime": "2026-10-17T19:27:00", "Height": 1.8},
                             {"EventType": "LowWater", "DateTime": "2026-10-18T01:40:00", "Height": 0.6}])
        replies = {"Stations": STATIONS, "Stations/0037/TidalEvents?duration=7": events}
        def download(url, headers=None):
            self.assertEqual(headers, {"Ocp-Apim-Subscription-Key": "k"})
            return replies[url.replace(tides.BASE, "")]
        with tempfile.TemporaryDirectory() as folder, patch("coast.CACHE", Path(folder)), \
                patch("tides.api_key", return_value="k"), patch("coast.download", side_effect=download):
            source, station = tide_source(DEFAULT_LOCATION)
            self.assertEqual(list(Path(folder).iterdir()), [])
        self.assertEqual((station["id"], len(source["data"])), ("0037", 2))

    def test_quota_exceeded_reads_as_temporarily_unavailable(self):
        def download(url, headers=None):
            if url.endswith("Stations"):
                return STATIONS
            raise urllib.error.HTTPError(url, 403, "Quota Exceeded", {}, None)
        with patch("tides.api_key", return_value="k"), patch("coast.download", side_effect=download):
            source, station = tide_source(DEFAULT_LOCATION)
        self.assertIsNone(station)
        self.assertEqual(source["note"], "Tide data temporarily unavailable")
        empty = {"data": None, "fetched": None, "error": None}
        self.assertEqual(build_report([source, empty, empty], now=0)["warnings"].count("Tide data temporarily unavailable"), 1)

    def test_key_never_follows_redirects(self):
        request = urllib.request.Request(tides.BASE + "Stations", headers={"Ocp-Apim-Subscription-Key": "k"})
        self.assertIsNone(coast.NoRedirect().redirect_request(request, None, 302, "Found", {}, "http://elsewhere.invalid/"))
        with patch("urllib.request.build_opener") as build:
            build.return_value.open.return_value.__enter__.return_value.read.return_value = b"[]"
            coast.download(tides.BASE + "Stations", {"Ocp-Apim-Subscription-Key": "k"})
            self.assertEqual(build.call_args.args, (coast.NoRedirect,))
            build.return_value.open.return_value.__enter__.return_value.read.return_value = b"x" * (coast.MAX_BYTES + 1)
            with self.assertRaises(ValueError):
                coast.download(tides.BASE + "Stations")
        with self.assertRaises(ValueError):
            coast.download("http://admiraltyapi.azure-api.net/", {"Ocp-Apim-Subscription-Key": "k"})

    def test_open_panel_hands_back_held_events(self):
        events = [{"time": 3600, "kind": "high", "height": 1.8}, {"time": 7200, "kind": "low", "height": 1.2}]
        station = {"id": "0037", "name": "Bournemouth", "distance": 0.9}
        empty = {"data": None, "fetched": None, "error": None}
        first = build_report([{"data": events, "fetched": 5, "error": None}, empty, empty], now=0, station=station)
        source, held_station = held_tides(json.dumps(first["tideHold"]))
        later = build_report([source, empty, empty], now=3000, station=held_station)
        self.assertEqual(later["nextTide"]["due"], "in 10m")
        self.assertEqual((later["tideStation"], later["fetched"]["tides"]), (station, first["fetched"]["tides"]))
        with self.assertRaises(ValueError):
            held_tides('{"events": [], "fetched": 5}')

    def test_closed_panel_skips_tides_quietly(self):
        empty = {"data": None, "fetched": None, "error": None}
        report = build_report([SKIPPED, empty, empty], now=0)
        self.assertIsNone(report["nextTide"])
        self.assertIsNone(report["tideHold"])
        self.assertFalse([w for w in report["warnings"] if "ide" in w])

    def test_report_carries_station_and_note(self):
        empty = {"data": None, "fetched": None, "error": None}
        note = no_tides("Tide times need a free ADMIRALTY API key (see README)")
        report = build_report([note, empty, empty], now=0)
        self.assertEqual(report["tideNote"], note["note"])
        self.assertIn(note["note"], report["warnings"])
        self.assertNotIn("Tides: cached / unavailable", report["warnings"])
        events = [{"time": 3600, "kind": "high", "height": 1.8}, {"time": 7200, "kind": "low", "height": 1.2}]
        station = {"id": "0037", "name": "Bournemouth", "distance": 0.9}
        report = build_report([{"data": events, "fetched": 0, "error": None}, empty, empty], now=0, station=station)
        self.assertEqual(report["tideStation"]["name"], "Bournemouth")
        self.assertIsNone(report["tideNote"])


if __name__ == "__main__":
    unittest.main()
