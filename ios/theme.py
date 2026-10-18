#!/usr/bin/env python3
"""Print the THEME line for ios/Coast.js from the current Omarchy theme.

Paste the output over the THEME line near the top of Coast.js in Scriptable.
"""
import json
import os
from pathlib import Path
import re

state = Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local" / "state")))
colors = {}
for line in (state / "omarchy" / "current" / "theme" / "colors.toml").read_text().splitlines():
    match = re.match(r'\s*([a-z_]+)\s*=\s*"(#[0-9a-fA-F]{6})"', line)
    if match:
        colors[match.group(1)] = match.group(2).lower()
# The same roles the Omarchy panel uses; the sea is the theme's cyan.
theme = {"background": colors.get("background", "#1a1b26"), "foreground": colors.get("foreground", "#a9b1d6"),
         "accent": colors.get("accent", "#7aa2f7"), "sea": colors.get("cyan", "#449dab"), "urgent": colors.get("red", "#f7768e")}
print("const THEME = " + json.dumps(theme))
