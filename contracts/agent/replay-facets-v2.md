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

> 边界说明（2026-02）：早先这里写的是「只属于 3D Playback 的专用输入」，那是当时的实现状态
> 而不是契约本身。契约层面它们是 Playback 时序遥测；实际消费者目前仍只有 3D
> （`frontend/src/scene/playbackScene.js` + `reloadBar.js`），因为 **2D Playback 的数据通道
> （`utils/battlePlaybackV2` 的 V2 轨道）目前不携带 reload facet**。2D 若要显示装填，
> 需要先让该通道具备同一时序，而不是在 2D 侧复制一份求值逻辑。

- `reloads[]`: `{clock, eid, phase, duration_s: number|null, count: number|null}`。来源为
  arena update subtype 15/16/17 的原始装填族；`phase` = 原始 f2，`duration_s` = f3 秒数
  （不是倒计时；缺失时序列化为 `null`），`count` = 原始 f4（缺失时为 `null`）。
  生产者按 clock 升序输出，并且协议只给**本方全队**。
- `reload_effective[]`: `{clock, eid, duration_s}`。来源为 method 35（0x23），表示该时刻
  **当前生效的完整装填配置时长**；同样仅本方可见、按 clock 升序。
- WotbTools 3D 当前只解释已在真实回放与客户端 OTM 交叉闭环的子集：
  `f2=1` = 剩余发数快照；`3` = 整夹装填；`4` = 当前装填时长变更；
  `5` 的 `f4=1` = 就绪/取消标志（**不是**剩余发数）；`6` = 弹鼓逐发补槽；
  `7` = 夹内推弹/射击间隔，**有定时视觉但不补弹**。未闭环码继续原样保留，不赋语义。
- 方法 35 只校准整夹 `f2=3` 的长装填刻度；`f2=6/7` 使用相位自身 `duration_s`。
  求值按时间归并而不是累加计时器，因此 seek / 拖动时间轴必须得到相同状态。
- 敌方没有该遥测：装填呈现只为 friendly team 绘制（3D 名牌的逐发装填条）。无数据时不得把“未知”
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
2D 回放与 AI 复盘都只消费那一层（见 `docs/architecture/replay-pipeline.md`「Agent 切面不是领域契约」）。
canonical 必需证据缺失即拒绝（fail closed）：`damage.hp_raw`、`health` 事件、`poses` / `turrets`（≥ v0.3.7）。

| 证据（上游版本） | 形状 | canonical 用途 |
|---|---|---|
| `damage.hp_raw`（v0.3.5） | method1 原始 u16 | `HpRawState`：0 = HP 归零；0xFFFD = 终态哨兵（血量未知）；`hp` 的钳 0 只是显示值 |
| `visibility.hp_raw`（v0.3.5） | 开段 Type5 物化快照原始 HP（仅战斗车辆，每次重入） | 物化血量采样；战斗车辆类证据（Type5 entityTypeId=2） |
| `hit_notice`（v0.3.5） | method8 全变体（eid / payload_len / shooter / victim / result / secondary），**不分类** | WotbTools 按旧口径分类：payload < 26 = 短体变体；result=3 = 直击；其余 = 未解码变体（冲突证据） |
| `health`（v0.3.6） | prop3 原始 u16 | 血量帧与掉血推导的采样源（录像者自身血量常只有这一路） |
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
