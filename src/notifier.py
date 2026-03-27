"""
Sends alerts via:
  1. Resend.com  — formatted HTML email
  2. ntfy.sh     — instant push notification (browser + mobile app)
"""

import json
import requests
from analyzer import Alert, ALERT_META
from config import (
    RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM,
    NTFY_TOPIC, NTFY_BASE_URL, STOCKS,
)


# -------------------------------------------------------------------
# Email via Resend.com
# -------------------------------------------------------------------

def send_email(alerts: list[Alert], is_digest: bool = False) -> bool:
    if not RESEND_API_KEY:
        print("[notifier] RESEND_API_KEY not set — skipping email.")
        return False

    subject = (
        "📊 NEPSE Pulse — Daily Market Digest"
        if is_digest
        else _email_subject(alerts)
    )
    html = _build_html(alerts, is_digest)

    payload = {
        "from":    ALERT_EMAIL_FROM,
        "to":      [ALERT_EMAIL_TO],
        "subject": subject,
        "html":    html,
    }
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type":  "application/json",
            },
            json=payload,
            timeout=15,
        )
        r.raise_for_status()
        print(f"[notifier] Email sent: {subject}")
        return True
    except Exception as e:
        print(f"[notifier] Email failed: {e}")
        return False


def _email_subject(alerts: list[Alert]) -> str:
    if len(alerts) == 1:
        a = alerts[0]
        meta = ALERT_META[a.alert_type]
        return f"{meta['emoji']} NEPSE Pulse — {a.symbol} {meta['label']}"
    types = ", ".join({ALERT_META[a.alert_type]["label"] for a in alerts})
    return f"⚡ NEPSE Pulse — {len(alerts)} Alerts: {types}"


def _build_html(alerts: list[Alert], is_digest: bool) -> str:
    rows = ""
    for a in alerts:
        meta   = ALERT_META[a.alert_type]
        color  = meta["color"]
        label  = meta["label"]
        emoji  = meta["emoji"]
        cfg    = STOCKS.get(a.symbol, {})
        holding = cfg.get("holding", 0)
        avg_cost = cfg.get("avg_buy_price")

        pnl_row = ""
        if holding > 0 and avg_cost:
            pnl = (a.current_price - avg_cost) * holding
            pct = ((a.current_price - avg_cost) / avg_cost) * 100
            sign = "+" if pnl >= 0 else ""
            pnl_color = "#22c55e" if pnl >= 0 else "#ef4444"
            pnl_row = f"""
            <tr>
              <td style="padding:4px 0;color:#9ca3af;font-size:13px;">Your P&amp;L</td>
              <td style="padding:4px 0;font-weight:600;color:{pnl_color};">
                {sign}{pnl:,.0f} NPR ({pct:+.1f}%) on {holding} shares
              </td>
            </tr>"""

        pct_row = ""
        if a.pct_change is not None:
            pc = a.pct_change
            pct_row = f"""
            <tr>
              <td style="padding:4px 0;color:#9ca3af;font-size:13px;">Move</td>
              <td style="padding:4px 0;font-weight:600;">{"+" if pc > 0 else ""}{pc}% this cycle</td>
            </tr>"""

        rows += f"""
        <div style="background:#1f2937;border-radius:12px;padding:20px;margin-bottom:16px;
                    border-left:4px solid {color};">
          <div style="display:flex;align-items:center;margin-bottom:12px;">
            <span style="font-size:24px;margin-right:10px;">{emoji}</span>
            <div>
              <div style="font-size:18px;font-weight:700;color:#f9fafb;">
                {a.symbol} — {label}
              </div>
              <div style="font-size:13px;color:#9ca3af;">{a.name}</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;color:#9ca3af;font-size:13px;width:120px;">Current Price</td>
              <td style="padding:4px 0;font-weight:700;font-size:16px;color:{color};">
                {a.current_price:,.2f} NPR
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#9ca3af;font-size:13px;">Threshold</td>
              <td style="padding:4px 0;">{a.threshold}</td>
            </tr>
            {pnl_row}
            {pct_row}
            <tr>
              <td style="padding:4px 0;color:#9ca3af;font-size:13px;">Action</td>
              <td style="padding:4px 0;font-weight:600;color:#fbbf24;">{a.action}</td>
            </tr>
          </table>
        </div>"""

    title = "Daily Market Digest" if is_digest else "Stock Alert"
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#111827;font-family:'Segoe UI',Arial,sans-serif;color:#f9fafb;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="margin:0;font-size:22px;color:#f9fafb;">📈 NEPSE Pulse</h1>
      <p style="margin:4px 0 0;color:#6b7280;font-size:14px;">{title} — Nepal Stock Monitor</p>
    </div>
    {rows}
    <div style="text-align:center;margin-top:24px;color:#4b5563;font-size:12px;">
      <p>View live dashboard → <a href="https://stock.bishalstha.info.np"
         style="color:#6b7280;">stock.bishalstha.info.np</a></p>
      <p>NEPSE Pulse • Data from NEPSE public sources • Not financial advice</p>
    </div>
  </div>
</body>
</html>"""


# -------------------------------------------------------------------
# Push notification via ntfy.sh
# -------------------------------------------------------------------

def send_push(alert: Alert) -> bool:
    if not NTFY_TOPIC:
        print("[notifier] NTFY_TOPIC not set — skipping push.")
        return False

    meta = ALERT_META[alert.alert_type]
    title = f"{meta['emoji']} {alert.symbol} — {meta['label']}"
    body  = (
        f"Price: {alert.current_price:,.0f} NPR\n"
        f"Zone: {alert.threshold}\n"
        f"{alert.action}"
    )
    if alert.pct_change is not None:
        body = f"Move: {alert.pct_change:+.1f}%\n" + body

    try:
        r = requests.post(
            f"{NTFY_BASE_URL}/{NTFY_TOPIC}",
            data=body.encode("utf-8"),
            headers={
                "Title":    title,
                "Priority": meta["priority"],
                "Tags":     _ntfy_tags(alert.alert_type),
            },
            timeout=10,
        )
        r.raise_for_status()
        print(f"[notifier] Push sent: {title}")
        return True
    except Exception as e:
        print(f"[notifier] Push failed: {e}")
        return False


def _ntfy_tags(alert_type: str) -> str:
    tag_map = {
        "stop_loss":    "rotating_light,skull",
        "full_exit":    "red_circle,moneybag",
        "partial_exit": "yellow_circle,moneybag",
        "buy_zone":     "green_circle,chart_with_upwards_trend",
        "add_zone":     "blue_circle,chart_with_upwards_trend",
        "rapid_up":     "zap,arrow_up",
        "rapid_down":   "zap,arrow_down",
        "daily_digest": "bar_chart",
    }
    return tag_map.get(alert_type, "bell")


# -------------------------------------------------------------------
# Dispatch: send both email + push for each alert
# -------------------------------------------------------------------

def dispatch(alerts: list[Alert], is_digest: bool = False) -> None:
    if not alerts:
        return

    # Always send email (batch all alerts into one email)
    send_email(alerts, is_digest=is_digest)

    # Send individual push notifications (one per alert)
    if not is_digest:
        for alert in alerts:
            send_push(alert)
