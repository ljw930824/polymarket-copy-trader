# Polymarket 策略控制台

这是一个本地运行的 Polymarket 策略研究工具。当前主线是做市奖励实验，跟单钱包只作为辅助信号和对照样本。

默认运行在 `paper` 模式，不会真实下单。做市奖励模块目前只做观察、评分和模拟，不会自动提交真实 maker 挂单。

## PnL 口径

dashboard 里的 PnL 分三类，不能混用：

- `跟单模拟PnL`：本地 paper 订单和标记价计算出来的模拟账面收益，不是 Polymarket 真实账户收益。
- `做市估算PnL`：本地 maker 模拟账本加 `book-competition` 模型估算出来的 paper 奖励收益。它不是 Polymarket 真实账户已领取奖励，也不代表可提现利润。
- `真实账户PnL`：当前未接入。等切入真金模式后，需要单独读取真实持仓、真实成交、USDC 余额和已领取 rewards，再和模拟账本分开展示。

在当前 `COPY_MODE=paper` 阶段，页面上的盈利只能作为策略研究和回测依据，不能视为可提现利润。

## 功能

- 跟单观察：筛选 PnL、ROI、成交量较强的钱包，监听公开 activity，生成本地跟单信号。
- 模拟盘：用 paper 账本记录模拟买入、卖出、持仓、PnL、ROI 和最大回撤。
- 做市奖励观察：读取 Polymarket CLOB reward-eligible markets，按奖励、价差、盘口、风险和最小挂单评分。
- 机会中心：把做市、互补套利、跟单信号分为 `可执行`、`观察`、`禁止` 三层。
- dashboard：本地网页展示信号、订单、模拟盘、做市候选、机会中心和回测快照。

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

历史文件会写入：

```text
data/archives/
```

## 主要配置

`.env.example` 里有完整配置。常用项：

```env
COPY_MODE=paper
PORT=8787
TOP_N=3
COPY_TOTAL_BUDGET_USDC=100
MAX_SINGLE_ORDER_USDC=10
MAX_ASSET_EXPOSURE_USDC=20
MAX_CONDITION_EXPOSURE_USDC=25
MAX_OPEN_COPY_POSITIONS=12
MIN_SOURCE_TRADE_USDC=50
MARKET_COOLDOWN_MS=300000
MIN_SIGNAL_SCORE=20
EXCLUDE_SPORTS_MARKETS=true

MAKER_ENABLED=true
MAKER_TOP_N=20
MAKER_MIN_DAILY_REWARD=1
MAKER_MAX_SPREAD_BPS=500
MAKER_MIN_SCORE=20
MAKER_QUOTE_SIZE_USDC=10
MAKER_SIM_INITIAL_CASH_USDC=100
MAKER_SIM_TOP_N=8
MAKER_SIM_MAX_MARKET_EXPOSURE_USDC=50
MAKER_SIM_REWARD_CAPTURE_RATE=0.02
MAKER_REWARD_ESTIMATE_HAIRCUT=0.50
MAKER_REWARD_CAPTURE_CAP=0.10
MAKER_SIM_FILL_THRESHOLD_BPS=25

STRATEGY_MIN_SCORE=55
STRATEGY_MAX_CATALYST_RISK=55
STRATEGY_MAX_INVENTORY_RISK=70
```

## 做市策略评分

做市奖励估算优先使用 `book-competition` 模型：

1. 读取候选 token 的当前 order book。
2. 按官方奖励思路，对最大合格价差内的盘口深度进行二次距离加权。
3. 计算本地计划 bid/ask 的预计得分。
4. 用 `我们的预计得分 / (现有竞争得分 + 我们的预计得分)` 估算奖励份额。
5. 再乘以 `MAKER_REWARD_ESTIMATE_HAIRCUT` 并受 `MAKER_REWARD_CAPTURE_CAP` 限制。

无法获得 order book 时，才回退到 `MAKER_SIM_REWARD_CAPTURE_RATE` 固定比例。fallback 只用于候选评分和观察，不再进入 maker 模拟盘的奖励累积。该模型仍是估算，因为公开盘口无法准确拆分全部做市商身份、挂单存续时间和每分钟抽样结果。

