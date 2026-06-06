const formatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const priceFormatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
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
      : `轮询 ${refreshCount} 次 · 状态${stateChanged ? "已更新" : "未变化"} · worker ${time(
          state.updatedAt
        )} · dashboard ${time(state.servedAt)}`;

    renderMetrics(state);
    renderOpportunityCenter(state.opportunityCenter ?? []);
    renderMakerMetrics(state.makerSimulation, state.makerCandidates ?? []);
    renderMakerCandidates(state.makerCandidates ?? []);
    renderMakerPositions(state.makerSimulation?.positions ?? {});
    renderArbitrageOpportunities(state.arbitrageOpportunities ?? []);
    renderMakerTrades(state.makerSimulation?.trades ?? []);
    renderMakerSnapshots(state.makerSimulation?.snapshots ?? []);
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

function renderOpportunityCenter(opportunities) {
  const executeCount = opportunities.filter((item) => item.tier === "execute").length;
  const watchCount = opportunities.filter((item) => item.tier === "watch").length;
  const avoidCount = opportunities.filter((item) => item.tier === "avoid").length;
  const best = opportunities[0];

  document.getElementById("opportunity-metrics").innerHTML = [
    metric("可执行机会", executeCount, executeCount ? "positive" : ""),
    metric("观察机会", watchCount),
    metric("禁止机会", avoidCount, avoidCount ? "negative" : ""),
    metric("最高机会分", best ? formatter.format(best.score ?? 0) : "-"),
    metric("最高机会来源", best ? sourceText(best.source) : "-"),
    metric("最高机会动作", best ? best.action : "-")
  ].join("");

  table(
    "opportunity-center",
    ["层级", "来源", "机会", "结果", "评分", "风险", "预估日收益", "边际", "盘口", "建议动作", "依据"],
    opportunities.map((item) => [
      opportunityPill(item.tier),
      sourceText(item.source),
      text(item.title),
      text(item.outcome ?? "-"),
      scorePill(item.score ?? 0),
      riskPill(item.riskLevel),
      item.expectedDailyReward ? usd.format(item.expectedDailyReward) : "-",
      item.edgeBps ? `${formatter.format(item.edgeBps)} bps` : "-",
      item.bid || item.ask ? `${price(item.bid)} / ${price(item.ask)}` : "-",
      text(item.action),
      text([item.rationale, ...(item.reasons ?? [])].filter(Boolean).join("; "))
    ])
  );
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
  const latestMaker = (state.makerCandidates ?? [])[0];
  const signalAgeMs = latestSignal ? Date.now() - latestSignal.sourceTimestamp : 0;
  const detectionLagMs = latestSignal ? latestSignal.detectedAt - latestSignal.sourceTimestamp : 0;
  const simPnl = state.simulation?.totalPnl ?? 0;
  const makerPnl = state.makerSimulation?.totalPnl ?? 0;

  document.getElementById("metrics").innerHTML = [
    metric("跟踪钱包", state.walletScores?.length ?? 0),
    metric("做市候选", state.makerCandidates?.length ?? 0),
    metric("最高做市评分", latestMaker ? formatter.format(latestMaker.score) : "-"),
    metric("最高日奖励", latestMaker ? usd.format(latestMaker.dailyReward) : "-"),
    metric("做市估算PnL", signedUsd(makerPnl), pnlClass(makerPnl)),
    metric("真实账户PnL", "未接入"),
    metric("PnL口径", state.mode === "live" ? "LIVE订单/账户待接入" : "PAPER模拟/奖励估算"),
    metric("信号数量", state.signals?.length ?? 0),
    metric("订单数量", state.orders?.length ?? 0),
    metric("周期开始", state.cycleStartedAt ? time(state.cycleStartedAt) : "-"),
    metric("今日名义金额", usd.format(state.risk?.notionalUsdc ?? 0)),
    metric("跟单模拟权益", `${usd.format(state.simulation?.totalEquity ?? 0)} PAPER`),
    metric("跟单模拟PnL", signedUsd(simPnl), pnlClass(simPnl)),
    metric("跟单模拟 ROI", percent(state.simulation?.roi ?? 0), pnlClass(state.simulation?.roi ?? 0)),
    metric("跟单已实现PnL", signedUsd(state.simulation?.realizedPnl ?? 0), pnlClass(state.simulation?.realizedPnl ?? 0)),
    metric("跟单未实现PnL", signedUsd(state.simulation?.unrealizedPnl ?? 0), pnlClass(state.simulation?.unrealizedPnl ?? 0)),
    metric("跟单最大回撤", percent(state.simulation?.maxDrawdown ?? 0), "negative"),
    metric("跟单持仓数", Object.keys(state.simulation?.positions ?? {}).length),
    metric("上一信号距今", signalAgeMs ? `${formatter.format(signalAgeMs / 1000)} 秒` : "-"),
    metric("公开 API 延迟", detectionLagMs ? `${formatter.format(detectionLagMs / 1000)} 秒` : "-")
  ].join("");
}

