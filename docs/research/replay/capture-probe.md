# Type 31/7 占点时间线探测报告

> 日期：2026-08-12。样本：用户提供的 4 个训练房回放（Downloads）+ 2 个随机战对照。
> 探测工具：`CaptureTimelineProbeTest`（`@Tag("ai-capture-probe")`，默认排除）。
> 复跑：`mvn -s settings.xml -pl wotb-web -am test -Dtest=CaptureTimelineProbeTest -Dai.probe.excludedGroups= -Dai.capture.replayDir=<目录>`

> **VERDICT: UNKNOWN** —— Type 31/7 与 battle_results 均无可靠的时间线级基地归属信号；不升级 CAPTURE_TIMELINE，占点复盘维持「结算级（占点分 + 点数胜负）+ 静态语义（占领点区域）」。详见文末「结论」。

## 目的

确认事件流能否还原「某时间点基地归属/占领进度」时间线（CAPTURE_TIMELINE），以决定占点复盘是否从结算级升级。

## 样本

| 回放 | 地图 | arenaBonusType | 时长(s) | 占点分 earned/seized |
|---|---|---|---|---|
| 20260725_1535 malinovka | malinovka | 2（训练房） | 203.4 | 1043 / 280 |
| 20260725_1555 neptune | neptune | 4 | 170.5 | 628 / 280 |
| 20260725_1600 neptune | neptune | 4 | 145.2 | 427 / 280 |
| 20260725_1604 malinovka | malinovka | 4 | 231.9 | 1126 / 160 |
| random-battle-example（对照） | rift | 1（随机） | 302.7 | 0 / 0 |
| random_game（对照） | milbase | 1 | 209.4 | 0 / 0 |

## 发现

### 1. 占点分（权威结算）确认有效

- 4 个训练房回放均为 supremacy（`arenaBonusType` 2/4），`victoryPointsEarned` 427–1126、`victoryPointsSeized` 160–280；随机战对照恒为 0。
- 逐人 `PlayerResult.victoryPointsEarned/Seized`（protobuf #32/#33）可作为「被偷家 / 点数胜负」的权威依据（**总量**，无时间线）。

### 2. Type 31（Tracked/State）：无占点时间线结构

- 每场 1800–5300 个 Type 31 包，但 **payload 全部为 4 字节**，且以 ~8ms 间隔成簇出现；值恒为 ~53.9（float 位模式，如 `4257e6a5`），与战斗时钟/占点进度无对应关系。
- 结论：Type 31 不是基地/旗子状态载体，**不可**用于 CAPTURE_TIMELINE。

### 3. Type 7（EntityProperty）：propId 无占点证据

- 观测到 propId ∈ {0, 1, 2, 3, 4, 9}；其中 **propId=3 = 当前血量**（已确认），其余未解且出现次数少（1–31 次/场），未发现与占点进度匹配的字段。

### 4. battle_results raw 字段

- raw 字段号未含明显的逐人占点明细（#32/#33 已映射为权威总量）；无团队级占点时间线字段。

## 结论

- **不升级 CAPTURE_TIMELINE**：Type 31/7 与 battle_results 均无可靠的时间线级基地归属信号；占点复盘维持「结算级（占点分 + 点数胜负）+ 静态语义（占领点区域）」。
- 若未来仍需时间线：候选方向为 **Type 32 / Type 33**（每场 287–537 / 80–134 包，supremacy 与随机战都存在，含义未逆向）或其他未解 bucket，需另立逆向任务。
- 生产反馈闭环不依赖时间线：`CAPTURE_AND_POINTS`（逐人/双方占点分、pointsDecided、占领点区域）已足够支撑「集中一波→被偷家」「残局守家 vs 占点」复盘。
