# IBKR Portfolio Dashboard

一键上传IBKR交易报告，生成可视化持仓仪表盘，支持与目标仓位配比对比。

## 功能

- 📤 **一键上传**：支持IBKR Flex Query CSV导出和每日账户报告
- 📊 **持仓可视化**：资产分布饼图、个股仓位条形图、盈亏热力图
- 🎯 **目标对比**：设定目标仓位配比，与实际持仓实时对比
- 📈 **进度追踪**：总资产进度条（百万美元挑战风格）
- 📱 **响应式**：适配桌面和移动端

## 快速开始

```bash
pip install -r requirements.txt
python app.py
```

访问 http://localhost:5000

## 支持的IBKR数据格式

1. **Flex Query (推荐)**：在IBKR中创建Flex Query → 导出CSV → 上传
2. **每日账户活动报告**：Account → Reports → Daily → 选择日期下载
3. **手动输入**：支持手动添加持仓

## 项目结构

```
ibkr-portfolio-dashboard/
├── app.py              # Flask主应用
├── parser.py           # IBKR报告解析器
├── requirements.txt    # 依赖
├── templates/
│   └── dashboard.html  # 仪表盘页面
├── static/
│   ├── css/style.css
│   └── js/dashboard.js
├── uploads/            # 上传文件存储
└── data/               # 持仓数据存储
```

## License

MIT
