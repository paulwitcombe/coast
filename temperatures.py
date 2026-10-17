"""Plain temperature readings: sea, air, feels-like and wind chill. No advice or verdicts.

Inputs are Celsius and wind is mph. Missing, non-numeric or out-of-range values
become None rather than being guessed.
"""
import math


def valid(value, low, high):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and low <= value <= high


def wind_chill(air, wind):
    """NWS exposed-skin index; only defined at <=10 C and >3 mph."""
    if not valid(air, -90, 60) or not valid(wind, 0, 250) or air > 10 or wind <= 3:
        return None
    fahrenheit = air * 1.8 + 32
    chill = 35.74 + 0.6215 * fahrenheit - 35.75 * wind ** 0.16 + 0.4275 * fahrenheit * wind ** 0.16
    return round((chill - 32) / 1.8, 1)


def readings(sea, air, feels, wind):
    air = air if valid(air, -90, 60) else None
    return {"sea": sea if valid(sea, -3, 45) else None, "air": air,
            "feels": feels if valid(feels, -110, 80) else None,
            "windChill": wind_chill(air, wind if valid(wind, 0, 250) else None)}
