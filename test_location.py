import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from location import DEFAULT_LOCATION, country_abbreviation, country_for_timezone, saved_locations, select_location, search_results, validate_location, load_location, toggle_favourite
from coast import build_report, grid_distance

SYDNEY = {'name': 'Sydney', 'latitude': -33.86785, 'longitude': 151.20732, 'timezone': 'Australia/Sydney', 'detail': 'New South Wales · Australia'}

class LocationTests(unittest.TestCase):
    def test_favourites_persist_independently_of_recents(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'locations.json'
            state = toggle_favourite(SYDNEY, path)
            self.assertEqual([x['name'] for x in state['favourites']], ['Bournemouth', 'Sydney'])
            for i in range(10):
                state = select_location(dict(SYDNEY, name='Place '+str(i)), path)
            self.assertEqual([x['name'] for x in saved_locations(path)['favourites']], ['Bournemouth', 'Sydney'])
            active = state['active']
            state = toggle_favourite(SYDNEY, path)
            self.assertEqual(state['active'], active)
            self.assertEqual([x['name'] for x in state['favourites']], ['Bournemouth'])
            state = toggle_favourite(DEFAULT_LOCATION, path)
            self.assertEqual(saved_locations(path)['favourites'], [])

    def test_old_state_migrates_without_losing_locations(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'locations.json'
            path.write_text(json.dumps({'active': DEFAULT_LOCATION, 'saved': [DEFAULT_LOCATION, validate_location(SYDNEY)]}))
            state = saved_locations(path)
            self.assertEqual(len(state['saved']), 2)
            self.assertEqual(state['favourites'], [DEFAULT_LOCATION])
            select_location(SYDNEY, path)
            self.assertEqual(saved_locations(path)['favourites'], [DEFAULT_LOCATION])

    def test_persistence_units_and_deduplication(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'locations.json'
            state = select_location(dict(SYDNEY, temperatureUnit='F'), path)
            self.assertEqual(saved_locations(path), state)
            with patch('location.STATE_PATH', path):
                self.assertEqual(load_location()['name'], 'Sydney')
            self.assertEqual(state['active']['temperatureUnit'], 'F')
            self.assertIsNone(state['active']['tideUrl'])
            state = select_location(dict(SYDNEY, temperatureUnit='C'), path)
            self.assertEqual(len(state['saved']), 2)
            self.assertEqual(state['saved'][0]['temperatureUnit'], 'C')
            state = select_location(DEFAULT_LOCATION, path)
            self.assertEqual(state['active']['tideUrl'], DEFAULT_LOCATION['tideUrl'])
            self.assertEqual(len(state['saved']), 2)

    def test_recent_limit_keeps_home(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'locations.json'
            for i in range(12):
                state = select_location(dict(SYDNEY, name='Coast '+str(i)), path)
            self.assertEqual(len(state['saved']), 8)
            self.assertEqual(state['saved'][-1]['name'], 'Bournemouth')

    def test_invalid_selection_does_not_replace_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'locations.json'
            select_location(DEFAULT_LOCATION, path)
            before = path.read_text()
            with self.assertRaises(ValueError):
                select_location(dict(SYDNEY, longitude=190), path)
            self.assertEqual(path.read_text(), before)

    def test_search_ambiguous_locations_and_missing_timezone(self):
        data = {'results': [dict(SYDNEY, admin1='NSW', country='Australia'), dict(SYDNEY, name='Sydney', country='Canada', latitude=46.1, longitude=-60.2, timezone='America/Halifax'), {'name':'Incomplete'}]}
        results = search_results(data)
        self.assertEqual(len(results),2)
        self.assertNotEqual(results[0]['detail'], results[1]['detail'])
        self.assertNotEqual(results[0]['timezone'], results[1]['timezone'])
        self.assertTrue(all(x['tideUrl'] is None for x in results))

    def test_bournemouth_search_restores_supported_tides(self):
        result = search_results({'results': [DEFAULT_LOCATION]})[0]
        self.assertEqual(result, DEFAULT_LOCATION)

    def test_distant_marine_grid_hidden(self):
        location = validate_location(SYDNEY)
        self.assertGreater(grid_distance(location, {'latitude': 0, 'longitude':0}),30)
        empty = {'data': None, 'fetched': None, 'error': None}
        marine = {'data': {'latitude':0, 'longitude':0, 'current': {'time':10000,'sea_surface_temperature':25,'ocean_current_velocity':1,'ocean_current_direction':90}, 'current_units': {'sea_surface_temperature':'°C', 'ocean_current_velocity':'km/h'}}, 'fetched':10000, 'error':None}
        report = build_report([empty,empty,marine],now=10000,location=location)
        self.assertIsNone(report['marine']['temperature'])
        self.assertIsNone(report['marine']['direction'])
        self.assertFalse(report['swim']['complete'])
        self.assertTrue(any('No nearby marine' in w for w in report['warnings']))

    def test_country_abbreviations(self):
        self.assertEqual(country_abbreviation('gb'), 'UK')
        self.assertEqual(country_abbreviation('AU'), 'AU')
        self.assertEqual(country_for_timezone('Europe/London'), 'UK')
        self.assertEqual(country_for_timezone('Australia/Sydney'), 'AU')
        self.assertEqual(country_for_timezone('Not/AZone'), '')
        self.assertEqual(validate_location(SYDNEY)['country'], 'AU')
        result = search_results({'results': [dict(SYDNEY, admin1='New South Wales', country='Australia', country_code='AU')]})[0]
        self.assertEqual((result['detail'], result['country']), ('New South Wales', 'AU'))
        self.assertEqual(validate_location(dict(SYDNEY, country='NZ'))['country'], 'NZ')

if __name__ == '__main__': unittest.main()
