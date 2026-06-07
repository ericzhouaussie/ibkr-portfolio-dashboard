"""
IBKR Portfolio Dashboard - Report Parser
Supports:
  1. Flex Query positions CSV
  2. Flex Query trades CSV
  3. Transaction History CSV (中文 IBKR 交易历史)
"""

import pandas as pd
from datetime import datetime
from pathlib import Path
import json
import re

DATA_DIR = Path(__file__).parent / "data"
TARGET_FILE = DATA_DIR / "target_allocation.json"


# ─── Helpers ─────────────────────────────────────────────────────────────

def _to_float(val):
    try:
        s = str(val).strip().replace(",", "")
        if s in ("", "--", "-", "N/A", "nan"):
            return 0.0
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def _parse_option_symbol(code, description=""):
    """
    Parse IBKR option symbol / description into dict.
    code: 'NVDA  260702P00195000' or 'NVDA 02JUL26 195 P'
    Returns: {symbol, expiry, strike, type} or None
    """
    code = str(code or "").strip()
    desc = str(description or "")

    # Pattern 1: IBKR normalized format: SYMBOL + YYMMDD + C/P + strike padded
    m = re.match(r'^([A-Z]+)\s+(\d{6})([CP])(\d+)$', code.replace(" ", ""))
    if m:
        sym, yymmdd, cp, strike_str = m.groups()
        yy = int(yymmdd[:2]) + 2000
        mm = int(yymmdd[2:4])
        dd = int(yymmdd[4:6])
        expiry = f"{yy}-{mm:02d}-{dd:02d}"
        strike = int(strike_str) / 1000 if len(strike_str) >= 5 else int(strike_str)
        opt_type = "call" if cp == "C" else "put"
        return {"symbol": sym, "expiry": expiry, "strike": strike, "option_type": opt_type}

    # Pattern 2: Human-readable: 'NVDA 02JUL26 195 P'
    m2 = re.search(r'(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})\s+([\d.]+)\s+([CP])', desc)
    if m2:
        day, mon, yy_short, strike, cp = m2.groups()
        mon_map = {"JAN":"01","FEB":"02","MAR":"03","APR":"04","MAY":"05","JUN":"06",
                   "JUL":"07","AUG":"08","SEP":"09","OCT":"10","NOV":"11","DEC":"12"}
        yy = int("20" + yy_short)
        mm = mon_map[mon]
        expiry = f"{yy}-{mm}-{int(day):02d}"
        opt_type = "call" if cp == "C" else "put"
        # symbol from description
        sym_match = re.search(r'^([A-Z]+)', desc)
        sym = sym_match.group(1) if sym_match else code[:4]
        return {"symbol": sym, "expiry": expiry, "strike": float(strike), "option_type": opt_type}

    return None


def _classify_transaction(row):
    """
    Classify a transaction row dict into:
      category:  'stock_buy' | 'stock_sell' | 'option_buy' | 'option_sell'
                 | 'dividend' | 'tax' | 'deposit' | 'withdrawal' | 'interest'
                 | 'fx' | 'adjustment' | 'other'
      strategy:  'dca' | 'swing' | 'wheel' | 'leaps' | 'cash' | None
    """
    desc = str(row.get("说明", row.get("description", "")))
    ttype = str(row.get("交易类型", row.get("type", "")))
    code = str(row.get("代码", row.get("code", "")))
    qty = _to_float(row.get("数量", row.get("quantity", 0)))
    net = _to_float(row.get("净额", row.get("net", 0)))

    # --- Deposit / Withdrawal ---
    if "电子资金转账" in desc or "存款" in desc or ttype == "存款":
        if net > 0:
            return "deposit", "cash"
        else:
            return "withdrawal", "cash"

    # --- Dividend ---
    if "股息" in desc or ttype == "股息" or ttype == "Dividend":
        return "dividend", "cash"

    # --- Withholding tax ---
    if "预扣税" in desc or "税收" in desc or ttype == "外国预扣税":
        return "tax", "cash"

    # --- Interest ---
    if "利息" in desc:
        if "借方" in desc:
            return "interest_debit", "cash"
        else:
            return "interest_credit", "cash"

    # --- FX ---
    if "外汇" in desc or "FX" in desc or ttype == "外汇交易组成部分":
        return "fx", "cash"

    # --- FX Translation P&L (unrealized, skip cash impact) ---
    if "FX Translations" in desc or "调整" in desc:
        return "adjustment", "cash"

    # --- Stock buy / sell ---
    if ttype in ("买", "卖") and code and code != "-":
        # Check if it's an option by looking at description
        is_option = any(k in desc for k in [" P ", " C ", " PUT", " CALL"]) or re.search(r'\d{1,2}[JFMASOND]\w+', code)
        if not is_option:
            if ttype == "买":
                return "stock_buy", None   # strategy TBD by caller
            else:
                return "stock_sell", None

    # --- Option buy / sell ---
    if ttype in ("买", "卖"):
        opt = _parse_option_symbol(code, desc)
        if opt:
            if ttype == "买":
                # Determine if LEAPS (expiry > 1 year from now)
                try:
                    from datetime import date
                    exp = datetime.strptime(opt["expiry"], "%Y-%m-%d").date()
                    is_leaps = (exp - date.today()).days > 365
                except Exception:
                    is_leaps = False
                if is_leaps:
                    return "option_buy_leaps", "leaps"
                else:
                    return "option_buy_wheel", "wheel"
            else:
                return "option_sell", "wheel"

    return "other", None


