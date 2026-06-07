// ===== IBKR Portfolio Dashboard v2 =====
// Strategy-based management with collapsible groups

let portfolio = window.__PORTFOLIO__ || {strategies:[], positions:[], cash:0};
let targetAlloc = window.__TARGETS__ || [];
let historyList = [];  // 存储历史记录

// === Helpers ===
function fmtNum(n) {
  if (n == null) return '$0';
  const abs = Math.abs(n);
  const prefix = n < 0 ? '-' : '';
  if (abs >= 1e6) return prefix + '$' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return prefix + '$' + (abs / 1e3).toFixed(1) + 'K';
  return prefix + '$' + abs.toFixed(2);
}

function fmtPct(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function pctClass(n) { return n >= 0 ? 'green' : 'red'; }

function daysToExpiry(dateStr) {
  if (!dateStr) return '-';
  const today = new Date(); today.setHours(0,0,0,0);
  const exp = new Date(dateStr); exp.setHours(0,0,0,0);
  const days = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
  if (days < 0) return '<span style="color:#ff4757">已过期</span>';
  if (days <= 7) return '<span style="color:#ff4757">剩余' + days + '天</span>';
  if (days <= 30) return '<span style="color:#f59e0b">剩余' + days + '天</span>';
  return '<span style="color:var(--text-dim)">剩余' + days + '天</span>';
}

function getStrategyById(id) {
  return (portfolio.strategies || []).find(s => s.id === id);
}

function getPositionsForStrategy(stratId) {
  return (portfolio.positions || []).filter(p => p.strategy === stratId);
}

function getStrategyValue(stratId) {
  if (stratId === 'cash') return portfolio.cash || 0;
  return getPositionsForStrategy(stratId).reduce((s, p) => s + p.market_value, 0);
}

function getStrategyPnl(stratId) {
  if (stratId === 'cash') return 0;
  return getPositionsForStrategy(stratId).reduce((s, p) => s + p.pnl, 0);
}

function getTotalValue() {
  let v = (portfolio.cash || 0) + (portfolio.cash_base_usd || 0);
  (portfolio.positions || []).forEach(p => v += p.market_value);
  return v;
}

function getTotalPnl() {
  return (portfolio.positions || []).reduce((s, p) => s + p.pnl, 0);
}

// === Stats Row ===
function renderStats() {
  const total = getTotalValue();
  const pnl = getTotalPnl();
  const pnlPct = total ? (pnl / (total - pnl) * 100) : 0;
  const posCount = (portfolio.positions || []).length;
  const stratCount = (portfolio.strategies || []).length;

  // Top strategy
  let topStrat = '-';
  let topStratPct = '';
  const strategies = portfolio.strategies || [];
  if (strategies.length && total > 0) {
    let maxVal = 0;
    strategies.forEach(s => {
      const v = getStrategyValue(s.id);
      if (v > maxVal) { maxVal = v; topStrat = s.name; }
    });
    topStratPct = fmtNum(maxVal) + ' (' + (maxVal / total * 100).toFixed(1) + '%)';
  }

  document.getElementById('stats-row').innerHTML = `
    <div class="stat-card">
      <div class="label">总资产 (含现金)</div>
      <div class="value">${fmtNum(total)}</div>
      <div class="sub">${stratCount} 个策略</div>
    </div>
    <div class="stat-card">
      <div class="label">总盈亏</div>
      <div class="value ${pctClass(pnl)}">${fmtNum(pnl)}</div>
      <div class="sub">${fmtPct(pnlPct)}</div>
    </div>
    <div class="stat-card">
      <div class="label">现金</div>
      <div class="value" style="color: var(--blue)">${fmtNum(portfolio.cash || 0)}</div>
      <div class="sub">${total ? ((portfolio.cash || 0) / total * 100).toFixed(1) : '0'}%</div>
    </div>
    <div class="stat-card">
      <div class="label">持仓标的</div>
      <div class="value">${posCount}</div>
      <div class="sub">个持仓</div>
    </div>
    <div class="stat-card">
      <div class="label">最大策略仓</div>
      <div class="value" style="font-size:1rem">${topStrat}</div>
      <div class="sub">${topStratPct}</div>
    </div>
  `;

  // Challenge
  renderChallenge(total);
}

function renderChallenge(total) {
  const goal = parseFloat(localStorage.getItem('challenge_goal') || 1000000);
  const pct = Math.min(total / goal * 100, 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('challenge-amount').textContent = fmtNum(total) + ' / ' + fmtNum(goal);
  document.getElementById('challenge-pct').textContent = pct.toFixed(1) + '% 完成';
}

// === Strategy Cards ===
function renderStrategies() {
  const container = document.getElementById('strategy-list');
  const total = getTotalValue();
  const strategies = portfolio.strategies || [];
  let html = '';

  strategies.forEach(s => {
    const value = getStrategyValue(s.id);
    const pnl = getStrategyPnl(s.id);
    const pct = total ? (value / total * 100).toFixed(1) : '0.0';
    const positions = getPositionsForStrategy(s.id);

    html += `
      <div class="strategy-card" id="sc-${s.id}" onclick="toggleStrategy('${s.id}')">
        <div class="strategy-header">
          <div class="strategy-icon" style="background: ${s.color}22; color: ${s.color}">${s.icon}</div>
          <div class="strategy-info">
            <div class="strategy-name">${s.name}</div>
            <div class="strategy-desc">${s.desc || ''}</div>
          </div>
          <div class="strategy-meta">
            <div class="strategy-value">${fmtNum(value)}</div>
            <div class="strategy-pct">${pct}%</div>
            ${s.id !== 'cash' ? `<div class="strategy-pnl ${pctClass(pnl)}">${fmtPct(pnl)}</div>` : ''}
          </div>
          <div class="strategy-chevron">▼</div>
        </div>
        <div class="strategy-bar"><div class="strategy-bar-fill" style="width: ${pct}%; background: ${s.color}"></div></div>
        <div class="strategy-body">
          <div class="strategy-body-inner">
            ${s.id === 'cash' ? `
              <div style="padding: 12px; color: var(--text-dim); font-size: 0.85rem">
                现金储备: <b style="color: var(--blue)">${fmtNum(portfolio.cash || 0)}</b>
              </div>
            ` : positions.length ? `
              ${positions.map(p => {
                // Wheel 策略 - 期权格式
                if (p.strategy === 'wheel') {
                  return `
                    <div class="holding-item" onclick="event.stopPropagation()">
                      <div class="holding-symbol">${p.symbol}</div>
                      <div class="holding-details">
                        <span class="holding-tag ${p.wheel_type}">${p.wheel_type === 'sell_put' ? 'Sell Put' : p.wheel_type === 'covered_call' ? 'Covered Call' : '持有正股'}</span>
                        <span>K${p.strike} · ${p.expiry} · ${daysToExpiry(p.expiry)}</span>
                        <span>${p.contracts}合约 (${p.contracts*100}股)</span>
                        <span>Delta: ${p.delta || '-'}</span>
                      </div>
                      <div class="holding-value">
                        <div>权利金: <span class="green">$${((p.premium || 0) * (p.contracts || 0) * 100).toFixed(2)}</span></div>
                        <div>股价: $${(p.stock_price || 0).toFixed(2)}</div>
                      </div>
                      <div class="holding-pnl ${pctClass(p.pnl)}">${fmtNum(p.pnl)}</div>
                      <div class="holding-actions">
                        <button class="btn btn-sm btn-close" onclick="closePosition('${p.id}','${s.id}','${p.symbol}')">🔒 平仓</button>
                        <button class="btn btn-sm" onclick="editPosition('${p.id}','${s.id}')">✏️</button>
                        <button class="btn btn-sm btn-danger" onclick="deletePosition('${p.id}')">🗑️</button>
                      </div>
                    </div>
                  `;
                }
                // LEAPS 策略 - 期权格式
                if (p.strategy === 'leaps') {
                  return `
                    <div class="holding-item" onclick="event.stopPropagation()">
                      <div class="holding-symbol">${p.symbol}</div>
                      <div class="holding-details">
                        <span class="holding-tag leaps">LEAPS Call</span>
                        <span>K${p.strike} · ${p.expiry} · ${daysToExpiry(p.expiry)}</span>
                        <span>${p.contracts}合约</span>
                        <span>Delta: ${p.delta || '-'}</span>
                      </div>
                      <div class="holding-value">
                        <div>成本: $${(p.buy_price || 0).toFixed(2)}/股</div>
                        <div>现价: $${(p.current_option_price || 0).toFixed(2)}/股</div>
                        <div>股价: $${(p.stock_price || 0).toFixed(2)}</div>
                      </div>
                      <div class="holding-pnl ${pctClass(p.pnl)}">${fmtNum(p.pnl)} (${fmtPct(p.pnl_pct)})</div>
                      <div class="holding-actions">
                        <button class="btn btn-sm btn-close" onclick="closePosition('${p.id}','${s.id}','${p.symbol}')">🔒 平仓</button>
                        <button class="btn btn-sm" onclick="editPosition('${p.id}','${s.id}')">✏️</button>
                        <button class="btn btn-sm btn-danger" onclick="deletePosition('${p.id}')">🗑️</button>
                      </div>
                    </div>
                  `;
                }
                // 普通策略 (DCA, Swing) - 原始格式
                return `
                  <div class="holding-item" onclick="event.stopPropagation()">
                    <div class="holding-symbol">${p.symbol}</div>
                    <div class="holding-details">
                      <span>${p.quantity > 0 ? '+' : ''}${p.quantity} 股</span>
                      <span>@ $${p.avg_price.toFixed(2)}</span>
                      <span>→ $${p.current_price.toFixed(2)}</span>
                    </div>
                    <div class="holding-value">
                      <div>${fmtNum(p.market_value)}</div>
                      <div class="holding-pct-tag">${getTotalValue() ? ((p.market_value / getTotalValue()) * 100).toFixed(1) : 0}%</div>
                    </div>
                    <div class="holding-pnl ${pctClass(p.pnl)}">${fmtNum(p.pnl)} (${fmtPct(p.pnl_pct)})</div>
                    <div class="holding-actions">
                      <button class="btn btn-sm" onclick="editPosition('${p.id}','${s.id}')">✏️</button>
                      <button class="btn btn-sm btn-danger" onclick="deletePosition('${p.id}')">🗑️</button>
                    </div>
                  </div>
                `;
              }).join('')}
              <div class="add-position-row" onclick="event.stopPropagation()" id="add-row-${s.id}">
                ${renderAddPositionForm(s.id)}
              </div>
            ` : `
              <div class="strategy-empty">
                <p>暂无持仓</p>
                <button class="btn btn-sm" onclick="event.stopPropagation()">📤 上传IBKR报告 或 ✏️ 手动添加</button>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Populate upload strategy selector
  const sel = document.getElementById('upload-strategy');
  if (sel) {
    sel.innerHTML = strategies.filter(s => s.id !== 'cash').map(s =>
      `<option value="${s.id}">${s.icon} ${s.name}</option>`
    ).join('');
  }
}

function toggleStrategy(id) {
  document.getElementById('sc-' + id).classList.toggle('expanded');
}

// === Position Actions ===
function renderAddPositionForm(stratId) {
  if (stratId === 'wheel') {
    return `
      <input class="input-sym" id="add-sym-${stratId}" placeholder="AMZN" style="width:70px">
      <select id="add-wheel-type-${stratId}" style="padding:5px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.8rem">
        <option value="sell_put">Sell Put</option>
        <option value="covered_call">Covered Call</option>
        <option value="holding_stock">持有正股</option>
      </select>
      <input class="input-strike" id="add-strike-${stratId}" type="number" step="any" placeholder="Strike" style="width:70px">
      <input class="input-expiry" id="add-expiry-${stratId}" type="date" style="width:120px">
      <input class="input-contracts" id="add-contracts-${stratId}" type="number" step="1" placeholder="合约" style="width:55px">
      <input class="input-premium" id="add-premium-${stratId}" type="number" step="any" placeholder="权利金" style="width:65px">
      <input class="input-delta" id="add-delta-${stratId}" type="number" step="0.01" placeholder="Delta" style="width:65px">
      <input class="input-stock-price" id="add-stock-price-${stratId}" type="number" step="any" placeholder="股价" style="width:65px">
      <button class="btn btn-sm btn-primary" onclick="addPositionToStrategy('${stratId}')">添加</button>
    `;
  }
  if (stratId === 'leaps') {
    return `
      <input class="input-sym" id="add-sym-${stratId}" placeholder="NVDA" style="width:70px">
      <input class="input-strike" id="add-strike-${stratId}" type="number" step="any" placeholder="Strike" style="width:70px">
      <input class="input-expiry" id="add-expiry-${stratId}" type="date" style="width:120px">
      <input class="input-contracts" id="add-contracts-${stratId}" type="number" step="1" placeholder="合约" style="width:55px">
      <input class="input-buy-price" id="add-buy-price-${stratId}" type="number" step="any" placeholder="买入价" style="width:65px">
      <input class="input-opt-price" id="add-opt-price-${stratId}" type="number" step="any" placeholder="现价" style="width:65px">
      <input class="input-delta" id="add-delta-${stratId}" type="number" step="0.01" placeholder="Delta" style="width:65px">
      <input class="input-stock-price" id="add-stock-price-${stratId}" type="number" step="any" placeholder="股价" style="width:65px">
      <button class="btn btn-sm btn-primary" onclick="addPositionToStrategy('${stratId}')">添加</button>
    `;
  }
  // 普通策略 (DCA, Swing)
  return `
    <input class="input-sym" id="add-sym-${stratId}" placeholder="AAPL" style="width:70px">
    <input class="input-qty" id="add-qty-${stratId}" type="number" step="any" placeholder="数量" style="width:60px">
    <input class="input-price" id="add-price-${stratId}" type="number" step="any" placeholder="成本价" style="width:75px">
    <input class="input-curr" id="add-curr-${stratId}" type="number" step="any" placeholder="现价" style="width:75px">
    <button class="btn btn-sm btn-primary" onclick="addPositionToStrategy('${stratId}')">添加</button>
  `;
}

function addPositionToStrategy(stratId) {
  const sym = document.getElementById(`add-sym-${stratId}`).value.toUpperCase();
  if (!sym) { showToast('请填写标的代码', 'error'); return; }

  if (stratId === 'wheel') {
    const wheelType = document.getElementById(`add-wheel-type-${stratId}`).value;
    const strike = parseFloat(document.getElementById(`add-strike-${stratId}`).value);
    const expiry = document.getElementById(`add-expiry-${stratId}`).value;
    const contracts = parseInt(document.getElementById(`add-contracts-${stratId}`).value) || 1;
    const premium = parseFloat(document.getElementById(`add-premium-${stratId}`).value) || 0;
    const delta = parseFloat(document.getElementById(`add-delta-${stratId}`).value) || 0;
    const stockPrice = parseFloat(document.getElementById(`add-stock-price-${stratId}`).value) || 0;
    
    if (!strike || !expiry) { showToast('请填写完整信息', 'error'); return; }
    
    const costBasis = wheelType === 'sell_put' ? strike - premium : stockPrice;
    const quantity = contracts * 100;
    const marketValue = quantity * stockPrice;
    const pnl = premium * contracts * 100;
    const pnlPct = premium > 0 ? (pnl / (strike * quantity)) * 100 : 0;
    
    fetch('/api/portfolio/position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: sym,
        strategy: stratId,
        wheel_type: wheelType,
        strike: strike,
        expiry: expiry,
        premium: premium,
        contracts: contracts,
        quantity: quantity,
        stock_price: stockPrice,
        cost_basis: costBasis,
        current_option_price: 0,
        market_value: marketValue,
        pnl: pnl,
        pnl_pct: pnlPct,
        status: wheelType === 'sell_put' ? '等待行权' : '卖Covered Call',
        delta: delta,
      }),
    })
      .then(r => r.json())
      .then(res => {
        if (res.success) { portfolio = res.portfolio; refreshAll(); showToast('✅ 已添加 ' + sym); }
      });
    return;
  }
  
  if (stratId === 'leaps') {
    const strike = parseFloat(document.getElementById(`add-strike-${stratId}`).value);
    const expiry = document.getElementById(`add-expiry-${stratId}`).value;
    const contracts = parseInt(document.getElementById(`add-contracts-${stratId}`).value) || 1;
    const buyPrice = parseFloat(document.getElementById(`add-buy-price-${stratId}`).value);
    const optPrice = parseFloat(document.getElementById(`add-opt-price-${stratId}`).value) || buyPrice;
    const delta = parseFloat(document.getElementById(`add-delta-${stratId}`).value) || 0;
    const stockPrice = parseFloat(document.getElementById(`add-stock-price-${stratId}`).value) || 0;
    
    if (!strike || !expiry || isNaN(buyPrice)) { showToast('请填写完整信息', 'error'); return; }
    
    const quantity = contracts * 100;
    const marketValue = contracts * 100 * optPrice;
    const pnl = (optPrice - buyPrice) * contracts * 100;
    const pnlPct = ((optPrice / buyPrice) - 1) * 100;
    
    fetch('/api/portfolio/position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: sym,
        strategy: stratId,
        strike: strike,
        expiry: expiry,
        contracts: contracts,
        quantity: quantity,
        buy_price: buyPrice,
        current_option_price: optPrice,
        stock_price: stockPrice,
        market_value: marketValue,
        pnl: pnl,
        pnl_pct: pnlPct,
        delta: delta,
      }),
    })
      .then(r => r.json())
      .then(res => {
        if (res.success) { portfolio = res.portfolio; refreshAll(); showToast('✅ 已添加 ' + sym); }
      });
    return;
  }
  
  // 普通策略 (DCA, Swing)
  const qty = parseFloat(document.getElementById(`add-qty-${stratId}`).value);
  const avg = parseFloat(document.getElementById(`add-price-${stratId}`).value);
  const curr = parseFloat(document.getElementById(`add-curr-${stratId}`).value) || avg;

  if (isNaN(qty) || isNaN(avg)) { showToast('请填写完整信息', 'error'); return; }

  fetch('/api/portfolio/position', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: sym, quantity: qty, avg_price: avg, current_price: curr, strategy: stratId }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) { portfolio = res.portfolio; refreshAll(); showToast('✅ 已添加 ' + sym); }
    });
}

