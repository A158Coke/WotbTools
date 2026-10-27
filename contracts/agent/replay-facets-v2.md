# WoT-Blitz-Agent 回放数据能力契约（replay facets）v2

> Producer: [`fanypcd/WoT-Blitz-Agent`](https://github.com/fanypcd/WoT-Blitz-Agent)（MIT）
> · 状态：生产消费契约。WotbTools 当前通过 `deploy/agent/source.json` 锁定
>   上游 Release `v0.3.11` / commit `73ea422a774fb6af83eb75ff83b146ba7f5f4c55`，
>   并校验 Release WASM asset SHA-256；升级不得浮动跟随 upstream `main`。
>   pin 的 artifact identity SSOT 始终是 `deploy/agent/source.json`，本文档只描述其形状与语义。
>
> **性质声明**：本文档规定预期的公开消费 DTO 形状与能力边界，
> 供 WotBTools 消费侧对表。它**不是协议证据主张**：
> Agent Rust Core 是回放解析与领域解释的上游来源；WotBTools 现有研究档案
> （见 `docs/research/replay/README.md`）保留交叉验证证据，不定义 Agent 内部模型。

## 1. 能力边界（v2 裁决；breaking）

```
Agent Rust Core
├── Result interpretation   -> BattleResult（结果能力）
└── Temporal interpretation -> PlaybackData / AI 事件数据（时序能力）

WotBTools
└── BattleResult -> HoFSubmission -> Business API / HoF domain（消费方投影）
```

- **名人堂（HoF）不是 Agent 公开能力**：v1 的 `HofFacet` 已从上游删除，
  `{playback, ai, hof}` giant envelope 已拆除——Agent 不感知消费方的下游产品。
- **四个独立 WASM 入口**（浏览器通道；v0.3.1 起为四个）：
  `parseResult(bytes, tankNamesJson?)` / `parsePlayback(bytes, tankNamesJson?)` /
  `parseShotReplays(bytes, limitsJson?, shellsJson?)` / `parseAiReview(bytes)`，
  不做双 API 兼容；只要 Result 时不得被迫物化 ~MB 级 Playback。
- **AI 事件数据自 v0.3.1 起同时提供 WASM 入口**（`parseAiReview`，DTO 冻结 v1）；
  CLI/服务端通道（`facets --parts ai`）继续保留，两者逐字段同构。
- 消费方接口：`frontend/src/api/agent-replay-facets.ts`（三能力装载 + 形状校验
  + `projectHoF` 投影；样例锁定测试同目录）。

### 1a. 装载边界（artifact identity；content-addressed）

产物 identity 的 SSOT 是 `deploy/agent/source.json`（`ref` = 上游完整 commit，
`artifact.release` = Release tag，`artifact.sha256` = 附件校验）：

- **文件名与目录是契约的一部分**：`/wasm/<ref>/wotb_replay_wasm.js`、
  `/wasm/<ref>/wotb_replay_wasm_bg.wasm`、`/wasm/<ref>/fingerprint.json`。
  wasm-bindgen wrapper 自行加载同目录的 `_bg.wasm`，因此三者必须同一 commit 目录。
- **stable `/wasm/wotb_replay_wasm.js` 禁止回归**：固定 URL 会让浏览器把别的 build
  的产物长期缓存下来，同一 frontend 用错版引擎解析（症状：AI Review 报
  `ai_review.poses 缺失`）。测试、Docker build 与 TX 发布校验都断言它不存在。
- **装载顺序 fail closed**：fetch versioned `fingerprint.json` → 校验
  `upstream_commit` / `tag` 等于 build 期 pin（Vite `define` 注入的
  `__AGENT_WASM_COMMIT__` / `__AGENT_WASM_RELEASE__`）→ dynamic import versioned JS →
  wrapper 从同目录装载 `_bg.wasm`。任一不一致抛 `AgentWasmVersionMismatchError`
  （携带 expected/actual 的 release 与 commit），不进入形状校验。
- **缓存**：`/wasm/<40 位 commit>/` 可长期 `immutable`——URL 即内容身份，新 Agent
  换 URL，普通刷新即生效；不使用 no-cache。

## 2. 契约形状总则

- 各切面顶层带 `version`：Result / AI 切面为 **1**；**PlaybackData 自上游 v0.3.1 起为 2**
  （版本显式门禁，见 §4b）。同版本只加字段（消费方忽略未知键），不兼容变更递增 version。
- 语义原则：**unknown ≠ 0 ≠ false ≠ 没发生**。观测缺失一律字段缺省（`skip_serializing_if`）或显式 null；
  `0` 只在该字段语义就是数值零时出现。协议哨兵（如 `game_hit_result: 255 = 未获取`、`killer_eid: 0 = 无归属`）
  在字段文档中显式标注。
- 单 POV / AoI 是真实信息边界：回放由录制者客户端产生，未进入本队视野的实体没有位姿/事件数据
  （与 `docs/research/replay` 的 single POV 结论一致）。缺失不代表实体不存在。

## 3. 结果能力（BattleResult）

- WASM 入口：`parseResult(new Uint8Array(fileBuffer), tankNamesJson?)` → BattleSummary JSON。
  `tankNamesJson` 可选（`{tank_id: name}`）：注入后 `tank_name` 为真实车型名；不注入时为
  `tank_{id}`（**不是空串**——v0.3.1 起文档与实现统一，此前文档写空串）。
- 只解析 meta + battle_results——**不读包流、不建时序模型**，单文件毫秒级；
  批量扫描与 HoF 投影均走此通道。
- DTO 冻结（`BattleSummary`）：`file_name / timestamp / datetime / room_type /
  map_id / map_name / battle_duration_secs / winner_team / author_* / author / players[]`。
  `players[]` 为 `PlayerSummary` 结算行（`damage_dealt / damage_blocked /
  damage_assisted_1|2 / n_enemies_destroyed / base_xp / credits_earned / mm_rating? …`，
  字段语义见上游 `crates/replay-core/src/models/battle.rs`）。
- **v0.3.2 新增（可选，向后兼容）**：顶层 `map_key`（meta.json 原始 `mapName` 地图代号，底图 / 语义 /
  i18n 按此键控；`map_name` 是枚举名，未知地图退化为 `map_{id}`）；`players[]` 的 `xp` / `credits`
  （#301 f23 / f106——crate 的 `base_xp` / `credits_earned` 在 11.19 语料中为 0，**消费方只读新字段**）、
  `result_id`（#301 外层 f1）与 `killer_account_id`（`killer_id` 经同场 `result_id` 联表）。
  `survived` 语义订正：`death_reason` 缺省 = 普通击毁 → `false`，整条结算缺失才缺省。
  这组字段与已退役的服务端 Java `ReplayParser` 的 `Battle` 模型逐字段一致（迁移期对比 23 场 / 322 名战斗者；回归基线 `frontend/src/replay-local/__golden__`）。
- 样例：`samples/result.sample.json`（与 ai-review 样例同场，真实匿名回放经 v0.1.7 重导出）。

## 4. 时序能力（PlaybackData）

- WASM 入口：`parsePlayback(new Uint8Array(fileBuffer), tankNamesJson?)` → PlaybackData JSON
  （单次扫描；与服务端 `/api/playback/data` 同一构建语义）。`tankNamesJson` 同 §3：
  注入后 `vehicles[].tank_name` 为真实车型名，缺省为空串。
- 形状与 v1 回放切面一致（顶层 version 见 §2 / §4b）：0.1s 网格位姿（列式）、炮塔/炮管角、
  全员弹道、血量链、击杀流、战局阶段、AoI 可见性窗口。
- `vehicles[]` 自带花名册语义（`nickname / tank_id / team / is_author`）——
  消费方联表（如射击复现的 target/shooter tank_id 富化）以此为准，不依赖 AI 切面。
- 客户端路径已知取舍：无 tank_cache / models.pb 时 `tank_name` 空串、
  `gun_pitch` 走车体 pitch 兜底、无俯仰极限锚定（质量标记如实透传）；
  `map_name` 为解析器枚举名（前端按 `map_id` 键控）。

## 4b. Playback contract v2（上游 v0.2.0：Supremacy / 点数）

- `PlaybackData.version` 1 → **2**（版本显式门禁：错版 WASM 在
  `validateAgentPlayback` 拒绝，不允许静默半残解析）。**v0.3.11 起 version 仍为 2**：
  该版本只做字段补正与删除（见版本记录），不构成 breaking。
- 新增字段（skip-when-empty：非争霸场缺省，消费端 `?:` 可选）：
  - `supremacy_bases[]`: `{clock, base_id(0..3=A..D), owner_team?, capturing_team?, capture_progress?}`
    ——wrapper12/root11 sparse 更新重建；absent=维持前值、显式 0=清空、占领中 owner
    变更清 capture。seek 消费 = 取 ≤t 每基地最后一条。
    **占领中断 = 进度作废**（v0.3.11）：车辆出圈 / 被击毁时服务端发**双缺省块**，进度与
    占领方一起归零（不再保留最后一次进度）。重建实现据此把缺省行解读为显式清空，
    而不是「维持前值」。
  - `supremacy_points[]`: `{clock, team, points}` ——wrapper13/root12 真实广播，
    消费取 ≤t 最后值；禁止按游戏规则推算、禁止由点数反推基地归属。
- provenance 全文：上游 `docs/replay-contract-v2-supremacy-type39.md`。
- gameplay mode 纪律：`arenaBonusType` 非 objective mode 权威；Supremacy 存在性
  以 `supremacy_bases` 非空为强事实；Assault/Encounter 多 candidate 无证据 fail-closed。
- **历史字段 `aim_frames[]` 已移除**（v0.3.11）：零消费方且占 Playback JSON 大量体积；
  raw Type39 仍由射击复现相关能力保留。它不是当前 producer output——消费方不得再读，
  也不得据此在任何路径上做「有/无」判断。

## 4c. 单基地目标（Assault / Encounter；上游 v0.3.1）

与争霸走**不同载体**（wrapper8，非 wrapper12），两者天然互斥（实测不共存）：

- `assault_objective_present: bool` —— 单基地目标是否存在，**独立于是否已有占领进度**。
  缺省/`false` = 无已证实的单基地目标（缺省按 false 解读，与 `assaultObjectivePresent` 同义）。
  **判据 = 目标族存在性**：wrapper8/root8 目标族出现（`field2 == 1` 且 `field1 ∈ {1,2}`）即为
  `true`，**不要求**该族随后发出进度或其它字段。
  也就是说「**有目标但全程没人进入基地**」仍必须 `"assault_objective_present": true`——
  该字段回答的是「这一场有没有单基地目标」，不是「有没有发生过占领」。
  （v0.3.11 为字段契约补正：producer 实现从「要求进度字段」改为与本文档既有定义一致的
  存在性判定；历史结论见版本记录，当前 contract 只有这一种定义。）
- `assault_bases[]`: `{clock, progress(0..100)}` —— 单基地占领进度时间线；无该族（非
  单基地场次）为空。seek 消费 = 取 ≤t 最后一条。
  **占领中断 = 进度作废**（v0.3.11）：出圈 / 被击毁后服务端用双缺省块表达重置，重建结果是
  进度归零（序列出现回落），不再是「维持最后一次进度」；因此消费端**不得施加单调性**，
  也不得把回落当解析噪声抹平（回落/重置原样保留）。
- **`field1` 不是进度族判别子**：真实回放中携带 `field3` 的族会在 `field1=1`/`field1=2`
  之间切换（Yukon 两族交替、Malinovka 仅 2、**遭遇战仅 1**、Hellas 评级战 13 条）。
  锁 `field1=2` 会丢事件甚至得到空时间线。`field1` 语义（进度所属方）仍未闭合。
- 无阵营语义：单基地的 owner/capturing 恒为 `null`；静态几何的 `team` 字段语义 UNKNOWN，
  消费端不得据此上色推断归属；几何 `radius` 缺失时用呈现兜底（20m），不得由车辆距离推算。
- provenance 全文：WotbTools `docs/research/replay/assault-base-state.md`（含 2026-10-01
  判据修正通告）。

## 4d. 实时装填遥测（PlaybackData additive；上游 v0.3.9）

这两项是 **PlaybackData 的时序遥测，供 Playback 呈现（2D / 3D）消费**，
但**不自动提升为 WotbTools canonical ReplayFacts**——它们仍然是呈现层的输入，不是
通用回放事实。字段均为 additive、skip-when-empty；缺失必须保持 unknown，
不允许恢复服务端解析或为敌方推算装填状态。

消费路径：2D 的 `replay-local/playback/parseLocalPlayback.ts` 从同一 `parsePlayback`
结果保留独立的 `reloadTelemetry`，与 canonical 2D dataset 并列传给 Playback；3D
直接消费 PlaybackData。两者共同使用 `frontend/src/scene/reloadBar.js` 的
`createReloadStateResolver()`（`reloadStateAt(vehicleId, time)`），不复制装填解释器，
也不向 `ReplayFacts` 或 HTTP dataset schema 添加装填字段。

- `reloads[]`: `{clock, eid, phase, duration_s: number|null, count: number|null}`。来源为
  arena update subtype 15/16/17 的原始装填族；`phase` = 原始 f2，`duration_s` = f3 秒数
  （不是倒计时；缺失时序列化为 `null`），`count` = 原始 f4（缺失时为 `null`）。
  生产者按 clock 升序输出，并且协议只给**本方全队**。
- `reload_effective[]`: `{clock, eid, duration_s}`。来源为 method 35（0x23），表示该时刻
  **当前生效的完整装填配置时长**；同样仅本方可见、按 clock 升序。
- WotbTools 2D / 3D 共同只解释已在真实回放与客户端 OTM 交叉闭环的子集：
  `f2=1` = 剩余发数快照；`3` = 整夹装填；`4` = 当前装填时长变更；
  `5` 的 `f4=1` = 就绪/取消标志（**不是**剩余发数）；`6` = 弹鼓逐发补槽；
  `7` = 夹内推弹/射击间隔，**有定时视觉但不补弹**。未闭环码继续原样保留，不赋语义。
- 方法 35 只校准整夹 `f2=3` 的长装填刻度；`f2=6/7` 使用相位自身 `duration_s`。
  求值按时间归并而不是累加计时器，因此 seek / 拖动时间轴必须得到相同状态。
- 敌方没有该遥测：共享车辆标签只为有权威遥测的 friendly team 绘制逐发装填条。无数据时不得把“未知”
  渲染成推测的敌方满弹/空弹状态。
- **无遥测 = 整条不画（`unknown ≠ full`）**：`reloads` 缺失或该车没有任何闭环相位时，
  消费方（`frontend/src/scene/reloadBar.js#shellStatesAt`）返回 `null`，渲染侧隐藏整条
  装填 UI。**不允许**把"没有遥测"兜底成满弹——2026-10-02 线上故障正是错版 WASM
  （`reloads = 0`）导致每台车画出一根永远不动的白条。有遥测且当前确实满弹的车照常显示。
- `reload_effective` 对 **autoreloader 多段装填 profile** 仍可能整场为空（method 35 当前
  只解码 `[eid][single duration]` 形状）。这属于**上游 producer 语义**，消费方不得据坦克
  型号/burst size 推断，也不得用 shots 反推时长；需要时在上游修并发新 Release。

## 4e. 车体横滚（`vehicles[].hull_roll`，PlaybackData additive；上游 v0.3.11）

- `hull_roll?: number[]` —— 与 `hull_pitch` / `hull_yaw` 同形的列式逐帧数组，单位**弧度**，
  N 对齐 playback grid（与 `vehicles[]` 其它列同长）。
- **来源与 `hull_pitch` 不同，不得互相代用**：`hull_pitch` 是渲染滤波后的输出，
  `hull_roll` 取 **raw type=10 的最近邻采样**（片段内不插值，避免在 AoI 间隙两端之间
  编造姿态）。缺帧即该帧缺省，**不跨 AoI gap 外推**。
- 消费方契约：字段缺失（旧产物 / 该场无数据）时按 `0`（= 水平）渲染；
  **不得**用 `hull_pitch` 兜底成 roll，也不得由地形/坡度反推。
- 与 `frontend/src/api/agent-replay-facets.ts` 的 `hull_roll?: number[]` 逐字对应。

## 4f. 位姿关键帧折线（`vehicles[].pose_kf`，PlaybackData additive；上游 v0.3.13）

- `pose_kf?: { t: number[]; pos: number[]; yaw: number[]; pitch: number[] }` ——
  **渲染位姿的权威表示**：`t` = 关键帧时刻（秒，回放时钟域，升序，0.1ms 舍入），
  `pos` = `[x,y,z] × t.length`（回放世界系，0.01m 舍入），`yaw` / `pitch` 与网格列同域
  （`yaw` = **解卷绕连续域**）。消费方在相邻关键帧之间**线性插值**；早于首点/晚于末点按
  端点**保持**（与网格列同语义）。
- **它解决什么**：位姿来源是客户端滤波器（`AvatarFilter` 移植）的 60Hz 逐帧输出。滤波器在
  「预测-保持」阶段（`latency` 未收敛到位置更新间隔，= 车辆刚进 AoI 的数秒内）逐帧输出是
  **保持-跳变阶梯**；把 60Hz 帧按固定 0.1s 网格重采样、再在网格间线性插值，会把阶梯混叠成
  速度摆动（实测某 0.5s 窗内前端线速度 4.5→29.6 m/s，同段真值稳定；全时线逐帧位置最大
  偏差 21m）——观感即「一顿一顿 / 不连续」。`pose_kf` 保留原路径的折点（保持段两端 + 跳变
  段），插值结果与客户端逐帧画面一致。
- **精度契约**：走廊拟合容差 2cm / 0.4°（上游 `KF_TOL_POS` / `KF_TOL_ANG`），叠加落盘舍入
  后相对客户端 60Hz 逐帧画面的偏差 ≤ ~2.5cm / 0.5°；点数 7~10 点/秒/车（≈ 位置更新率，
  与 10Hz 网格同量级）。
- **消费方义务**：渲染位姿（`pos` / `hull_yaw` / `hull_pitch`）**以本列为准**；字段缺失
  （旧产物）时回退 10Hz 网格线性插值（历史行为逐值一致）。`turret_yaw` / `gun_pitch` /
  `hull_roll` 仍只有网格列（prop2 / 原始采样语义，**不参与**折线，不得以折线替代）。
- 与 `frontend/src/api/agent-replay-facets.ts` 的 `pose_kf?: AgentPoseKeyframes` 逐字对应；
  渲染侧实现在 `frontend/src/scene/trackInterp.js`（`sampleKeyframes`）与
  `frontend/src/scene/playbackScene.js`（`kfOf` 分支）。

## 4g. 弹道折线（`shots[].via` / `shots[].leg_secs`，PlaybackData additive；上游 v0.3.13）

- `via?: [number, number, number][]` —— 弹道**折线中间点**（按飞行顺序；直射弹缺省）。
- `leg_secs?: number[]` —— 各段时长（秒）：段 0 = `from`→`via[0]`，…，末段 = …→`to`；
  `leg_secs.length == via.length + 1`。段时长按**几何 / 该段速度**给出，不用包时钟
  （包钟 10Hz 量化：跳弹常与发射同刻，用钟会得到零长段）。
- **语义**：`from` = 炮口（method29 launchPoint）；`to` = **method20 弹道终点 = 弹道最终
  停止点**（= 服务器权威的"炮弹最后停在哪"）；`via` = 同 `(shooter, shotId)` 的后续 method29
  起点 = **跳弹/穿透出射点**（服务器在命中/跳弹时刻重播该发续段：起点为装甲接触/出射点、
  速度为续段方向）。渲染 = `from → via… → to` 折线，**在服务器终点处中止**。
- **确定性归属（不得用相关性匹配）**：一次开火 = `(shooter, shotId)` 一条链；碎片化到包级
  只有两条规则——(1) 同链的后续 method29 是同一发的续段，(2) method20 按 `shotId` 配对。
  典型样本（20260821_1917）：命中威廉斯特后跳弹，续段仰角 +38.6°、method20 终点在 730m 外
  452m 高处（出射方向延长线）——把 method20 直接当"打到哪"会画出一条指向天空的炮线。
- `flight_secs` = 各段时长之和（直射弹退化为 `|to−from| / |launch_velocity|`）；`hit` /
  `target_eid` 的归属窗口以**首个续段时刻**（= 装甲接触时刻，与 method8 同刻）为基准。
- 消费方契约：字段缺失（旧产物）= 直射单段，渲染回退为 `from → to` 直线（历史行为逐值不变）。
- 与 `frontend/src/api/agent-replay-facets.ts` 的 `via?: [number,number,number][]` /
  `leg_secs?: number[]` 逐字对应；渲染侧实现在 `frontend/src/scene/shotPath.js`。

## 4h. 实际搭载配置与弹容（`vehicles[].config_idx` / `vehicles[].burst_size`，PlaybackData additive；上游 2026-10-06，pin 待随下一 Release 更新）

- `config_idx?: number` —— 该车**实际搭载配置**在坦克数据 `configs[]` 数组中的下标
  （comp blob → 弹种 → 血量证据链 = 上游 `resolve_config_index`，与 shots 的
  `shooter_config_idx` 同域）。缺省 = configs 唯一或证据链未命中 → 消费端回退顶级配置。
- `burst_size?: number` —— 该配置的弹夹容量**原值**（`configs[config_idx].burst_size`，
  **0 = 单发**；configs 唯一时即便 `config_idx` 缺省也给出）。
- **它是装填条弹容 N 的唯一权威取值**（上游裁决 2026-10-06，详见上游
  `docs/wotbtools-cross-reference.md` §六「弹容 N 裁决」）：多炮坦克各炮弹容不同
  （实测上游资产包 735 台中 52 台跨配置不一致——T69 4/3、AC Wedge 0/6、Medium I 0/15 等），
  **禁止跨配置取最大**、**禁止用相位流剩余弹数 +1（f4）推断 N**。f4 快照继续用于
  **在膛发数**重锚（语义不变），只是不再参与 N。
- **客户端（WASM 本地解析）路径**：浏览器产物无解析面注入，`config_idx`/`burst_size` 缺省。
  `vehicles[]` 另行透传 comp blob 模块局部 id（`turret_local` / `gun_local`，纯回放证据），
  消费方经 `reloadBar.resolveMountedConfig` 用资产面 `tank/{id}.json` 联表 `configs[]`，
  按**同一三级证据链**（comp locals → 发射弹种 `shell_ids` → 初始血量 `max_hp`，
  多匹配取最后一档 = 顶级）钉定实际搭载配置并取其 `burst_size`；该链与上游
  `resolve_config_index` 同语义（两侧均有测试锁定）。联表数据未就绪时回退 facet
  `burst_size` → 单发（1）。
- 消费端契约：`burst_size` 缺省（旧产物 / 坦克数据缺失 / 证据矛盾）→ 按单发（1），不猜；
  `≤1` 读作单发；脏值由消费方夹到渲染上限（`reloadBar.js` 的 `MAX_PLAUSIBLE_MAG`）。
  2D / 3D 共用的 `createReloadStateResolver()` 已改为默认从 facet 车辆取 N——
  旧的「2D 异步拉坦克数据 / 3D 相位推断+异步覆盖」两段式维护已移除。
- 与 `frontend/src/api/agent-replay-facets.ts` 的 `config_idx?` / `burst_size?` 逐字对应。

## 4i. 动态装甲 armorsStates（`armor_states[]` / `shots[].target_armor_state`，PlaybackData additive；上游待发版，pin 待随下一 Release 更新）

- **协议定案**（上游 2026-10-13 两回放交叉实证：0954/1615 样本闭环）：Vehicle 实体
  **propID 16 `armorsStates`，载荷 = `[u8 n][n × u32 LE 状态描述符]`**（n = 该车声明的
  状态数；描述符仅 bit0/bit16 两位，**bit16 = 该状态当前激活**）——解码 = 激活组下标。
  初始态经 ON_ENTITY_CREATE(type=5) 属性表 materialize（含"入视野前已切换"的快照）；
  此后 `armorMover` 消耗品每次使用伴随恰一条 prop16 更新。静态车 create 表 prop16 为
  空表（n=0）。前作"type=7 prop0 u8"已被证伪（prop0 = 全车皆有的交替布尔，与装甲状态
  无关；反例存档见上游 `RawArmorStateTrack` 文档）。客户端数据源为车辆 XML
  `<extras><armorsStatesController>`（全库仅 **6 辆**：T54MS 9073 / Charioteer_T 12657 /
  Titan Strife 17777 / JagdPanther II Titan 22385 / AMX 50 100 Titan 24945 /
  Sturmfeur HW 8305）。
- `armor_states[]`: `{eid, t: number[], state: number[]}`（列式，两列等长，按 eid 升序）。
  **skip-when-empty**：静态装甲车（绝大多数）字段整体省略——旧产物与静态场零扰动。
- `shots[].target_armor_state?: number` —— 受击方**弹着时刻**（`t_fire + flight_secs`）
  的状态号；`None`/缺省 = 受击车无状态流或弹着早于首个样本（**快照前区间**——用声明里
  `default: true` 的 state 兜底，不猜）。
- **回归锚点**（上游测试 `armor_state_timeline.rs`，1615 样本）：首弹（t_fire 68.95，
  战报"未击穿"）受击车在 [57.44, 79.95) = state1——该弹命中板 `hull.armor_15` 仅存于
  state1；79.95s 切回后各弹 = state0。修复前 facet 误报全 0（prop0 误判所致）。
- **消费方门控（fail-closed）**：状态语义的唯一权威 = 上游 `data/armor_states.json`
  （前端 vendored 于 `frontend/src/data/armorStates.js`）：每态 `armors` = 该态**激活**的
  `<part>.<armor_N>` 集合；可控板 = 各态并集；`state ∉ 声明集` 的更新丢弃；时间线缺省 →
  声明初态。
- **前端接线**（`frontend/src/data/armorStates.js` + `scene/tankViewer.js`）：装甲模型
  装载后按声明初态摘除非激活可控板（**deco 口径**——与穿透判定/点击分类/跳弹枚举的保留面
  过滤同源，一处摘除全链生效；可控板中未激活板不计入等效装甲）；射击复现进入时按
  `shots[].target_armor_state` 切换（`setArmorState`，声明外值拒绝）。恢复两段式：
  `retagSpacedSections` 先按 `armorSectionOrig` 还原（含 spaced 重判），再摘除非激活——
  顺序不可换；恢复 visible 时不得复活 `configHidden` 的配置变体。
- 与 `frontend/src/api/agent-replay-facets.ts` 的 `armor_states?` /
  `shots[].target_armor_state?` 逐字对应。

## 4j. 独立炮塔实体（`detached_turrets[]`，PlaybackData v2 additive；上游 v0.4.7）

- `detached_turrets?: { eid: number; vehicle_eid: number; coverage: number[]; pose_kf: { t: number[]; pos: number[]; yaw: number[]; pitch: number[]; roll: number[] } }[]`。
  缺省或空数组 = **没有可用的独立炮塔事实**；不是「证明全场未发生殉爆」。旧产物仍可正常播放。
- **身份与归属**：`eid` = Type5 class 8 独立炮塔实体的正 u32 ID；`vehicle_eid` = 同一 create
  属性中明确给出的所属车辆 ID，必须能联到该 PlaybackData 的 `vehicles[].eid`。
  不以低血量击杀、死亡原因、空间距离或最近车辆猜测飞头；炮塔 ID 不得与车辆 ID 相同、
  自指或在数组中重复；同一 owner 出现多个独立炮塔是归属冲突，上游不输出，消费边界也拒绝。
- **位姿来源**：每次进入 AoI 的 Type5 初始世界位姿与后续 Type10 世界位姿，**不经过车辆
  60Hz AvatarFilter / PoseKF 拟合**。`t` = 回放 raw 秒；`pos` = `[x,y,z] × N`（游戏世界系，米）；
  `yaw` / `pitch` / `roll` = 弧度，三轴完整保留。它复用 `AgentPoseKeyframes` 的列式形状，
  其中 `roll` 对车辆关键帧可缺省，对独立炮塔**必填**。三轴解卷绕，同 clock 的 Type10 取文件序最后一帧，Type5 首快照保留。
- **覆盖与插值**：`coverage` = 有序、互不重叠的 AoI **闭区间** `[start,end,...]`，有限端点、
  `0 ≤ start ≤ end`，单帧允许 `start == end`；相邻区间须 `next.start > previous.end`。
  每段都必须由 `t == start` 的初帧锚定，全部采样落在覆盖区间内。只在**同一段内**按
  相邻真实帧插值，末帧至段末允许保持；区间外隐藏独立实体，不取未来首帧、不跨未知段插值。
  AoI 消失不等于重新装回车体；车辆炮塔一旦有明确分离事实，回放后续保留分离状态，
  倒退至首个实体出现之前时恢复原车辆节点。
- **消费边界 fail closed**：字段出现时必须为数组，各轨迹必须为对象；ID / 归属与覆盖满足
  上述约束；`N = t.length ≥ 1`，`t` 严格升序，`pos.length == 3N`，三轴角列长度均为 N，
  所有数值有限。形状漂移在 `validateAgentPlayback` 拒绝，不能静默拿缺失轴或未知位姿造事实。
  此新增校验不扩大既有 `vehicles[]` 字段的兼容边界，也不向 HTTP / canonical ReplayFacts
  增加第二份飞头事实源。

## 4k. 复活生命轨道（`vehicles[].death_times` / `vehicles[].resurrection_times`，PlaybackData additive；上游 v0.4.8）

- `death_times?: number[]`（该车全部死亡时刻，升序，`death_times[0] == death_t`；**仅该车死亡 ≥2 次才输出**）、
  `resurrection_times?: number[]`（死亡后生命证据从终态回归正值的时刻，升序；**仅非空才输出**）。
  两列同时缺省 = `death_t` 已完整表达生命史（**死亡终态**；普通回放因此零扰动，行为与既往逐位一致）。
  上游保证第 n 次死亡与第 n-1 次死亡之间必有复活证据。
- **语义**：复活模式（爆燃等）同一 eid 死而复生，死亡不再是终态。消费方按 `death → resurrection → death …`
  交替重建生命状态：canonical `lifeTransitions`（`replay-local/playback/toBattlePlaybackDataset.ts`）、
  3D 回退 `defLifeAt`（`utils/battlePlaybackV2.ts`）与 `scene/rosterState.js` 同规则；爆焰按**死亡身份**
  去重——同一次死亡的重复迁移只爆一次，复活后的新死亡各自爆焰。字段缺省时三者一律走 prop3 采样扫描的
  旧口径。不以 HP 归零、爆焰或位移反推复活时刻。
- **消费边界 fail closed**：字段出现时必须为数组、元素有限、非负且非降序；形状漂移在
  `validateAgentPlayback`（`frontend/src/api/agent-replay-facets.ts`，前端唯一装载/校验边界）拒绝，
  不静默降级为"缺省 = 死亡终态"。不据数组长度反推复活模式（"≥2 死 / 非空"是上游的输出条件，不是消费方的判据）。
- **消费侧的四条显式规则**（3.1.0 review P2 落定）：① 复活时刻起、到该实体第一份**可用数值**血量证据之前，
  血量 transition 落 `currentHp: null`（未知展示），绝不沿用死前值——未知哨兵（`hp = null`，如
  PROP3 `UNKNOWN_FFFF`）与终态 0 都不是"新证据"（`isPlausibleHp` 判据）；② battle-level `events` 的
  DESTROYED 在该账号改用轨道死亡列（**同账号多实体的死亡列合并、升序去重**，每次死亡一条），
  canonical 终态重建（每账号至多一条）只覆盖无轨道账号，KILL 仍只由 canonical 致死窗口证据给出；
  ③ 同一账号多实体（AoI 重入 / 复活换实体）时 2D 位姿按 canonical 身份证据（`entityFirstSeenByAccount`
  + `activeEntityAt`）选活跃实体，**且采样时刻必须落在该实体的 `coverage` 内**（`poseCoveredAt`：
  覆盖外的端点钳位会把该实体未来的首帧位姿泄漏到过去——其身份证据可早于首个位姿样本），
  两处不满足一律回落 canonical 位姿；④ 分离炮塔（§4j）的摘除只属于它发生的那一世：该车复活后
  装回车体炮塔（旧飞头实体照旧按自己的 coverage 渲染）。四条都有对应测试
  （`lifeTransitions.test.ts` / `parseLocalPlayback.test.ts` / `vehiclePose.test.ts` /
  `BattlePlayback.integration.test.js` / `playbackScene.test.js`）。

## 4l. 血量终态分类（`damage.hp_state` / `health.hp_state`，AiReview additive；上游 v0.4.9）

- 形状：`hp_state?: 'current' | 'zero' | 'terminal'`，随 `damage`（method1）/`health`（prop3）事件输出；
  上游 v0.4.9 起**恒在场**，缺省仅出现在旧产物（见 §6 表）。闭集 SSOT =
  `frontend/src/api/agent-replay-facets.ts` 的 `AI_HP_STATES` tuple：`AiHpStateField` 由它派生，
  运行期校验集合由它构建，canonical 分类器（`classifyHpRaw`）也只复用该类型——producer 枚举变更
  只改一处。
- **两条各自单一权威的路径**：①字段在场 = 权威——`terminal` = 负 i16 终态哨兵**全族**
  （实测 0xFFFF/0xFFFE/0xFFFD，其余负值同编码；同族全部取值同一处理，禁按分布裁剪），
  `zero` = 0x0000 确知归零，`current` = 可用血量；②**字段缺省 = legacy 分类不放宽**——仅
  `{0x0000, 0xFFFD}` 为终态，`0xFFFF`/`0xFFFE` 等仍是"未证明哨兵（血量与生死都未知）"，
  **不作为死亡证据**（存量语料把 0xFFFF 记为 unavailable；缺省放宽会在旧产物上产生无旁证的
  死亡判定）。全族语义只能经字段获得。
- **消费边界 fail closed（两种口径，不混用）**：`validateAgentAiReview(value, mode)` 的 `mode` 必填——
  **`current-producer`**（当前正式 pin 的 WASM 路径 `parseAgentAiReviewFromBytes`）把
  `damage` / `health.hp_state` 当**必填**：缺字段 = producer 漂移 → 拒绝，**不得静默进入 legacy 回退**
  （那会把 0xFFFE 档弹药架殉爆重新判成存活）；**`legacy-compatible`**（显式旧 artifact / 旧 JSON
  fixture 摄入）允许缺省，缺省按 §6 表的 legacy 规则现算。两种口径下**在场值都必须落在闭集内**，
  形状 / 枚举漂移一律拒绝，**不静默回退 `hp_raw`**（避免把 producer 漂移变成错误的生命态事实）。
- **词汇边界**：只有上游 facet 的事件字段用小写三值 `current`/`zero`/`terminal`；**客户端投影的
  `ClientAiReviewProjection.hpState` 用 canonical 状态名**（`HpRawState` 枚举：`CURRENT_HP` /
  `HP_ZERO_TERMINAL` / `DEATH_TERMINAL_FFFD` / `DEATH_TERMINAL` / `UNKNOWN_FFFF` / `UNKNOWN_OTHER`，
  即 `contracts/http/openapi.yaml` 的 enum），服务端 `HpRawState.fromWireName` 只认后者。
- **消费**：canonical `classifyHpRaw(raw, hp_state?)`（`replay-local/canonical/hpRawState.ts`）→
  血量帧（`healthTransitions`；终态哨兵血量未知 ≠ 0）与生命轨道（`lifeTransitions` 终态样本 →
  `DESTROYED`）；终态分类**随 HTTP 投影正式发送**（`ClientAiReviewProjection.hpState`，
  `prop3Health` 与 `healthEvents` 两处载荷都携带 canonical 分类）传到 Java canonical，服务端在场时
  **不再重新分类**（`HpRawState.fromWireName` 显式 wire 映射）。守卫：
  `canonical/facts.hpTerminal.test.ts`（字段权威 / legacy 缺省两侧）+ `playbackScene.test.js`
  终态族用例（含 `hp_state=terminal` 的 0xFFFE/0xFFFF 行与"legacy 0xFFFE 不判死"反例行）。
- **回归背景**：−1/−2 档弹药架殉爆（实例 1910 局 Intotherainy `0xFFFE`）曾因本层只认
  {0x0000, 0xFFFD} 被判成存活（血量冻在最后正值、装填条继续外播）。裁决与迁移账见上游
  `WoT-Blitz-Agent` §七（`docs/wotbtools-cross-reference.md`）。
- **HTTP wire 词表与读取边界**：服务端 DTO `ClientAiProjection.Prop3Health/HealthEvent` 显式登记
  `hpState`（与 `contracts/http/openapi.yaml` 的 enum 同步登记），经 `HpRawState.fromWireName` 的
  **字面量 switch** 映射——HTTP 接受的集合与内部枚举增删/改名解耦；**未登记字段仍 fail-closed**
  （`PROJECTION_MAPPER` 保持 `FAIL_ON_UNKNOWN_PROPERTIES`，与各 schema 的
  `additionalProperties: false` 一致），**显式 `null` 拒绝**（读取边界拦截；只有字段缺省才走
  legacy 口径，服务旧载荷 / 回滚窗口）。写方与读方在本 PR 内同时到位：前端与 `ai-service` 是两条
  独立的 main-push 工作流，若部署顺序产生短暂兼容窗口或某个 workflow 失败，用 rerun / 人工单发
  deploy 恢复——**不保留 staged writer，也不留 follow-up**。

## 4m. AoI 重入血量台阶（`vehicles[].hp` 语义；上游 v0.4.12→v0.4.13）

- `vehicles[].hp`（血量链显示序列）自 v0.4.12 起并入重入 Type5 物化快照血量：Type4 隐藏段
  「零更新」（type=7/8/10 全断），丢视野期间的盲炮/视野外伤害没有 method1 事件——此前血量链
  在二次点亮后停在丢视野前旧值、直到下一次受击才被动修正（实测 J20 CN_LEVITHAN 在场末 1192 →
  重入快照 348，缺 844 点）。现快照血量在 `t_in`（二次点亮时刻）落台阶，与客户端 `onEnterAoI`
  物化时 HP 条直接跳到快照值同构。
- **血量链构建不变式（v0.4.13 修正 v0.4.12 的合并顺序缺陷）**：全部证据（`initial_hp` 种子 +
  method1 + 重入快照）统一按时间合并（同钟快照在前 = 客户端物化先于属性更新）、**最后**做一次
  相邻同值去重——先去重后并入会把被快照分隔的同值 method1 吞掉（隐藏段死亡无 method1 归零 +
  复活回满血再受击、值恰同受击前；与 §4k 复活轨道同源场景）。普通回放 v0.4.13 与 v0.4.12
  输出逐位一致，仅复活/同值边界修正。
- **消费面（零代码适配）**：`hpAt`/`hpAtSeries`（「≤t 的最后一点」采样）与 `buildTransientSources`
  （血量链相邻差分）按既有逻辑自动受益——隐藏段掉血在二次点亮时刻以一次聚合伤害事件出现
  （多次受击合并为一条：协议证据只有绝对血量台阶、无 per-hit 事件；凶手归属不提供，上游
  fail-closed）。无锚点实体以首个带血量快照为链起点；隐藏段死亡的重入快照哨兵按显示口径钳 0
  （死亡面权威仍在 `hp_state`/prop1/§4l）。AI 投影 golden 不受影响（投影不走 `hp_series`）。

## 5. 射击复现能力（ShotReplays）

- **契约 v0.1.9（breaking）**：WASM 入口输出由裸数组改为包装对象——
  `{shots, author_path: "ok"|"error", author_error?, author_eid, others}`。作者严格
  路径失败不再静默降级为空数组：`author_path="error"` 时 `author_error` 携带链式
  原因（仅 error 态存在该键），`shots` 仍含他人宽松路径全量，消费方 fail-visible
  （WotBTools 射击复现页顶部警示条）。消费端 `normalizeAgentShotsOutcome` 对
  旧裸数组产物归一化兼容（author 状态不可知 → ok/eid=0/others 全 0）。
- **受击方身份 = `target_eid`**：v0.1.9 起逐发直传受击方实体 id（作者 = method38 /
  他人 = method8，服务器权威）。此前仅 `target_name`，消费方按昵称反查 eid——
  名字缺失（昵称损坏/非 ASCII 旧版解析）时 hit/target 全丢；联表一律用 eid，
  昵称仅显示域。
- WASM 入口：`parseShotReplays(new Uint8Array(fileBuffer))` → 射击链包装
  （作者严格路径 + 他人宽松路径合并；弹道/命中判定/逐发质量标记/双方渲染锚点）。
- **index 语义**：合并后两路各自持局部 index——消费方必须按 `time_s` 排序后全局
  重编号（`index = i + 1`，与上游 Web `/api/replay/shots` 同规则；上游
  `shots.rs` "合并后由调用方重编号" 注记）。WotBTools 消费端由
  `normalizeAgentShotIndices` 收敛。

## 6. AI 事件数据（`parseAiReview`；DTO 冻结 v1，同版本只加字段 / 事件类型）

**WotbTools 消费方式**：不直接使用本 DTO 的字段语义——`frontend/src/api/agent-replay-facets.ts#validateAgentAiReview`
做信任边界校验后，只由 `frontend/src/replay-local/canonical/facts.ts` 投影成 WotbTools canonical replay facts，
2D 回放与 AI 复盘的通用事实都只消费那一层（见 `docs/architecture/replay-pipeline.md`「Agent 切面不是领域契约」）；
2D 车辆标签的装填呈现另外消费 §4d 的独立 Playback 时序遥测，不混入该 facts 投影。
canonical 必需证据缺失即拒绝（fail closed）：`damage.hp_raw`、`health` 事件、`poses` / `turrets`（≥ v0.3.7）。
`hp_state`（`current`/`zero`/`terminal`）自上游 v0.4.9 起恒在场：当前正式 pin 的 WASM 路径
（`current-producer`）把 `damage` / `health` 两处的该字段当**必填**，缺字段即拒绝——producer 漂移
fail closed，不静默进入 legacy 回退；只有显式 legacy 摄入（`legacy-compatible`）允许缺省并走 legacy
raw 分类。在场值必须落在闭集内（SSOT = `api/agent-replay-facets.ts` 的 `AI_HP_STATES`，`AiHpStateField`
与 canonical `classifyHpRaw` 都复用它），非法枚举在信任边界拒绝（不静默回退 `hp_raw`——那会把
producer 漂移变成错误的生命态事实）。

| 证据（上游版本） | 形状 | canonical 用途 |
|---|---|---|
| `damage.hp_raw`（v0.3.5） | method1 原始 u16 | `HpRawState`（**仅缺 `hp_state` 的旧产物**按此现算，legacy 语义）：0 = HP 归零；0xFFFD = 终态哨兵（血量未知）；0xFFFF/0xFFFE 等负值 = 未证明哨兵（血量与生死都未知，**不作为死亡证据**）；`hp` 的钳 0 只是显示值 |
| `damage.hp_state` / `health.hp_state`（v0.4.9） | 血量 u16 的**权威分类**（`current` / `zero` / `terminal`，恒在场） | 在场即权威：`terminal` = 负 i16 终态哨兵**全族**（死亡面之一，血量未知），取代本地对 `hp_raw` 的再解释；缺省（旧产物）= legacy 分类**不放宽**（全族语义只能经字段获得）。`terminal` + `hp_raw` 的显示口径由 canonical 层决定（`knownHpOf` → null ≠ 0） |
| `visibility.hp_raw`（v0.3.5） | 开段 Type5 物化快照原始 HP（仅战斗车辆，每次重入） | 物化血量采样；战斗车辆类证据（Type5 entityTypeId=2） |
| `hit_notice`（v0.3.5） | method8 全变体（eid / payload_len / shooter / victim / result / secondary），**不分类** | WotbTools 按旧口径分类：payload < 26 = 短体变体；result=3 = 直击；其余 = 未解码变体（冲突证据） |
| `health`（v0.3.6） | prop3 原始 u16（`hp_state` 同 `damage`） | 血量帧与掉血推导的采样源（录像者自身血量常只有这一路）；终态样本（`hp_state=terminal` ∨ legacy 0/0xFFFD）产出 `DESTROYED` |
| `damage_tick` | 录像者 Avatar prop10 的 `t / eid / cumulative`（eid 是 Avatar，不是车辆 eid） | 投影为录像者的可选 `damageDealtSamples`；只保留战斗内、非负整数、单一来源的累计广播，同刻保留较大值、下降样本拒绝。当前时刻只查询已出现的广播，不使用结算总量补齐；其他车辆仍使用可靠 HP-loss attribution。 |
| `poses` / `turrets`（v0.3.7） | 原始 type10 世界位姿（attachmentParent=0）/ prop2 原始 u16，列式 | 位置 / 朝向证据（PlaybackData 网格是渲染滤波输出，不是观测） |

- `AiReviewFacet`（花名册 + 类型化事件流 spawn/shot/damage/kill/visibility/
  counter/damage_tick + 结算锚点）经 `wotb-agent facets --parts ai`、服务端通道
  与 **WASM 入口 `parseAiReview(bytes)`（v0.3.1 起）**三方产出，逐字段同构；
  DTO 冻结 v1（counter 语义 = code 低字节基类型 + seq 同类型内序号，
  上游 v0.1.6 复合编码修正）。
- **`Shot.target_eid` 取自弹道自带身份**（作者 = method38 受击者、他人 = method8 直击
  通知，服务器权威）——v0.3.1 起不再按昵称反查实体名表：昵称损坏/缺失时不再丢受击方。
  `hit` 的定义随之统一为「target_eid 存在」。
- 样例 `samples/ai-review.sample.json` 保留作 DTO 对照（与 result 样例同场，
  GravityMode / map 13）。

- **v0.3.8 结果能力**：`roster_complete`（结算花名册与战绩账号集合一致）、`author_vehicle_codename`（meta
  `playerVehicleName`）→ `Battle.rosterComplete` / `Battle.recorderVehicle`。

## 7. HoF（WotBTools 产品域；非 Agent 能力）

- HoF 提交 = `projectHoF(BattleResult)`：消费方纯投影，字段映射与已删除的
  上游 `HofFacet.from_settlement` 逐项一致（`damage_assisted_1|2 →
  damage_assisted_spot|track`、`n_hits_dealt → n_hits`、`base_xp → xp`、
  `credits_earned → credits` 等）；`battle.duration_secs` 恒 null（root5 未解码，
  宁缺勿冒充）。
- HoF 提交仍可携带 original `.wotbreplay`：Business API 侧 replay 是
  evidence/storage，不做 server-side replay verification。

## 8. 版本记录

- v1（2026-09-29 随上游 v0.1.6 `6b442cf` 发布）：三切面 + giant envelope
  `{playback,ai,hof}`。**已被 v2 取代**（envelope 与 HofFacet 拆除）。
- v2（2026-09-30 随上游 v0.1.7 `f3684fc` 发布，breaking）：能力拆分——
  Result / Playback / ShotReplays 三个独立 WASM 入口；HoF 退出 Agent 公开面
  （消费方从 Result 投影）；AI 事件数据保持 Agent 服务端能力（DTO 冻结）；
  已知开放项不变：0x0c 次数口径互验（待非匿名场次）、结算时长 root5 解码、
  评审切面暂不含点亮协助的位置级归因。
- v0.3.1（2026-10-01，agent 仓库 `main`）：**P1R5**（消耗品生命周期 / 开局 loadout /
  车辆模块乘员状态 / 攻防战单基地占领进度）且**修正 assault 判据**——进度族去掉
  `field1` 限制（真实回放中携带进度的族在 `field1=1/2` 间切换）、`assaultObjectivePresent`
  收紧为「目标族发出裸初始化对以外的字段」（裸初始化对是通用广播，8/62 普通对局同样发出）；
  新增 `assault_bases[]` 与 `assault_objective_present`（契约见 §4c）。
  **注**：上一条「收紧为要求进度字段」的判据已于 v0.3.11 修正回字段契约既有的
  **目标族存在性**（见 v0.3.11 记录 3 与 §4c）——此处保留为「当时是什么」。
  **P2**：`tankNamesJson` 可选注入、第 4 入口 `parseAiReview`、AiReview `Shot.target_eid`
  改用弹道自带身份、`PlaybackData` 版本注释订正；Release 附件随 tag 发布
  （`wotb-replay-wasm-v0.3.1.zip`）。
- v0.3.2（2026-10-01，agent 仓库 `7fa0dc5`，fanypcd/WoT-Blitz-Agent#1）：Result 结算 parity 补齐
  （见 §3「v0.3.2 新增」）；meta.json 统一 UTF-8 lossy 读取，非法字节不再让 `arena_bonus_type` 整体丢失。
  Release 附件 `wotb-replay-wasm-v0.3.2.zip`。
- v0.3.3（2026-10-01，agent 仓库 `cdce004`，fanypcd/WoT-Blitz-Agent#2）：`winner_team` 读结算原始字段，
  无胜方（平局 / 结算缺胜方）= `0`，不再伪装成 1 队胜（Result 与 PlaybackData `meta.winner_team` 同步）。
- v0.3.4（2026-10-02，agent 仓库 `9437f6d`，fanypcd/WoT-Blitz-Agent#3）：包流自行分帧（`replay::packets`），不再经 crate
  `read_data()` 反序列化 payload——单个包的 pickle 形状偏差（如 type 0 的 bool 字段为整数 0）不再让 Playback / AiReview /
  ShotReplays 整场失败。阵亡车辆 `hp` 末值为 0（Java 曾保留最后观测值）。
- v0.3.5（2026-10-02，fanypcd/WoT-Blitz-Agent#4）：AI 切面 `Damage.hp_raw`、`Visibility.hp_raw`（`AoiPresence.hp_raw`，PlaybackData
  visibility 同步获得）、`HitNotice`（method8 全变体原始通知）。
- v0.3.6（2026-10-02，fanypcd/WoT-Blitz-Agent#5）：AI 切面 `Health`（prop3 血量属性广播原始值）。
- v0.3.7（2026-10-02，fanypcd/WoT-Blitz-Agent#6）：`AiReviewFacet.poses` / `turrets`（原始 type10 世界位姿与 prop2，列式）。
- v0.3.8（2026-10-02，fanypcd/WoT-Blitz-Agent#7）：结果能力 `roster_complete` / `author_vehicle_codename`。
- v0.3.9（2026-10-02，agent commit `b4e50e13`）：PlaybackData additive 增加
  `reloads` / `reload_effective` 装填遥测，并补收 arena subtype 16；WotbTools
  `deploy/agent/source.json` 同步 pin 到该 Release，字段契约见 §4d。
- v0.3.10（2026-10-02，agent commit `5029e103`）：射击复现多 interaction 关联修复；
  `unique shotId = 一次开火 = 一个 Shot`，同一 `shotId` 关联的后续事件与多次装甲接触仍聚合为同一 Shot
  （后续 method29 在物理上是什么，上游仍未定，此处只记录身份规则）；
  作者严格路径在同 victim / 同时窗存在多个 type32 segment 时优先以 `method8.hash6 ↔ type32.hash6`
  做 interaction 关联，重复 method8 广播按 hash 去重，证据不足继续 fail-fast。WotbTools production pin 同步到该 Release。
- v0.3.11（2026-10-03，agent commit `73ea422a`，fanypcd/WoT-Blitz-Agent#13）：
  1. **Supremacy 占领中断归零**：占领中止（车辆出圈 / 被击毁）以双缺省块编码，重建不再
     保留最后一次进度与占领方（`supremacy_bases` 语义见 §4b）；
  2. **Assault 占领重置**：同上，单基地进度在中断后作废（`assault_bases` 语义见 §4c）；
  3. **`assault_objective_present` 字段契约补正**：producer 实现改为与本文档既有定义一致
     的**目标族存在性**判定（出现即 `true`，不要求进度字段）；
  4. **移除 `aim_frames`**：零消费方且占 Playback JSON 大量体积；`PlaybackData.version`
     保持 2（additive 删除 + 字段补正，见 §4b）；
  5. **additive `vehicles[].hull_roll`**：车体横滚列（raw type=10 最近邻，见 §4e）。
  WotbTools production pin 同步到该 Release（shot reconstruction 的 raw Type39 能力不受影响）。
- v0.4.9（2026-10-16，agent commit `8dcec2c6`，fanypcd/WoT-Blitz-Agent#22 + #23）：
  **additive `hp_state`**（`damage`/`health` 事件的权威血量分类，见 §4l）——上游把
  `{0x0000, 0xFFFF, 0xFFFE, 0xFFFD}` 终态族语义从"内部规则"改为显式透出，消费方不再自行解释
  u16；`PlaybackData` v2 / `AiReviewFacet` v1 形状不变。WotbTools production pin 同步到
  v0.4.9（`ref 8dcec2c6…`、`wotb-replay-wasm-v0.4.9.zip`），Android `wotbVersion` 随候选递增。
  WotbTools 同批正式消费该字段并把它投影给服务端：canonical 分类（2D/3D 生命轨道）与
  AI 投影（`ClientAiReviewProjection.hpState` → Java `HpRawState.fromWireName`）用**同一套**
  terminal 分类；legacy 只用于明确的旧 artifact / 缺字段兼容（见 §4l）。
- v0.4.12→v0.4.13（2026-10-27，agent commit `c32fc583…`/PR #31+#33）：**AoI 重入血量兑现**
  （`vehicles[].hp` 台阶语义，见 §4m）——隐藏段掉血在二次点亮时刻落台阶；v0.4.13 修正
  v0.4.12 的合并顺序（统一去重最后做）。WotbTools pin 同步到 v0.4.13，AI 投影 golden
  仅 provenance 变化，Android `wotbVersion` 3.17.6 → 3.17.7。
