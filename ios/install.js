// Installs or updates Coast in Scriptable. Paste into a new Scriptable script and run it.
// Downloads ios/Coast.js from github.com/paulwitcombe/coast and saves it as the "Coast" script.
// It asks GitHub for the latest commit first and downloads that exact version, because the
// plain download link is cached for a few minutes and could hand back an older copy.
const repo = "paulwitcombe/coast"
const latest = new Request("https://api.github.com/repos/" + repo + "/commits/main")
latest.headers = {"Accept": "application/vnd.github+json"}
const commit = await latest.loadJSON()
if (!/^[0-9a-f]{40}$/.test(commit.sha || "")) throw new Error("Could not find the latest version")
const request = new Request("https://raw.githubusercontent.com/" + repo + "/" + commit.sha + "/ios/Coast.js")
const code = await request.loadString()
if (request.response.statusCode !== 200 || !code.includes("Coast for iOS (Scriptable)")) throw new Error("Download failed")
let fm = FileManager.iCloud()
try { fm.documentsDirectory() } catch (e) { fm = FileManager.local() }
fm.writeString(fm.joinPath(fm.documentsDirectory(), "Coast.js"), code)
const alert = new Alert()
alert.title = "Coast installed"
alert.message = "Version " + commit.sha.slice(0, 7) + " (" + commit.commit.committer.date.slice(0, 10) + "): " +
  commit.commit.message.split("\n")[0] + "\n\nOpen the Coast script to add your ADMIRALTY key, then add a Scriptable widget and choose Coast."
alert.addAction("OK")
await alert.present()
