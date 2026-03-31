"""
Central configuration for NEPSE Pulse.
Edit thresholds here whenever your strategy changes.
"""

# -------------------------------------------------------------------
# STOCK WATCHLIST
# Each stock has: name, your holding, avg buy price, and thresholds.
# Thresholds use tuples for zones (low, high) or a single int for hard levels.
# -------------------------------------------------------------------

STOCKS = {
    "NMFBS": {
        "name": "National Laghubitta Bittiya Sanstha",
        "sector": "Microfinance",
        "holding": 50,
        "avg_buy_price": 1131.70,
        "thresholds": {
            "add_zone":       (1080, 1100),
            "partial_exit":   (1350, 1380),
            "full_exit":      (1460, 1500),
            "stop_loss":      1060,
        },
    },
    "NABIL": {
        "name": "Nabil Bank Ltd.",
        "sector": "Commercial Bank",
        "holding": 0,           # Update to 27 after you buy
        "avg_buy_price": None,  # Update after purchase (~543)
        "thresholds": {
            "buy_zone":       (530, 555),
            "add_zone":       (490, 510),
            "partial_exit":   (590, 610),
            "full_exit":      (640, 680),
            "stop_loss":      480,
        },
    },
    "EBL": {
        "name": "Everest Bank Ltd.",
        "sector": "Commercial Bank",
        "holding": 0,
        "avg_buy_price": None,
        "thresholds": {
            "buy_zone":       (690, 725),
            "add_zone":       (640, 660),
            "partial_exit":   (755, 770),
            "full_exit":      (800, 830),
            "stop_loss":      615,
        },
    },
    "SBL": {
        "name": "Siddhartha Bank Ltd.",
        "sector": "Commercial Bank",
        "holding": 0,
        "avg_buy_price": None,
        "thresholds": {
            "buy_zone":       (390, 408),
            "add_zone":       (355, 375),
            "partial_exit":   (440, 455),
            "full_exit":      (480, 500),
            "stop_loss":      340,
        },
    },
    "HIDCL": {
        "name": "Hydroelectricity Investment and Development Company",
        "sector": "Hydropower",
        "holding": 0,
        "avg_buy_price": None,
        "thresholds": {
            "buy_zone":       (285, 305),
            "add_zone":       (252, 262),
            "partial_exit":   (325, 335),
            "full_exit":      (360, 390),
            "stop_loss":      242,
        },
    },
    "SKHL": {
        "name": "Super Khudi Hydropower Ltd.",
        "sector": "Hydropower",
        "holding": 0,
        "avg_buy_price": None,
        "thresholds": {
            # Do NOT buy yet — wait for post-listing cooldown
            "buy_zone":       (285, 315),
            "add_zone":       (245, 265),
            "partial_exit":   (380, 410),
            "full_exit":      (460, 500),
            "stop_loss":      220,
        },
    },
}

# -------------------------------------------------------------------
# ALERT SETTINGS
# -------------------------------------------------------------------

# Percentage change in a single 30-min cycle that triggers a rapid move alert
RAPID_MOVE_THRESHOLD_PCT = 3.0

# -------------------------------------------------------------------
# NEPSE MARKET HOURS  (Nepal Standard Time = UTC+5:45)
# Trading: Sunday–Thursday, 11:00 AM – 3:00 PM NST
# In UTC: 05:15 – 09:15
# -------------------------------------------------------------------
MARKET_OPEN_UTC_HOUR   = 5
MARKET_OPEN_UTC_MINUTE = 15
MARKET_CLOSE_UTC_HOUR  = 9
MARKET_CLOSE_UTC_MINUTE = 15
MARKET_DAYS = [6, 0, 1, 2, 3]  # Sunday=6, Mon=0, ..., Thu=3 in Python weekday()

# -------------------------------------------------------------------
# NOTIFICATION CHANNELS  (values injected from environment / GitHub Secrets)
# -------------------------------------------------------------------
import os

RESEND_API_KEY  = os.environ.get("RESEND_API_KEY", "")
ALERT_EMAIL_TO  = os.environ.get("ALERT_EMAIL_TO", "bishalkumar45657@gmail.com")
ALERT_EMAIL_FROM = os.environ.get("ALERT_EMAIL_FROM", "NEPSE Pulse <alerts@bishalstha.info.np>")

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")