function deletePosition(posId) {
  if (!confirm('确认删除此持仓？')) return;
  fetch(`/api/portfolio/position/${posId}`, { method: 'DELETE' })
    .then(r => r.json())
    .then(res => {
      if (res.success) { portfolio = res.portfolio; refreshAll(); showToast('已删除'); }
    });
}

function editPosition(posId, stratId) {
  const p = portfolio.positions.find(x => x.id === posId);
  if (!p) return;
  // Simple inline edit: prompt for current price update
  const newPrice = prompt(`更新 ${p.symbol} 当前价:`, p.current_price);
  if (newPrice === null) return;
  const curr = parseFloat(newPrice);
  if (isNaN(curr)) return;
  fetch('/api/portfolio/position', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: posId, symbol: p.symbol, quantity: p.quantity, avg_price: p.avg_price, current_price: curr, strategy: stratId }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) { portfolio = res.portfolio; refreshAll(); showToast('✅ 已更新'); }
    });
}

// === Cash Update ===
function handleCashUpdate(e) {
  e.preventDefault();
  const cash = parseFloat(document.getElementById('cash-input').value);
  if (isNaN(cash)) return;
  fetch('/api/portfolio/cash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cash }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) { portfolio = res.portfolio; refreshAll(); closeModal('cash-modal'); showToast('✅ 现金已更新'); }
    });
}

