// ===== IBKR Portfolio Dashboard v2 =====
// Strategy-based management with collapsible groups

let portfolio = window.__PORTFOLIO__ || {strategies:[], positions:[], cash:0};
let targetAlloc = window.__TARGETS__ || [];
let historyList = [];  // 存储历史记录
let realizedProfits = window.__PORTFOLIO__.realized_profits || {};  // 各策略已实现盈利

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
  if (days < 0) return '<span style="color:#ff4757">已过期!</span>';
  if (days <= 7) return '<span style="color:#ff4757;font-weight:bold">⚠剩余' + days + '天 可平仓</span>';
  if (days <= 21) return '<span style="color:#ff4757;font-weight:bold">剩余' + days + '天 请平仓</span>';
  if (days <= 25) return '<span style="color:#f59e0b;font-weight:bold">⏰剩余' + days + '天 接近平仓</span>';
  if (days <= 30) return '<span style="color:#f59e0b">剩余' + days + '天</span>';
  return '<span style="color:var(--text-dim)">剩余' + days + '天</span>';
}

// 计算期权对应的正股年化 ROI
function calcStockAnnualizedROI(stockPrice, strike, expiry, premium = 0, wheelType = 'sell_put') {
  if (!stockPrice || !strike || !expiry) return null;
  
  const today = new Date(); today.setHours(0,0,0,0);
  const exp = new Date(expiry); exp.setHours(0,0,0,0);
  const daysToExp = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
  
  if (daysToExp <= 0) return null;
  
  // 卖Put：年化ROI = (权利金 / 行权价) * (365 / 剩余天数)
  // 买Call：年化ROI = (期权盈亏 / 正股价) * (365 / 剩余天数)
  if (wheelType === 'sell_put') {
    if (!premium) return null;
    const returnRate = premium / strike;
    const annualizedROI = returnRate * (365 / daysToExp) * 100;
    return annualizedROI;
  } else if (wheelType === 'leaps_call') {
    // LEAPS Call：用期权盈亏相对于正股价计算
    const optionPrice = premium; // 这里premium代表期权现价
    if (!optionPrice) return null;
    const returnRate = (optionPrice - (premium * 0.8)) / stockPrice; // 简化计算
    const annualizedROI = returnRate * (365 / daysToExp) * 100;
    return annualizedROI;
  }
  
  return null;
}

function formatAnnualizedROI(roi) {
  if (roi === null || roi === undefined) return '';
  const absROI = Math.abs(roi);
  let color = 'var(--text-dim)';
  if (roi >= 50) color = '#00d68f'; // 绿色 - 高收益
  else if (roi >= 30) color = '#4c9aff'; // 蓝色 - 中等收益
  else if (roi >= 15) color = '#ffa502'; // 橙色 - 一般收益
  else if (roi > 0) color = '#a78bfa'; // 紫色 - 低收益
  else color = '#ff4757'; // 红色 - 亏损
  
  return '<span style="color:' + color + ';font-weight:600">年化' + roi.toFixed(1) + '%</span>';
}

function getStrategyById(id) {
  return (portfolio.strategies || []).find(s => s.id === id);
}

function getStrategyType(stratId) {
  const strat = getStrategyById(stratId);
  if (strat && strat.type) return strat.type;
  // 向后兼容：现有硬编码策略默认类型
  if (stratId === 'wheel' || stratId === 'leaps') return 'option';
  return 'stock';
}

function getPositionsForStrategy(stratId) {
  return (portfolio.positions || []).filter(p => p.strategy === stratId);
}

function getStrategyValue(stratId) {
  // 'cash' 策略：显示资金流水累计的现金基础
  if (stratId === 'cash') return portfolio.cash_base_usd || 0;
  return getPositionsForStrategy(stratId).reduce((s, p) => s + p.market_value, 0);
}

function getStrategyPnl(stratId) {
  if (stratId === 'cash') return 0;
  return getPositionsForStrategy(stratId).reduce((s, p) => s + p.pnl, 0);
}

// 期权策略潜在被行权金额（仅卖出期权）
function getStrategyPotentialAssignment(stratId) {
  if (stratId === 'cash') return 0;
  const positions = getPositionsForStrategy(stratId);
  if (!positions.some(p => (p.contracts || 0) < 0)) return 0;
  return positions.reduce((s, p) => {
    if ((p.contracts || 0) < 0) {
      const absC = Math.abs(p.contracts || 0);
      return s + (p.strike || 0) * 100 * absC;
    }
    return s;
  }, 0);
}

function getTotalValue() {
  // 总资产 = 各策略持仓市值之和 + 现金基础(cash_base_usd)
  // 注意：不再重复加 portfolio.cash，cash 策略已通过 getStrategyValue('cash') 计入
  let v = (portfolio.cash_base_usd || 0);
  (portfolio.positions || []).forEach(p => v += p.market_value);
  return v;
}

function getTotalPnl() {
  return (portfolio.positions || []).reduce((s, p) => s + p.pnl, 0);
}

// === Strategy Analytics Helpers ===
function getStrategyTotalCost(stratId) {
  // 计算某策略所有持仓的总成本
  const positions = getPositionsForStrategy(stratId);
  let totalCost = 0;
  positions.forEach(p => {
    if (getStrategyType(stratId) === 'option') {
      const absContracts = Math.abs(p.contracts || 0);
      const isSold = (p.contracts || 0) < 0;
      if (!isSold) {
        // 买期权：成本 = buy_price * 100 * 合约数
        totalCost += (p.buy_price || 0) * 100 * absContracts;
      }
      // 卖期权成本计为0（已收权利金）
    } else {
      // 正股：成本 = avg_price * quantity
      totalCost += (p.avg_price || 0) * (p.quantity || 0);
    }
  });
  return totalCost;
}

function getStrategyRealizedProfit(stratId) {
  // 从realizedProfits字典中获取累计已实现盈利
  return realizedProfits[stratId] || 0;
}

