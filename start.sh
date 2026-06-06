#!/bin/bash
# IBKR Portfolio Dashboard - 启动脚本
cd "$(dirname "$0")"

# 检查Python3
if ! command -v python3 &>/dev/null; then
    echo "❌ 需要Python3"
    exit 1
fi

# 安装依赖
echo "📦 检查依赖..."
python3 -c "import flask, pandas" 2>/dev/null || {
    echo "📦 安装依赖中..."
    pip3 install flask pandas --quiet
}

# 创建必要目录
mkdir -p uploads data

# 启动
echo "🚀 启动 IBKR Portfolio Dashboard..."
echo "📍 访问 http://localhost:5050"
echo "按 Ctrl+C 停止"
echo ""
python3 app.py