function renderMakerMetrics(simulation, candidates) {
  const activeQuoteCount = (candidates ?? []).filter((candidate) => candidate.bid && candidate.ask).length;
  const latestSnapshot = simulation?.snapshots?.[0];
  document.getElementById("maker-metrics").innerHTML = [
    metric("做市估算权益", `${usd.format(simulation?.totalEquity ?? 0)} PAPER`),
    metric("做市估算PnL", signedUsd(simulation?.totalPnl ?? 0), pnlClass(simulation?.totalPnl ?? 0)),
    metric("做市 ROI", percent(simulation?.roi ?? 0), pnlClass(simulation?.roi ?? 0)),
    metric("现金", usd.format(simulation?.cash ?? 0)),
    metric("库存市值", usd.format(simulation?.inventoryValue ?? 0)),
    metric("估算已获奖励", usd.format(simulation?.accruedReward ?? 0)),
    metric("估算日奖励", usd.format(latestSnapshot?.estimatedDailyReward ?? 0)),
    metric("奖励模型", simulation?.rewardModelVersion ?? "-"),
    metric("活跃盘口", `${activeQuoteCount}/${candidates.length}`),
    metric("模拟成交", simulation?.trades?.length ?? 0),
    metric("最大回撤", percent(simulation?.maxDrawdown ?? 0), "negative")
  ].join("");
}

function renderMakerCandidates(candidates) {
  table(
    "maker-candidates",
    [
      "综合分",
      "等级",
      "基础分",
      "市场",
      "结果",
      "日奖励",
      "动态估算日收益",
      "估算捕获率",
      "奖励模型",
      "最大价差",
      "盘口",
      "收益拆解",
      "风险拆解",
      "建议 bid",
      "建议 ask",
      "规模",
      "决策原因"
    ],
    candidates.slice(0, 80).map((candidate) => [
      scorePill(candidate.strategyScore ?? candidate.score ?? 0),
      decisionPill(candidate.decision?.tier, candidate.decision?.eligible),
      scorePill(candidate.score ?? 0),
      text(candidate.title ?? "-"),
      text(candidate.outcome ?? "-"),
      usd.format(candidate.dailyReward ?? 0),
      usd.format(candidate.rewardEstimate?.estimatedDailyReward ?? 0),
      percent(candidate.rewardEstimate?.captureRate ?? 0),
      rewardEstimateText(candidate.rewardEstimate),
      `${formatter.format(candidate.maxSpreadBps ?? 0)} bps`,
      quoteText(candidate),
      strategyGainText(candidate.strategy),
      strategyRiskText(candidate.strategy),
      price(candidate.quotePlan?.bidPrice),
      price(candidate.quotePlan?.askPrice),
      usd.format(candidate.quotePlan?.quoteSizeUsdc ?? 0),
      text([...(candidate.decision?.reasons ?? []), ...(candidate.tags ?? [])].join("; "))
    ])
  );
}

function renderMakerPositions(positionsByAsset) {
  const positions = Object.values(positionsByAsset).sort((a, b) => b.marketValue - a.marketValue);
  table(
    "maker-positions",
    ["市场", "结果", "份额", "成本均价", "标记价", "模拟库存市值", "模拟未实现PnL", "评分", "日奖励"],
    positions.slice(0, 80).map((position) => [
      text(position.title ?? shortText(position.asset)),
      text(position.outcome ?? "-"),
      formatter.format(position.shares),
      price(position.avgCost),
      price(position.markPrice),
      usd.format(position.marketValue),
      colorMoney(position.unrealizedPnl),
      formatter.format(position.score ?? 0),
      usd.format(position.dailyReward ?? 0)
    ])
  );
}

function renderArbitrageOpportunities(opportunities) {
  table(
    "arbitrage-opportunities",
    ["类型", "市场", "Yes价", "No价", "合计", "边际", "可执行", "说明"],
    opportunities.slice(0, 50).map((item) => [
      text(item.type),
      text(item.title),
      price(item.yesPrice),
      price(item.noPrice),
      price(item.combinedPrice),
      `${formatter.format(item.edgeBps)} bps`,
      decisionPill(item.executable ? "watch" : "avoid", item.executable),
      text(item.reason)
    ])
  );
}

function renderMakerTrades(trades) {
  table(
    "maker-trades",
    ["时间", "方向", "市场", "结果", "份额", "价格", "金额", "模拟已实现PnL", "原因"],
    trades.slice(0, 80).map((trade) => [
      time(trade.timestamp),
      sidePill(trade.side),
      text(trade.title ?? shortText(trade.asset)),
      text(trade.outcome ?? "-"),
      formatter.format(trade.shares),
      price(trade.price),
      usd.format(trade.notional),
      colorMoney(trade.realizedPnl),
      text(trade.reason ?? "")
    ])
  );
}