function hasProfitAlert(stratId) {
  // 非DCA策略，已实现盈利 >= $5000 时提醒
  if (stratId === 'dca' || stratId === 'cash') return false;
  return getStrategyRealizedProfit(stratId) >= 5000;
}

function getAvailableProfitSources(currentStratId) {
  // 返回可用盈利资金来源列表（已实现盈利 > 0，且不是当前策略）
  const strategies = portfolio.strategies || [];
  return strategies.filter(s => {
    if (s.id === currentStratId || s.id === 'cash') return false;
    return getStrategyRealizedProfit(s.id) > 0;
  });
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
    <div class="stat-card" style="cursor:pointer" onclick="openCashFlowModal()" title="点击查看资金流水">
      <div class="label">现金基础</div>
      <div class="value" style="color: var(--blue)">${fmtNum(portfolio.cash_base_usd || 0)}</div>
      <div class="sub">${total ? ((portfolio.cash_base_usd || 0) / total * 100).toFixed(1) : '0'}% · 点击查看流水</div>
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
let _dragStratId = null;
function onDragStart(e, stratId) {
  _dragStratId = stratId;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.5';
}
function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
function onDrop(e, targetId) {
  e.preventDefault();
  if (!_dragStratId || _dragStratId === targetId) return;
  const fixedIds = ['cash', 'dca', 'wheel', 'leaps'];
  if (fixedIds.includes(_dragStratId) || fixedIds.includes(targetId)) return;
  // 交换策略顺序
  const strategies = portfolio.strategies;
  const fromIdx = strategies.findIndex(s => s.id === _dragStratId);
  const toIdx = strategies.findIndex(s => s.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = strategies.splice(fromIdx, 1);
  strategies.splice(toIdx, 0, moved);
  _dragStratId = null;
  // 持久化顺序到后端
  fetch('/api/portfolio/order', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({strategies: strategies.map(s => s.id)})
  }).then(r => r.json()).then(() => refreshAll());
}
function onDragEnd(e) {
  e.currentTarget.style.opacity = '';
  _dragStratId = null;
}

function renderStrategies() {
  const container = document.getElementById('strategy-list');
  const strategies = portfolio.strategies || [];
  const total = getTotalValue();
  let html = '';

  // 收集需要提醒的策略（已实现盈利 >= $5000）
  const alertStrategies = strategies.filter(s => hasProfitAlert(s.id));
  if (alertStrategies.length > 0) {
    const alerts = alertStrategies.map(s => `${s.icon}${s.name}(${fmtNum(getStrategyRealizedProfit(s.id))})`).join('、');
    html += `<div style="background:#7c3aed22;border:1px solid #7c3aed55;color:#c4b5fd;padding:10px 16px;border-radius:10px;margin-bottom:12px;font-size:0.82rem;line-height:1.7">
      <b style="color:#a78bfa">💰 盈利再投资提醒</b><br>
      ${alertStrategies.map(s => {
        const rp = getStrategyRealizedProfit(s.id);
        return `<span style="color:#e2e8f0">${s.icon} <b>${s.name}</b> 已实现盈利 <span class="green">${fmtNum(rp)}</span>，买入时可选择使用此盈利支付</span>`;
      }).join('<br>')}
    </div>`;
  }

  strategies.forEach(s => {
    const value = getStrategyValue(s.id);
    const pnl = getStrategyPnl(s.id);
    const pct = total ? (value / total * 100).toFixed(1) : '0.0';
    const positions = getPositionsForStrategy(s.id);
    const totalCost = getStrategyTotalCost(s.id);
    const realizedProfit = getStrategyRealizedProfit(s.id);
    const weightedReturn = totalCost > 0 ? (pnl / totalCost * 100) : (value > 0 ? 0 : 0);
    const potentialAssignment = getStrategyPotentialAssignment(s.id);
    const isDraggable = !['cash', 'dca', 'wheel', 'leaps'].includes(s.id);
    const hasAlert = hasProfitAlert(s.id);
    const stratPctTag = pct + '%';
    const dragAttr = isDraggable ? `draggable="true" ondragstart="onDragStart(event,'${s.id}')" ondragover="onDragOver(event)" ondrop="onDrop(event,'${s.id}')" ondragend="onDragEnd(event)"` : '';
    const dragStyle = isDraggable ? 'cursor:grab;' : '';
    const clickAttr = s.id === 'cash' ? '' : `onclick="toggleStrategy('${s.id}')"`;

    html += `
      <div class="strategy-card" id="sc-${s.id}" ${dragAttr} ${clickAttr} style="${dragStyle}">
        <div class="strategy-header">
          <div class="strategy-icon" style="background: ${s.color}22; color: ${s.color}">${s.icon}</div>
          <div class="strategy-info">
            <div class="strategy-name">${s.name}${hasAlert ? ' <span style="font-size:0.7em;color:#a78bfa;vertical-align:middle">💜</span>' : ''}</div>
            <div class="strategy-desc">${s.desc || ''}</div>
            ${s.id !== 'cash' ? `
              <div class="strategy-analytics" style="display:flex;gap:12px;font-size:0.72rem;color:var(--text-dim);margin-top:3px">
                <span>成本: <b style="color:var(--text)">${fmtNum(totalCost)}</b></span>
                <span>占比: <b style="color:var(--text)">${stratPctTag}</b></span>
                ${totalCost > 0 ? `<span>加权回报: <b class="${pctClass(weightedReturn)}">${fmtPct(weightedReturn)}</b></span>` : ''}
                ${realizedProfit !== 0 ? `<span>已实现盈利: <b class="${pctClass(realizedProfit)}">${fmtNum(realizedProfit)}</b></span>` : ''}
                ${potentialAssignment > 0 ? `<span>潜在被行权金额: <b style="color:#f59e0b">${fmtNum(potentialAssignment)}</b></span>` : ''}
              </div>
            ` : ''}
          </div>
          <div class="strategy-meta">
            <div class="strategy-value">${fmtNum(value)}</div>
            <div class="strategy-pct">${pct}%</div>
            ${s.id !== 'cash' ? `<div class="strategy-pnl ${pctClass(weightedReturn)}">${fmtPct(weightedReturn)}</div>` : ''}
          </div>
          ${s.id !== 'cash' && s.id !== 'dca' && s.id !== 'wheel' && s.id !== 'leaps' ? `<button class="btn-delete-strategy" onclick="event.stopPropagation(); confirmDeleteStrategy('${s.id}','${s.name.replace(/'/g, "\\'")}')" title="删除策略">🗑️</button>` : ''}
          ${isDraggable ? `<div class="strategy-drag-handle" style="color:var(--text-dim);font-size:1rem;padding:0 6px;cursor:grab" title="拖动排序">⋮⋮</div>` : ''}
          <div class="strategy-chevron">▼</div>
        </div>
        <div class="strategy-bar"><div class="strategy-bar-fill" style="width: ${pct}%; background: ${s.color}"></div></div>
        <div class="strategy-body">
          <div class="strategy-body-inner">
            ${s.id === 'cash' ? `
              <div style="padding: 12px; color: var(--text-dim); font-size: 0.85rem">
                现金基础（来自资金流水）: <b style="color: var(--blue)">${fmtNum(portfolio.cash_base_usd || 0)}</b>
                <br><span style="font-size:0.75rem;color:var(--text-dim)">入金/出金记录请点击顶部「现金基础」卡片查看</span>
              </div>
            ` : positions.length ? `
              ${positions.map(p => {
                // 期权策略格式（根据策略类型）
                if (getStrategyType(p.strategy) === 'option') {
                  const isSold = (p.contracts || 0) < 0;
                  const absContracts = Math.abs(p.contracts || 0);
                  const optType = p.option_type || 'put';
                  const isWheel = p.wheel_type === 'sell_put' || p.wheel_type === 'sell_call';
                  const annualizedROI = p.wheel_type === 'sell_put' ? calcStockAnnualizedROI(p.stock_price, p.strike, p.expiry, p.premium, 'sell_put') : null;
                  const tagHtml = isWheel
                    ? `<span class="holding-tag ${p.wheel_type}">${p.wheel_type === 'sell_put' ? 'Sell Put' : p.wheel_type === 'sell_call' ? 'Sell Call' : 'Covered Call'}</span>`
                    : `<span class="holding-tag leaps">${isSold ? 'Sell ' + optType.charAt(0).toUpperCase() + optType.slice(1) : optType.charAt(0).toUpperCase() + optType.slice(1)} ${isSold ? '(空头)' : '(多头)'}</span>`;
                  const premiumTotal = (p.premium || 0) * absContracts * 100;
                  const valLeft = isSold
                    ? `权利金: <span class="green">$${premiumTotal.toFixed(0)}</span>`
                    : `成本: $${(p.buy_price || 0).toFixed(0)}`;
                  const extraInfo = annualizedROI !== null ? '<span>' + formatAnnualizedROI(annualizedROI) + '</span>' : '';
                  return `
                    <div class="holding-item" onclick="event.stopPropagation()">
                      <div class="holding-symbol">${p.symbol}</div>
                      <div class="holding-details">
                        <div>${tagHtml}</div>
                        <div class="holding-info-row">
                          <span>K${p.strike} · ${p.expiry} · ${daysToExpiry(p.expiry)}</span>
                          <span class="stock-price-tag">股价: <span class="${(p.stock_price || 0) > 0 ? 'green' : ''}">$${(p.stock_price || 0).toFixed(0)}</span></span>
                          <span>${absContracts}${isSold ? '张(卖)' : '张(买)'}</span>
                          <span>Δ${p.delta || '-'}</span>
                          ${extraInfo}
                        </div>
                      </div>
                      <div class="holding-value">
                        <div>${valLeft}</div>
                        <div>期权当前价: $${(p.current_option_price || 0).toFixed(0)}</div>
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
                // 正股策略格式
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
                      <button class="btn btn-sm" style="border-color:var(--blue);color:var(--blue)" onclick="openBuyModal('${p.id}','${p.symbol}','${s.id}')">📥 加仓</button>
                      <button class="btn btn-sm" style="border-color:var(--green);color:var(--green)" onclick="openSellModal('${p.id}','${p.symbol}',${p.quantity},${p.avg_price})">📤 卖出</button>
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
                <div class="add-form-inline" onclick="event.stopPropagation()" id="add-form-${s.id}">
                  ${renderAddPositionForm(s.id)}
                </div>
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
  const sources = getAvailableProfitSources(stratId);
  const profitSourceSelect = sources.length > 0
    ? `<select id="profit-source-${stratId}" style="width:140px;background:#0f172a;color:#e8eaf0;border:1px solid #1e2235;border-radius:6px;padding:6px 4px;font-size:12px;margin-top:4px">
        <option value="">💵 现金支付</option>
        ${sources.map(s => `<option value="${s.id}">💜 用${s.icon}${s.name}(${fmtNum(getStrategyRealizedProfit(s.id))})</option>`).join('')}
      </select>`
    : '';
  const isOption = getStrategyType(stratId) === 'option';
  if (isOption) {
    return `
      <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
        <input class="input-sym" id="add-sym-${stratId}" placeholder="AMZN" style="width:70px">
        <select class="input-option-type" id="add-option-type-${stratId}" style="width:65px;background:#0f172a;color:#e8eaf0;border:1px solid #1e2235;border-radius:6px;padding:6px 4px;font-size:12px">
          <option value="put">Put</option>
          <option value="call">Call</option>
        </select>
        <input class="input-strike" id="add-strike-${stratId}" type="number" step="any" placeholder="Strike" style="width:70px">
        <input class="input-expiry" id="add-expiry-${stratId}" type="date" style="width:120px">
        <input class="input-contracts" id="add-contracts-${stratId}" type="number" step="1" placeholder="合约(负=卖)" style="width:85px">
        <input class="input-premium" id="add-premium-${stratId}" type="number" step="any" placeholder="权利金/张" style="width:80px">
        <input class="input-delta" id="add-delta-${stratId}" type="number" step="0.01" placeholder="Delta" style="width:65px">
        <button class="btn btn-sm btn-primary" onclick="addPositionToStrategy('${stratId}')">添加</button>
      </div>
      ${profitSourceSelect}
    `;
  }
  // 正股策略 (DCA, Swing)
  return `
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
      <input class="input-sym" id="add-sym-${stratId}" placeholder="AAPL" style="width:70px">
      <input class="input-qty" id="add-qty-${stratId}" type="number" step="any" placeholder="数量" style="width:60px">
      <input class="input-price" id="add-price-${stratId}" type="number" step="any" placeholder="成本价" style="width:75px">
      <input class="input-curr" id="add-curr-${stratId}" type="number" step="any" placeholder="现价" style="width:75px">
      <button class="btn btn-sm btn-primary" onclick="addPositionToStrategy('${stratId}')">添加</button>
    </div>
    ${profitSourceSelect}
  `;
}

function addPositionToStrategy(stratId) {
  const sym = document.getElementById(`add-sym-${stratId}`).value.toUpperCase();
  if (!sym) { showToast('请填写标的代码', 'error'); return; }

  if (getStrategyType(stratId) === 'option') {
    // 期权策略（Wheel/LEAPS/自定义期权仓）
    const strike = parseFloat(document.getElementById(`add-strike-${stratId}`).value);
    const expiry = document.getElementById(`add-expiry-${stratId}`).value;
    const contracts = parseInt(document.getElementById(`add-contracts-${stratId}`).value) || 1;
    const premium = parseFloat(document.getElementById(`add-premium-${stratId}`).value) || 0;
    const optionType = document.getElementById(`add-option-type-${stratId}`).value;
    const delta = parseFloat(document.getElementById(`add-delta-${stratId}`).value) || 0;
    
    if (!strike || !expiry) { showToast('请填写完整信息', 'error'); return; }
    
    const quantity = contracts * 100;
    
    const profitSource = document.getElementById(`profit-source-${stratId}`) ? document.getElementById(`profit-source-${stratId}`).value : '';
    
    fetch('/api/portfolio/position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: sym,
        strategy: stratId,
        strike: strike,
        expiry: expiry,
        option_type: optionType,
        contracts: contracts,
        quantity: contracts * 100,
        premium: premium,
        buy_price: premium,
        current_option_price: premium,
        delta: delta,
        profit_source: profitSource || undefined,
        profit_source: profitSource,
      }),
    })
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          portfolio = res.portfolio;
          realizedProfits = res.realized_profits || {};
          refreshAll();
          const msg = profitSource ? `✅ ${sym} 已添加（用${profitSource}盈利支付）` : `✅ 已添加 ${sym}`;
          showToast(msg);
        }
      });
    return;
  }
  
  // 正股策略 (DCA, Swing)
  const qty = parseFloat(document.getElementById(`add-qty-${stratId}`).value);
  const avg = parseFloat(document.getElementById(`add-price-${stratId}`).value);
  const curr = parseFloat(document.getElementById(`add-curr-${stratId}`).value) || avg;
  const profitSource = document.getElementById(`profit-source-${stratId}`) ? document.getElementById(`profit-source-${stratId}`).value : '';

  if (isNaN(qty) || isNaN(avg)) { showToast('请填写完整信息', 'error'); return; }

  fetch('/api/portfolio/position', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: sym, quantity: qty, avg_price: avg, current_price: curr, strategy: stratId, profit_source: profitSource }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        portfolio = res.portfolio;
        realizedProfits = res.realized_profits || {};
        refreshAll();
        const msg = profitSource ? `✅ ${sym} 已添加（用${profitSource}盈利支付）` : `✅ 已添加 ${sym}`;
        showToast(msg);
      }
    });
}

