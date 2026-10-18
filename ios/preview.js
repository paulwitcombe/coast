// Development preview of the full panel with live data, outside Scriptable.
// Usage: node ios/preview.js > /tmp/coast.html   (uses ADMIRALTY_API_KEY or the plugin's key file)
const fs = require("fs"), os = require("os"), path = require("path")
const coast = require("./Coast.js")

const keyFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "omarchy", "coast", "admiralty-key")
let key = (process.env.ADMIRALTY_API_KEY || "").trim()
try { key = key || fs.readFileSync(keyFile, "utf8").trim() } catch (e) {}

async function getJSON(url, headers) {
  const res = await fetch(url, {headers: Object.assign({"User-Agent": "Coast/1.1 (preview)"}, headers || {}), redirect: headers ? "error" : "follow"})
  if (res.status !== 200) throw new Error("HTTP " + res.status)
  return res.json()
}

coast.loadReport(coast.DEFAULT_LOCATION, key || null, getJSON).then(report => {
  const state = {active: coast.DEFAULT_LOCATION, favourites: [coast.DEFAULT_LOCATION], recents: []}
  process.stdout.write(coast.panelHTML(report, state, coast.THEME))
})
