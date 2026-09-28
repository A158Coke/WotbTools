# WoT-Blitz-Agent 回放数据切面契约（replay facets）v1

> Producer: [`fanypcd/WoT-Blitz-Agent`](https://github.com/fanypcd/WoT-Blitz-Agent)（MIT）
> · 产出模块：`src/replay/model.rs`（内部回放模型）+ `src/facets/`（切面投影）
> · 导出入口：`wotb-agent facets <file.wotbreplay> --parts playback,ai,hof`
>
> **性质声明**：本文档是生产方行为契约——描述上游 Agent 当前实际输出的数据形状与语义边界，
> 供 WotBTools 消费侧（`replay-engine` / Java / AI 编排）对表。它**不是协议证据主张**：
> 涉及回放协议语义的权威判定仍以 WotBTools 自有证据链为准
> （见 `docs/research/replay/README.md` 的 evidence grades 与
> `docs/research/replay/external-wot-blitz-agent-cross-validation.md` 的 authority rule）。

## 1. 契约形状总则

- 三个切面顶层均带 `"version": 1`。**同版本内只做加字段（消费方忽略未知键）；不兼容变更递增 version。**
- 语义原则：**unknown ≠ 0 ≠ false ≠ 没发生**。观测缺失一律字段缺省（`skip_serializing_if`）或显式 null；
  `0` 只在该字段语义就是数值零时出现。协议哨兵（如 `game_hit_result: 255 = 未获取`、`killer_eid: 0 = 无归属`）
  在字段文档中显式标注。
- 单 POV / AoI 是真实信息边界：回放由录制者客户端产生，未进入本队视野的实体没有位姿/事件数据
  （与 `docs/research/replay` 的 single POV 结论一致）。缺失不代表实体不存在。

## 2. 三个切面

| 切面 | 顶层文件 | 消费方 | 内容 |
|---|---|---|---|
| **playback** | `*.facet.playback.json` | 前端 3D 回放 / WASM 播放器 | 全场时序：0.1s 网格位姿（列式）、炮塔/炮管角、全员弹道、血量链、击杀流、战局阶段、AoI 可见性窗口 |
| **ai-review** | `*.facet.ai.json` | AI 复盘编排（→ Java → LLM） | 花名册 + 类型化事件流（spawn/shot/damage/kill/visibility/counter/damage_tick）+ 结算锚点 |
| **hof** | `*.facet.hof.json` | Java → PostgreSQL | 结算精简行（14 人花名册战绩，无任何时序数据） |

样例（客户端匿名回放，无真实用户内容）：[`samples/hof.sample.json`](samples/hof.sample.json)、
[`samples/ai-review.sample.json`](samples/ai-review.sample.json)。playback 切面因含完整位置轨迹
（单场 ~10MB 量级）不入库，形状以本文档 §2.1 与生产端 `PlaybackData` 结构为准。

### 2.1 playback（`PlaybackData`）

- `meta`：地图 id/显示名、胜方、友方队、作者实体、时钟域（`t_start` + 0.1s 网格 `samples`/`duration`）。
- `vehicles[]`：每车 `eid/账号/昵称/车型/队伍/is_author/max_hp` + 列式网格
  `pos[3N] / hull_yaw[N] / hull_pitch[N] / turret_yaw[N] / gun_pitch[N]`（角度为解卷绕连续域，
  消费方朴素线性插值即物理正确）+ `hp[(t,hp)]` 链 + `death_t/killer_eid` + `coverage` 有效区段
  （采样间隙 >2s 断开，空洞期勿插值渲染）+ `visibility` 之外的搭载证据（`shell_ids/turret_index/gun_index`）。
- `shots[]`：全员弹道（炮口/终点/飞行时长/弹速/命中结果枚举/跳弹/伤害/击杀标记/弹种）。
- `kills[]`：击杀者/受害者/死因（0=炮弹 1=火 2=撞击 3=世界 5=溺水）/≥50% 助攻归属。
- `periods[]`：战局阶段（准备/倒计时/战斗）与剩余时间。
- `visibility[]`：AoI 可见窗口 `{eid, t_in, t_out?}`（Type33/5 物化开段、Type4 关段；重入 = 多段）。
  **本队视角的点亮/熄灭时序以本字段为准。**

### 2.2 ai-review（`AiReviewFacet`）

- `battle`：地图/模式/胜方/时长/阶段表。
- `rosters[]`：有身份实体（14 车）的 `eid ↔ 账号/昵称/队伍/车型` 联表。
- `events[]`：按回放时钟升序、`type` 内部标签的统一事件流。喂给 LLM 的粒度（降采样/摘要）由编排层决定，
  本层保持权威全量（单场 7 分钟典型 ~300 事件）。
- `settlements[]`：结算总量行（与 hof 行同构），供模型结论与过程事件互验。
- **已知边界**：作者战斗反馈计数（0x0c：1=累计伤害 2=点亮 3=击杀 5=挡伤 15=毁灭协助 17=总助攻）
  的 `count/value` 次数口径尚未与结算逐项复核；队友点亮的事件级归属不在回放中（0x0c 为作者 Avatar 专属，
  队友只有结算总量）——"谁点亮了谁"只能由可见性窗口 + 位置推断并标注为推断。

### 2.3 hof（`HofFacet`）

`battle`（开始时间/地图/模式/胜方/**`duration_secs` 当前恒为 null**——结算口径时长字段尚未解码，
禁用 meta 口径冒充）+ `entries[]`（账号/昵称/军团/组队/队伍/车型、伤害/格挡/**点亮协助与断带协助分列**/
击杀/击杀者/存活/寿命、射击/命中/击穿、点亮数/毁灭协助/炮印、评级、经验/银币）。
发服务器的就是这些聚合数字——不含位置/炮线/镜头帧。

## 3. 复现

```bash
# Agent 仓库（MIT）：
wotb-agent facets <file.wotbreplay> --parts playback,ai,hof --tank-cache data/tank_cache.json
# 互验报告随导出输出：0x0c 过程计数 vs 结算总量（作者口径），对不上标 MISMATCH
```

样例由客户端匿名回放（Anonyme 场次）产出，昵称/账号为游戏侧匿名化占位。

## 4. 与 WotBTools 既有面的关系

- `contracts/mq/parser-messages.json`（RabbitMQ 解析信封）：本契约描述的是**上游 Agent 的产出数据**，
  与 metadata-only 信封正交；两者可在 parser worker 侧并存（信封调度任务，切面是任务产物之一）。
- `contracts/http/fixtures/battle-playback-v2.json`：WotBTools 自有 playback 消费形状。
  本契约 playback 切面是**另一生产者**的独立产物，字段不对齐也互不阻塞；如需收敛形状，
  在 `replay-engine` 消费层做映射（不反向约束上游内部结构——Rust 内部模型 ≠ 对外 DTO）。
- `feat/client-replay-engine` 的 Java/WASM 解码线与本契约互补：该线自主解码协议，
  本契约提供上游现成的语义切面（可直接消费或作为 golden 对照）。

## 5. 版本记录

- v1（2026-09-29）：首版。三切面 + 匿名样例；已知开放项：0x0c 次数口径互验、结算时长 root5 解码、
  评审切面暂不含点亮协助的位置级归因。
