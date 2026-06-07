"""
IBKR Portfolio Dashboard - Flask App v2
Strategy-based portfolio management with collapsible strategy groups.
"""

from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
import pandas as pd
from pathlib import Path
import json
import subprocess
import re
from datetime import datetime

from parser import (
    detect_format, parse_positions, parse_trades,
    parse_transaction_history, apply_transactions_to_portfolio,
)

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = Path(__file__).parent / "uploads"
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

DATA_DIR = Path(__file__).parent / "data"
PORTFOLIO_FILE = DATA_DIR / "portfolio.json"
TARGET_FILE = DATA_DIR / "target_allocation.json"

DEFAULT_STRATEGIES = [
    {"id": "dca", "name": "定投仓 (DCA)", "icon": "📊", "color": "#6366f1",
     "desc": "定期定额买入个股和大盘ETF"},
    {"id": "wheel", "name": "轮子策略仓 (Wheel)", "icon": "🎡", "color": "#22c55e",
     "desc": "Sell Put → 被行权 → Covered Call → 卖出"},
    {"id": "leaps", "name": "LEAPS Call仓", "icon": "🚀", "color": "#a855f7",
     "desc": "长期期权（到期1年+）看多策略"},
    {"id": "swing", "name": "波段仓 (Swing)", "icon": "⚡", "color": "#f59e0b",
     "desc": "短线波段交易"},
    {"id": "cash", "name": "现金仓", "icon": "💵", "color": "#3b82f6",
     "desc": "现金储备，等待机会"},
]

# ---- Data Layer ----

DEFAULT_PORTFOLIO = {
    "strategies": DEFAULT_STRATEGIES,
    "positions": [
        # DCA positions (普通策略保持不变)
        {"id":"p1","symbol":"AAPL","strategy":"dca","quantity":150,"avg_price":175.5,"current_price":195.2,"market_value":29280,"pnl":2955,"pnl_pct":11.22,"notes":""},
        {"id":"p2","symbol":"MSFT","strategy":"dca","quantity":80,"avg_price":410,"current_price":445.6,"market_value":35648,"pnl":2848,"pnl_pct":8.68,"notes":""},
        {"id":"p3","symbol":"QQQ","strategy":"dca","quantity":50,"avg_price":460,"current_price":498.3,"market_value":24915,"pnl":1915,"pnl_pct":8.33,"notes":"大盘ETF"},
        {"id":"p4","symbol":"VOO","strategy":"dca","quantity":30,"avg_price":520,"current_price":555.8,"market_value":16674,"pnl":1074,"pnl_pct":6.88,"notes":"S&P500 ETF"},
        # Wheel positions (轮子策略 - 期权格式，增加delta字段)
        {"id":"w1","symbol":"AMZN","strategy":"wheel","wheel_type":"sell_put","strike":185,"expiry":"2026-07-18","premium":3.20,"contracts":2,"quantity":200,"stock_price":195.50,"cost_basis":181.80,"current_option_price":0.45,"market_value":39100,"pnl":640,"pnl_pct":1.83,"status":"等待行权","delta":-0.25,"notes":""},
        {"id":"w2","symbol":"GOOGL","strategy":"wheel","wheel_type":"covered_call","strike":185,"expiry":"2026-08-15","premium":4.50,"contracts":4,"quantity":400,"stock_price":178.60,"cost_basis":150.70,"current_option_price":6.20,"market_value":71440,"pnl":1800,"pnl_pct":2.59,"status":"卖Covered Call","delta":-0.35,"notes":""},
        {"id":"w3","symbol":"TSLA","strategy":"wheel","wheel_type":"sell_put","strike":240,"expiry":"2026-06-20","premium":5.80,"contracts":1,"quantity":100,"stock_price":268.40,"cost_basis":234.20,"current_option_price":0.12,"market_value":26840,"pnl":580,"pnl_pct":2.21,"status":"等待行权","delta":-0.15,"notes":""},
        # LEAPS Call positions (LEAPS Call - 期权格式，增加delta字段)
        {"id":"l1","symbol":"NVDA","strategy":"leaps","strike":900,"expiry":"2028-01-20","contracts":2,"quantity":200,"buy_price":45.80,"current_option_price":82.50,"stock_price":1050.30,"market_value":16500,"pnl":7340,"pnl_pct":80.13,"delta":0.65,"notes":"2028 LEAPS Call"},
        {"id":"l2","symbol":"META","strategy":"leaps","strike":600,"expiry":"2027-01-15","contracts":3,"quantity":300,"buy_price":32.50,"current_option_price":58.20,"stock_price":565.80,"market_value":17460,"pnl":3810,"pnl_pct":39.08,"delta":0.55,"notes":"2027 LEAPS Call"},
        # Swing positions (普通策略保持不变)
        {"id":"p9","symbol":"TSLA","strategy":"swing","quantity":15,"avg_price":245,"current_price":268.4,"market_value":4026,"pnl":351,"pnl_pct":9.55,"notes":"短线持有"},
        {"id":"p10","symbol":"AMD","strategy":"swing","quantity":30,"avg_price":155,"current_price":168.2,"market_value":5046,"pnl":396,"pnl_pct":8.52,"notes":""},
    ],
    "cash": 35000,
    "history": [],
    "cash_flows": [],
    "cash_base_usd": 35000,
}

