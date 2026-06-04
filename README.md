# Polymarket 策略控制台

这是一个本地运行的 Polymarket 策略研究工具。它现在包含两条独立能力：

- 跟单观察：筛选 PnL、ROI、成交量较强的钱包，监听公开 activity，生成跟单信号和 paper/live 订单。
- 做市奖励观察：读取 Polymarket CLOB 的 reward-eligible markets，按日奖励、最大价差、最小挂单、盘口和风险标签做评分，给出被动 bid/ask 建议。

默认运行在 `paper` 模式，不会真实下单。做市奖励模块目前只做观察和评分，不会自动提交 maker 挂单。

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

做市评分考虑：

- 日奖励越高越好。
- 官方允许价差越窄越好。
- 有实时 bid/ask 盘口比没有盘口更可靠。
- 最小挂单要求过高会扣分。
- 体育、电竞、临场强波动市场默认大幅扣分并过滤。
- 市场关闭、不活跃、不接受订单会扣分并过滤。

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

## 官方 API 来源

- Data API leaderboard：`GET https://data-api.polymarket.com/v1/leaderboard`
- Data API positions：`GET https://data-api.polymarket.com/positions`
- Data API activity：`GET https://data-api.polymarket.com/activity`
- CLOB reward markets：`GET https://clob.polymarket.com/sampling-markets`
- Market WebSocket：`wss://ws-subscriptions-clob.polymarket.com/ws/market`
- CLOB SDK：`@polymarket/clob-client-v2`

## 免责声明

这只是自动化工具和策略研究代码，不构成投资建议。真实下单前，请自行确认所在地合规限制、Polymarket 账户状态、资金风险、盘口流动性和策略表现。