// === Strategy Creation ===
function handleAddStrategy(e) {
  e.preventDefault();
  fetch('/api/portfolio/strategy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.getElementById('new-strat-name').value,
      icon: document.getElementById('new-strat-icon').value || '📁',
      color: document.getElementById('new-strat-color').value,
      desc: document.getElementById('new-strat-desc').value,
    }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) { portfolio = res.portfolio; refreshAll(); closeModal('strategy-modal'); showToast('✅ 策略已创建'); }
    });
}

// === Charts ===
function renderStrategyPieChart() {
  const el = document.getElementById('chart-strategy-pie');
  if (!el || typeof echarts === 'undefined') return;
  const chart = echarts.init(el);
  const total = getTotalValue();
  const strategies = portfolio.strategies || [];

  const data = strategies.map((s, i) => ({
    name: s.icon + ' ' + s.name.split('(')[0].trim(),
    value: getStrategyValue(s.id),
    itemStyle: { color: s.color },
  }));

  chart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: p => `<b>${p.name}</b><br/>${fmtNum(p.value)} (${p.percent}%)`,
      backgroundColor: '#151823', borderColor: '#1e2235', textStyle: { color: '#e8eaf0' },
    },
    series: [{
      type: 'pie',
      radius: ['50%', '78%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: false,
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold', color: '#e8eaf0' } },
      itemStyle: { borderRadius: 6, borderColor: '#151823', borderWidth: 3 },
      data,
    }],
  });
  window.addEventListener('resize', () => chart.resize());
}