def load_portfolio():
    if PORTFOLIO_FILE.exists():
        return json.loads(PORTFOLIO_FILE.read_text(encoding="utf-8"))
    # First run: seed with default data
    save_portfolio(DEFAULT_PORTFOLIO)
    return DEFAULT_PORTFOLIO

def save_portfolio(data):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PORTFOLIO_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def add_cash_flow(amount, currency, rate, note="", flow_type="deposit"):
    """
    flow_type: 'deposit' (入金) or 'withdraw' (出金)
    amount: 金额（正数）
    currency: 'CNY' or 'USD'
    rate: USD/CNY 汇率（currency='CNY' 时需要）
    Returns: (success, new_cash_base_usd)
    """
    portfolio = load_portfolio()
    if currency == 'CNY':
        usd = round(amount / rate, 2) if rate else 0
    else:
        usd = round(amount, 2)
    flow = {
        "id": generate_id("cf_"),
        "type": flow_type,
        "currency": currency,
        "original_amount": amount,
        "rate": rate if currency == 'CNY' else None,
        "amount_usd": usd,
        "note": note,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    portfolio.setdefault("cash_flows", []).append(flow)
    if flow_type == "deposit":
        portfolio["cash_base_usd"] = round(portfolio.get("cash_base_usd", 0) + usd, 2)
    else:
        portfolio["cash_base_usd"] = round(portfolio.get("cash_base_usd", 0) - usd, 2)
    save_portfolio(portfolio)
    return True, portfolio["cash_base_usd"]


def migrate_cash_flows(portfolio):
    """迁移旧数据：没有 currency 字段的旧记录默认为 CNY"""
    flows = portfolio.get("cash_flows", [])
    changed = False
    for f in flows:
        if "currency" not in f:
            f["currency"] = "CNY"
            f["original_amount"] = f.get("amount_cny", 0)
            changed = True
    if changed:
        save_portfolio(portfolio)


def generate_id(prefix=""):
    """Generate unique ID with optional prefix"""
    import uuid
    return prefix + str(uuid.uuid4())[:8]

def load_target_allocation():
    if TARGET_FILE.exists():
        return json.loads(TARGET_FILE.read_text(encoding="utf-8"))
    return None

def save_target_allocation(targets):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TARGET_FILE.write_text(json.dumps(targets, indent=2, ensure_ascii=False), encoding="utf-8")

# ---- Price Fetcher (Twelve Data) ----

def fetch_price_twelvedata(symbol, api_key):
    """Fetch latest price via Twelve Data API."""
    try:
        cmd = ['curl', '-s', '--max-time', '10',
               f'https://api.twelvedata.com/price?symbol={symbol}&apikey={api_key}']
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.stdout:
            d = json.loads(result.stdout)
            p = d.get('price')
            if p:
                return float(p)
    except:
        pass
    return None


def refresh_all_prices(api_key):
    """Refresh prices for all positions. Returns updated portfolio or error."""
    portfolio = load_portfolio()
    positions = portfolio.get("positions", [])
    if not positions:
        return portfolio

    updated = 0
    errors = []
    # Deduplicate symbols
    seen = set()
    for p in positions:
        sym = p.get("symbol", "").upper()
        if sym in seen:
            continue
        seen.add(sym)

        price = fetch_price_twelvedata(sym, api_key)
        if price is None:
            errors.append(sym)
            continue

        # Update all positions with this symbol
        for p in positions:
            if p.get("symbol", "").upper() == sym:
                if p["strategy"] in ("dca", "swing"):
                    p["current_price"] = price
                    qty = p.get("quantity", 0)
                    avg = p.get("avg_price", 0)
                    p["market_value"] = round(abs(qty) * price, 2)
                    p["pnl"] = round((price - avg) * qty, 2)
                    p["pnl_pct"] = round((price / avg - 1) * 100, 2) if avg else 0
                elif p["strategy"] in ("wheel", "leaps"):
                    p["stock_price"] = price
                updated += 1

    save_portfolio(portfolio)
    return {"portfolio": portfolio, "updated": updated, "errors": errors}


# ---- Routes ----

@app.route("/")
def index():
    portfolio = load_portfolio()
    targets = load_target_allocation()
    return render_template("dashboard.html", portfolio=portfolio, targets=targets)


@app.route("/api/portfolio", methods=["GET"])
def get_portfolio():
    return jsonify(load_portfolio())


@app.route("/api/portfolio/position", methods=["POST"])
def add_position():
    data = request.get_json()
    portfolio = load_portfolio()

    position = {
        "id": data.get("id", ""),
        "symbol": data.get("symbol", "").upper(),
        "strategy": data.get("strategy", "dca"),
        "notes": data.get("notes", ""),
    }

    # 根据策略类型处理不同字段
    if position["strategy"] == "wheel":
        # Wheel 策略 - 期权字段
        position["wheel_type"] = data.get("wheel_type", "sell_put")
        position["strike"] = float(data.get("strike", 0))
        position["expiry"] = data.get("expiry", "")
        position["premium"] = float(data.get("premium", 0))
        position["contracts"] = int(data.get("contracts", 1))
        position["quantity"] = position["contracts"] * 100  # 股数 = 合约数 * 100
        position["stock_price"] = float(data.get("stock_price", 0))
        position["cost_basis"] = float(data.get("cost_basis", 0))
        position["current_option_price"] = float(data.get("current_option_price", 0))
        position["market_value"] = float(data.get("market_value", 0))
        position["pnl"] = float(data.get("pnl", 0))
        position["pnl_pct"] = float(data.get("pnl_pct", 0))
        position["status"] = data.get("status", "等待行权")
        position["delta"] = float(data.get("delta", 0))
    elif position["strategy"] == "leaps":
        # LEAPS 策略 - 期权字段
        position["strike"] = float(data.get("strike", 0))
        position["expiry"] = data.get("expiry", "")
        position["contracts"] = int(data.get("contracts", 1))
        position["quantity"] = position["contracts"] * 100  # 股数 = 合约数 * 100
        position["buy_price"] = float(data.get("buy_price", 0))
        position["current_option_price"] = float(data.get("current_option_price", 0))
        position["stock_price"] = float(data.get("stock_price", 0))
        position["market_value"] = position["contracts"] * 100 * position["current_option_price"]
        position["pnl"] = (position["current_option_price"] - position["buy_price"]) * position["contracts"] * 100
        position["pnl_pct"] = round((position["current_option_price"] / position["buy_price"] - 1) * 100, 2) if position["buy_price"] else 0
        position["delta"] = float(data.get("delta", 0))
    else:
        # 普通策略 (DCA, Swing) - 原始字段
        position["quantity"] = float(data.get("quantity", 0))
        position["avg_price"] = float(data.get("avg_price", 0))
        position["current_price"] = float(data.get("current_price", data.get("avg_price", 0)))
        qty = position["quantity"]
        ap = position["avg_price"]
        cp = position["current_price"]
        position["market_value"] = round(abs(qty) * cp, 2)
        position["pnl"] = round((cp - ap) * qty, 2)
        position["pnl_pct"] = round((cp / ap - 1) * 100, 2) if ap else 0

    # Update or add (DCA/Swing同策略同symbol自动合并)
    if position["id"]:
        for i, p in enumerate(portfolio["positions"]):
            if p["id"] == position["id"]:
                position["id"] = p["id"]
                portfolio["positions"][i] = position
                break
        else:
            portfolio["positions"].append(position)
    elif position["strategy"] in ("dca", "swing"):
        # 查找同策略下同symbol的持仓，合并
        merged = False
        for i, p in enumerate(portfolio["positions"]):
            if (p["strategy"] == position["strategy"]
                    and p.get("symbol", "").upper() == position["symbol"].upper()
                    and "avg_price" in p):
                # 加权平均成本
                old_qty = p["quantity"]
                old_avg = p["avg_price"]
                new_qty = position["quantity"]
                new_avg = position["avg_price"]
                total_qty = old_qty + new_qty
                p["quantity"] = total_qty
                p["avg_price"] = round((old_qty * old_avg + new_qty * new_avg) / total_qty, 2)
                p["current_price"] = position["current_price"]
                p["market_value"] = round(abs(total_qty) * p["current_price"], 2)
                p["pnl"] = round((p["current_price"] - p["avg_price"]) * total_qty, 2)
                p["pnl_pct"] = round((p["current_price"] / p["avg_price"] - 1) * 100, 2) if p["avg_price"] else 0
                merged = True
                position = p
                break
        if not merged:
            import uuid
            position["id"] = str(uuid.uuid4())[:8]
            portfolio["positions"].append(position)
    else:
        import uuid
        position["id"] = str(uuid.uuid4())[:8]
        portfolio["positions"].append(position)

    save_portfolio(portfolio)
    return jsonify({"success": True, "position": position, "portfolio": portfolio})


@app.route("/api/portfolio/position/<pos_id>", methods=["DELETE"])
def delete_position(pos_id):
    portfolio = load_portfolio()
    portfolio["positions"] = [p for p in portfolio["positions"] if p["id"] != pos_id]
    save_portfolio(portfolio)
    return jsonify({"success": True, "portfolio": portfolio})


@app.route("/api/portfolio/cash", methods=["POST"])
def update_cash():
    data = request.get_json()
    portfolio = load_portfolio()
    portfolio["cash"] = float(data.get("cash", 0))
    save_portfolio(portfolio)
    return jsonify({"success": True, "portfolio": portfolio})


# ---- Cash Flow ----

@app.route("/api/cash-flow", methods=["GET", "POST"])
def cash_flow():
    """GET: 获取流水列表 / POST: 新增入金/出金记录"""
    portfolio = load_portfolio()
    migrate_cash_flows(portfolio)
    portfolio.setdefault('cash_flows', [])
    if request.method == 'POST':
        data = request.get_json()
        currency = data.get('currency', 'CNY')
        amount = float(data.get('amount', 0))
        rate = float(data.get('rate', 7.25)) if currency == 'CNY' else None
        note = data.get('note', '')
        flow_type = data.get('type', 'deposit')
        if amount <= 0:
            return jsonify({"error": "金额必须大于0"}), 400
        success, new_cash = add_cash_flow(amount, currency, rate, note, flow_type)
        portfolio = load_portfolio()
        return jsonify({"success": True, "cash_base_usd": portfolio['cash_base_usd'], "flows": portfolio['cash_flows']})
    return jsonify({"flows": portfolio['cash_flows'], "cash_base_usd": portfolio.get('cash_base_usd', 0)})


@app.route("/api/cash-flow/<flow_id>", methods=["DELETE"])
def delete_cash_flow(flow_id):
    portfolio = load_portfolio()
    flows = portfolio.get('cash_flows', [])
    flow = next((f for f in flows if f['id'] == flow_id), None)
    if flow:
        if flow['type'] == 'deposit':
            portfolio['cash_base_usd'] = round(portfolio.get('cash_base_usd', 0) - flow['amount_usd'], 2)
        else:
            portfolio['cash_base_usd'] = round(portfolio.get('cash_base_usd', 0) + flow['amount_usd'], 2)
        portfolio['cash_flows'] = [f for f in flows if f['id'] != flow_id]
        save_portfolio(portfolio)
        return jsonify({"success": True, "cash_base_usd": portfolio['cash_base_usd']})
    return jsonify({"error": "记录不存在"}), 404


@app.route("/api/portfolio/transactions/upload", methods=["POST"])
def upload_transactions():
    """Upload IBKR transaction history CSV (中文交易历史)."""
    portfolio = load_portfolio()
    if "file" not in request.files:
        return jsonify({"error": "请选择文件"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "文件名为空"}), 400

    filename = secure_filename(file.filename)
    filepath = app.config["UPLOAD_FOLDER"] / filename
    filepath.parent.mkdir(parents=True, exist_ok=True)
    file.save(filepath)

    try:
        transactions = parse_transaction_history(str(filepath))
        portfolio, new_tx = apply_transactions_to_portfolio(transactions, portfolio)
        save_portfolio(portfolio)
        return jsonify({
            "success": True,
            "transactions_count": len(new_tx),
            "total_transactions": len(portfolio.get("transactions", [])),
            "cash_base_usd": portfolio.get("cash_base_usd", 0),
            "message": f"成功导入 {len(new_tx)} 条新交易记录"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/portfolio/strategy", methods=["POST"])
def add_strategy():
    data = request.get_json()
    portfolio = load_portfolio()
    strategy = {
        "id": data.get("id", str(__import__("uuid").uuid4())[:8]),
        "name": data.get("name", "新策略"),
        "icon": data.get("icon", "📁"),
        "color": data.get("color", "#8b8d9a"),
        "desc": data.get("desc", ""),
    }
    portfolio["strategies"].append(strategy)
    save_portfolio(portfolio)
    return jsonify({"success": True, "portfolio": portfolio})


@app.route("/api/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "没有文件"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "文件名为空"}), 400

    filename = secure_filename(file.filename)
    filepath = app.config["UPLOAD_FOLDER"] / filename
    filepath.parent.mkdir(parents=True, exist_ok=True)
    file.save(str(filepath))

    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(filepath, skiprows=1, low_memory=False)
        elif filename.endswith(".xlsx"):
            df = pd.read_excel(filepath, skiprows=1)
        else:
            return jsonify({"error": "仅支持CSV和Excel文件"}), 400

        fmt = detect_format(df)
        upload_type = request.form.get("type", "positions")

        if upload_type == "trades":
            trades = parse_trades(df)
            return jsonify({"success": True, "trades": trades, "count": len(trades)})
        else:
            positions = parse_positions(df, fmt)
            if not positions:
                return jsonify({"error": "未解析到持仓数据，请检查文件格式"}), 400
            # Import into portfolio under specified strategy or DCA default
            strategy = request.form.get("strategy", "dca")
            portfolio = load_portfolio()
            import uuid
            for p in positions:
                p["id"] = str(uuid.uuid4())[:8]
                p["strategy"] = strategy
                p["notes"] = ""
                portfolio["positions"].append(p)
            save_portfolio(portfolio)
            return jsonify({"success": True, "count": len(positions), "portfolio": portfolio})
    except Exception as e:
        return jsonify({"error": "解析失败: %s" % str(e)}), 500


@app.route("/api/refresh-prices", methods=["POST"])
def refresh_prices():
    data = request.get_json() or {}
    api_key = data.get("api_key", "demo")
    result = refresh_all_prices(api_key)
    if isinstance(result, dict) and "portfolio" in result:
        return jsonify({"success": True, "updated": result["updated"], "errors": result["errors"], "portfolio": result["portfolio"]})
    else:
        return jsonify({"success": True, "portfolio": result})


@app.route("/api/targets", methods=["GET"])
def get_targets():
    return jsonify({"targets": load_target_allocation() or []})

@app.route("/api/targets", methods=["POST"])
def set_targets():
    data = request.get_json()
    save_target_allocation(data.get("targets", []))
    return jsonify({"success": True})


@app.route("/api/portfolio/position/<pos_id>/close", methods=["POST"])
def close_position(pos_id):
    """平仓API - 移除持仓并创建历史记录"""
    data = request.get_json()  # {"close_price": 0.15}
    portfolio = load_portfolio()
    
    # 查找持仓
    position = None
    position_index = -1
    for i, p in enumerate(portfolio["positions"]):
        if p["id"] == pos_id:
            position = p
            position_index = i
            break
    
    if not position:
        return jsonify({"error": "持仓不存在"}), 404
    
    close_price = float(data.get("close_price", 0))
    
    # 创建历史记录
    history = portfolio.get("history", [])
    
    from datetime import datetime
    close_date = datetime.now().strftime("%Y-%m-%d")
    
    if position["strategy"] == "wheel":
        # Wheel策略平仓
        open_premium = position.get("premium", 0)
        pnl = round((open_premium - close_price) * position["contracts"] * 100, 2)
        pnl_pct = round((open_premium / close_price - 1) * 100, 2) if close_price > 0 else 0
        
        record = {
            "id": generate_id("h_"),
            "symbol": position["symbol"],
            "strategy": "wheel",
            "wheel_type": position.get("wheel_type", ""),
            "strike": position["strike"],
            "expiry": position["expiry"],
            "contracts": position["contracts"],
            "open_premium": open_premium,
            "close_price": close_price,
            "open_delta": position.get("delta", 0),
            "open_date": "",  # 可由前端传入或根据创建时间推断
            "close_date": close_date,
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "status": "已平仓",
            "notes": ""
        }
    elif position["strategy"] == "leaps":
        # LEAPS策略平仓
        open_price = position.get("buy_price", 0)
        pnl = round((close_price - open_price) * position["contracts"] * 100, 2)
        pnl_pct = round((close_price / open_price - 1) * 100, 2) if open_price > 0 else 0
        
        record = {
            "id": generate_id("h_"),
            "symbol": position["symbol"],
            "strategy": "leaps",
            "strike": position["strike"],
            "expiry": position["expiry"],
            "contracts": position["contracts"],
            "open_price": open_price,
            "close_price": close_price,
            "open_delta": position.get("delta", 0),
            "open_date": "",
            "close_date": close_date,
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "status": "已平仓",
            "notes": ""
        }
    else:
        return jsonify({"error": "该策略不支持平仓操作"}), 400
    
    # 从历史中移除持仓
    portfolio["positions"].pop(position_index)
    
    # 添加历史记录
    history.append(record)
    portfolio["history"] = history
    
    # 更新现金（LEAPS平仓收入现金）
    if position["strategy"] == "leaps":
        portfolio["cash"] = portfolio.get("cash", 0) + close_price * position["contracts"] * 100
    # Wheel策略：已收premium已计入，平仓买入期权支出暂不自动调整cash，让用户手动管理
    
    save_portfolio(portfolio)
    return jsonify({"success": True, "history": record, "portfolio": portfolio})


@app.route("/api/history", methods=["GET"])
def get_history():
    """获取所有历史交易记录"""
    portfolio = load_portfolio()
    return jsonify({"history": portfolio.get("history", [])})


@app.route("/api/history", methods=["DELETE"])
def clear_history():
    """清空历史交易记录"""
    portfolio = load_portfolio()
    portfolio["history"] = []
    save_portfolio(portfolio)
    return jsonify({"success": True})


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5050))
    app.run(debug=True, port=port, host="0.0.0.0")
