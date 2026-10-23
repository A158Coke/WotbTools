# 战局回放 HP 权威（Battle Playback HP Authority）

## 状态

本文是 Battle Playback HP 展示的产品/架构权威。
客户端播放投影（`frontend/src/replay-local/playback`）从 pinned Agent WASM facets 与
结算事实推导 canonical HP 状态；UI 只负责渲染。UI 不得推断开局 HP、在 replay/tankopedia
来源之间做选择，或重建依赖可见性的 HP 真相。

## 己方车辆

己方车辆以其在战斗结算中的实际开局 HP 确认：

```text
toBattlePlaybackDataset.ts#settlementInitialHp(player)
= max(signed PlayerResults field1, 0) + damageReceived
```

11.19 回放研究语料在 238/238 个 setup 窗口战斗员上，用 Type5 初始物化证明了该重建。
见 `docs/research/replay/actual-hp-type5-settlement.md`。

在战斗相对时间 `t=0`，客户端播放投影输出：

```text
currentHp         = actual opening HP
displayCapacityHp = actual opening HP
knowledge         = CURRENT
source            = SETTLEMENT_OPENING_HP_EXACT
relativeFull      = false
confidence        = HIGH
```

产品 UI 必须显示具体数值（例如 `2500 / 2500`）。不得用 `100%` 或旧文案
「开局满血、具体 HP 未确认」替代。

## 敌方车辆

在第一次可信回放 HP 观测之前，Tankopedia `baseHp` 仅允许作为临时的开局展示值：

```text
currentHp         = tankopedia baseHp
displayCapacityHp = tankopedia baseHp
source            = TANKOPEDIA_BASE_PROVISIONAL
```

该值不是实际战斗 HP，绝不能晋升为 canonical 回放真相。
Tankopedia 访问必须使用 `docs/architecture/tankopedia-reference-data.md` 描述的
应用级不可变参考数据；Playback 不得创建自己的 Tankopedia 副本。

### 永久权威切换

第一次可信回放 HP 观测（经 canonical timeline 投影的 Type5/current HP 面）会永久把
该车辆切换到回放权威，直至本场战斗结束。

切换之后：

- 当前观测 HP 使用回放 HP；
- 隐藏/AoI 间隙保持回放最后已知状态；
- 重新捕获使用新的回放 HP；
- 在可证明时，destroyed 状态到达回放 HP `0`；
- 同一场战斗中，Tankopedia 永远不得再次成为该车辆的 active HP 来源。

UI 层不得知道或重新实现该切换；它只消费投影出的 transition。

### 回放容量独立权威

`currentHp` 与 `displayCapacityHp` 是不同事实。可信回放的 current HP 不证明
同一数值就是该车辆的战场容量。

若第一次可信回放 HP 没有回放权威容量：

```text
currentHp         = replay current HP
displayCapacityHp = null
source            = replay source
```

投影不得伪造 `currentHp / currentHp` 的满血配对。稍后的可信回放事实可以提供正的
`displayCapacityHp`；只有那时才采用该回放容量。

示例：

```text
t=0   敌方临时值：current=3400 capacity=3400（Tankopedia 展示参考）
t=10  首次 replay HP：current=3200 capacity=null（权威切换到 replay）
t=20  后续 replay 事实：current=2800 capacity=3560（replay 容量已知）
```

任何时刻，权威切换都不得回退到 Tankopedia。

## 稀疏 timeline 规则

缺失/UNKNOWN 帧不是恢复 Tankopedia 的指令，也不会自动成为新 HP 值的 transition。
客户端投影输出稀疏的权威 transition；UI 只使用
`lastAtOrBefore(currentTime)`/等价的 query-at-time 逻辑。

因此，对于已切换到回放权威的敌方，隐藏/AoI 间隙会把先前的回放 HP 保留为
`LAST_KNOWN`；它不会仅仅因为该车辆不再被观测就发出清除 transition。

## 队伍 HP 条展示

底部的己方/敌方队伍条是对已 canonical 的单车 HP 事实做展示聚合。它们不得引入
第二套 HP 权威模型。

关键区别是：

- 最新 `currentHp` 跟随最新的 canonical HP transition；
- 展示容量是在当前播放时刻或之前已披露的最新正 `displayCapacityHp`；
- 稍后一个 `displayCapacityHp = null` 的 transition 表示「该 transition 不提供新
  容量」，而不是「忘记此前披露的展示刻度」；
- `currentHp` 绝不能替代缺失的容量；
- 当稍后出现回放权威的正容量时，它会自然替换先前的展示刻度。

这可以避免敌方队伍条跳出一段虚假序列，例如：

```text
EXACT 80% -> PARTIAL 100% -> EXACT 75%
```

当一辆敌方车辆从 Tankopedia 临时 HP 切换到回放 HP、而回放容量尚未立即可用时。

该聚合只是展示数学：query-at-time 加对 canonical 事实的纯求和。它不推断回放协议
语义、可见性真相、开局 HP 或权威切换。

## 职责边界

```text
pinned Agent WASM facets + settlement facts + application Tankopedia reference
        ↓
frontend replay-local canonical facts
        ↓
client playback projection (HP authority)
        ↓
BattlePlaybackDataset.healthTransitions
        ↓
UI query-at-time + pure presentation aggregation
        ↓
只展示
```

客户端 canonical/playback 投影拥有：

- 结算开局 HP 重建；
- 己方开局确认；
- 敌方 Tankopedia 临时种子；
- 首次可信回放的永久权威切换；
- 回放容量权威；
- CURRENT / LAST_KNOWN HP 来源标注（provenance）。

UI/查询层只拥有：

- `lastAtOrBefore` / query-at-time；
- 保留已披露的正展示容量，直到披露更新的正容量；
- 纯队伍求和/百分比计算；
- 格式化、本地化与视觉渲染。

UI/查询代码不得：

- 在 Tankopedia 与回放之间选择 HP 来源；
- 推断开局 HP；
- 从 current HP 推导容量；
- 在回放权威开始后恢复 Tankopedia；
- 仅因车辆离开 AoI 就清除 HP。

## 朝向 UI

车辆朝向仍是地图渲染与可能的 AI Review 消费所需的 canonical 数据，但刻意不在
Playback 车辆详情面板中以文本行展示。原先的 `朝向: 当前朝向` 展示传达了来源却没有
有用数值，已从产品 UI 移除。
