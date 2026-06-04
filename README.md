# Polymarket 策略控制台

这是一个本地运行的 Polymarket 策略研究工具。系统现在以“做市奖励实验”为主线，“跟单钱包”为辅助信号：

- 主策略：读取 Polymarket CLOB 的 reward-eligible markets，按日奖励、最大价差、最小挂单、盘口和风险标签做评分，生成被动 bid/ask 计划，并用本地 paper maker 账本模拟库存、成交、预计奖励和回撤。
- 辅助策略：筛选 PnL、ROI、成交量较强的钱包，监听公开 activity，生成跟单信号和 paper/live 订单，用于观察市场和对照实验。

默认运行在 `paper` 模式，不会真实下单。做市奖励模块目前只做观察、评分和模拟，不会自动提交真实 maker 挂单。

## 安装

```powershell
cd C:\path\polymarket
npm install
Copy-Item .env.example .env
```

## 启动

同时启动 worker 和 dashboard：

```powershell
npm run dev
```

分开启动：

```powershell
npm run worker
npm run dashboard
```

只跑一轮 worker，用于检查 API 和状态写入：

```powershell
npm run worker:once
```

打开 dashboard：

```text
http://localhost:8787
```

## 新开模拟盘周期

归档历史账本并重置模拟盘：

```powershell
npm run cycle:reset
```

该命令会把 `data/state.json` 归档到 `data/archives/`，然后清空 signals、orders、risk 和 simulation，并写入新的 `cycleStartedAt`。

## 核心配置

配置文件是本地 `.env`，不要提交到 GitHub。

```text
COPY_MODE=paper
COPY_TOP_N=3
COPY_TOTAL_BUDGET_USDC=100
POLL_INTERVAL_MS=1500
LEADERBOARD_REFRESH_MS=300000
ACTIVITY_LIMIT=25

MIN_WALLET_PNL=0
MIN_WALLET_VOLUME=1000
MIN_POSITION_VALUE_USDC=1
MAX_POSITION_VALUE_USDC=35

MAX_SINGLE_ORDER_USDC=15
MAX_DAILY_ORDER_COUNT=100
MAX_DAILY_NOTIONAL_USDC=500
MAX_SLIPPAGE_BPS=250
SIGNAL_STALE_MS=120000
MAX_SIGNAL_API_DELAY_MS=30000
MAX_ASSET_EXPOSURE_USDC=20
MARKET_COOLDOWN_MS=30000
MIN_COPY_PRICE=0.05
MAX_COPY_PRICE=0.85
MIN_SIGNAL_SCORE=60
EXCLUDE_SPORTS_MARKETS=true

MAKER_ENABLED=true
MAKER_REFRESH_MS=180000
MAKER_TOP_N=20
MAKER_MIN_DAILY_REWARD=1
MAKER_MAX_SPREAD_BPS=500
MAKER_MIN_SCORE=30
MAKER_QUOTE_SIZE_USDC=20
MAKER_SIM_INITIAL_CASH_USDC=100
MAKER_SIM_TOP_N=8
MAKER_SIM_MAX_MARKET_EXPOSURE_USDC=50
MAKER_SIM_REWARD_CAPTURE_RATE=0.02
MAKER_SIM_FILL_THRESHOLD_BPS=25
STRATEGY_MIN_SCORE=55
STRATEGY_MAX_CATALYST_RISK=55
STRATEGY_MAX_INVENTORY_RISK=70

SIM_INITIAL_CASH_USDC=100
```

## 做市奖励配置

- `MAKER_ENABLED`：是否启用做市奖励观察器。
- `MAKER_REFRESH_MS`：刷新官方 reward markets 的间隔。
- `MAKER_TOP_N`：dashboard 展示多少个做市候选。
- `MAKER_MIN_DAILY_REWARD`：过滤日奖励太低的市场。
- `MAKER_MAX_SPREAD_BPS`：只保留最大允许价差不超过该值的市场，500 表示 5%。
- `MAKER_MIN_SCORE`：低于该评分的候选不展示。
- `MAKER_QUOTE_SIZE_USDC`：生成建议挂单规模时使用的本地参考金额。
- `MAKER_SIM_INITIAL_CASH_USDC`：做市 paper 账本初始资金。
- `MAKER_SIM_TOP_N`：做市模拟每轮跟进评分最高的前 N 个候选。
- `MAKER_SIM_MAX_MARKET_EXPOSURE_USDC`：单个 outcome token 最大库存敞口。
- `MAKER_SIM_REWARD_CAPTURE_RATE`：预计能捕获的官方日奖励比例。默认 2%，因为真实奖励会和其他 LP 竞争。
- `MAKER_SIM_FILL_THRESHOLD_BPS`：中间价穿越被动 bid/ask 多少 bps 后，模拟成交。
- `STRATEGY_MIN_SCORE`：综合策略分低于该值的候选不进入做市回测。
- `STRATEGY_MAX_CATALYST_RISK`：催化/事件风险超过该值的候选不进入做市回测。
- `STRATEGY_MAX_INVENTORY_RISK`：库存风险超过该值的候选不进入做市回测。

