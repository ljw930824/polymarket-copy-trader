const formatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
let refreshCount = 0;
let lastStateUpdatedAt = 0;

initTabs();
refresh();
setInterval(refresh, 2000);

async function refresh() {
  try {
    const response = await fetch(`/api/state?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const state = await response.json();
    refreshCount += 1;
    const stateChanged = state.updatedAt !== lastStateUpdatedAt;
    lastStateUpdatedAt = state.updatedAt;

    renderMode(state);
    document.getElementById("status").innerHTML = state.lastError
      ? `<span class="bad">${escapeHtml(state.lastError)}</span>`
      : `轮询 ${refreshCount} 次 · 状态${stateChanged ? "已更新" : "未变化"} · worker ${new Date(
          state.updatedAt
        ).toLocaleTimeString()} · dashboard ${new Date(state.servedAt).toLocaleTimeString()}`;

    renderMetrics(state);
    renderSimulationPositions(state.simulation?.positions ?? {});
    renderSimulationTrades(state.simulation?.trades ?? []);
    renderWallets(state.walletScores ?? []);
    renderPositions(state.targetPositions ?? []);
    renderSignals(state.signals ?? []);
    renderOrders(state.orders ?? []);
  } catch (error) {
    document.getElementById("status").innerHTML = `<span class="bad">dashboard 请求失败：${escapeHtml(
      error instanceof Error ? error.message : String(error)
    )}</span>`;
  }
}

function initTabs() {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      for (const item of document.querySelectorAll(".tab")) item.classList.toggle("active", item === tab);
      for (const panel of document.querySelectorAll(".tab-panel")) {
        panel.classList.toggle("active", panel.id === `tab-${target}`);
      }
    });
  }
}

function renderMode(state) {
  const modeCard = document.getElementById("mode-card");
  const mode = String(state.mode ?? "paper").toLowerCase();
  modeCard.classList.toggle("mode-live", mode === "live");
  document.getElementById("mode").textContent = mode === "live" ? "实盘 LIVE" : "模拟 PAPER";
}

function renderMetrics(state) {
  const latestSignal = (state.signals ?? [])[0];
  const signalAgeMs = latestSignal ? Date.now() - latestSignal.sourceTimestamp : 0;
  const detectionLagMs = latestSignal ? latestSignal.detectedAt - latestSignal.sourceTimestamp : 0;
  const simPnl = state.simulation?.totalPnl ?? 0;
  const simRoi = state.simulation?.roi ?? 0;

  document.getElementById("metrics").innerHTML = [
    metric("跟踪钱包", state.walletScores?.length ?? 0),
    metric("信号数量", state.signals?.length ?? 0),
    metric("订单数量", state.orders?.length ?? 0),
    metric("周期开始", state.cycleStartedAt ? new Date(state.cycleStartedAt).toLocaleTimeString() : "-"),
    metric("今日名义金额", usd.format(state.risk?.notionalUsdc ?? 0)),
    metric("模拟权益", usd.format(state.simulation?.totalEquity ?? 0)),
    metric("模拟盈亏", signedUsd(simPnl), pnlClass(simPnl)),
    metric("模拟 ROI", percent(simRoi), pnlClass(simRoi)),
    metric("最大回撤", percent(state.simulation?.maxDrawdown ?? 0), "negative"),
    metric("上一信号距今", signalAgeMs ? `${formatter.format(signalAgeMs / 1000)} 秒` : "-"),
    metric("公开 API 延迟", detectionLagMs ? `${formatter.format(detectionLagMs / 1000)} 秒` : "-")
  ].join("");
}

function renderSimulationPositions(positionsByAsset) {
  const positions = Object.values(positionsByAsset).sort((a, b) => b.marketValue - a.marketValue);
  table(
    "sim-positions",
    ["市场", "结果", "份额", "成本均价", "标记价", "市值", "未实现盈亏"],
    positions.slice(0, 50).map((position) => [
      text(position.title ?? shortText(position.asset)),
      text(position.outcome ?? "-"),
      formatter.format(position.shares),
      formatter.format(position.avgCost),
      formatter.format(position.markPrice),
      usd.format(position.marketValue),
      colorMoney(position.unrealizedPnl)
    ])
  );
}

function renderSimulationTrades(trades) {
  table(
    "sim-trades",
    ["时间", "方向", "市场", "份额", "价格", "金额", "已实现盈亏", "备注"],
    trades.slice(0, 50).map((trade) => [
      new Date(trade.timestamp).toLocaleTimeString(),
      sidePill(trade.side),
      text(trade.title ?? shortText(trade.asset)),
      formatter.format(trade.shares),
      formatter.format(trade.price),
      usd.format(trade.notional),
      colorMoney(trade.realizedPnl),
      text(trade.skippedReason ?? "")
    ])
  );
}

function renderWallets(wallets) {
  table(
    "wallets",
    ["排名", "钱包", "PnL", "ROI", "当前价值", "评分"],
    wallets.map((wallet) => [
      wallet.rank,
      short(wallet.wallet),
      colorMoney(wallet.pnl),
      percent(wallet.roi),
      usd.format(wallet.currentValue),
      formatter.format(wallet.score)
    ])
  );
}

function renderPositions(positions) {
  table(
    "positions",
    ["市场", "结果", "Token", "目标金额"],
    positions.slice(0, 50).map((position) => [
      text(position.title ?? "-"),
      text(position.outcome ?? "-"),
      short(position.asset),
      usd.format(position.currentValue)
    ])
  );
}

function renderSignals(signals) {
  table(
    "signals",
    ["发现时间", "方向", "评分", "来源钱包", "市场", "目标金额", "公开 API 延迟", "拒绝原因"],
    signals.slice(0, 50).map((signal) => [
      new Date(signal.detectedAt).toLocaleTimeString(),
      sidePill(signal.side),
      scorePill(signal.signalScore ?? 0),
      short(signal.sourceWallet),
      text(signal.title ?? shortText(signal.asset)),
      usd.format(signal.targetUsdcAmount),
      `${formatter.format((signal.detectedAt - signal.sourceTimestamp) / 1000)} 秒`,
      text((signal.rejectReasons ?? []).join("; "))
    ])
  );
}

function renderOrders(orders) {
  table(
    "orders",
    ["时间", "方向", "Token", "数量/金额", "最差价格", "状态", "说明"],
    orders.slice(0, 50).map((order) => [
      new Date(order.createdAt).toLocaleTimeString(),
      sidePill(order.side),
      short(order.asset),
      formatter.format(order.amount),
      formatter.format(order.worstPrice),
      statusPill(order.status),
      text(order.error ?? "")
    ])
  );
}

function table(id, headers, rows) {
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" class="muted">暂无数据</td></tr>`;
  document.getElementById(id).innerHTML = `<table><thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function metric(label, value, className = "") {
  return `<div class="metric ${className}"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(
    String(value)
  )}</div></div>`;
}

function sidePill(side) {
  const value = escapeHtml(String(side ?? "-"));
  return `<span class="pill ${side === "BUY" ? "pill-buy" : "pill-sell"}">${value}</span>`;
}

function statusPill(status) {
  const value = escapeHtml(String(status ?? "-"));
  return `<span class="pill pill-${value}">${value}</span>`;
}

function scorePill(score) {
  const className = score >= 80 ? "pill-filled" : score >= 60 ? "pill-partial" : "pill-failed";
  return `<span class="pill ${className}">${formatter.format(score)}</span>`;
}

function colorMoney(value) {
  const className = pnlClass(value);
  return `<span class="${className}">${escapeHtml(signedUsd(value))}</span>`;
}

function pnlClass(value) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
}

function short(value) {
  return escapeHtml(shortText(value));
}

function shortText(value) {
  if (!value || value.length < 12) return value ?? "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function text(value) {
  return escapeHtml(value);
}

function signedUsd(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${usd.format(value)}`;
}

function percent(value) {
  return `${formatter.format(value * 100)}%`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}
