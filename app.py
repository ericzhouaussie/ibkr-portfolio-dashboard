"""
IBKR Portfolio Dashboard - Flask App v2
Strategy-based portfolio management with collapsible strategy groups.
"""

from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
import pandas as pd
from pathlib import Path
import json

from parser import detect_format, parse_positions, parse_trades

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
        {"id":"p1","symbol":"AAPL","strategy":"dca","quantity":150,"avg_price":175.5,"current_price":195.2,"market_value":29280,"pnl":2955,"pnl_pct":11.22,"notes":""},
        {"id":"p2","symbol":"MSFT","strategy":"dca","quantity":80,"avg_price":410,"current_price":445.6,"market_value":35648,"pnl":2848,"pnl_pct":8.68,"notes":""},
        {"id":"p3","symbol":"QQQ","strategy":"dca","quantity":50,"avg_price":460,"current_price":498.3,"market_value":24915,"pnl":1915,"pnl_pct":8.33,"notes":"大盘ETF"},
        {"id":"p4","symbol":"VOO","strategy":"dca","quantity":30,"avg_price":520,"current_price":555.8,"market_value":16674,"pnl":1074,"pnl_pct":6.88,"notes":"S&P500 ETF"},
        {"id":"p5","symbol":"AMZN","strategy":"wheel","quantity":60,"avg_price":185,"current_price":212.4,"market_value":12744,"pnl":1644,"pnl_pct":14.81,"notes":"Sell Put接盘"},
        {"id":"p6","symbol":"GOOGL","strategy":"wheel","quantity":40,"avg_price":155.2,"current_price":178.6,"market_value":7144,"pnl":936,"pnl_pct":15.08,"notes":""},
        {"id":"p7","symbol":"NVDA","strategy":"leaps","quantity":20,"avg_price":880,"current_price":1050.3,"market_value":21006,"pnl":3406,"pnl_pct":19.35,"notes":"2028 LEAPS Call"},
        {"id":"p8","symbol":"META","strategy":"leaps","quantity":25,"avg_price":480,"current_price":565.8,"market_value":14145,"pnl":2145,"pnl_pct":17.88,"notes":"2027 LEAPS Call"},
        {"id":"p9","symbol":"TSLA","strategy":"swing","quantity":15,"avg_price":245,"current_price":268.4,"market_value":4026,"pnl":351,"pnl_pct":9.55,"notes":"短线持有"},
        {"id":"p10","symbol":"AMD","strategy":"swing","quantity":30,"avg_price":155,"current_price":168.2,"market_value":5046,"pnl":396,"pnl_pct":8.52,"notes":""},
    ],
    "cash": 35000,
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

def load_target_allocation():
    if TARGET_FILE.exists():
        return json.loads(TARGET_FILE.read_text(encoding="utf-8"))
    return None

def save_target_allocation(targets):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TARGET_FILE.write_text(json.dumps(targets, indent=2, ensure_ascii=False), encoding="utf-8")


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
        "quantity": float(data.get("quantity", 0)),
        "avg_price": float(data.get("avg_price", 0)),
        "current_price": float(data.get("current_price", data.get("avg_price", 0))),
        "notes": data.get("notes", ""),
    }
    qty = position["quantity"]
    ap = position["avg_price"]
    cp = position["current_price"]
    position["market_value"] = round(abs(qty) * cp, 2)
    position["pnl"] = round((cp - ap) * qty, 2)
    position["pnl_pct"] = round((cp / ap - 1) * 100, 2) if ap else 0

    # Update or add
    if position["id"]:
        for i, p in enumerate(portfolio["positions"]):
            if p["id"] == position["id"]:
                position["id"] = p["id"]
                portfolio["positions"][i] = position
                break
        else:
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


@app.route("/api/targets", methods=["GET"])
def get_targets():
    return jsonify({"targets": load_target_allocation() or []})

@app.route("/api/targets", methods=["POST"])
def set_targets():
    data = request.get_json()
    save_target_allocation(data.get("targets", []))
    return jsonify({"success": True})


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5050))
    app.run(debug=True, port=port, host="0.0.0.0")