function renderStrategyPnlChart() {
  const el = document.getElementById('chart-strategy-pnl');
  if (!el || typeof echarts === 'undefined') return;
  const chart = echarts.init(el);
  const strategies = portfolio.strategies || [];

  const data = strategies
    .filter(s => s.id !== 'cash')
    .map(s => ({
      name: s.icon + ' ' + s.name.split('(')[0].trim(),
      value: getStrategyPnl(s.id),
      color: s.color,
    }))
    .sort((a, b) => b.value - a.value);

  chart.setOption({
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: '#151823', borderColor: '#1e2235', textStyle: { color: '#e8eaf0' },
      formatter: p => `<b>${data[p[0].dataIndex].name}</b><br/>PnL: ${fmtNum(data[p[0].dataIndex].value)}`,
    },
    grid: { left: 70, right: 20, top: 10, bottom: 40 },
    xAxis: {
      type: 'category', data: data.map(d => d.name),
      axisLabel: { color: '#6b7194', fontSize: 11 },
      axisLine: { lineStyle: { color: '#1e2235' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6b7194', formatter: v => '$' + (Math.abs(v) >= 1000 ? (v/1000).toFixed(0)+'K' : v.toFixed(0)) },
      splitLine: { lineStyle: { color: '#1e2235' } },
    },
    series: [{
      type: 'bar',
      data: data.map(d => ({
        value: d.value,
        itemStyle: {
          color: d.value >= 0 ? d.color : '#ff4757',
          borderRadius: d.value >= 0 ? [6, 6, 0, 0] : [0, 0, 6, 6],
        },
      })),
    }],
  });
  window.addEventListener('resize', () => chart.resize());
}

function renderTargetComparison() {
  const container = document.getElementById('target-comparison');
  if (!targetAlloc.length) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px">点击"目标配比"按钮设置</p>';
    return;
  }

  const total = getTotalValue();
  const strategies = portfolio.strategies || [];

  let html = '';
  targetAlloc.forEach(t => {
    const strat = strategies.find(s => s.id === t.strategy_id) || { name: t.strategy_id, color: '#8b8d9a' };
    const actual = getStrategyValue(t.strategy_id);
    const actualPct = total ? actual / total * 100 : 0;
    const targetPct = t.percent;
    const diff = actualPct - targetPct;

    html += `
      <div class="target-row">
        <div class="target-header">
          <span>${strat.icon || ''} ${strat.name}</span>
          <span>
            <span style="color:${strat.color}">实际 ${actualPct.toFixed(1)}%</span>
            &nbsp;|&nbsp;
            <span style="color: var(--orange)">目标 ${targetPct}%</span>
            &nbsp;|&nbsp;
            <span class="diff ${pctClass(diff)}">${fmtPct(diff)}</span>
          </span>
        </div>
        <div class="target-bars">
          <div class="bar" style="width: ${Math.min(actualPct * 2.5, 100)}%; background: ${strat.color}">
            <span class="bar-label">${fmtNum(actual)}</span>
          </div>
          <div class="bar" style="width: ${Math.min(targetPct * 2.5, 100)}%; background: rgba(255,165,2,0.4)">
            <span class="bar-label">目标 ${targetPct}%</span>
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

// === Upload ===
function handleUpload(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const xhr = new XMLHttpRequest();
  xhr.onload = function () {
    if (xhr.status === 200) {
      const data = JSON.parse(xhr.responseText);
      if (data.portfolio) {
        portfolio = data.portfolio;
        refreshAll();
        closeModal('upload-modal');
        showToast('✅ 成功导入 ' + data.count + ' 个持仓');
      } else if (data.trades) {
        showToast('✅ 成功导入 ' + data.count + ' 条交易');
        closeModal('upload-modal');
      }
    } else {
      const data = JSON.parse(xhr.responseText);
      showToast('❌ ' + (data.error || '上传失败'), 'error');
    }
  };
  xhr.open('POST', '/api/upload');
  xhr.send(formData);
}

// === Target Modal ===
function addTargetRow(strategy_id = '', percent = '') {
  const container = document.getElementById('target-rows');
  const strategies = portfolio.strategies || [];
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center;';
  div.innerHTML = `
    <select class="t-strat" style="flex:1;padding:7px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.8rem">
      ${strategies.map(s => `<option value="${s.id}" ${s.id === strategy_id ? 'selected' : ''}>${s.icon} ${s.name}</option>`).join('')}
    </select>
    <input class="t-pct" type="number" placeholder="30" value="${percent}" min="0" max="100"
      style="width:70px;padding:7px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.8rem">
    <span style="color:var(--text-dim)">%</span>
    <button type="button" class="btn btn-sm" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(div);
}

function handleTargetSave(e) {
  e.preventDefault();
  const targets = [];
  document.querySelectorAll('#target-rows > div').forEach(row => {
    const sid = row.querySelector('.t-strat').value;
    const pct = parseFloat(row.querySelector('.t-pct').value);
    if (sid && pct > 0) targets.push({ strategy_id: sid, percent: pct });
  });
  fetch('/api/targets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        targetAlloc = targets;
        renderTargetComparison();
        closeModal('target-modal');
        showToast('✅ 目标配比已保存');
      }
    });
}

