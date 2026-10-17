import QtQuick
import QtQuick.Shapes
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

Panel {
    id: root
    moduleName: "pdog.coast"
    ipcTarget: "pdog.coast"
    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight
    property var report: ({})
    property string failure: ""
    property bool choosingLocation: false
    property var savedLocations: []
    property var favouriteLocations: []
    property bool favouritesOpen: false
    function isFavourite(choice) {
        return favouriteLocations.some(function(item) { return item.name === choice.name && item.latitude === choice.latitude && item.longitude === choice.longitude })
    }
    // -B: never write __pycache__ under plugins/, which would trigger a shell reload.
    function python(script, args) {
        return ["python3", "-B", decodeURIComponent(Qt.resolvedUrl(script).toString().replace("file://", ""))].concat(args || [])
    }
    function runLocation(action, args) {
        locationAction = action
        locationWorker.command = python("location.py", [action].concat(args || []))
        locationWorker.running = true
    }
    function loadLocations() {
        if (locationWorker.running) return
        runLocation("list")
    }
    function toggleFavourites() {
        favouritesOpen = !favouritesOpen
        if (favouritesOpen) { choosingLocation = false; loadLocations(); keys.forceActiveFocus() }
    }
    function toggleFavourite() {
        if (locationWorker.running || !location.name) return
        locationMessage = ""
        runLocation("favourite", [JSON.stringify(location)])
    }
    property var searchResults: []
    property int selectedResult: -1
    property string locationMessage: ""
    property string searchQuery: ""
    property string locationAction: "list"
    readonly property bool locationBusy: locationWorker.running || fetcher.running
    readonly property var marine: report.marine || ({})
    readonly property var weather: report.weather || ({})
    readonly property var location: report.location || ({})
    readonly property var temps: report.temperatures || ({})
    // Below ~0.3 kn the stream is turning; the modelled direction swings and means little.
    readonly property bool slack: typeof marine.speed === "number" && marine.speed < 0.3
    readonly property color ink: Color.popups.text
    // Sea colour for the current compass: the theme's cyan, read from its colors.toml.
    property color sea: "#449dab"
    function readSea(text) {
        var match = /^\s*cyan\s*=\s*"(#[0-9a-fA-F]{6})"/m.exec(text || "")
        if (match) sea = match[1]
    }
    FileView {
        id: themeColors
        path: Color.currentThemePath + "/colors.toml"
        watchChanges: true
        printErrors: false
        onFileChanged: reload()
        onLoaded: root.readSea(text())
    }
    Connections { target: Color; function onAccentChanged() { themeColors.reload() } }
    readonly property string family: bar ? bar.fontFamily : "monospace"
    function value(v, suffix) { return typeof v === "number" && isFinite(v) ? v.toFixed(1) + suffix : "—" }
    function temperature(v) { return typeof v === "number" && isFinite(v) ? value(location.temperatureUnit === "F" ? v * 1.8 + 32 : v, location.temperatureUnit === "F" ? "°F" : "°C") : "—" }
    function refresh() { if (!fetcher.running && !locationWorker.running) fetcher.running = true }
    function showLocations() {
        choosingLocation = !choosingLocation
        locationMessage = ""
        if (choosingLocation) {
            favouritesOpen = false
            loadLocations()
            Qt.callLater(function() { locationField.forceActiveFocus() })
        } else keys.forceActiveFocus()
    }
    function searchLocations() {
        if (locationSearch.running) return
        searchQuery = locationField.text.trim()
        searchResults = []
        if (searchQuery.length < 2) { locationMessage = "Enter at least two characters."; return }
        locationMessage = "Searching…"
        locationSearch.command = python("location.py", ["search", searchQuery])
        locationSearch.running = true
    }
    function selectLocation(choice, unit) {
        if (locationBusy) { locationMessage = "Wait for the current update to finish."; return }
        var next = Object.assign({}, choice)
        next.temperatureUnit = unit || root.location.temperatureUnit || "C"
        locationMessage = "Saving location…"
        runLocation("select", [JSON.stringify(next)])
    }
    function open() { controller.show(); refresh(); loadLocations() }
    function arrow(d) { return typeof d === "number" ? ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"][Math.round(d / 45) % 8] : "·" }
    // Tide chart geometry: x is a 0–1 window fraction, heights scale between the window's low and high.
    function tidePoint(curve, fraction, w, h) {
        if (!curve || !curve.points || !curve.points.length || w <= 0) return null
        var best = null
        for (var i = 0; i < curve.points.length; i++)
            if (!best || Math.abs(curve.points[i][0] - fraction) < Math.abs(best[0] - fraction)) best = curve.points[i]
        if (Math.abs(best[0] - fraction) > 0.02) return null
        var span = Math.max(0.1, curve.high - curve.low)
        return {x: fraction * w, y: h - Style.space(5) - (best[1] - curve.low) / span * (h - Style.space(10))}
    }
    function tidePath(curve, w, h, closed) {
        if (!curve || !curve.points || curve.points.length < 2 || w <= 0) return ""
        var d = ""
        for (var i = 0; i < curve.points.length; i++) {
            var p = tidePoint(curve, curve.points[i][0], w, h)
            d += (i ? " L " : (closed ? "M " + p.x.toFixed(1) + " " + h + " L " : "M ")) + p.x.toFixed(1) + " " + p.y.toFixed(1)
        }
        if (closed) d += " L " + (curve.points[curve.points.length - 1][0] * w).toFixed(1) + " " + h + " Z"
        return d
    }
    function coordinate(v, positive, negative) { return typeof v === "number" ? Math.abs(v).toFixed(3) + "°" + (v >= 0 ? positive : negative) : "—" }
    Process {
        id: locationSearch
        stdout: StdioCollector { id: searchOutput; waitForEnd: true }
        onExited: {
            if (root.searchQuery !== locationField.text.trim()) return
            try {
                var response = JSON.parse(searchOutput.text)
                root.searchResults = response.results || []
                root.locationMessage = response.error ? "Search failed. Check your connection and try again." : (root.searchResults.length ? "Choose a result below." : "No matches. Try a nearby coastal town or postcode.")
            } catch (e) { root.locationMessage = "Search failed. Please try again." }
        }
    }
    // Parse stdout in onExited: streamFinished is not guaranteed to fire before exit.
    Process {
        id: locationWorker
        stdout: StdioCollector { id: locationOutput; waitForEnd: true }
        onExited: function(code) {
            var response = null
            try { response = JSON.parse(locationOutput.text) }
            catch (e) { response = {error: "Could not read saved locations."} }
            if (code !== 0 || !response || response.error) {
                root.locationMessage = (response && response.error) || "Could not save location. Try again."
                return
            }
            root.savedLocations = response.saved || []
            root.favouriteLocations = response.favourites || []
            if (root.locationAction === "select") {
                // Never relabel the previous location's readings as the new beach.
                root.report = {location: response.active}
                root.failure = ""
                root.choosingLocation = false
                root.favouritesOpen = false
                root.searchResults = []
                keys.forceActiveFocus()
                Qt.callLater(root.refresh)
            }
        }
    }
    Process {
        id: fetcher
        command: root.python("coast.py")
        stdout: StdioCollector { id: fetchOutput; waitForEnd: true }
        onExited: function(code) {
            if (code !== 0) { root.failure = "Coastal feed failed. Click Refresh to retry."; return }
            try { root.report = JSON.parse(fetchOutput.text); root.failure = "" }
            catch (e) { root.failure = "Could not read coastal data. Click Refresh to retry." }
        }
    }
    Timer { interval: 60000; repeat: true; running: true; triggeredOnStart: true; onTriggered: root.refresh() }
    BarIconButton {
        id: button
        anchors.fill: parent
        bar: root.bar
        text: "󰞍"
        tooltipText: (root.location.name || "Coast") + " · " + root.temperature(root.weather.temperature_2m) + " · " + root.arrow(root.marine.direction) + " " + root.value(root.marine.speed, " kn") + (root.report.nextTide ? "\nNext " + root.report.nextTide.kind + " tide " + root.report.nextTide.label : "")
        onPressed: function(b) { if (b === Qt.MiddleButton) root.refresh(); else root.toggle() }
    }
    KeyboardPanel {
        id: popup
        anchorItem: button
        owner: root
        bar: root.bar
        open: root.opened
        focusTarget: keys
        contentWidth: popup.fittedContentWidth(Style.space(660))
        contentHeight: popup.fittedContentHeight(content.implicitHeight)
        PanelKeyCatcher {
            id: keys
            anchors.fill: parent
            blocked: locationField.activeFocus
            onCloseRequested: { if (root.favouritesOpen) root.favouritesOpen = false; else root.close() }
            onReturnRequested: root.refresh()
            onTabRequested: function(direction) { root.switchPanel(direction) }
            onTextKey: function(text) { if (text === "/") root.showLocations(); else if (text === "f") root.toggleFavourites() }
            Flickable {
                anchors.fill: parent
                contentHeight: content.implicitHeight
                contentWidth: width
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                Column {
                    id: content
                    // Three monospace characters (~0.6 em each), for indenting under a heading.
                    readonly property real indent: Math.round(Style.font.body * 0.6 * 3)
                    // Two characters of extra margin on the right, shared by every section.
                    width: parent.width - Math.round(indent * 2 / 3)
                    spacing: Style.space(12)
                    component Label: Text {
                        textFormat: Text.PlainText
                        color: root.ink
                        font.family: root.family
                        font.pixelSize: Style.font.body
                    }
                    Row {
                        id: topRow
                        width: parent.width
                        spacing: Style.space(20)
                        readonly property real share: width - spacing * 2 - 1
                        Column {
                            id: leftColumn
                            // As wide as its text, so the divider sits midway between the two blocks of content.
                            readonly property real natural: {
                                var widest = 0
                                for (var i = 0; i < leftItems.children.length; i++)
                                    if (leftItems.children[i].visible) widest = Math.max(widest, leftItems.children[i].implicitWidth)
                                return widest + content.indent
                            }
                            width: Math.max(topRow.share * 0.35, Math.min(topRow.share * 0.6, natural))
                            spacing: Style.space(7)
                            Label { width: parent.width; elide: Text.ElideRight; text: "COAST"; font.bold: true; font.letterSpacing: 1.5; color: Color.accent }
                            Column {
                                id: leftItems
                                x: content.indent
                                width: parent.width - content.indent
                                spacing: Style.space(7)
                                Label { width: parent.width; wrapMode: Text.WordWrap; text: (root.location.name ? root.location.name + (root.location.country ? "," + root.location.country : "") + " · " : "") + (root.location.detail || "Coastal conditions"); font.pixelSize: Style.font.bodySmall; opacity: 0.7 }
                                Row {
                                    spacing: Style.space(18)
                                    Label {
                                        text: root.favouritesOpen ? "★ Favourites ▴" : "★ Favourites ▾"
                                        font.pixelSize: Style.font.bodySmall; color: Color.accent
                                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.toggleFavourites() }
                                    }
                                    Label {
                                        text: root.isFavourite(root.location) ? "★ Saved" : "☆ Save"
                                        font.pixelSize: Style.font.bodySmall; color: Color.accent
                                        opacity: locationWorker.running ? 0.5 : 1
                                        MouseArea { anchors.fill: parent; enabled: !locationWorker.running && !!root.location.name; cursorShape: Qt.PointingHandCursor; onClicked: root.toggleFavourite() }
                                    }
                                }
                                Item {
                                    id: favouritesDrop
                                    width: parent.width
                                    property real reveal: root.favouritesOpen ? 1 : 0
                                    height: (Math.min(favouritesList.implicitHeight, Style.space(240)) + Style.space(24)) * reveal
                                    visible: reveal > 0
                                    clip: true
                                    Behavior on reveal { NumberAnimation { duration: 520; easing.type: Easing.InOutCubic } }
                                    onRevealChanged: waveSurface.requestPaint()
                                    Canvas {
                                        id: waveSurface
                                        anchors.fill: parent
                                        onWidthChanged: requestPaint()
                                        onHeightChanged: requestPaint()
                                        Connections { target: root; function onInkChanged() { waveSurface.requestPaint() } }
                                        onPaint: {
                                            var ctx = getContext("2d")
                                            ctx.reset()
                                            if (width <= 0 || height <= 0) return
                                            var amplitude = Style.space(10) * Math.sin(Math.PI * favouritesDrop.reveal)
                                            var bottom = height - Style.space(2) - amplitude
                                            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(width, 0)
                                            for (var x = width; x >= 0; x -= 3) {
                                                var y = bottom + amplitude * Math.sin(x / width * Math.PI * 2 - favouritesDrop.reveal * Math.PI * 2)
                                                ctx.lineTo(x, y)
                                            }
                                            ctx.lineTo(0, 0); ctx.closePath()
                                            ctx.fillStyle = Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.08)
                                            ctx.fill()
                                            ctx.strokeStyle = Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.35)
                                            ctx.lineWidth = 1; ctx.stroke()
                                        }
                                    }
                                    Flickable {
                                        x: Style.space(8); y: Style.space(8)
                                        width: parent.width - Style.space(16)
                                        height: Math.max(0, parent.height - Style.space(24))
                                        contentHeight: favouritesList.implicitHeight
                                        clip: true
                                        boundsBehavior: Flickable.StopAtBounds
                                        Column {
                                            id: favouritesList
                                            width: parent.width
                                            spacing: Style.space(4)
                                            Repeater {
                                                model: root.favouriteLocations
                                                Rectangle {
                                                    id: favouriteRow
                                                    required property var modelData
                                                    required property int index
                                                    width: parent.width
                                                    height: favouriteText.implicitHeight + Style.space(12)
                                                    radius: Style.space(4)
                                                    property real arrival: Math.max(0, Math.min(1, (favouritesDrop.reveal - Math.min(index, 5) * 0.07) / 0.6))
                                                    opacity: arrival * (root.locationBusy ? 0.5 : 1)
                                                    transform: Translate { x: (1 - favouriteRow.arrival) * Style.space(12); y: (1 - favouriteRow.arrival) * Style.space(6) }
                                                    color: favouriteMouse.containsMouse ? Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.14) : "transparent"
                                                    Column {
                                                        id: favouriteText
                                                        x: Style.space(8); y: Style.space(6)
                                                        width: parent.width - Style.space(16)
                                                        spacing: Style.space(3)
                                                        Label { width: parent.width; elide: Text.ElideRight; text: modelData.name; color: Color.accent }
                                                        Label { width: parent.width; elide: Text.ElideRight; text: modelData.detail; font.pixelSize: Style.font.bodySmall; opacity: 0.65 }
                                                    }
                                                    MouseArea { id: favouriteMouse; anchors.fill: parent; hoverEnabled: true; enabled: root.favouritesOpen && !root.locationBusy; cursorShape: Qt.PointingHandCursor; onClicked: root.selectLocation(parent.modelData) }
                                                }
                                            }
                                            Label { width: parent.width; wrapMode: Text.WordWrap; visible: root.favouriteLocations.length === 0; text: "No favourites yet. Use ☆ Save to add this location."; font.pixelSize: Style.font.bodySmall; opacity: 0.7 }
                                        }
                                    }
                                }
                                Label { width: parent.width; wrapMode: Text.WordWrap; visible: root.favouritesOpen && !!root.locationMessage; text: root.locationMessage; font.pixelSize: Style.font.bodySmall; color: Color.urgent }
                                Label {
                                    text: root.choosingLocation ? "− Close locations" : "⌖ Change location"
                                    font.pixelSize: Style.font.bodySmall; color: Color.accent
                                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.showLocations() }
                                }
                                Item { width: 1; height: Style.space(3) }
                                Label { text: "OFFSHORE CURRENT"; opacity: 0.65; font.pixelSize: Style.font.bodySmall; font.letterSpacing: 1 }
                                Label { text: root.value(root.marine.speed, " kn"); font.pixelSize: Style.font.displayLarge; font.bold: true }
                                Label { width: parent.width; wrapMode: Text.WordWrap; text: typeof root.marine.direction === "number" ? "Flowing to " + root.marine.bearing + " · " + Math.round(root.marine.direction) + "°" : "Direction unavailable" }
                                Label { visible: root.slack; width: parent.width; wrapMode: Text.WordWrap; text: "Near slack water · direction unsettled"; font.pixelSize: Style.font.bodySmall; color: Color.accent }
                                Row {
                                    spacing: Style.space(20)
                                    Label { text: "Model time " + (root.marine.time || "—"); opacity: 0.65; font.pixelSize: Style.font.bodySmall }
                                    Label {
                                        text: fetcher.running ? "Updating…" : "↻ Refresh"
                                        font.pixelSize: Style.font.bodySmall
                                        color: Color.accent
                                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.refresh() }
                                    }
                                }
                            }
                        }
                        Rectangle { width: 1; height: tideSummary.height; color: root.ink; opacity: 0.15 }
                        // Tide summary spans the full height of the left column; the chart takes what's left.
                        Item {
                            id: tideSummary
                            width: topRow.share - leftColumn.width
                            height: Math.max(leftColumn.height, tideText.height + Style.space(110))
                            readonly property var next: root.report.nextTide || null
                            readonly property var then: root.report.followingTide || null
                            readonly property var curve: root.report.tideCurve || null
                            Column {
                                id: tideText
                                width: parent.width
                                spacing: Style.space(7)
                            Label { text: "NEXT TIDE"; opacity: 0.65; font.pixelSize: Style.font.bodySmall; font.letterSpacing: 1 }
                            Label {
                                visible: !!tideSummary.next
                                text: tideSummary.next ? (tideSummary.next.kind === "high" ? "↑ High " : "↓ Low ") + tideSummary.next.label.slice(-5) : ""
                                font.pixelSize: Style.font.display; font.bold: true; color: Color.accent
                            }
                            Label {
                                visible: !!tideSummary.next
                                text: tideSummary.next ? tideSummary.next.due + " · " + tideSummary.next.height.toFixed(1) + " m" : ""
                            }
                            Label {
                                visible: !!tideSummary.then
                                text: tideSummary.then ? "Then " + tideSummary.then.kind + " " + tideSummary.then.label.slice(-5) + " · " + tideSummary.then.height.toFixed(1) + " m" : ""
                                font.pixelSize: Style.font.bodySmall; opacity: 0.65
                            }
                            Label {
                                visible: !tideSummary.next
                                width: parent.width; wrapMode: Text.WordWrap
                                text: fetcher.running ? "Loading tide times…" : (root.location.tideUrl ? "Tide times unavailable" : "No tide source for this location")
                                font.pixelSize: Style.font.bodySmall; opacity: 0.65
                            }
                            }
                                Item {
                                    id: tideChart
                                    visible: !!tideSummary.curve
                                    width: parent.width
                                    anchors.top: tideText.bottom; anchors.topMargin: Style.space(10)
                                    anchors.bottom: tideAxis.top; anchors.bottomMargin: Style.space(4)
                                    readonly property var nowPoint: root.tidePoint(tideSummary.curve, tideSummary.curve ? tideSummary.curve.now : 0, width, height)
                                    Shape {
                                        anchors.fill: parent
                                        preferredRendererType: Shape.CurveRenderer
                                        ShapePath {
                                            strokeColor: "transparent"
                                            fillColor: Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.12)
                                            PathSvg { path: root.tidePath(tideSummary.curve, tideChart.width, tideChart.height, true) }
                                        }
                                        ShapePath {
                                            strokeColor: Color.accent; strokeWidth: 1.5
                                            fillColor: "transparent"
                                            capStyle: ShapePath.RoundCap; joinStyle: ShapePath.RoundJoin
                                            PathSvg { path: root.tidePath(tideSummary.curve, tideChart.width, tideChart.height, false) }
                                        }
                                    }
                                    Repeater {
                                        model: tideSummary.curve ? tideSummary.curve.events : []
                                        Rectangle {
                                            required property var modelData
                                            readonly property var point: root.tidePoint(tideSummary.curve, modelData.x, tideChart.width, tideChart.height)
                                            visible: !!point
                                            x: point ? point.x - width / 2 : 0; y: point ? point.y - height / 2 : 0
                                            width: Style.space(5); height: width; radius: width / 2
                                            color: Color.accent; opacity: 0.6
                                        }
                                    }
                                    Rectangle {
                                        x: tideSummary.curve ? tideSummary.curve.now * tideChart.width : 0
                                        width: 1; height: parent.height
                                        color: root.ink; opacity: 0.3
                                    }
                                    Rectangle {
                                        visible: !!tideChart.nowPoint
                                        x: tideChart.nowPoint ? tideChart.nowPoint.x - width / 2 : 0
                                        y: tideChart.nowPoint ? tideChart.nowPoint.y - height / 2 : 0
                                        width: Style.space(9); height: width; radius: width / 2
                                        color: Color.accent; border.color: Color.popups.background; border.width: Style.space(2)
                                    }
                                }
                                Item {
                                    id: tideAxis
                                    anchors.bottom: parent.bottom
                                    visible: !!tideSummary.curve
                                    width: parent.width
                                    height: nowLabel.implicitHeight
                                    Label { text: "−6h"; font.pixelSize: Style.font.bodySmall; opacity: 0.5 }
                                    Label {
                                        id: nowLabel
                                        x: (tideSummary.curve ? tideSummary.curve.now * parent.width : 0) - width / 2
                                        text: "now"; font.pixelSize: Style.font.bodySmall; opacity: 0.65
                                    }
                                    Label { anchors.right: parent.right; text: "+18h"; font.pixelSize: Style.font.bodySmall; opacity: 0.5 }
                                }
                        }
                    }
                    Rectangle { width: parent.width; height: 1; color: root.ink; opacity: 0.15 }
                    Column {
                        visible: root.choosingLocation
                        width: parent.width
                        spacing: Style.space(10)
                        Label { text: "CHOOSE A COASTAL LOCATION"; font.pixelSize: Style.font.bodySmall; color: Color.accent; font.letterSpacing: 1 }
                        Row {
                            width: parent.width
                            spacing: Style.space(12)
                            Rectangle {
                                width: parent.width - Style.space(100)
                                height: Style.space(36)
                                radius: Style.space(4)
                                color: "transparent"; border.color: Color.accent
                                TextInput {
                                    id: locationField
                                    anchors.fill: parent; anchors.margins: Style.space(8)
                                    color: root.ink; selectionColor: Color.accent
                                    font.family: root.family; font.pixelSize: Style.font.body
                                    clip: true; selectByMouse: true
                                    onTextChanged: { root.searchResults = []; root.selectedResult = -1; root.locationMessage = "" }
                                    function acceptResult() {
                                        if (root.selectedResult >= 0 && root.selectedResult < root.searchResults.length) root.selectLocation(root.searchResults[root.selectedResult])
                                        else root.searchLocations()
                                    }
                                    Keys.onReturnPressed: function(event) { acceptResult(); event.accepted = true }
                                    Keys.onEnterPressed: function(event) { acceptResult(); event.accepted = true }
                                    Keys.onDownPressed: function(event) { root.selectedResult = Math.min(root.searchResults.length - 1, root.selectedResult + 1); event.accepted = true }
                                    Keys.onUpPressed: function(event) { root.selectedResult = Math.max(-1, root.selectedResult - 1); event.accepted = true }
                                    Keys.onEscapePressed: function(event) { root.choosingLocation = false; keys.forceActiveFocus(); event.accepted = true }
                                }
                                Label { anchors.verticalCenter: parent.verticalCenter; x: Style.space(8); visible: !locationField.text && !locationField.activeFocus; text: "Town or postcode, country"; opacity: 0.45 }
                            }
                            Label {
                                anchors.verticalCenter: parent.verticalCenter
                                text: locationSearch.running ? "Searching…" : "Search"
                                font.pixelSize: Style.font.bodySmall; color: Color.accent
                                MouseArea { anchors.fill: parent; enabled: !locationSearch.running; cursorShape: Qt.PointingHandCursor; onClicked: root.searchLocations() }
                            }
                        }
                        Label { width: parent.width; wrapMode: Text.WordWrap; text: root.locationMessage || "Search worldwide. Include the country to distinguish places with the same name."; font.pixelSize: Style.font.bodySmall; opacity: 0.7 }
                        Repeater {
                            model: root.searchResults
                            Rectangle {
                                required property var modelData
                                required property int index
                                width: parent.width
                                height: resultText.implicitHeight + Style.space(14)
                                radius: Style.space(4)
                                color: Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, resultMouse.containsMouse || root.selectedResult === index ? 0.16 : 0.05)
                                opacity: root.locationBusy ? 0.5 : 1
                                Column {
                                    id: resultText
                                    x: Style.space(8); y: Style.space(7)
                                    width: parent.width - Style.space(16)
                                    spacing: Style.space(3)
                                    Label { width: parent.width; wrapMode: Text.WordWrap; text: modelData.name + (modelData.country ? "," + modelData.country : "") + " · " + modelData.detail; color: Color.accent }
                                    Label { width: parent.width; wrapMode: Text.WordWrap; text: modelData.timezone + " · " + root.coordinate(modelData.latitude, "N", "S") + ", " + root.coordinate(modelData.longitude, "E", "W"); font.pixelSize: Style.font.bodySmall; opacity: 0.6 }
                                }
                                MouseArea { id: resultMouse; anchors.fill: parent; hoverEnabled: true; enabled: !root.locationBusy; cursorShape: Qt.PointingHandCursor; onClicked: root.selectLocation(parent.modelData) }
                            }
                        }
                        Label { text: "RECENT LOCATIONS"; color: Color.accent; font.pixelSize: Style.font.bodySmall; font.letterSpacing: 1 }
                        Flow {
                            width: parent.width
                            spacing: Style.space(8)
                            Repeater {
                                model: root.savedLocations
                                Rectangle {
                                    required property var modelData
                                    width: Math.min(parent.width, recentLabel.implicitWidth + Style.space(20))
                                    height: Style.space(32); radius: Style.space(4)
                                    color: "transparent"; border.color: Color.accent
                                    opacity: root.locationBusy ? 0.5 : 0.85
                                    Label { id: recentLabel; anchors.centerIn: parent; width: parent.width - Style.space(20); elide: Text.ElideRight; text: modelData.name + (modelData.detail ? " · " + modelData.detail : ""); font.pixelSize: Style.font.bodySmall }
                                    MouseArea { anchors.fill: parent; enabled: !root.locationBusy; cursorShape: Qt.PointingHandCursor; onClicked: root.selectLocation(parent.modelData) }
                                }
                            }
                        }
                        Row {
                            spacing: Style.space(18)
                            Label { text: "TEMPERATURE"; font.pixelSize: Style.font.bodySmall; opacity: 0.65 }
                            Repeater {
                                model: ["C", "F"]
                                Label {
                                    required property string modelData
                                    text: "°" + modelData + (root.location.temperatureUnit === modelData ? " ✓" : "")
                                    color: Color.accent; font.pixelSize: Style.font.bodySmall
                                    MouseArea { anchors.fill: parent; enabled: !root.locationBusy && !!root.location.name; cursorShape: Qt.PointingHandCursor; onClicked: root.selectLocation(root.location, parent.modelData) }
                                }
                            }
                        }
                        Label { width: parent.width; wrapMode: Text.WordWrap; text: "Choose a coastal place. Offshore coverage varies; tide times need a supported local source. Search: Open-Meteo / GeoNames."; font.pixelSize: Style.font.bodySmall; opacity: 0.6 }
                        Rectangle { width: parent.width; height: 1; color: root.ink; opacity: 0.15 }
                    }
                    // Plain temperature readings; no advice or verdicts.
                    Rectangle {
                        width: parent.width
                        height: tempContent.implicitHeight + Style.space(28)
                        radius: Style.space(8)
                        color: Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.04)
                        border.color: Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.3)
                        Column {
                            id: tempContent
                            x: Style.space(14); y: Style.space(14)
                            width: parent.width - Style.space(28)
                            spacing: Style.space(8)
                            Label { text: "TEMPERATURES"; font.pixelSize: Style.font.bodySmall; font.letterSpacing: 1; color: Color.accent }
                            Row {
                                width: parent.width
                                Repeater {
                                    model: [
                                        {label: "SEA", value: root.temps.sea},
                                        {label: "AIR", value: root.temps.air},
                                        {label: "FEELS LIKE", value: root.temps.feels},
                                        {label: "WIND CHILL", value: root.temps.windChill}
                                    ]
                                    Column {
                                        required property var modelData
                                        width: parent.width / 4
                                        spacing: Style.space(4)
                                        Label { text: modelData.label; font.pixelSize: Style.font.bodySmall; opacity: 0.65 }
                                        Label { text: root.failure ? "—" : root.temperature(modelData.value); font.pixelSize: Style.font.title }
                                    }
                                }
                            }
                            Label {
                                width: parent.width; wrapMode: Text.WordWrap
                                text: root.failure || ("Sea is an offshore model estimate and can differ at the beach. Wind chill is shown only at air ≤10°C with wind >3 mph. " + (root.temps.times || ""))
                                font.pixelSize: Style.font.bodySmall; opacity: 0.6
                            }
                        }
                    }
                    // Inset to line up with the text inside the temperature box, slightly narrower than the box.
                    Column {
                        x: Style.space(14)
                        width: parent.width - Style.space(28)
                        spacing: Style.space(12)
                        // Table | divider | weather, with equal gaps either side of the divider like the top section.
                        Row {
                            id: tideRow
                            width: parent.width
                            spacing: Style.space(20)
                            Column {
                                id: tideList
                                // Only as wide as the table (or its heading), leaving the rest to the compass.
                                width: Math.max(tideGrid.implicitWidth, tideHeading.implicitWidth)
                                spacing: Style.space(12)
                                Label { id: tideHeading; width: parent.width; elide: Text.ElideRight; text: "NEXT TIDES · " + (root.location.name || "COAST").toUpperCase(); color: Color.accent; font.letterSpacing: 1 }
                                // Time, state and height, two characters apart; the grid keeps each column aligned.
                                Grid {
                                    id: tideGrid
                                    columns: 3
                                    columnSpacing: Math.round(content.indent * 2 / 3)
                                    rowSpacing: Style.space(12)
                                    Repeater {
                                        model: (root.report.tides || []).filter(function(t) { return t.time * 1000 >= Date.now() }).slice(0, 4).reduce(function(cells, t) {
                                            return cells.concat([t.label, t.kind === "high" ? "↑ High water" : "↓ Low water", t.height.toFixed(1) + " m"])
                                        }, [])
                                        Label { required property var modelData; text: modelData }
                                    }
                                }
                                Label { visible: !root.report.nextTide; width: parent.width; wrapMode: Text.WordWrap; text: fetcher.running ? "Loading tide times…" : (root.location.tideUrl ? "Tide times unavailable" : "No tide provider configured for this location"); opacity: 0.7 }
                                Label { id: tideNote; visible: !!root.location.tideUrl; width: parent.width; wrapMode: Text.WordWrap; text: "Chart datum heights · Met Office\nCurve approximate"; opacity: 0.6; font.pixelSize: Style.font.bodySmall }
                            }
                            Rectangle { width: 1; height: tideList.height; color: root.ink; opacity: 0.15 }
                            Item {
                                width: tideRow.width - tideList.width - 1 - tideRow.spacing * 2
                                height: tideList.height
                                Row {
                                    anchors.verticalCenter: parent.verticalCenter
                                    width: parent.width
                                    Repeater {
                                        model: [
                                            { label: "WEATHER", value: root.temperature(root.weather.temperature_2m), sub: root.weather.summary || "Loading…" },
                                            { label: "WIND", value: root.value(root.weather.wind_speed_10m, " mph"), sub: "From " + (root.weather.windBearing || "—") },
                                            { label: "WAVES", value: root.value(root.marine.wave, " m"), sub: "Sea " + root.temperature(root.marine.temperature) }
                                        ]
                                        Column {
                                            required property var modelData
                                            width: parent.width / 3
                                            spacing: Style.space(5)
                                            Label { text: modelData.label; opacity: 0.65; font.pixelSize: Style.font.bodySmall }
                                            Label { text: modelData.value; font.pixelSize: Style.font.title }
                                            Label { text: modelData.sub; font.pixelSize: Style.font.bodySmall; opacity: 0.7 }
                                        }
                                    }
                                }
                            }
                        }
                        // Current: compass and the 12-hour outlook together, in the sea colour.
                        Rectangle {
                            width: parent.width
                            height: currentContent.implicitHeight + Style.space(28)
                            radius: Style.space(8)
                            color: Qt.rgba(root.sea.r, root.sea.g, root.sea.b, 0.08)
                            border.color: Qt.rgba(root.sea.r, root.sea.g, root.sea.b, 0.5)
                            Column {
                                id: currentContent
                                x: Style.space(16); y: Style.space(14)
                                width: parent.width - Style.space(32)
                                spacing: Style.space(12)
                                Row {
                                    id: currentRow
                                    width: parent.width
                                    spacing: Style.space(20)
                                    Row {
                                        id: compassRow
                                        spacing: Style.space(14)
                                        CurrentCompass {
                                            id: compass
                                            width: Style.space(108); height: width
                                            direction: root.marine.direction
                                            weak: root.slack
                                            accent: root.sea
                                            family: root.family
                                            labelSize: Style.font.bodySmall
                                            animate: root.opened
                                        }
                                        Column {
                                            anchors.verticalCenter: parent.verticalCenter
                                            spacing: Style.space(6)
                                            Label { text: "CURRENT"; font.pixelSize: Style.font.bodySmall; font.letterSpacing: 1; color: root.sea }
                                            Label { text: compass.hasDirection ? "→ " + root.marine.bearing : "—"; font.pixelSize: Style.font.display; font.bold: true; color: root.sea }
                                            Label { text: root.value(root.marine.speed, " kn"); color: root.sea }
                                            Label { visible: root.slack; text: "Near slack"; font.pixelSize: Style.font.bodySmall; color: root.sea; opacity: 0.8 }
                                        }
                                    }
                                    Rectangle { width: 1; height: compassRow.height; color: root.sea; opacity: 0.35 }
                                    Column {
                                        anchors.verticalCenter: parent.verticalCenter
                                        width: currentRow.width - compassRow.width - 1 - currentRow.spacing * 2
                                        spacing: Style.space(8)
                                        Label { text: "OUTLOOK · NEXT 12 HOURS"; color: root.sea; font.pixelSize: Style.font.bodySmall; font.letterSpacing: 1 }
                                        Row {
                                            width: parent.width
                                            Repeater {
                                                model: (root.report.forecast || []).filter(function(v, i) { return i % 2 === 0 })
                                                Column {
                                                    required property var modelData
                                                    width: parent.width / 6
                                                    spacing: Style.space(4)
                                                    Label { text: modelData.time; font.pixelSize: Style.font.bodySmall; color: root.sea }
                                                    Label { text: root.arrow(modelData.direction); font.pixelSize: Style.font.display; color: root.sea }
                                                    Label { text: root.value(modelData.speed, " kn"); font.pixelSize: Style.font.bodySmall; color: root.sea }
                                                }
                                            }
                                        }
                                    }
                                }
                                Label {
                                    width: parent.width; wrapMode: Text.WordWrap
                                    text: "Offshore model ~8 km resolution; not beach rip currents or navigation guidance. Grid: " + root.coordinate(root.marine.latitude, "N", "S") + ", " + root.coordinate(root.marine.longitude, "E", "W")
                                    font.pixelSize: Style.font.bodySmall; color: root.sea; opacity: 0.8
                                }
                            }
                        }
                        Label {
                            width: parent.width; wrapMode: Text.WordWrap
                            visible: text !== ""
                            text: root.failure || (root.report.warnings || []).join(" · ")
                            color: Color.urgent; font.pixelSize: Style.font.bodySmall
                        }
                        Label {
                            width: parent.width; wrapMode: Text.WordWrap
                            text: "Fetched: tides " + ((root.report.fetched || {}).tides || "—") + " · weather " + ((root.report.fetched || {}).weather || "—") + " · marine " + ((root.report.fetched || {}).marine || "—")
                            font.pixelSize: Style.font.bodySmall; opacity: 0.55
                        }
                        Row {
                            spacing: Style.space(24)
                            Label {
                                visible: !!root.location.tideUrl
                                text: "Tide source ↗"; color: Color.accent; font.pixelSize: Style.font.bodySmall
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: Qt.openUrlExternally(root.location.tideUrl) }
                            }
                            Label {
                                text: "Open-Meteo / DWD ↗"; color: Color.accent; font.pixelSize: Style.font.bodySmall
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: Qt.openUrlExternally("https://open-meteo.com/en/docs/marine-weather-api") }
                            }
                        }
                    }
                }
            }
        }
    }
}