综合策略评分：

```text
StrategyScore =
  rewardYield
+ spreadYield
+ rebatePotential
+ holdingRewardPotential
- inventoryRisk
- catalystRisk
- liquidityRisk
- competitionRisk
```

收益侧含义：

- `rewardYield`：官方 liquidity rewards 的可捕获收益，按 `MAKER_SIM_REWARD_CAPTURE_RATE` 保守估算。
- `spreadYield`：当前盘口价差带来的被动成交收益空间。
- `rebatePotential`：maker rebate 潜力，来自有 fees/rebates 的 maker 结构和市场奖励规模的近似估计。
- `holdingRewardPotential`：长期慢变量市场可能叠加 holding rewards 的潜力。

风险侧含义：

- `inventoryRisk`：mid 远离 0.5、最小挂单过大导致的库存风险。
- `catalystRisk`：临近事件、新闻、体育、短期结算导致的价格跳变风险。
- `liquidityRisk`：缺盘口、min size 过高带来的流动性风险。
- `competitionRisk`：价差极窄或奖励过高时，其他 LP 竞争激烈导致奖励捕获率下降。

做市回测只使用 `eligible=true` 的候选；被过滤的候选仍会在 dashboard 展示原因，方便复盘。

做市评分考虑：

- 日奖励越高越好。
- 官方允许价差越窄越好。
- 有实时 bid/ask 盘口比没有盘口更可靠。
- 最小挂单要求过高会扣分。
- 体育、电竞、临场强波动市场默认大幅扣分并过滤。
- 市场关闭、不活跃、不接受订单会扣分并过滤。

做市模拟规则：

- 不假设自己一定成交；只有当中间价穿越本地计划的被动 bid/ask 时，才记录 paper maker 成交。
- BUY 会增加库存，SELL 会减少库存并计算已实现盈亏。
- 持仓按最新 bid/ask 中间价 mark-to-market。
- 奖励收益按 `MAKER_SIM_REWARD_CAPTURE_RATE` 做保守估算，并单独显示为“预计已获奖励”。
- 做市账本和跟单模拟盘完全分开，避免两种策略互相污染。

## Dashboard 颜色含义

- 顶部蓝绿色：`paper` 模式，只模拟，不真实下单。
- 顶部红色：`live` 模式，会尝试真实下单。
- 紫色：做市奖励观察。
- 橙色：跟单信号与订单。
- 蓝色：模拟盘账本。
- 绿色：钱包筛选和目标持仓。

## 跟单延迟说明

Polymarket 官方 user WebSocket 只能推送当前账户自己的订单和成交，不能订阅别人的钱包成交。本工具跟单部分通过公开 Data API `/activity` 高频轮询目标钱包交易，因此 dashboard 中的“公开 API 延迟”表示：

```text
目标钱包成交时间 -> 本地第一次从公开 activity API 看到该事件的时间
```

即使 `POLL_INTERVAL_MS=1500`，公开 API 本身也可能晚十几秒或几十秒才出现目标钱包成交。这也是单纯跟单容易滞后的原因。

## Live 模式凭证

真实下单前，需要在本地 `.env` 填写：

```text
PRIVATE_KEY=0x...
POLY_API_KEY=...
POLY_API_SECRET=...
POLY_PASSPHRASE=...
POLY_SIGNATURE_TYPE=3
POLY_FUNDER_ADDRESS=0x...
COPY_MODE=live
```

安全要求：

- 不要提交 `.env`。
- 不要把私钥、API secret、passphrase 写入 README、issue、commit message 或截图。
- `.env.example` 只能保留空占位符。
- `data/state.json` 是本地运行状态，不提交。
- `node_modules` 不提交。

## 测试

```powershell
npm run typecheck
npm test
node --check public\app.js
```

当前测试覆盖：

- top 钱包评分和筛选。
- 跟单信号去重。
- 模拟盘买入、卖出、PnL、ROI、最大回撤。
- 做市奖励候选评分、体育市场过滤、价差单位换算。
- 做市 paper 账本的被动成交、库存标记、奖励估算和权益更新。

## 官方 API 来源

- Data API leaderboard：`GET https://data-api.polymarket.com/v1/leaderboard`
- Data API positions：`GET https://data-api.polymarket.com/positions`
- Data API activity：`GET https://data-api.polymarket.com/activity`
- CLOB reward markets：`GET https://clob.polymarket.com/sampling-markets`
- CLOB batch prices：`POST https://clob.polymarket.com/prices`
- Market WebSocket：`wss://ws-subscriptions-clob.polymarket.com/ws/market`
- CLOB SDK：`@polymarket/clob-client-v2`

## 免责声明

这只是自动化工具和策略研究代码，不构成投资建议。真实下单前，请自行确认所在地合规限制、Polymarket 账户状态、资金风险、盘口流动性和策略表现。