# ─── Format detection ───────────────────────────────────────────────────────

def detect_format(df):
    """Detect IBKR report format from column headers."""
    cols = set(str(c).upper() for c in df.columns)
    if "SYMBOL" in cols and ("POSITION" in cols or "QTY" in cols):
        return "flex_positions"
    if "SYMBOL" in cols and ("TRADEPRICE" in cols or "PRICE" in cols):
        return "flex_trades"
    # Check for Chinese Transaction History format
    cols_zh = set(str(c).strip() for c in df.columns)
    if "日期" in cols_zh and "说明" in cols_zh:
        return "transaction_history"
    if "DESCRIPTION" in cols or "DESCRIPTION" in cols_zh:
        return "daily_report"
    return "unknown"


# ─── Flex / Daily parsers (unchanged) ───────────────────────────────────

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


# ─── Transaction History parser (NEW) ────────────────────────────────────

def parse_transaction_history(filepath):
    """
    Parse IBKR Chinese Transaction History CSV.
    Returns: {transactions: [...], cash_delta: float, positions_delta: [...]}
    
    Transactions each have:
      date, account, description, type, code, quantity, price, currency,
      total, commission, net, category, strategy
    """
    filepath = Path(filepath)
    lines = filepath.read_text(encoding="utf-8-sig").splitlines()

    # Find the Transaction History header row
    data_start = None
    for i, line in enumerate(lines):
        if "Transaction History,Header" in line or (line.startswith("Transaction History") and "日期" in line):
            data_start = i + 1
            break
        # Also handle: first column = "日期"
        if line.startswith("日期,") or ",日期," in line:
            data_start = i + 1
            break

    if data_start is None:
        # Try to find by scanning for "Transaction History,Data"
        for i, line in enumerate(lines):
            if line.startswith("Transaction History,Data,") or ",Transaction History,Data," in line:
                # Find header before this
                for j in range(i, max(0, i-5), -1):
                    if "日期" in lines[j] and "说明" in lines[j]:
                        data_start = i
                        break
                break

    if data_start is None:
        raise ValueError("无法识别交易历史文件格式：找不到 'Transaction History' 数据区")

    # Read data rows (skip Statement/* and 总结/* rows)
    transactions = []
    for line in lines[data_start:]:
        line = line.strip()
        if not line:
            continue
        # Skip non-transaction rows
        if line.startswith("Statement,") or line.startswith("总结,"):
            continue
        if not line.startswith("Transaction History,Data,"):
            # Maybe comma-separated without prefix — try parsing directly
            pass

        # Parse: Transaction History,Data,<date>,<account>,<desc>,<type>,<code>,<qty>,<price>,<currency>,<total>,<commission>,<net>
        # Split on comma but respect quoted fields
        parts = _split_csv_line(line)
        
        # Find the part that looks like a date (YYYY-MM-DD)
        date_idx = None
        for i, p in enumerate(parts):
            if re.match(r'\d{4}-\d{2}-\d{2}', p):
                date_idx = i
                break
        
        if date_idx is None:
            continue
        
        date = parts[date_idx]
        account = parts[date_idx + 1] if date_idx + 1 < len(parts) else ""
        desc = parts[date_idx + 2] if date_idx + 2 < len(parts) else ""
        ttype = parts[date_idx + 3] if date_idx + 3 < len(parts) else ""
        code = parts[date_idx + 4] if date_idx + 4 < len(parts) else ""
        qty_str = parts[date_idx + 5] if date_idx + 5 < len(parts) else "0"
        price_str = parts[date_idx + 6] if date_idx + 6 < len(parts) else "0"
        currency = parts[date_idx + 7] if date_idx + 7 < len(parts) else ""
        total_str = parts[date_idx + 8] if date_idx + 8 < len(parts) else "0"
        commission_str = parts[date_idx + 9] if date_idx + 9 < len(parts) else "0"
        net_str = parts[date_idx + 10] if date_idx + 10 < len(parts) else "0"

        qty = _to_float(qty_str)
        price = _to_float(price_str)
        total = _to_float(total_str)
        commission = _to_float(commission_str)
        net = _to_float(net_str)

        category, suggested_strategy = _classify_transaction({
            "说明": desc, "交易类型": ttype, "代码": code,
            "数量": qty, "净额": net
        })

        tx = {
            "date": date,
            "account": account,
            "description": desc,
            "type": ttype,
            "code": code,
            "quantity": qty,
            "price": price,
            "currency": currency,
            "total": total,
            "commission": commission,
            "net": net,
            "category": category,
            "strategy": suggested_strategy,   # May be None — needs user assignment
            "processed": False,
        }
        transactions.append(tx)

    return transactions


