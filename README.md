# Polymarket 跟单控制台

这是一个本地运行的 Polymarket 跟单与模拟盘工具。它会筛选盈利能力较强的钱包，监听这些钱包的公开交易活动，按 top 钱包持仓比例生成跟单信号，并在本地 dashboard 中展示信号、订单、模拟盘收益和策略表现。

默认运行在 `paper` 模式，不会真实下单。切换到 `live` 之前，请先确认 geoblock、钱包余额、API 凭证、滑点和风控配置。

## 当前能力

- 根据 leaderboard、PnL、ROI、成交量和当前持仓筛选 top 钱包。
- 支持 `COPY_TOP_N` 配置，例如 top3、top5。
- 高频轮询目标钱包公开 activity，生成 BUY/SELL 跟单信号。
- 使用 Market WebSocket 缓存目标 token 的盘口价格。
- 支持 paper 模式和 live 模式。
- paper 模式会进入模拟盘，计算现金、持仓、已实现盈亏、未实现盈亏、ROI、最大回撤。
- dashboard 使用 tab 区分总览、信号与订单、模拟盘、钱包与持仓。
- 所有状态写入本地 `data/state.json`，不会上传到仓库。

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

只运行一轮 worker，用于检查 API、筛选逻辑和状态写入：

```powershell
npm run worker:once
```

打开 dashboard：

```text
http://localhost:8787
```

## 配置说明

配置文件是本地 `.env`，不要提交到 GitHub。

核心配置：

```text
COPY_MODE=paper
COPY_TOP_N=3
COPY_TOTAL_BUDGET_USDC=100
POLL_INTERVAL_MS=1500
ACTIVITY_LIMIT=25
SIGNAL_STALE_MS=120000
SIM_INITIAL_CASH_USDC=100
MAX_SLIPPAGE_BPS=250
MAX_SINGLE_ORDER_USDC=15
MAX_DAILY_ORDER_COUNT=100
MAX_DAILY_NOTIONAL_USDC=500
```

含义：

- `COPY_MODE=paper`：模拟盘，不真实下单。
- `COPY_MODE=live`：真实下单，需要配置私钥和 Polymarket API 凭证。
- `COPY_TOP_N`：跟踪 top 几个钱包。
- `COPY_TOTAL_BUDGET_USDC`：跟单总预算。
- `POLL_INTERVAL_MS`：公开 activity 轮询间隔。
- `SIGNAL_STALE_MS`：信号最大可接受陈旧时间。
- `SIM_INITIAL_CASH_USDC`：模拟盘初始资金。
- `MAX_SLIPPAGE_BPS`：最大滑点，250 表示 2.5%。
- `MAX_SINGLE_ORDER_USDC`：单笔最大跟单金额。
- `MAX_DAILY_ORDER_COUNT`：每日最大订单数。
- `MAX_DAILY_NOTIONAL_USDC`：每日最大名义成交金额。

## Live 模式凭证

真实下单前，需要在本地 `.env` 里填写：

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
- `.env.example` 只能保留占位符。
- `data/state.json` 是本地运行状态，不提交。
- `node_modules` 不提交。

## Dashboard 说明

dashboard 分成四个 tab：

- `总览`：系统是否在运行、paper/live 模式、模拟盘收益、公开 API 延迟。
- `信号与订单`：目标钱包 BUY/SELL 信号，以及本工具生成的订单。
- `模拟盘`：模拟账户持仓、成交流水、PnL、ROI、最大回撤。
- `钱包与持仓`：当前 top 钱包，以及按钱包持仓比例换算出的目标持仓。

颜色语义：

- 顶部蓝绿色：`paper` 模式，只模拟，不真实下单。
- 顶部红色：`live` 模式，会尝试真实下单。
- 橙色：信号与订单。
- 蓝色：模拟盘。
- 绿色：钱包和目标持仓。

## 延迟说明

Polymarket 官方 `user` WebSocket 只能推送当前账户自己的订单和成交，不能订阅别人的钱包成交。

本工具目前通过公开 Data API `/activity` 高频轮询目标钱包交易，因此 dashboard 上的 `公开 API 延迟` 指的是：

```text
目标钱包成交时间 -> 本地第一次从公开 activity API 看到该事件的时间
```

这个延迟通常高于本机轮询间隔。即使 `POLL_INTERVAL_MS=1500`，公开 activity API 本身也可能晚十几秒或几十秒才出现目标钱包成交。

## 模拟盘与回归测试

paper 模式下，订单不会提交到 Polymarket，而是进入本地模拟账户：

- BUY：扣除现金，增加 token 持仓。
- SELL：卖出已有持仓，计算已实现盈亏。
- 如果没有持仓却收到 SELL，会记录跳过原因，不会产生负仓位。
- 持仓会按最新盘口或目标价进行 mark-to-market。

运行测试：

```powershell
npm test
npm run typecheck
```

测试覆盖：

- top 钱包评分和筛选。
- 跟单信号去重。
- 模拟盘买入、部分卖出、已实现盈亏、未实现盈亏、ROI、最大回撤。
- 无持仓卖出不会产生负仓位。

## GitHub 提交安全清单

提交前请检查：

```powershell
git status --short
git diff --cached
```

确认不会提交：

- `.env`
- 私钥
- API secret
- passphrase
- `data/state.json`
- `node_modules`

当前 `.gitignore` 已忽略这些运行产物：

```text
node_modules/
dist/
.env
data/
*.log
```

## 官方 API 来源

- Leaderboard：`GET https://data-api.polymarket.com/v1/leaderboard`
- Positions：`GET https://data-api.polymarket.com/positions`
- Activity：`GET https://data-api.polymarket.com/activity`
- Market WebSocket：`wss://ws-subscriptions-clob.polymarket.com/ws/market`
- CLOB SDK：`@polymarket/clob-client-v2`
- Geoblock：`GET https://polymarket.com/api/geoblock`

## 免责声明

这只是自动化工具和策略研究代码，不构成投资建议。真实下单前，请自行确认所在地区的合规限制、Polymarket 账户状态、资金风险和策略表现。
