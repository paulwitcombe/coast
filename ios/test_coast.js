// Run with: node --test ios/
const test = require("node:test")
const assert = require("node:assert")
const coast = require("./Coast.js")

const STATIONS = {type: "FeatureCollection", features: [
  {type: "Feature", geometry: {type: "Point", coordinates: [-1.866666, 50.716666]}, properties: {Id: "0037", Name: "Bournemouth"}},
  {type: "Feature", geometry: {type: "Point", coordinates: [-1.95, 50.68]}, properties: {Id: "0036", Name: "Poole (Entrance)"}},
  {type: "Feature", geometry: null, properties: {Id: "bad"}}]}
const empty = {data: null, fetched: null, error: null}

test("events are UTC and shown in local time", () => {
  const events = coast.parseEvents([
    {EventType: "LowWater", DateTime: "2026-10-17T19:27:00", Height: 1.2535},
    {EventType: "HighWater", DateTime: "2026-12-17T12:00:00", Height: 1.8},
    {EventType: "Unknown", DateTime: "2026-10-17T20:00:00", Height: 1.0},
    {EventType: "HighWater", DateTime: "2026-10-17T23:14:00", Height: true}])
  assert.deepStrictEqual(events.map(e => e.kind), ["low", "high"])
  assert.strictEqual(events[0].height, 1.25)
  assert.strictEqual(coast.clock(events[0].time, "Europe/London"), "20:27")
  assert.strictEqual(coast.clock(events[1].time, "Europe/London"), "12:00")
  assert.throws(() => coast.parseEvents([]))
})

test("nearest station within limit", () => {
  const stations = coast.parseStations(STATIONS)
  assert.strictEqual(stations.length, 2)
  const station = coast.nearestStation(stations, 50.716, -1.88)
  assert.deepStrictEqual([station.id, station.name, station.distance], ["0037", "Bournemouth", 0.9])
  assert.strictEqual(coast.nearestStation(stations, -33.87, 151.21), null)
  assert.throws(() => coast.parseStations({features: []}))
})

test("readings match the plugin", () => {
  assert.deepStrictEqual([0, 90, 180, 270, 360].map(coast.bearing), ["N", "E", "S", "W", "N"])
  assert.strictEqual(coast.knots(1.852, "km/h"), 1)
  assert.strictEqual(coast.knots(1, "unknown"), null)
  assert.strictEqual(coast.conditions(1), "Mainly clear")
  assert.strictEqual(coast.countdown(6 * 3600 + 20 * 60), "in 6h 20m")
  assert.strictEqual(coast.countdown(2 * 3600), "in 2h")
  assert.strictEqual(coast.countdown(45 * 60), "in 45m")
  assert.ok(Math.abs(coast.windChill(-32 / 1.8, 15) - (-19 - 32) / 1.8) <= 0.3)
  assert.strictEqual(coast.windChill(10.1, 10), null)
  assert.strictEqual(coast.readings(100, 20, 20, 5).sea, null)
})

test("tide curve and summary", () => {
  const events = [{time: 0, kind: "low", height: 1.0}, {time: 21600, kind: "high", height: 2.0},
    {time: 43200, kind: "low", height: 1.2}, {time: 64800, kind: "high", height: 1.8}, {time: 86400, kind: "low", height: 1.1}]
  const curve = coast.tideCurve(events, 21600)
  assert.strictEqual(curve.now, 0.25)
  assert.deepStrictEqual(curve.points[0], [0, 1])
  assert.strictEqual(curve.points.find(p => p[0] === 0.25)[1], 2)
  assert.strictEqual(coast.tideCurve(events, 10800).points[0][0], 0.125)
  const report = coast.buildReport([{data: events, fetched: 0, error: null}, empty, empty], 30000, Object.assign({}, coast.DEFAULT_LOCATION, {timezone: "UTC"}), null)
  assert.strictEqual(report.nextTide.kind, "low")
  assert.strictEqual(report.nextTide.due, "in 3h 40m")
  assert.strictEqual(report.followingTide.kind, "high")
})

test("no key, no station and quota exceeded explain themselves", async () => {
  const replies = {"Stations": STATIONS}
  const getJSON = async (url, headers) => {
    const path = url.replace(/^https:\/\/admiraltyapi\.azure-api\.net\/uktidalapi\/api\/V1\//, "")
    if (path in replies) return replies[path]
    if (path.startsWith("Stations/")) throw new Error("HTTP 403")
    return {current: {time: Date.now() / 1000}}
  }
  let report = await coast.loadReport(coast.DEFAULT_LOCATION, null, getJSON)
  assert.match(report.tideNote, /API key/)
  report = await coast.loadReport(Object.assign({}, coast.DEFAULT_LOCATION, {latitude: -33.87, longitude: 151.21}), "k", getJSON)
  assert.match(report.tideNote, /No UK tidal station/)
  report = await coast.loadReport(coast.DEFAULT_LOCATION, "k", getJSON)
  assert.strictEqual(report.tideNote, coast.UNAVAILABLE)
  assert.strictEqual(report.warnings.filter(w => w === coast.UNAVAILABLE).length, 1)
})

test("the key only goes to ADMIRALTY", async () => {
  const seen = []
  const getJSON = async (url, headers) => { seen.push([url, headers]); throw new Error("offline") }
  await coast.loadReport(coast.DEFAULT_LOCATION, "secret", getJSON)
  for (const [url, headers] of seen) {
    if (headers) assert.ok(url.startsWith("https://admiraltyapi.azure-api.net/"), url)
    else assert.ok(url.startsWith("https://") && url.includes("open-meteo.com"), url)
  }
})

test("panel escapes text from the APIs", () => {
  const location = Object.assign({}, coast.DEFAULT_LOCATION, {name: "<img src=x onerror=alert(1)>", detail: "\"quoted\""})
  const report = coast.buildReport([empty, empty, empty], 0, location, null)
  const html = coast.panelHTML(report, {active: location, favourites: [], recents: []}, coast.THEME)
  assert.ok(!html.includes("<img src=x"))
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"))
  assert.strictEqual(coast.searchLocation({name: "Bournemouth", latitude: 50.72, longitude: -1.88, timezone: "Europe/London"}).detail, coast.DEFAULT_LOCATION.detail)
  assert.strictEqual(coast.searchLocation({name: "Nowhere"}), null)
})
