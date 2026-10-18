// Installs or updates Coast in Scriptable. Paste into a NEW Scriptable script named "Install Coast" and run it
// from the script list (tap its tile), not from inside Coast's editor: an open editor runs
// and can save back the old code.
// Downloads ios/Coast.js from github.com/paulwitcombe/coast and saves it as the "Coast" script.
const repo = "paulwitcombe/coast"

async function tell(title, message) {
  const alert = new Alert()
  alert.title = title
  alert.message = message
  alert.addAction("OK")
  await alert.present()
}

async function download() {
  // The latest commit's exact file: the plain link is cached for a few minutes.
  try {
    const latest = new Request("https://api.github.com/repos/" + repo + "/commits/main")
    latest.headers = {"Accept": "application/vnd.github+json"}
    const commit = await latest.loadJSON()
    if (/^[0-9a-f]{40}$/.test(commit.sha || "")) {
      const request = new Request("https://raw.githubusercontent.com/" + repo + "/" + commit.sha + "/ios/Coast.js")
      const code = await request.loadString()
      if (request.response.statusCode === 200) return {code, version: commit.sha.slice(0, 7), note: commit.commit.message.split("\n")[0]}
    }
  } catch (e) {}
  // GitHub's API can refuse (it limits requests per network), so fall back to a fresh copy of main.
  const request = new Request("https://raw.githubusercontent.com/" + repo + "/main/ios/Coast.js?fresh=" + Date.now())
  const code = await request.loadString()
  if (request.response.statusCode !== 200) throw new Error("GitHub answered " + request.response.statusCode)
  return {code, version: "main " + new Date().toISOString().slice(0, 16).replace("T", " "), note: "latest on main"}
}

try {
  // Saved as "Coast", the installer would overwrite itself and the editor would save it back.
  if (Script.name().toLowerCase() === "coast") throw new Error("This installer is saved as \"Coast\". Rename it to \"Install Coast\" (Script Settings → Name), go back to the script list and run it from its tile.")
  const {code, version, note} = await download()
  if (!code.includes("Coast for iOS (Scriptable)") || !code.includes('const VERSION = "dev"')) throw new Error("The download wasn't the Coast script")
  // Save beside this installer: that is the folder Scriptable lists, whether it keeps
  // scripts in iCloud Drive or on the phone.
  const here = module.filename
  const fm = here.includes("/Mobile Documents/") ? FileManager.iCloud() : FileManager.local()
  const path = fm.joinPath(here.slice(0, here.lastIndexOf("/")), "Coast.js")
  fm.writeString(path, code.replace('const VERSION = "dev"', 'const VERSION = "' + version + '"'))
  if (!fm.readString(path).includes('const VERSION = "' + version + '"')) throw new Error("Saved, but reading it back gave a different file")
  await tell("Coast installed", "Version " + version + ": " + note +
    "\n\nThe bottom of the Coast panel shows this version. Run Coast from its tile in the script list (if it isn't there yet, close and reopen Scriptable). Widgets redraw on their next refresh, within the hour.")
} catch (e) {
  await tell("Coast update failed", String(e && e.message || e) + "\n\nCheck your connection and run the installer again.")
}