function showAddForm(stratId) {
  const row = document.getElementById('add-row-' + stratId);
  if (!row) return;
  row.innerHTML = renderAddPositionForm(stratId, true);
}

function deletePosition(posId) {
  if (!confirm('确认删除此持仓？')) return;
  fetch(`/api/portfolio/position/${posId}`, { method: 'DELETE' })
    .then(r => r.json())
    .then(res => {
      if (res.success) { portfolio = res.portfolio; refreshAll(); showToast('已删除'); }
    });
}

function confirmDeleteStrategy(stratId, stratName) {
  if (!confirm(`确认删除策略「${stratName}」？\n\n注意：策略内的所有持仓也会被一起删除！`)) return;
  fetch(`/api/portfolio/strategy/${stratId}`, { method: 'DELETE' })
    .then(r => r.json())
    .then(res => {
      if (res.success) { portfolio = res.portfolio; refreshAll(); showToast('策略已删除'); }
      else { showToast('❌ 删除失败'); }
    });
}

function editPosition(posId, stratId) {
  const p = portfolio.positions.find(x => x.id === posId);
  if (!p) return;
  if (getStrategyType(p.strategy) === 'option') {
    // 期权：输入期权当前价
    const optLabel = p.strategy === 'wheel' ? '期权当前价(权利金现价)' : '期权当前价';
    const currentOpt = p.current_option_price || 0;
    const newOptPrice = prompt(`更新 ${p.symbol} ${optLabel}:`, currentOpt);
    if (newOptPrice === null) return;
    const opt = parseFloat(newOptPrice);
    if (isNaN(opt) || opt < 0) { showToast('❌ 请输入有效价格'); return; }
    fetch('/api/option/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: posId, current_option_price: opt }),
    })
    .then(r => r.json())
    .then(res => {
      if (res.success) { portfolio = res.portfolio; refreshAll(); showToast('✅ 期权盈亏已更新'); }
      else { showToast('❌ ' + (res.error || '更新失败')); }
    });
  } else {
    // 正股：更新 current_price
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
}


