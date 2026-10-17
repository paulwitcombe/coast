import json
from pathlib import Path
import tempfile
import unittest
from coast import build_report, source_urls
from location import load_location, DEFAULT_LOCATION
from swim import assess, wind_chill


class SwimTests(unittest.TestCase):
    def test_warm_air_never_offsets_cold_sea(self):
        for sea in (-1, 10, 14.9, 15):
            self.assertEqual(assess(sea, 30, 32, 5)['level'], 'cold')
        self.assertEqual(assess(15.1, 30, 32, 5)['level'], 'caution')
        self.assertEqual(assess(20, 20, 20, 5)['level'], 'neutral')

    def test_air_and_feels_like_independently_warn(self):
        self.assertEqual(assess(24, 14, 18, 5)['level'], 'caution')
        self.assertEqual(assess(24, 18, 14, 10)['level'], 'caution')

    def test_missing_invalid_and_zero_inputs(self):
        for invalid in (None, float('nan'), float('inf'), True, '17', 100):
            result = assess(invalid, 20, 20, 5)
            self.assertEqual(result['level'], 'unknown')
            self.assertFalse(result['complete'])
        self.assertTrue(assess(0, 0, 0, 0)['complete'])
        result = assess(10, None, None, None)
        self.assertEqual(result['level'], 'cold')
        self.assertFalse(result['complete'])
        self.assertEqual(assess(20, 20, None, 5)['level'], 'unknown')

    def test_wind_chill_known_value_and_domain(self):
        # NWS chart rounds to -19 F; allow its half-degree F rounding.
        self.assertAlmostEqual(wind_chill(-32/1.8, 15), (-19-32)/1.8, delta=0.3)
        self.assertIsNone(wind_chill(10.1, 10))
        self.assertIsNone(wind_chill(10, 3))
        self.assertIsNotNone(wind_chill(10, 3.1))
        self.assertIsNone(wind_chill(None, 10))

    def test_stale_and_unknown_units_cannot_produce_complete_assessment(self):
        empty = {'data': None, 'fetched': None, 'error': None}
        weather = {'data': {'current': {'time': 10000, 'temperature_2m': 20, 'apparent_temperature': 19, 'wind_speed_10m': 5}, 'current_units': {'temperature_2m': '°C', 'apparent_temperature': '°C', 'wind_speed_10m': 'mp/h'}}, 'fetched': 10000, 'error': None}
        marine = {'data': {'current': {'time': 10000, 'sea_surface_temperature': 21}, 'current_units': {'sea_surface_temperature': '°C'}}, 'fetched': 10000, 'error': None}
        sources = [empty, weather, marine]
        self.assertTrue(build_report(sources, now=10000)['swim']['complete'])
        self.assertFalse(build_report(sources, now=18000)['swim']['complete'])
        marine['data']['current_units']['sea_surface_temperature'] = '°F'
        self.assertEqual(build_report(sources, now=10000)['swim']['level'], 'unknown')

    def test_location_isolation_and_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'location.json'
            self.assertEqual(load_location(path), DEFAULT_LOCATION)
            location = {'name': 'Sydney', 'latitude': -33.89, 'longitude': 151.28, 'timezone': 'Australia/Sydney', 'temperatureUnit': 'F'}
            path.write_text(json.dumps(location))
            loaded = load_location(path)
            self.assertIsNone(loaded['tideUrl'])
            self.assertEqual(loaded['marineLatitude'], -33.89)
            self.assertNotEqual(source_urls(loaded), source_urls(DEFAULT_LOCATION))
            empty = {'data': None, 'fetched': None, 'error': None}
            report = build_report([empty]*3, now=0, location=loaded)
            self.assertEqual(report['updated'], '10:00')
            location['latitude'] = 91
            path.write_text(json.dumps(location))
            with self.assertRaises(ValueError):
                load_location(path)


if __name__ == '__main__':
    unittest.main()