// === Goal ===
function updateGoal() {
  const goal = parseFloat(document.getElementById('goal-input').value);
  if (goal > 0) {
    localStorage.setItem('challenge_goal', goal);
    renderChallenge(getTotalValue());
    closeModal('goal-modal');
  }
}

// === Modals ===
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// === Price Refresh ===
function refreshPrices() {
  const btn = document.getElementById('refresh-btn');
  btn.textContent = '⏳ 更新中...';
  btn.disabled = true;
  
  const apiKey = localStorage.getItem('twelvedata_api_key') || 'demo';
  
  fetch('/api/refresh-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        portfolio = res.portfolio;
        refreshAll();
        const msg = res.errors && res.errors.length
          ? `✅ 已更新 ${res.updated} 个标的，${res.errors.length} 个失败: ${res.errors.join(', ')}`
          : `✅ 全部 ${res.updated} 个标的行情已更新`;
        showToast(msg);
      } else {
        showToast('❌ 更新失败', 'error');
      }
    })
    .catch(() => showToast('❌ 网络错误', 'error'))
    .finally(() => {
      btn.textContent = '🔄 更新行情';
      btn.disabled = false;
    });
}

function handleSaveApiKey(e) {
  e.preventDefault();
  const key = document.getElementById('apikey-input').value.trim() || 'demo';
  localStorage.setItem('twelvedata_api_key', key);
  closeModal('apikey-modal');
  showToast('✅ API Key 已保存');
}

