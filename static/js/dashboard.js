// ===== IBKR Portfolio Dashboard v2 =====
// Strategy-based management with collapsible groups

let portfolio = window.__PORTFOLIO__ || {strategies:[], positions:[], cash:0};
let targetAlloc = window.__TARGETS__ || [];

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
  let v = portfolio.cash || 0;
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
              ${positions.map(p => `
                <div class="holding-item" onclick="event.stopPropagation()">
                  <div class="holding-symbol">${p.symbol}</div>
                  <div class="holding-details">
                    <span>${p.quantity > 0 ? '+' : ''}${p.quantity} 股</span>
                    <span>@ $${p.avg_price.toFixed(2)}</span>
                    <span>→ $${p.current_price.toFixed(2)}</span>
                  </div>
                  <div class="holding-value">${fmtNum(p.market_value)}</div>
                  <div class="holding-pnl ${pctClass(p.pnl)}">${fmtNum(p.pnl)} (${fmtPct(p.pnl_pct)})</div>
                  <div class="holding-actions">
                    <button class="btn btn-sm" onclick="editPosition('${p.id}','${s.id}')">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="deletePosition('${p.id}')">🗑️</button>
                  </div>
                </div>
              `).join('')}
              <div class="add-position-row" onclick="event.stopPropagation()">
                <input class="input-sym" id="add-sym-${s.id}" placeholder="AAPL">
                <input class="input-qty" id="add-qty-${s.id}" type="number" step="any" placeholder="数量">
                <input class="input-price" id="add-price-${s.id}" type="number" step="any" placeholder="成本价">
                <input class="input-curr" id="add-curr-${s.id}" type="number" step="any" placeholder="现价">
                <button class="btn btn-sm btn-primary" onclick="addPositionToStrategy('${s.id}')">添加</button>
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
function addPositionToStrategy(stratId) {
  const sym = document.getElementById(`add-sym-${stratId}`).value.toUpperCase();
  const qty = parseFloat(document.getElementById(`add-qty-${stratId}`).value);
  const avg = parseFloat(document.getElementById(`add-price-${stratId}`).value);
  const curr = parseFloat(document.getElementById(`add-curr-${stratId}`).value) || avg;

  if (!sym || isNaN(qty) || isNaN(avg)) { showToast('请填写完整信息', 'error'); return; }

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
