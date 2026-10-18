// Installs or updates Coast in Scriptable. Paste into a new Scriptable script and run it.
// Downloads ios/Coast.js from github.com/paulwitcombe/coast and saves it as the "Coast" script.
const url = "https://raw.githubusercontent.com/paulwitcombe/coast/main/ios/Coast.js"
const request = new Request(url)
const code = await request.loadString()
if (request.response.statusCode !== 200 || !code.includes("Coast for iOS (Scriptable)")) throw new Error("Download failed")
let fm = FileManager.iCloud()
try { fm.documentsDirectory() } catch (e) { fm = FileManager.local() }
fm.writeString(fm.joinPath(fm.documentsDirectory(), "Coast.js"), code)
const alert = new Alert()
alert.title = "Coast installed"
alert.message = "Open the Coast script to add your ADMIRALTY key, then add a Scriptable widget and choose Coast."
alert.addAction("OK")
await alert.present()
