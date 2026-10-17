import json
from pathlib import Path
import tempfile
import unittest
from coast import build_report, source_urls
from location import load_location, DEFAULT_LOCATION
from temperatures import readings, wind_chill


class TemperatureTests(unittest.TestCase):
    def test_readings_are_plain_values(self):
        result = readings(17.1, 12.8, 9.6, 8.3)
        self.assertEqual((result['sea'], result['air'], result['feels']), (17.1, 12.8, 9.6))
        self.assertIsNone(result['windChill'])
        self.assertEqual(set(result), {'sea', 'air', 'feels', 'windChill'})

    def test_invalid_inputs_become_none(self):
        for invalid in (None, float('nan'), float('inf'), True, '17', 100):
            self.assertIsNone(readings(invalid, 20, 20, 5)['sea'])
        self.assertEqual(readings(0, 0, 0, 0)['sea'], 0)
        self.assertIsNone(readings(10, None, None, 20)['windChill'])

    def test_wind_chill_known_value_and_domain(self):
        # NWS chart rounds to -19 F; allow its half-degree F rounding.
        self.assertAlmostEqual(wind_chill(-32/1.8, 15), (-19-32)/1.8, delta=0.3)
        self.assertIsNone(wind_chill(10.1, 10))
        self.assertIsNone(wind_chill(10, 3))
        self.assertIsNotNone(wind_chill(10, 3.1))
        self.assertIsNone(wind_chill(None, 10))

    def test_stale_and_unknown_units_are_withheld(self):
        empty = {'data': None, 'fetched': None, 'error': None}
        weather = {'data': {'current': {'time': 10000, 'temperature_2m': 20, 'apparent_temperature': 19, 'wind_speed_10m': 5}, 'current_units': {'temperature_2m': '°C', 'apparent_temperature': '°C', 'wind_speed_10m': 'mp/h'}}, 'fetched': 10000, 'error': None}
        marine = {'data': {'current': {'time': 10000, 'sea_surface_temperature': 21}, 'current_units': {'sea_surface_temperature': '°C'}}, 'fetched': 10000, 'error': None}
        sources = [empty, weather, marine]
        self.assertEqual(build_report(sources, now=10000)['temperatures']['sea'], 21)
        self.assertIsNone(build_report(sources, now=18000)['temperatures']['sea'])
        marine['data']['current_units']['sea_surface_temperature'] = '°F'
        self.assertIsNone(build_report(sources, now=10000)['temperatures']['sea'])

    def test_location_isolation_and_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'location.json'
            self.assertEqual(load_location(path), DEFAULT_LOCATION)
            location = {'name': 'Sydney', 'latitude': -33.89, 'longitude': 151.28, 'timezone': 'Australia/Sydney', 'temperatureUnit': 'F'}
            path.write_text(json.dumps(location))
            loaded = load_location(path)
            self.assertNotIn('tideUrl', loaded)
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
