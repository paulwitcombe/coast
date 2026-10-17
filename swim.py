"""Location-independent thermal screening, never a swimming-safety verdict.

All inputs and thresholds are Celsius, wind is mph. 15 C is the conservative
cold-water warning boundary (RNLI); 20 C water / 15 C air are product comfort
bands, not clinical or validated safety thresholds. No exposure-time prediction.
"""
import math


def valid(value, low, high):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and low <= value <= high


def wind_chill(air, wind):
    """NWS exposed-skin index, only at <=10 C and >3 mph; not wet-body cooling."""
    if not valid(air, -90, 60) or not valid(wind, 0, 250) or air > 10 or wind <= 3:
        return None
    fahrenheit = air * 1.8 + 32
    chill = 35.74 + 0.6215 * fahrenheit - 35.75 * wind ** 0.16 + 0.4275 * fahrenheit * wind ** 0.16
    return round((chill - 32) / 1.8, 1)


def assess(sea, air, feels, wind):
    sea = sea if valid(sea, -3, 45) else None
    air = air if valid(air, -90, 60) else None
    feels = feels if valid(feels, -110, 80) else None
    wind = wind if valid(wind, 0, 250) else None
    chill = wind_chill(air, wind)
    missing = [name for name, v in (("sea temperature", sea), ("air temperature", air), ("feels-like temperature", feels), ("wind", wind)) if v is None]
    reasons = []
    level, title = "neutral", "Milder temperatures"
    if sea is not None and sea <= 15:
        level, title = "cold", "Cold water · cold-shock risk"
        reasons.append("Cold water can disrupt breathing and movement, even when the air is warm.")
    elif sea is not None and sea < 20:
        level, title = "caution", "Cool water · prepare for cold"
        reasons.append("Water is in the cool comfort band; plan for cooling during and after your swim.")
    exposure = [v for v in (air, feels, chill) if v is not None]
    if exposure and min(exposure) < 15:
        if level == "neutral":
            level, title = "caution", "Cool air · prepare for cold"
        reasons.append("Air / feels-like conditions are cool: have dry layers and shelter ready for your exit.")
    if not reasons:
        reasons.append("These readings do not establish safe swimming conditions or a safe swim duration.")
    if missing:
        # Preserve known cold-water warnings, but never present a complete result.
        if level != "cold":
            level, title = "unknown", "Incomplete temperature check"
        reasons.append("Missing or expired: " + ", ".join(missing) + ".")
    return {"level": level, "title": title, "reasons": reasons, "complete": not missing,
            "sea": sea, "air": air, "feels": feels, "windChill": chill,
            "windChillNote": "Exposed-skin index; not wet-body cooling." if chill is not None else
                ("Outside wind-chill range; use feels-like." if air is not None and wind is not None else "Wind chill unavailable."),
            "scope": "Temperature check only · not a safe-to-swim verdict",
            "checks": "Check beach flags, lifeguard advice, currents, waves and water quality. Swim with a buddy; plan your exit.",
            "method": "Cold-water alert ≤15°C. Cool bands: water <20°C or air / feels-like <15°C. Comfort bands, not safety limits."}