def _split_csv_line(line):
    """
    Split a CSV line on commas, but don't split inside quoted fields.
    Handles IBKR format where fields may have commas inside quotes.
    """
    parts = []
    current = []
    in_quotes = False
    i = 0
    while i < len(line):
        c = line[i]
        if c == '"' and (i == 0 or line[i-1] != '\\'):
            in_quotes = not in_quotes
        elif c == ',' and not in_quotes:
            parts.append(''.join(current).strip())
            current = []
            i += 1
            continue
        current.append(c)
        i += 1
    parts.append(''.join(current).strip())
    return parts


def apply_transactions_to_portfolio(transactions, portfolio):
    """
    Apply transactions to portfolio:
      - Update cash_base_usd (from cash-impacting transactions)
      - Store transactions in portfolio["transactions"]
      - Do NOT auto-update positions (too complex; use IBKR position upload instead)
    Returns: (updated_portfolio, new_transactions_list)
    """
    import copy, uuid
    pf = copy.deepcopy(portfolio)
    
    pf.setdefault("cash_base_usd", 0)
    pf.setdefault("transactions", [])
    
    # Build set of existing transaction keys to avoid duplicate imports
    existing_keys = set()
    for t in pf.get("transactions", []):
        key = t.get("date", "") + "|" + t.get("description", "")[:40]
        existing_keys.add(key)
    
    cash_delta = 0.0
    new_transactions = []
    
    for tx in transactions:
        cat = tx.get("category", "other")
        net = tx.get("net", 0)
        
        # Cash impact: skip FX translation adjustments (unrealized P&L)
        if cat not in ("adjustment",):
            cash_delta += net
        
        tx["processed"] = True
        key = tx.get("date", "") + "|" + tx.get("description", "")[:40]
        if key not in existing_keys:
            # Assign ID
            tx["id"] = "txn_" + uuid.uuid4().hex[:8]
            new_transactions.append(tx)
    
    # Only apply cash delta from truly NEW transactions
    new_cash_delta = sum(
        t.get("net", 0) for t in new_transactions
        if t.get("category", "other") not in ("adjustment",)
    )
    pf["cash_base_usd"] = round(pf.get("cash_base_usd", 0) + new_cash_delta, 2)
    
    # Append new transactions
    pf["transactions"].extend(new_transactions)
    
    return pf, new_transactions


def _extract_symbol(code, description=""):
    """Extract a stock/ETF symbol from IBKR code or description."""
    code = str(code or "").strip()
    desc = str(description or "")
    
    # Code is a plain symbol (not an option)
    if code and code != "-" and not re.search(r'\d', code):
        return code.split()[0]
    
    # Extract from description: 'XXX(US....) ...'
    m = re.search(r'([A-Z]{2,10})\s*\(US', desc)
    if m:
        return m.group(1)
    
    # Extract from description: 'XXX INC' or 'XXX HOLDINGS'
    m2 = re.search(r'^([A-Z]{2,10})\s+(INC|HOLDINGS|CORP|TECHNOLOGY|LTD|GLOBAL)', desc, re.IGNORECASE)
    if m2:
        return m2.group(1)
    
    return None


# ─── Save / Load helpers (unchanged) ─────────────────────────────────────

def save_positions(positions, label=""):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ts = label or datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath = DATA_DIR / ("positions_%s.json" % ts)
    filepath.write_text(json.dumps(positions, indent=2, ensure_ascii=False), encoding="utf-8")
    return filepath


def load_latest_positions():
    files = sorted(DATA_DIR.glob("positions_*.json"))
    if not files:
        return None
    return json.loads(files[-1].read_text(encoding="utf-8"))


def save_target_allocation(targets):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TARGET_FILE.write_text(json.dumps(targets, indent=2, ensure_ascii=False), encoding="utf-8")


def load_target_allocation():
    if not TARGET_FILE.exists():
        return None
    return json.loads(TARGET_FILE.read_text(encoding="utf-8"))
