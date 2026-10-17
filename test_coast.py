import datetime as dt
import unittest
from location import DEFAULT_LOCATION
from coast import ZONE, bearing, knots, parse_tides, parse_model, build_report, conditions, countdown, tide_curve

class CoastTests(unittest.TestCase):
    def test_bearings_and_units(self):
        self.assertEqual([bearing(x) for x in (0, 90, 180, 270, 360)], ["N", "E", "S", "W", "N"])
        self.assertEqual(bearing(None), "—")
        self.assertEqual(knots(1.852, "km/h"), 1.0)
        self.assertIsNone(knots(None, "km/h"))
        self.assertIsNone(knots(1, "unknown"))

    def test_tide_dates_and_bst(self):
        for day, offset in (("2026-09-19", 1), ("2026-12-19", 0)):
            page = '<div id="overview-container-' + day + '"><div class="tide-event"><p>high tide</p><p>12:37pm</p><p>1.7 metres</p></div><div class="tide-event"><p>low tide</p><p>10pm</p><p>1.4 metres</p></div></div>'
            events = parse_tides(page)
            self.assertEqual(len(events), 2)
            utc = dt.datetime.fromtimestamp(events[0]["time"], dt.timezone.utc)
            self.assertEqual(utc.hour, 12 - offset)
            self.assertEqual(dt.datetime.fromtimestamp(events[1]["time"], ZONE).hour, 22)
        with self.assertRaises(ValueError): parse_tides("changed page")

    def test_expired_direction_is_hidden(self):
        unavailable = {"data": None, "error": "offline", "fetched": None}
        expired = {"data": {"current": {"time": 1000, "ocean_current_direction": 90, "ocean_current_velocity": 1}, "current_units": {"ocean_current_velocity": "km/h"}}, "fetched": 1000, "error": "offline"}
        report = build_report([unavailable, unavailable, expired], now=10000)
        self.assertIsNone(report["marine"]["direction"])
        self.assertTrue(report["warnings"])

    def test_bad_model_rejected(self):
        with self.assertRaises(ValueError): parse_model('{"error":true}')
        with self.assertRaises(ValueError): parse_model('{"current":{"time":100},"hourly":{"time":[100]}}')

    def test_mainly_clear_label(self):
        self.assertEqual(conditions(1), "Mainly clear")
        self.assertEqual(conditions(2), "Partly cloudy")

    def test_tide_summary_and_curve(self):
        events = [{"time": 0, "kind": "low", "height": 1.0}, {"time": 21600, "kind": "high", "height": 2.0},
                  {"time": 43200, "kind": "low", "height": 1.2}, {"time": 64800, "kind": "high", "height": 1.8},
                  {"time": 86400, "kind": "low", "height": 1.1}]
        curve = tide_curve(events, now=21600)
        self.assertEqual(curve["now"], 0.25)
        self.assertEqual(curve["points"][0], [0.0, 1.0])
        self.assertEqual([p for p in curve["points"] if p[0] == 0.25][0][1], 2.0)
        self.assertEqual((curve["low"], curve["high"]), (1.0, 2.0))
        self.assertEqual([e["kind"] for e in curve["events"]], ["low", "high", "low", "high", "low"])
        # Before the first event there is nothing to interpolate.
        self.assertEqual(tide_curve(events, now=10800)["points"][0][0], 0.125)
        self.assertIsNone(tide_curve(events[:1], now=0))
        self.assertEqual(countdown(6 * 3600 + 20 * 60), "in 6h 20m")
        self.assertEqual(countdown(45 * 60), "in 45m")
        self.assertEqual(countdown(2 * 3600), "in 2h")
        self.assertEqual(countdown(0), "in 0m")
        empty = {"data": None, "fetched": None, "error": None}
        tides = {"data": events, "fetched": 0, "error": None}
        report = build_report([tides, empty, empty], now=30000, location=dict(DEFAULT_LOCATION, timezone="UTC"))
        self.assertEqual(report["nextTide"]["kind"], "low")
        self.assertEqual(report["nextTide"]["due"], "in 3h 40m")
        self.assertEqual(report["followingTide"]["kind"], "high")
        self.assertIsNotNone(report["tideCurve"])

if __name__ == "__main__": unittest.main()
