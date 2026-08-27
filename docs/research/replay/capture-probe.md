# Type 31/7 占点时间线探测报告

> 日期：2026-08-12。样本：用户提供的 4 个训练房回放（Downloads）+ 2 个随机战对照。
> 探测工具：`CaptureTimelineProbeTest`（`@Tag("ai-capture-probe")`，默认排除）。
> 复跑：`mvn -s settings.xml -pl wotb-web -am test -Dtest=CaptureTimelineProbeTest -Dai.probe.excludedGroups= -Dai.capture.replayDir=<目录>`
>
> **SUPERSEDED NOTICE (2026-08-27):** 本报告关于 `Type31/Type7` 的负结论仍有效，但“回放中不存在实时占点时间线 / 不升级 CAPTURE_TIMELINE”的更广泛结论已经被 canonical 34 场协议逆向推翻。Avatar method48 **wrapper12** 已被闭环为 Supremacy 基地实时 owner / capturingTeam / captureProgress 状态机。当前结论见 [`wrapper12-supremacy-capture-state.md`](wrapper12-supremacy-capture-state.md)。

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

## 当时的发现

### 1. 占点分（权威结算）确认有效

- 4 个训练房回放均为 supremacy（`arenaBonusType` 2/4），`victoryPointsEarned` 427–1126、`victoryPointsSeized` 160–280；随机战对照恒为 0。
- 逐人 `PlayerResult.victoryPointsEarned/Seized`（protobuf #32/#33）可作为权威结算总量。

### 2. Type 31：不是占点时间线

- 每场 1800–5300 个 Type31 包，但 payload 全部为 4 字节，且以高频固定模式变化；与基地占领进度无对应关系。
- 这个负结论在后续研究中仍成立。

### 3. 当时探测的 Type 7 property：没有找到占点时间线

- 当时观测到的 Type7 property 没有形成基地 owner/progress 状态机。
- 这个负结论也仍成立：真正的占点时间线不在 Type7。

### 4. battle_results 仅提供结算层信息

- #32/#33 是逐人 victory-points 总量，不是实时基地状态时间线。
- 这个结论仍成立。

## 2026-08-27 后续纠正

canonical 34 场重新枚举所有 Avatar method48 wrapper 后，发现此前探测漏掉了真正的 Supremacy 状态流：**wrapper12**。

当前已证明：

```text
wrapper12 field1 = zero-based base index          PROVEN
wrapper12 field2 = current owner team             PROVEN
wrapper12 field3 = current capturing team         PROVEN
wrapper12 field4 = realtime capture progress      PROVEN
wrapper12 field5 = contested/interruption candidate PARTIAL
wrapper12 field6 = recorder-local capture participation family STRONG PARTIAL
```

113 个独立基地易主事件都能从高位 captureProgress (`95..99`) 闭环到随后约 0.5 秒的 ownerTeam 切换。

因此当前协议层结论已经变成：

```text
CAPTURE_TIMELINE = AVAILABLE in replay stream
source           = Avatar method48 wrapper12
team score       = wrapper13
final player totals = settlement #32/#33
```

## 当前结论

本文件保留作为研究历史和负控：它证明 Type31/Type7 不是正确方向。但下面这条旧结论已经 **SUPERSEDED**：

```text
“不升级 CAPTURE_TIMELINE；回放只有结算级占点信息”
```

正确的新结论请以 [`wrapper12-supremacy-capture-state.md`](wrapper12-supremacy-capture-state.md) 为准。