// === Cash Flow ===
function openCashFlowModal() {
  openModal('cashflow-modal');
  document.getElementById('cashflow-form').style.display = 'none';
  document.getElementById('cf-currency').value = 'CNY';
  onCurrencyChange();
  loadCashFlows();
}

function openCashFlowForm(type) {
  const form = document.getElementById('cashflow-form');
  form.style.display = 'block';
  document.getElementById('cf-type').value = type;
  document.getElementById('cf-currency').value = 'CNY';
  document.getElementById('cf-amount').value = '';
  document.getElementById('cf-rate').value = '7.25';
  document.getElementById('cf-note').value = '';
  onCurrencyChange();
  updateCfPreview();
  document.getElementById('cf-amount').focus();
}

function closeCashFlowForm() {
  document.getElementById('cashflow-form').style.display = 'none';
}

function onCurrencyChange() {
  const currency = document.getElementById('cf-currency').value;
  const rateGroup = document.getElementById('cf-rate-group');
  const amountLabel = document.getElementById('cf-amount-label');
  if (currency === 'CNY') {
    rateGroup.style.display = 'block';
    amountLabel.textContent = '人民币金额 (CNY) ¥';
  } else {
    rateGroup.style.display = 'none';
    amountLabel.textContent = '美元金额 (USD) $';
  }
  updateCfPreview();
}

function updateCfPreview() {
  const currency = document.getElementById('cf-currency').value;
  const amount = parseFloat(document.getElementById('cf-amount').value) || 0;
  const rate = parseFloat(document.getElementById('cf-rate').value) || 7.25;
  const type = document.getElementById('cf-type').value;
  const label = type === 'deposit' ? '入金' : '出金';
  let preview = '';
  if (amount > 0) {
    if (currency === 'CNY') {
      const usd = (amount / rate).toFixed(2);
      preview = `${label}: ¥${amount.toLocaleString()} ÷ ${rate} = $${usd} USD`;
    } else {
      preview = `${label}: $${amount.toLocaleString()} USD`;
    }
  }
  document.getElementById('cf-preview').textContent = preview;
}

// 实时预览
['cf-cny','cf-rate'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateCfPreview);
});

function handleCashFlow(e) {
  e.preventDefault();
  const type = document.getElementById('cf-type').value;
  const currency = document.getElementById('cf-currency').value;
  const amount = parseFloat(document.getElementById('cf-amount').value);
  const rate = currency === 'CNY' ? parseFloat(document.getElementById('cf-rate').value) : null;
  const note = document.getElementById('cf-note').value.trim();
  if (!amount || amount <= 0) { showToast('❌ 金额必须大于0', 'error'); return; }
  if (currency === 'CNY' && (!rate || rate <= 0)) { showToast('❌ 汇率必须大于0', 'error'); return; }
  fetch('/api/cash-flow', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({type, currency, amount, rate, note})
  })
  .then(r => r.json())
  .then(res => {
    if (res.success) {
      portfolio.cash_base_usd = res.cash_base_usd;
      closeCashFlowForm();
      loadCashFlows();
      refreshAll();
      const label = type==='deposit'?'入金':'出金';
      showToast(`✅ ${label}成功，当前现金基础: $${res.cash_base_usd.toLocaleString()}`);
    } else {
      showToast('❌ ' + (res.error || '操作失败'), 'error');
    }
  })
  .catch(() => showToast('❌ 网络错误', 'error'));
}

