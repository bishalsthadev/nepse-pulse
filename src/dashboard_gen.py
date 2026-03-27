"""
Generates the two JSON data files consumed by the Cloudflare Pages dashboard:
  public/data/prices.json   — latest prices + threshold status per stock
  public/data/alerts.json   — last 50 alerts (newest first)
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from analyzer import Alert, ALERT_META, _in_zone, _describe_zone
from config import STOCKS

PUBLIC_DATA = Path(__file__).parent.parent / "public" / "data"


def update_prices_json(prices: dict[str, float | None]) -> None:
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    data = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "stocks": [],
    }

    for symbol, cfg in STOCKS.items():
        price = prices.get(symbol)
        thresholds = cfg["thresholds"]
        holding = cfg.get("holding", 0)
        avg_cost = cfg.get("avg_buy_price")

        status = "watching"
        status_color = "#6b7280"
        status_label = "Watching"

        if price is not None:
            if "stop_loss" in thresholds and price <= thresholds["stop_loss"]:
                status, status_color, status_label = "stop_loss", "#dc2626", "⛔ STOP LOSS"
            elif "full_exit" in thresholds and _in_zone(price, thresholds["full_exit"]):
                status, status_color, status_label = "full_exit", "#ef4444", "🔴 SELL ALL"
            elif "partial_exit" in thresholds and _in_zone(price, thresholds["partial_exit"]):
                status, status_color, status_label = "partial_exit", "#f59e0b", "🟡 SELL HALF"
            elif "buy_zone" in thresholds and _in_zone(price, thresholds["buy_zone"]):
                status, status_color, status_label = "buy_zone", "#22c55e", "🟢 BUY"
            elif "add_zone" in thresholds and _in_zone(price, thresholds["add_zone"]):
                status, status_color, status_label = "add_zone", "#3b82f6", "🔵 BUY MORE"

        pnl = None
        pnl_pct = None
        if holding > 0 and avg_cost and price:
            pnl = round((price - avg_cost) * holding, 2)
            pnl_pct = round(((price - avg_cost) / avg_cost) * 100, 2)

        # Build threshold ranges for display
        th_display = []
        for k, v in thresholds.items():
            th_display.append({"type": k, "range": _describe_zone(v)})

        data["stocks"].append({
            "symbol":       symbol,
            "name":         cfg["name"],
            "sector":       cfg.get("sector", ""),
            "price":        price,
            "holding":      holding,
            "avg_cost":     avg_cost,
            "pnl":          pnl,
            "pnl_pct":      pnl_pct,
            "status":       status,
            "status_color": status_color,
            "status_label": status_label,
            "thresholds":   th_display,
        })

    out = PUBLIC_DATA / "prices.json"
    out.write_text(json.dumps(data, indent=2))
    print(f"[dashboard] Updated {out}")


def append_alerts_json(alerts: list[Alert]) -> None:
    if not alerts:
        return
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    out = PUBLIC_DATA / "alerts.json"

    existing = []
    if out.exists():
        try:
            existing = json.loads(out.read_text()).get("alerts", [])
        except Exception:
            existing = []

    new_entries = [
        {
            "id":            f"{a.symbol}-{a.alert_type}-{a.timestamp}",
            "symbol":        a.symbol,
            "name":          a.name,
            "alert_type":    a.alert_type,
            "label":         ALERT_META[a.alert_type]["label"],
            "emoji":         ALERT_META[a.alert_type]["emoji"],
            "color":         ALERT_META[a.alert_type]["color"],
            "price":         a.current_price,
            "threshold":     a.threshold,
            "action":        a.action,
            "timestamp":     a.timestamp,
            "pct_change":    a.pct_change,
        }
        for a in alerts
    ]

    combined = new_entries + existing
    out.write_text(json.dumps({"alerts": combined[:50]}, indent=2))
    print(f"[dashboard] Appended {len(new_entries)} alert(s) to {out}")