奖励真实性口径：

- 当前 dashboard 的 `accruedReward` 是 paper 估算，不是真实到账。
- 官方 liquidity rewards 需要真实 resting limit orders、满足 min size/max spread、持续在线并参与每分钟抽样，最终按同市场 maker 竞争份额分配。
- 真实奖励确认需要接入账户地址的实际 rewards/claim/settlement 数据，本项目当前还没有接入这条真实账户口径。

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

收益侧：

- `rewardYield`：官方 liquidity rewards 的可捕获收益，优先按 order book 竞争得分估算；没有 book 时只作为低置信 fallback 观察值。
- `spreadYield`：当前盘口价差带来的被动成交收益空间。
- `rebatePotential`：maker rebate 潜力。
- `holdingRewardPotential`：长期慢变量市场可能叠加 holding rewards 的潜力。

风险侧：

- `inventoryRisk`：mid 远离 0.5、最小挂单过大导致的库存风险。
- `catalystRisk`：临近事件、新闻、体育、短期结算导致的价格跳变风险。
- `liquidityRisk`：缺盘口、min size 过高带来的流动性风险。
- `competitionRisk`：价差极窄或奖励过高时，其他 LP 竞争激烈导致奖励捕获率下降。

只有 `eligible=true` 的做市候选会进入 maker 模拟盘。失效市场会被排除，包括 `active=false`、`closed=true`、`acceptingOrders=false`、已过 `endDate`、体育/短周期市场、缺 live book、策略评分过低或风险超限。被过滤的候选在评分阈值允许时会在 dashboard 展示原因，方便复盘。

## 做市模拟规则

- 不假设自己一定成交；只有当中间价穿越本地计划的被动 bid/ask 时，才记录 paper maker 成交。
- BUY 会增加库存，SELL 会减少库存并计算已实现 PnL。
- 奖励收益只对高/中置信 `book-competition` 候选累积：必须有 live bid/ask、候选仍 eligible、预计挂单满足 min size、并且有正的计划挂单得分。低置信 fallback 候选不会累积奖励。
- 做市账本和跟单模拟盘完全分开，避免两种策略互相污染。

## 跟单风险控制

基于当前回测中重复体育信号、未实现收益占比过高和单一头寸贡献过大的问题，跟单模块默认执行：

- 过滤 World Cup、Finals、halftime、当天/短周期市场。
- 来源交易金额低于 `MIN_SOURCE_TRADE_USDC` 的 BUY 信号不跟。
- 单个 outcome 受 `MAX_ASSET_EXPOSURE_USDC` 限制。
- 同一 condition 的总敞口受 `MAX_CONDITION_EXPOSURE_USDC` 限制。
- 总持仓数受 `MAX_OPEN_COPY_POSITIONS` 限制。
- BUY 冷却时间默认提高到 5 分钟，减少重复追单。
- 已有模拟持仓收到 SELL 时，优先允许退出，避免过滤规则阻止平仓。

## dashboard 颜色

- 顶部蓝绿色：`paper` 模式，只模拟，不真实下单。
- 顶部红色：`live` 模式，会尝试真实下单。
- 青色：机会中心。
- 紫色：做市奖励观察。
- 橙色：跟单信号。
- 蓝色：模拟盘账本。
- 绿色：钱包和目标持仓。

## live 模式

真实下单前，需要在本地 `.env` 填写：

```env
COPY_MODE=live
PRIVATE_KEY=0x...
POLY_API_KEY=...
POLY_API_SECRET=...
POLY_PASSPHRASE=...
POLY_FUNDER_ADDRESS=0x...
```

注意：

- `.env` 已被 `.gitignore` 忽略，不要提交。
- 当前 live 下单只覆盖跟单 FAK 订单。
- 做市模块当前不会自动提交真实 maker 挂单。
- 真金投入前需要新增真实账户 PnL、真实成交、USDC 余额、已领取 rewards 的独立展示。

## 验证

```powershell
npm run typecheck
npm test
node --check public\app.js
```

## 风险提示

这只是自动化工具和策略研究代码，不构成投资建议。真实下单前，请自行确认所在地合规限制、Polymarket 账户状态、资金风险、盘口流动性、延迟和策略表现。