function renderMakerSnapshots(snapshots) {
  table(
    "maker-snapshots",
    ["时间", "候选", "活跃盘口", "Top评分", "估算日奖励", "估算累计奖励", "现金", "模拟库存", "估算权益", "估算ROI"],
    snapshots.slice(0, 80).map((snapshot) => [
      time(snapshot.timestamp),
      formatter.format(snapshot.candidateCount),
      formatter.format(snapshot.activeQuoteCount),
      formatter.format(snapshot.topScore),
      usd.format(snapshot.estimatedDailyReward),
      usd.format(snapshot.accruedReward),
      usd.format(snapshot.cash),
      usd.format(snapshot.inventoryValue),
      usd.format(snapshot.totalEquity),
      percent(snapshot.roi)
    ])
  );
}

function renderSimulationPositions(positionsByAsset) {
  const positions = Object.values(positionsByAsset).sort((a, b) => b.marketValue - a.marketValue);
  table(
    "sim-positions",
    ["市场", "结果", "份额", "成本均价", "标记价", "模拟市值", "模拟未实现PnL"],
    positions.slice(0, 50).map((position) => [
      text(position.title ?? shortText(position.asset)),
      text(position.outcome ?? "-"),
      formatter.format(position.shares),
      price(position.avgCost),
      price(position.markPrice),
      usd.format(position.marketValue),
      colorMoney(position.unrealizedPnl)
    ])
  );
}

function renderSimulationTrades(trades) {
  table(
    "sim-trades",
    ["时间", "方向", "市场", "份额", "价格", "金额", "模拟已实现PnL", "备注"],
    trades.slice(0, 50).map((trade) => [
      time(trade.timestamp),
      sidePill(trade.side),
      text(trade.title ?? shortText(trade.asset)),
      formatter.format(trade.shares),
      price(trade.price),
      usd.format(trade.notional),
      colorMoney(trade.realizedPnl),
      text(trade.skippedReason ?? "")
    ])
  );
}

function renderWallets(wallets) {
  table(
    "wallets",
    ["排名", "钱包", "公开PnL", "公开ROI", "公开当前价值", "评分"],
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
      time(signal.detectedAt),
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
      time(order.createdAt),
      sidePill(order.side),
      short(order.asset),
      formatter.format(order.amount),
      price(order.worstPrice),
      statusPill(order.status),
      text(order.error ?? "")
    ])
  );
}

function table(id, headers, rows) {
  const element = document.getElementById(id);
  if (!element) return;
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" class="muted">暂无数据</td></tr>`;
  element.innerHTML = `<table><thead><tr>${headers
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

function decisionPill(tier, eligible) {
  const label = tier ?? "unknown";
  const className = eligible ? (tier === "prime" ? "pill-filled" : "pill-partial") : "pill-failed";
  return `<span class="pill ${className}">${escapeHtml(label)}</span>`;
}

function opportunityPill(tier) {
  const labels = { execute: "可执行", watch: "观察", avoid: "禁止" };
  const classes = { execute: "pill-filled", watch: "pill-partial", avoid: "pill-failed" };
  return `<span class="pill ${classes[tier] ?? "pill-failed"}">${escapeHtml(labels[tier] ?? tier ?? "-")}</span>`;
}

function riskPill(risk) {
  const labels = { low: "低", medium: "中", high: "高" };
  const classes = { low: "pill-filled", medium: "pill-partial", high: "pill-failed" };
  return `<span class="pill ${classes[risk] ?? "pill-failed"}">${escapeHtml(labels[risk] ?? risk ?? "-")}</span>`;
}

function sourceText(source) {
  const labels = { maker: "做市", arbitrage: "套利", copy: "跟单" };
  return labels[source] ?? source ?? "-";
}

function strategyGainText(strategy) {
  if (!strategy) return "-";
  return text(
    `R ${formatter.format(strategy.rewardYield)} / S ${formatter.format(strategy.spreadYield)} / Reb ${formatter.format(
      strategy.rebatePotential
    )} / Hold ${formatter.format(strategy.holdingRewardPotential)}`
  );
}

function strategyRiskText(strategy) {
  if (!strategy) return "-";
  return text(
    `Inv ${formatter.format(strategy.inventoryRisk)} / Cat ${formatter.format(strategy.catalystRisk)} / Liq ${formatter.format(
      strategy.liquidityRisk
    )} / Comp ${formatter.format(strategy.competitionRisk)}`
  );
}

function rewardEstimateText(estimate) {
  if (!estimate) return "-";
  return text(
    `${estimate.model} / ${estimate.confidence} / comp ${formatter.format(
      estimate.existingCompetitionScore ?? 0
    )} / ours ${formatter.format(estimate.proposedQuoteScore ?? 0)}`
  );
}

function quoteText(candidate) {
  const bid = candidate.bid ? price(candidate.bid) : "-";
  const ask = candidate.ask ? price(candidate.ask) : "-";
  const mid = candidate.mid ? price(candidate.mid) : "-";
  return `${bid} / ${ask} · mid ${mid}`;
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
  return escapeHtml(value ?? "-");
}

function signedUsd(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${usd.format(value ?? 0)}`;
}

function percent(value) {
  return `${formatter.format((value ?? 0) * 100)}%`;
}

function price(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? priceFormatter.format(numberValue) : "-";
}

function time(value) {
  return value ? new Date(value).toLocaleTimeString() : "-";
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]
  );
}