function loadCashFlows() {
  fetch('/api/cash-flow')
    .then(r => r.json())
    .then(data => {
      const flows = data.flows || [];
      const cashBase = data.cash_base_usd || 0;
      const list = document.getElementById('cashflow-list');
      const summary = document.getElementById('cashflow-summary');
      if (!flows.length) {
        list.innerHTML = '<div style="color:var(--text-dim);padding:20px;text-align:center">暂无资金流水，点击上方按钮添加</div>';
        summary.innerHTML = `当前现金基础: <b>$${cashBase.toLocaleString()}</b>`;
        return;
      }
      let depositTotal = 0, withdrawTotal = 0;
      const rows = flows.slice().reverse().map(f => {
        const isDeposit = f.type === 'deposit';
        if (isDeposit) depositTotal += f.amount_usd; else withdrawTotal += f.amount_usd;
        const typeLabel = isDeposit ? '⬇️ 入金' : '⬆️ 出金';
        const currency = f.currency || 'CNY';
        let amountDisplay, rateDisplay;
        if (currency === 'CNY') {
          const cny = f.original_amount || f.amount_cny || 0;
          amountDisplay = '¥' + cny.toLocaleString();
          rateDisplay = f.rate ? f.rate.toFixed(4) : '-';
        } else {
          amountDisplay = '$' + (f.original_amount || f.amount_usd || 0).toLocaleString();
          rateDisplay = '-';
        }
        const usdFmt = '$' + (f.amount_usd || 0).toFixed(2);
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid var(--border);font-size:0.85rem">
            <div style="min-width:90px">${typeLabel}</div>
            <div style="min-width:110px;font-weight:600">${amountDisplay}</div>
            <div style="min-width:70px;color:var(--text-dim)">${rateDisplay}</div>
            <div style="min-width:90px;color:var(--accent)">${usdFmt}</div>
            <div style="flex:1;color:var(--text-dim);margin:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.note || ''}</div>
            <div style="min-width:130px;color:var(--text-dim);font-size:0.75rem">${f.created_at || ''}</div>
            <button class="btn btn-sm btn-danger" onclick="deleteCashFlow('${f.id}')" style="margin-left:8px">🗑️</button>
          </div>
        `;
      }).join('');
      list.innerHTML = `
        <div style="display:flex;font-size:0.75rem;color:var(--text-dim);padding:6px 10px;border-bottom:2px solid var(--border)">
          <div style="min-width:90px">类型</div>
          <div style="min-width:110px">金额</div>
          <div style="min-width:70px">汇率</div>
          <div style="min-width:90px">美元</div>
          <div style="flex:1;margin:0 8px">备注</div>
          <div style="min-width:130px">时间</div>
          <div style="min-width:40px"></div>
        </div>
        ${rows}
      `;
      summary.innerHTML = `
        累计入金: <b style="color:var(--green)">$${depositTotal.toLocaleString()}</b> 
        累计出金: <b style="color:var(--red)">$${withdrawTotal.toLocaleString()}</b> 
        当前现金基础: <b>$${cashBase.toLocaleString()}</b>
      `;
    })
    .catch(() => showToast('❌ 加载失败', 'error'));
}

function deleteCashFlow(id) {
  if (!confirm('确认删除该笔资金流水？')) return;
  fetch('/api/cash-flow/' + id, {method: 'DELETE'})
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        portfolio.cash_base_usd = res.cash_base_usd;
        loadCashFlows();
        refreshAll();
        showToast('✅ 已删除');
      }
    })
    .catch(() => showToast('❌ 删除失败', 'error'));
}

// === Close Position (平仓) ===
function closePosition(posId, stratId, symbol) {
  const modal = document.getElementById('close-modal');
  modal.classList.add('active');
  modal.dataset.posId = posId;
  modal.dataset.stratId = stratId;
  document.getElementById('close-symbol').textContent = symbol;
  document.getElementById('close-price').value = '';
  document.getElementById('close-price').focus();
}

function handleCloseClose(e) {
  e.preventDefault();
  const posId = document.getElementById('close-modal').dataset.posId;
  const closePrice = parseFloat(document.getElementById('close-price').value);
  
  if (isNaN(closePrice) || closePrice <= 0) {
    showToast('请输入有效的平仓价格', 'error');
    return;
  }
  
  fetch(`/api/portfolio/position/${posId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ close_price: closePrice }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        portfolio = res.portfolio;
        historyList = res.portfolio.history || [];
        refreshAll();
        closeModal('close-modal');
        showToast(`✅ ${res.history.symbol} 已平仓，盈亏 ${res.history.pnl > 0 ? '+' : ''}$${res.history.pnl.toFixed(2)}`);
      } else {
        showToast('❌ ' + (res.error || '平仓失败'), 'error');
      }
    })
    .catch(err => {
      showToast('❌ 网络错误', 'error');
    });
}

// === History (交易历史) ===
function openHistory() {
  openModal('history-modal');
  renderHistory();
}

function renderHistory() {
  const container = document.getElementById('history-list');
  if (!container) return;
  
  // 从portfolio中加载历史记录
  const history = portfolio.history || historyList || [];
  
  if (!history.length) {
    container.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:40px">暂无平仓记录</p>';
    return;
  }
  
  let html = '<table class="history-table"><thead><tr>';
  html += '<th>标的</th><th>策略</th><th>类型</th><th>Strike</th><th>到期日</th><th>合约</th>';
  html += '<th>开仓价</th><th>平仓价</th><th>Delta</th><th>平仓日期</th><th>盈亏</th><th>盈亏%</th>';
  html += '</tr></thead><tbody>';
  
  // 按close_date倒序
  const sorted = [...history].sort((a, b) => (b.close_date || '').localeCompare(a.close_date || ''));
  
  sorted.forEach(h => {
    const type = h.strategy === 'wheel' 
      ? (h.wheel_type === 'sell_put' ? 'Sell Put' : h.wheel_type === 'covered_call' ? 'Covered Call' : '-') 
      : 'LEAPS Call';
    const openPrice = h.strategy === 'wheel' ? (h.open_premium || 0) : (h.open_price || 0);
    
    html += `<tr>
      <td><b>${h.symbol}</b></td>
      <td>${h.strategy === 'wheel' ? '🎡 Wheel' : '🚀 LEAPS'}</td>
      <td><span class="holding-tag ${h.strategy === 'wheel' ? (h.wheel_type || '') : 'leaps'}">${type}</span></td>
      <td>K${h.strike}</td>
      <td>${h.expiry}</td>
      <td>${h.contracts}</td>
      <td>$${openPrice.toFixed(2)}</td>
      <td>$${(h.close_price || 0).toFixed(2)}</td>
      <td>${h.open_delta || '-'}</td>
      <td>${h.close_date || '-'}</td>
      <td class="${h.pnl >= 0 ? 'green' : 'red'}">$${h.pnl.toFixed(2)}</td>
      <td class="${h.pnl >= 0 ? 'green' : 'red'}">${h.pnl >= 0 ? '+' : ''}${h.pnl_pct.toFixed(2)}%</td>
    </tr>`;
  });
  
  html += '</tbody></table>';
  
  // 汇总统计
  const totalPnl = history.reduce((s, h) => s + (h.pnl || 0), 0);
  const winCount = history.filter(h => (h.pnl || 0) > 0).length;
  const lossCount = history.filter(h => (h.pnl || 0) < 0).length;
  const winRate = history.length ? (winCount / history.length * 100).toFixed(1) : 0;
  
  html += `<div class="history-summary">
    <div class="stat-card"><div class="label">总盈亏</div><div class="value ${totalPnl >= 0 ? 'green' : 'red'}">${fmtNum(totalPnl)}</div></div>
    <div class="stat-card"><div class="label">交易次数</div><div class="value">${history.length}</div></div>
    <div class="stat-card"><div class="label">胜率</div><div class="value">${winRate}%</div><div class="sub">${winCount}胜 ${lossCount}负</div></div>
  </div>`;
  
  container.innerHTML = html;
}

function clearHistory() {
  if (!confirm('确认清空所有历史记录？')) return;
  
  fetch('/api/history', { method: 'DELETE' })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        portfolio.history = [];
        historyList = [];
        renderHistory();
        showToast('✅ 历史记录已清空');
      }
    })
    .catch(err => {
      showToast('❌ 清空失败', 'error');
    });
}

