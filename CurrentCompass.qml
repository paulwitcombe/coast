import QtQuick

// Offshore current compass. `direction` is where the current flows TOWARDS, in degrees
// clockwise from north (Open-Meteo's convention), so the chevrons point downstream.
// No qs imports, so it can be rendered standalone to check orientation. Drawn on a
// 170-unit dial and scaled to fit; label text keeps its pixel size.
Item {
    id: root
    property var direction: null
    property bool weak: false
    property color accent: "#7eb8da"
    property string family: "monospace"
    property int labelSize: 12
    property bool animate: true
    readonly property bool hasDirection: typeof direction === "number" && isFinite(direction)

    implicitWidth: 132
    implicitHeight: 132

    Item {
        id: dial
        width: 170; height: 170
        anchors.centerIn: parent
        scale: Math.min(root.width, root.height) / width

        Rectangle {
            anchors.centerIn: parent
            width: 132; height: width; radius: width / 2
            color: "transparent"; border.color: root.accent; border.width: 1 / dial.scale
            opacity: 0.55
        }
        Repeater {
            model: ["N", "E", "S", "W"]
            Text {
                required property string modelData
                required property int index
                text: modelData
                x: dial.width / 2 + Math.sin(index * Math.PI / 2) * 76 - width / 2
                y: dial.height / 2 - Math.cos(index * Math.PI / 2) * 76 - height / 2
                color: root.accent
                font.family: root.family
                font.pixelSize: root.labelSize / dial.scale
            }
        }
        Item {
            id: arrow
            anchors.centerIn: parent
            width: 84; height: width
            // Qt rotation is clockwise, matching compass bearings; 0° points up (north).
            rotation: root.hasDirection ? root.direction : 0
            property real phase: 0
            NumberAnimation on phase {
                from: 0; to: 1; duration: 3200
                loops: Animation.Infinite
                running: root.animate && root.hasDirection
            }
            Repeater {
                model: 3
                Item {
                    required property int index
                    visible: root.hasDirection
                    x: arrow.width / 2
                    y: 56 - index * 20
                    // The highlight travels from the rear chevron to the tip.
                    readonly property real pulse: Math.pow(Math.max(0, Math.cos(2 * Math.PI * (arrow.phase - index * 0.23))), 4)
                    opacity: (root.weak ? 0.5 : 1) * (0.09 + 0.41 * pulse + (root.animate ? 0 : 0.4))
                    scale: 0.94 + 0.06 * pulse
                    Repeater {
                        model: [-45, 45]
                        Rectangle {
                            required property int modelData
                            x: -width / 2
                            width: 5; height: 23; radius: width / 2
                            color: root.accent
                            rotation: modelData
                            transformOrigin: Item.Top
                        }
                    }
                }
            }
            Text {
                anchors.centerIn: parent
                visible: !root.hasDirection
                text: "—"
                color: root.accent
                font.pixelSize: 84
            }
        }
    }
}
