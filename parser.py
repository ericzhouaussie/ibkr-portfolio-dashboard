"""
IBKR Portfolio Dashboard - Report Parser
Supports Flex Query CSV and Daily Activity Report formats.
"""

import pandas as pd
from datetime import datetime
from pathlib import Path
import json

DATA_DIR = Path(__file__).parent / "data"
TARGET_FILE = DATA_DIR / "target_allocation.json"


def detect_format(df):
    """Detect IBKR report format from column headers."""
    cols = set(c.upper() for c in df.columns)
    if "SYMBOL" in cols and ("POSITION" in cols or "QTY" in cols):
        return "flex_positions"
    if "SYMBOL" in cols and ("TRADEPRICE" in cols or "PRICE" in cols):
        return "flex_trades"
    if "SYMBOL" in cols or "DESCRIPTION" in cols:
        return "daily_report"
    return "unknown"


def _to_float(val):
    try:
        s = str(val).strip().replace(",", "")
        if s in ("", "--", "-", "N/A"):
            return 0.0
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def parse_positions(df, fmt):
    """Parse positions from detected format into standard dict list."""
    positions = []
    if fmt == "flex_positions":
        for _, row in df.iterrows():
            sym = str(row.get("Symbol", "")).strip()
            if not sym or sym in ("", "Total", "---"):
                continue
            qty = _to_float(row.get("Quantity", row.get("Position", 0)))
            if qty == 0:
                continue
            avg_price = _to_float(row.get("Avg Price", row.get("Average Cost", 0)))
            current_price = _to_float(row.get("Last", row.get("Mark", avg_price)))
            positions.append({
                "symbol": sym,
                "quantity": qty,
                "avg_price": round(avg_price, 4),
                "current_price": round(current_price, 4),
                "market_value": round(abs(qty) * current_price, 2),
                "pnl": round((current_price - avg_price) * qty, 2),
                "pnl_pct": round((current_price / avg_price - 1) * 100, 2) if avg_price else 0,
            })
    elif fmt == "daily_report":
        for _, row in df.iterrows():
            sym = str(row.get("Symbol", "")).strip()
            if not sym:
                continue
            qty = _to_float(row.get("Quantity", row.get("Shares", 0)))
            if qty == 0:
                continue
            avg_price = _to_float(row.get("Avg Price", row.get("Cost Basis", 0)))
            current_price = _to_float(row.get("Current Price", row.get("Market Price", avg_price)))
            positions.append({
                "symbol": sym,
                "quantity": qty,
                "avg_price": round(avg_price, 4),
                "current_price": round(current_price, 4),
                "market_value": round(abs(qty) * current_price, 2),
                "pnl": round((current_price - avg_price) * qty, 2),
                "pnl_pct": round((current_price / avg_price - 1) * 100, 2) if avg_price else 0,
            })
    return positions


def parse_trades(df):
    """Parse trade history from Flex Query trades format."""
    trades = []
    for _, row in df.iterrows():
        sym = str(row.get("Symbol", "")).strip()
        if not sym:
            continue
        trades.append({
            "date": str(row.get("Date/Time", row.get("Trade Date", "")))[:10],
            "symbol": sym,
            "side": str(row.get("Side", row.get("Buy/Sell", ""))).strip(),
            "quantity": _to_float(row.get("Quantity", row.get("Qty", 0))),
            "price": _to_float(row.get("Trade Price", row.get("Price", 0))),
            "commission": _to_float(row.get("Commission", 0)),
            "total": _to_float(row.get("Total", row.get("Net Amount", 0))),
        })
    return trades


def save_positions(positions, label=""):
    """Save parsed positions to data directory."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ts = label or datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath = DATA_DIR / ("positions_%s.json" % ts)
    filepath.write_text(json.dumps(positions, indent=2, ensure_ascii=False), encoding="utf-8")
    return filepath


def load_latest_positions():
    """Load most recent positions file."""
    files = sorted(DATA_DIR.glob("positions_*.json"))
    if not files:
        return None
    return json.loads(files[-1].read_text(encoding="utf-8"))


def save_target_allocation(targets):
    """Save target allocation config."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TARGET_FILE.write_text(json.dumps(targets, indent=2, ensure_ascii=False), encoding="utf-8")


def load_target_allocation():
    """Load target allocation config."""
    if not TARGET_FILE.exists():
        return None
    return json.loads(TARGET_FILE.read_text(encoding="utf-8"))