// === Toast ===
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.background = type === 'error' ? 'var(--red)' : 'var(--accent)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// === Refresh All ===
function refreshAll() {
  renderStats();
  renderStrategies();
  renderStrategyPieChart();
  renderStrategyPnlChart();
  renderTargetComparison();
  
  // 更新历史记录（如果历史modal是打开的）
  const historyModal = document.getElementById('history-modal');
  if (historyModal && historyModal.classList.contains('active')) {
    renderHistory();
  }
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  refreshAll();

  // Upload zone drag & drop
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  if (zone && fileInput) {
    zone.addEventListener('click', e => { if (e.target === zone || e.target.tagName !== 'BUTTON') fileInput.click(); });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; zone.querySelector('p').textContent = e.dataTransfer.files[0].name; }
    });
  }

  // Goal input
  document.getElementById('goal-input').value = localStorage.getItem('challenge_goal') || 1000000;

  // Cash input
  document.getElementById('cash-input').value = portfolio.cash || 0;

  // Load history from portfolio
  historyList = portfolio.history || [];

  // Target rows
  if (targetAlloc.length) {
    targetAlloc.forEach(t => addTargetRow(t.strategy_id, t.percent));
  } else {
    // Pre-fill defaults
    const defStrats = portfolio.strategies || [];
    const defaults = [
      ['dca', 30], ['wheel', 20], ['leaps', 25], ['swing', 5], ['cash', 20]
    ];
    defaults.forEach(([sid, pct]) => {
      if (defStrats.find(s => s.id === sid)) addTargetRow(sid, pct);
    });
  }

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('active'); });
  });

  // Auto-expand first non-cash strategy
  const strategies = portfolio.strategies || [];
  if (strategies.length) {
    const first = strategies.find(s => s.id !== 'cash') || strategies[0];
    const card = document.getElementById('sc-' + first.id);
    if (card) card.classList.add('expanded');
  }
});