// === Strategy Creation ===
function handleAddStrategy(e) {
  e.preventDefault();
  const name = document.getElementById('new-strat-name').value.trim();
  const icon = document.getElementById('new-strat-icon').value || '📁';
  const color = document.getElementById('new-strat-color').value;
  const type = document.getElementById('new-strat-type').value;
  const desc = document.getElementById('new-strat-desc').value;

  if (!name) { showToast('❌ 请输入策略名称'); return; }


  // 检查图标是否已被使用
  const usedIcons = (portfolio.strategies || []).map(s => s.icon);
  if (usedIcons.includes(icon)) { showToast('❌ 该图标已被其他策略使用，请换一个'); return; }


  fetch('/api/portfolio/strategy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, icon, color, desc, type }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) { portfolio = res.portfolio; refreshAll(); closeModal('strategy-modal'); showToast('✅ 策略已创建'); }
      else if (res.error) { showToast('❌ ' + res.error); }
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
      radius: ['42%', '68%'],
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
    grid: { left: 70, right: 20, top: 10, bottom: 60 },
    xAxis: {
      type: 'category', data: data.map(d => d.name.split(' ').slice(1).join(' ') || d.name),
      axisLabel: { color: '#6b7194', fontSize: 10, rotate: 35, interval: 0 },
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

// === Target Modal ===

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
  
  fetch('/api/refresh-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
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

// === 现金调整 ===
function openCashAdjustForm() {
  const form = document.getElementById('cash-adjust-form');
  form.style.display = 'block';
  document.getElementById('adj-cash-usd').value = (portfolio.cash_base_usd || 0).toFixed(2);
  document.getElementById('adj-cash-msg').textContent = '';
  document.getElementById('adj-cash-usd').focus();
  document.getElementById('adj-cash-usd').select();
}

async function submitCashAdjust() {
  const newVal = parseFloat(document.getElementById('adj-cash-usd').value);
  const msg = document.getElementById('adj-cash-msg');
  if (isNaN(newVal) || newVal < 0) {
    msg.textContent = '请输入有效金额';
    msg.style.color = 'red';
    return;
  }
  const resp = await fetch('/api/portfolio/cash/adjust', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({cash_usd: newVal})
  });
  const data = await resp.json();
  if (data.success) {
    portfolio.cash_base_usd = data.cash_base_usd;
    refreshAll();
    msg.textContent = `已更新为 $${newVal.toFixed(2)}`;
    msg.style.color = 'green';
  } else {
    msg.textContent = '更新失败';
    msg.style.color = 'red';
  }
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

// === Buy More (加仓) ===
function openBuyModal(posId, symbol, strategyId) {
  const modal = document.getElementById('buy-modal');
  modal.classList.add('active');
  document.getElementById('buy-pos-id').value = posId;
  document.getElementById('buy-symbol').textContent = symbol;
  document.getElementById('buy-qty').value = '';
  document.getElementById('buy-price').value = '';
  document.getElementById('buy-preview').innerHTML = '';
  document.getElementById('buy-qty').focus();

  const updatePreview = () => {
    const q = parseFloat(document.getElementById('buy-qty').value) || 0;
    const p = parseFloat(document.getElementById('buy-price').value) || 0;
    if (q > 0 && p > 0) {
      const cost = q * p;
      document.getElementById('buy-preview').innerHTML =
        `<span style="color:var(--text-dim)">预估成本: $${cost.toFixed(2)}</span>`;
    }
  };
  document.getElementById('buy-qty').oninput = updatePreview;
  document.getElementById('buy-price').oninput = updatePreview;
}

function submitBuy(e) {
  e.preventDefault();
  const posId = document.getElementById('buy-pos-id').value;
  const qty = parseFloat(document.getElementById('buy-qty').value);
  const price = parseFloat(document.getElementById('buy-price').value);
  if (!qty || qty <= 0) { showToast('❌ 请输入有效数量', 'error'); return; }
  if (!price || price <= 0) { showToast('❌ 请输入有效价格', 'error'); return; }

  // Find the position to get strategy info
  const pos = portfolio.positions.find(p => p.id === posId);
  if (!pos) { showToast('❌ 持仓不存在', 'error'); return; }

  fetch('/api/portfolio/position', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: pos.symbol,
      strategy: pos.strategy,
      quantity: qty,
      avg_price: price,
      current_price: pos.current_price || price,
    }),
  })
  .then(r => r.json())
  .then(res => {
    if (res.success) {
      portfolio = res.portfolio;
      refreshAll();
      closeModal('buy-modal');
      showToast(`✅ 加仓成功: ${pos.symbol} +${qty}股 @ $${price.toFixed(2)}`);
    } else { showToast('❌ ' + (res.error || '加仓失败'), 'error'); }
  })
  .catch(() => showToast('❌ 加仓失败', 'error'));
}

// === Sell Position (DCA + Swing FIFO) ===
function openSellModal(posId, symbol, qty, avgPrice) {
  const modal = document.getElementById('sell-modal');
  modal.classList.add('active');
  document.getElementById('sell-pos-id').value = posId;
  document.getElementById('sell-symbol').textContent = symbol;
  document.getElementById('sell-qty-max').textContent = qty;
  document.getElementById('sell-cost').textContent = avgPrice.toFixed(2);
  document.getElementById('sell-qty').value = '';
  document.getElementById('sell-price').value = '';
  document.getElementById('sell-preview').innerHTML = '';
  document.getElementById('sell-qty').focus();

  const updatePreview = () => {
    const q = parseFloat(document.getElementById('sell-qty').value) || 0;
    const p = parseFloat(document.getElementById('sell-price').value) || 0;
    if (q > 0 && p > 0) {
      const revenue = q * p;
      const cost = q * avgPrice;
      const pnl = revenue - cost;
      const color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
      document.getElementById('sell-preview').innerHTML =
        `<span style="color:${color}">预估盈亏: $${pnl.toFixed(2)} (${((pnl/cost)*100).toFixed(2)}%)</span>`;
    }
  };
  document.getElementById('sell-qty').oninput = updatePreview;
  document.getElementById('sell-price').oninput = updatePreview;
}

function submitSell(e) {
  e.preventDefault();
  const posId = document.getElementById('sell-pos-id').value;
  const qty = parseFloat(document.getElementById('sell-qty').value);
  const price = parseFloat(document.getElementById('sell-price').value);
  if (!qty || qty <= 0) { showToast('❌ 请输入有效数量', 'error'); return; }
  if (!price || price <= 0) { showToast('❌ 请输入有效价格', 'error'); return; }

  fetch(`/api/portfolio/position/${posId}/sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: qty, price: price }),
  })
  .then(r => r.json())
  .then(res => {
    if (res.success) {
      portfolio = res.portfolio;
      refreshAll();
      closeModal('sell-modal');
      showToast(`✅ 卖出成功，盈亏: ${res.pnl > 0 ? '+' : ''}$${res.pnl.toFixed(2)}`);
    } else { showToast('❌ ' + (res.error || '卖出失败'), 'error'); }
  })
  .catch(err => showToast('❌ 网络错误', 'error'));
}

// === Close Position (平仓) ===
function closePosition(posId, stratId, symbol) {
  // 查找持仓的wheel_type，用于显示不同提示
  const pos = portfolio.positions.find(p => p.id === posId);
  const modal = document.getElementById('close-modal');
  modal.classList.add('active');
  modal.dataset.posId = posId;
  modal.dataset.stratId = stratId;
  document.getElementById('close-symbol').textContent = symbol;
  document.getElementById('close-price').value = '';

  const wheelTypeTag = document.getElementById('close-wheel-type');
  const priceLabel = document.getElementById('close-price-label');
  const priceHint = document.getElementById('close-price-hint');

  const wt = pos && pos.wheel_type;
  // 所有期权统一：平仓价 = 期权价格（买回或卖出的期权价格）
  if (wt === 'covered_call') {
    wheelTypeTag.textContent = '🏛️ Covered Call';
  } else if (wt === 'sell_put') {
    wheelTypeTag.textContent = '📉 Sell Put';
  } else if (wt === 'sell_call') {
    wheelTypeTag.textContent = '📈 Sell Call';
  } else {
    wheelTypeTag.textContent = '';
  }
  // 统一提示：买方填期权卖出价，卖方填期权买回价，到期作废填 0
  priceLabel.textContent = '平仓价格 (每股期权价格)';
  priceHint.textContent = '到期作废请填 0；否则填当前期权价格';

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
  const history = portfolio.history || historyList || [];
  if (!history.length) {
    container.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:40px">暂无交易记录</p>';
    return;
  }

  const stockTrades = history.filter(h => h.action === 'BUY' || h.action === 'SELL');
  const optionTrades = history.filter(h => h.strategy === 'wheel' || h.strategy === 'leaps');
  const allTrades = history;

  // 按年月分组
  function groupByMonth(arr, dateKey) {
    const m = {};
    arr.forEach(h => {
      const d = h[dateKey] || h.close_date || h.date || '';
      const ym = d.substring(0, 7); // YYYY-MM
      (m[ym] = m[ym] || []).push(h);
    });
    // 每月内按日期降序
    Object.values(m).forEach(a => a.sort((a,b) => (b[dateKey]||b.date||'').localeCompare(a[dateKey]||a.date||'')));
    return m;
  }

  // 按个股分组
  function groupBy(arr, key) {
    const m = {};
    arr.forEach(h => { (m[h.symbol] = m[h.symbol] || []).push(h); });
    Object.values(m).forEach(a => a.sort((a,b) => (b[key]||'').localeCompare(a[key]||'')));
    return m;
  }

  function stats(trades, isOption) {
    if (isOption) {
      const pnls = trades.map(h => h.pnl || 0);
      const wins = pnls.filter(p => p > 0);
      const losses = pnls.filter(p => p < 0);
      const totalComm = trades.reduce((s,h) => s + (h.commission||0), 0);
      return {
        count: trades.length, totalPnl: pnls.reduce((a,b) => a+b, 0),
        winCount: wins.length, lossCount: losses.length, totalCost: totalComm
      };
    }
    const buys = trades.filter(h => h.action === 'BUY');
    const sells = trades.filter(h => h.action === 'SELL');
    const wins = sells.filter(h => (h.pnl||0) > 0);
    const losses = sells.filter(h => (h.pnl||0) < 0);
    const totalComm = trades.reduce((s,h) => s + (h.commission||0) + (h.fees||0), 0);
    return {
      buyQty: buys.reduce((s,h) => s + (h.quantity||0), 0),
      sellQty: sells.reduce((s,h) => s + (h.quantity||0), 0),
      totalPnl: sells.reduce((s,h) => s + (h.pnl||0), 0),
      sellCount: sells.length, winCount: wins.length, lossCount: losses.length,
      totalCost: totalComm
    };
  }

  // 累积佣金/税费
  const cumComm = allTrades.reduce((s,h) => s + (h.commission||0), 0);
  const cumFees = allTrades.reduce((s,h) => s + (h.fees||0), 0);
  const cumTotal = cumComm + cumFees;

  // 年月中文标签
  const monthLabel = ym => {
    const [y, m] = ym.split('-');
    return `${y}年${parseInt(m)}月`;
  };

  let html = '';

  // === 总览卡片 ===
  html += `<div class="history-summary" style="margin-bottom:20px">
    <div class="stat-card"><div class="label">总交易笔数</div><div class="value">${allTrades.length}</div></div>
    <div class="stat-card"><div class="label">累积佣金</div><div class="value fee-cell">$${cumComm.toFixed(2)}</div></div>
    <div class="stat-card"><div class="label">累积税费</div><div class="value fee-cell">$${cumFees.toFixed(2)}</div></div>
    <div class="stat-card"><div class="label">累积交易成本</div><div class="value fee-cell" style="font-size:1.1rem">$${cumTotal.toFixed(2)}</div></div>
  </div>`;

  // === 正股交易（按年月分组） ===
  if (stockTrades.length > 0) {
    const all = stats(stockTrades, false);
    const wr = all.sellCount ? (all.winCount/all.sellCount*100).toFixed(1) : '0.0';
    const stockByMonth = groupByMonth(stockTrades, 'date');

    html += `<h3 style="font-size:1.1rem;margin-bottom:12px">📈 正股交易</h3>`;
    html += `<div class="history-summary" style="margin-bottom:16px">
      <div class="stat-card"><div class="label">累计买入</div><div class="value">${all.buyQty} 股</div></div>
      <div class="stat-card"><div class="label">累计卖出</div><div class="value">${all.sellQty} 股</div></div>
      <div class="stat-card"><div class="label">总盈亏</div><div class="value ${all.totalPnl>=0?'green':'red'}">$${fmtNum(all.totalPnl)}</div></div>
      <div class="stat-card"><div class="label">卖出胜率</div><div class="value">${wr}%</div><div class="sub">${all.winCount}胜 ${all.lossCount}负</div></div>
      <div class="stat-card"><div class="label">交易成本</div><div class="value fee-cell">$${all.totalCost.toFixed(2)}</div></div>
    </div>`;

    // 按月份展示
    const sortedMonths = Object.keys(stockByMonth).sort().reverse();
    for (const ym of sortedMonths) {
      const monthTrades = stockByMonth[ym];
      const ms = stats(monthTrades, false);
      const mwr = ms.sellCount ? (ms.winCount/ms.sellCount*100).toFixed(1) : '0.0';
      const mComm = monthTrades.reduce((s,h) => s + (h.commission||0) + (h.fees||0), 0);

      html += `<details class="month-group" open>
        <summary class="month-summary">📅 <b>${monthLabel(ym)}</b>
          <span class="month-stats">${monthTrades.length}笔 · 净盈亏 <span class="${ms.totalPnl>=0?'green':'red'}">$${ms.totalPnl.toFixed(2)}</span> · 成本 $${mComm.toFixed(2)}</span>
        </summary>
        <div class="month-content">`;

      // 月内按个股分组
      const symGroups = groupBy(monthTrades, 'date');
      for (const [sym, trades] of Object.entries(symGroups)) {
        const s = stats(trades, false);
        const swr = s.sellCount ? (s.winCount/s.sellCount*100).toFixed(1) : '0.0';
        html += `<div class="history-symbol-group">
          <div class="history-symbol-header">
            <b>${sym}</b>
            <span style="font-size:0.8rem;color:var(--text-dim)">买入${s.buyQty}股 · 卖出${s.sellQty}股 · <span class="${s.totalPnl>=0?'green':'red'}">$${s.totalPnl.toFixed(2)}</span> · 胜率${swr}%</span>
          </div>
          <table class="history-table"><thead><tr>
            <th>日期</th><th>操作</th><th>数量</th><th>价格</th><th>成本</th><th>盈亏</th><th>佣金</th><th>税费</th><th>交易成本</th><th>备注</th><th></th>
          </tr></thead><tbody>`;
        trades.forEach(h => {
          const cls = h.action === 'BUY' ? 'buy-tag' : 'sell-tag';
          const comm = h.commission || 0;
          const fees = h.fees || 0;
          html += `<tr>
            <td>${h.date||'-'}</td>
            <td><span class="holding-tag ${cls}">${h.action==='BUY'?'买入':'卖出'}</span></td>
            <td>${h.quantity||'-'}</td>
            <td>$${(h.price||0).toFixed(2)}</td>
            <td>${h.cost_price ? '$'+h.cost_price.toFixed(2) : '-'}</td>
            <td class="${(h.pnl||0)>=0?'green':'red'}">${h.pnl ? '$'+h.pnl.toFixed(2) : '-'}</td>
            <td>$${comm.toFixed(2)}</td>
            <td>${fees > 0 ? '$'+fees.toFixed(2) : '-'}</td>
            <td class="fee-cell">$${(comm+fees).toFixed(2)}</td>
            <td style="font-size:0.8rem;color:var(--text-dim)">${h.note||'-'}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteHistoryItem('${h.id}')" title="删除此条记录">🗑️</button></td>
          </tr>`;
        });
        html += '</tbody></table></div>';
      }
      html += '</div></details>';
    }
  }

  // === 期权交易（按年月分组） ===
  if (optionTrades.length > 0) {
    const all = stats(optionTrades, true);
    const wr = all.count ? (all.winCount/all.count*100).toFixed(1) : '0.0';
    const optByMonth = groupByMonth(optionTrades, 'close_date');

    html += `<h3 style="font-size:1.1rem;margin:20px 0 12px">🎲 期权交易</h3>`;
    html += `<div class="history-summary" style="margin-bottom:16px">
      <div class="stat-card"><div class="label">交易次数</div><div class="value">${all.count}</div></div>
      <div class="stat-card"><div class="label">总盈亏</div><div class="value ${all.totalPnl>=0?'green':'red'}">$${fmtNum(all.totalPnl)}</div></div>
      <div class="stat-card"><div class="label">胜率</div><div class="value">${wr}%</div><div class="sub">${all.winCount}胜 ${all.lossCount}负</div></div>
      <div class="stat-card"><div class="label">交易成本</div><div class="value fee-cell">$${all.totalCost.toFixed(2)}</div></div>
    </div>`;

    const sortedMonths = Object.keys(optByMonth).sort().reverse();
    for (const ym of sortedMonths) {
      const monthTrades = optByMonth[ym];
      const ms = stats(monthTrades, true);
      const mwr = ms.count ? (ms.winCount/ms.count*100).toFixed(1) : '0.0';
      const mComm = monthTrades.reduce((s,h) => s + (h.commission||0), 0);

      html += `<details class="month-group" open>
        <summary class="month-summary">📅 <b>${monthLabel(ym)}</b>
          <span class="month-stats">${monthTrades.length}笔 · 净盈亏 <span class="${ms.totalPnl>=0?'green':'red'}">$${ms.totalPnl.toFixed(2)}</span> · 成本 $${mComm.toFixed(2)}</span>
        </summary>
        <div class="month-content">`;

      // 月内按个股分组
      const symGroups = groupBy(monthTrades, 'close_date');
      for (const [sym, trades] of Object.entries(symGroups)) {
        const s = stats(trades, true);
        const swr = s.count ? (s.winCount/s.count*100).toFixed(1) : '0.0';
        html += `<div class="history-symbol-group">
          <div class="history-symbol-header">
            <b>${sym}</b>
            <span style="font-size:0.8rem;color:var(--text-dim)">${s.count}笔 · <span class="${s.totalPnl>=0?'green':'red'}">$${s.totalPnl.toFixed(2)}</span> · 胜率${swr}%</span>
          </div>
          <table class="history-table"><thead><tr>
            <th>类型</th><th>策略</th><th>Strike</th><th>到期日</th><th>合约</th><th>开仓价</th><th>平仓价</th><th>Delta</th><th>平仓日</th><th>盈亏</th><th>盈亏%</th><th>佣金</th><th>交易成本</th><th></th>
          </tr></thead><tbody>`;
        trades.forEach(h => {
          const type = h.strategy==='wheel'
            ? (h.wheel_type==='sell_put'?'Sell Put':h.wheel_type==='sell_call'?'Sell Call':h.wheel_type==='covered_call'?'Covered Call':'-')
            : 'LEAPS Call';
          const openP = h.strategy==='wheel'?(h.open_premium||0):(h.open_price||0);
          const comm = h.commission || 0;
          html += `<tr>
            <td><span class="holding-tag ${h.strategy==='wheel'?(h.wheel_type||''):'leaps'}">${type}</span></td>
            <td>${h.strategy==='wheel'?'🎡 Wheel':'🚀 LEAPS'}</td>
            <td>K${h.strike}</td>
            <td>${h.expiry}</td>
            <td>${h.contracts}</td>
            <td>$${openP.toFixed(2)}</td>
            <td>$${(h.close_price||0).toFixed(2)}</td>
            <td>${h.open_delta||'-'}</td>
            <td>${h.close_date||'-'}</td>
            <td class="${h.pnl>=0?'green':'red'}">$${h.pnl.toFixed(2)}</td>
            <td class="${h.pnl>=0?'green':'red'}">${h.pnl>=0?'+':''}${h.pnl_pct.toFixed(2)}%</td>
            <td>$${comm.toFixed(2)}</td>
            <td class="fee-cell">$${comm.toFixed(2)}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteHistoryItem('${h.id}')" title="删除此条记录">🗑️</button></td>
          </tr>`;
        });
        html += '</tbody></table></div>';
      }
      html += '</div></details>';
    }
  }

  container.innerHTML = html;
}

function deleteHistoryItem(histId) {
  if (!confirm('确认删除此条交易记录？相关现金、已实现盈利、持仓将被回滚。')) return;
  fetch(`/api/history/${histId}`, { method: 'DELETE' })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        portfolio = res.portfolio || portfolio;
        realizedProfits = res.realized_profits || {};
        renderHistory();
        refreshAll();
        showToast('✅ 交易记录已删除，相关数据已回滚');
      } else {
        showToast('❌ 删除失败: ' + (res.error || '未知错误'));
      }
    });
}


function exportHistory() {
  window.location.href = '/api/export/history';
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

// === Backup Download ===
function downloadBackup() {
  const btn = document.querySelector('.btn-export');
  if (btn) { btn.textContent = '⏳ 打包中…'; btn.disabled = true; }
  const link = document.createElement('a');
  link.href = '/api/backup';
  link.download = '';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    if (btn) { btn.textContent = '💾 备份数据'; btn.disabled = false; }
  }, 2000);
}

// === Backup Upload / Restore ===
function uploadBackup() {
  document.getElementById('backup-upload').click();
}

function handleBackupUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (!confirm(`确认恢复数据？\n\n将从「${file.name}」恢复，当前所有数据会被覆盖！`)) {
    event.target.value = '';
    return;
  }
  
  const btn = document.querySelector('.btn-import');
  if (btn) { btn.textContent = '⏳ 恢复中…'; btn.disabled = true; }
  
  const formData = new FormData();
  formData.append('file', file);
  
  fetch('/api/restore', {
    method: 'POST',
    body: formData
  })
  .then(r => r.json())
  .then(res => {
    if (res.success) {
      portfolio = res.portfolio;
      refreshAll();
      showToast('✅ 数据已恢复！');
    } else {
      showToast('❌ ' + (res.error || '恢复失败'));
    }
  })
  .catch(err => {
    showToast('❌ 上传失败: ' + err.message);
  })
  .finally(() => {
    if (btn) { btn.textContent = '📤 恢复数据'; btn.disabled = false; }
    event.target.value = '';
  });
}

// === Refresh All ===


function refreshAll() {
  realizedProfits = portfolio.realized_profits || {};
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
