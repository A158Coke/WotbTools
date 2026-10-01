# WoT-Blitz-Agent 回放数据能力契约（replay facets）v2

> Producer: [`fanypcd/WoT-Blitz-Agent`](https://github.com/fanypcd/WoT-Blitz-Agent)（MIT）
> · 状态：生产方行为契约。上游 `main` 已于 2026-09-30 随 commit
>   [`f3684fc`](https://github.com/fanypcd/WoT-Blitz-Agent/commit/f3684fca454a50858943093a03d5f4106befe6aa)（tag `v0.1.7`）发布；
>   样例可从该 SHA 重导出复现。
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
  这组字段与服务端 Java `ReplayParser` 的 `Battle` 模型逐字段一致（`tools/parity`，23 场 / 322 名战斗者）。
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

## 4b. Playback contract v2（上游 v0.2.0：Supremacy / 点数 / 瞄准帧）

- `PlaybackData.version` 1 → **2**（版本显式门禁：错版 WASM 在
  `validateAgentPlayback` 拒绝，不允许静默半残解析）。
- 新增字段（skip-when-empty：非争霸场缺省，消费端 `?:` 可选）：
  - `supremacy_bases[]`: `{clock, base_id(0..3=A..D), owner_team?, capturing_team?, capture_progress?}`
    ——wrapper12/root11 sparse 更新重建；absent=维持前值、显式 0=清空、占领中 owner
    变更清 capture。seek 消费 = 取 ≤t 每基地最后一条。
  - `supremacy_points[]`: `{clock, team, points}` ——wrapper13/root12 真实广播，
    消费取 ≤t 最后值；禁止按游戏规则推算、禁止由点数反推基地归属。
  - `aim_frames[]`: `{time_sec, world_yaw, world_pitch, ray_point}` ——Type39 投影，
    **仅作者/recorder**；缺帧省略不外推；存活期按 deaths 门控；禁止给其他车伪造。
- provenance 全文：上游 `docs/replay-contract-v2-supremacy-type39.md`。
- gameplay mode 纪律：`arenaBonusType` 非 objective mode 权威；Supremacy 存在性
  以 `supremacy_bases` 非空为强事实；Assault/Encounter 多 candidate 无证据 fail-closed。

## 4c. 单基地目标（Assault / Encounter；上游 v0.3.1）

与争霸走**不同载体**（wrapper8，非 wrapper12），两者天然互斥（实测不共存）：

- `assault_objective_present: bool` —— 单基地目标是否存在，**独立于是否已有占领进度**。
  缺省/`false` = 无已证实的单基地目标（缺省按 false 解读，与 `assaultObjectivePresent` 同义）。
  **判据**：目标族（`field2==1`、`field1 ∈ {1,2}`）发出过**裸初始化对以外的**字段
  （`field3` 或 `field4`）。裸初始化对 `1=1,2=1` + `1=2,2=1` 是**通用广播**，普通对局
  同样会发（62 份真实样本里 8 份 Regular/TrainingRoom/Any 只发这一对），故不得据此判定。
- `assault_bases[]`: `{clock, progress(0..100)}` —— 单基地占领进度时间线；无该族（非
  单基地场次）为空。seek 消费 = 取 ≤t 最后一条；**不施加单调性**（回落/重置原样保留）。
- **`field1` 不是进度族判别子**：真实回放中携带 `field3` 的族会在 `field1=1`/`field1=2`
  之间切换（Yukon 两族交替、Malinovka 仅 2、**遭遇战仅 1**、Hellas 评级战 13 条）。
  锁 `field1=2` 会丢事件甚至得到空时间线。`field1` 语义（进度所属方）仍未闭合。
- 无阵营语义：单基地的 owner/capturing 恒为 `null`；静态几何的 `team` 字段语义 UNKNOWN，
  消费端不得据此上色推断归属；几何 `radius` 缺失时用呈现兜底（20m），不得由车辆距离推算。
- provenance 全文：WotbTools `docs/research/replay/assault-base-state.md`（含 2026-10-01
  判据修正通告）。

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

## 6. AI 事件数据（Agent 服务端/CLI 能力；DTO 冻结）

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
  **P2**：`tankNamesJson` 可选注入、第 4 入口 `parseAiReview`、AiReview `Shot.target_eid`
  改用弹道自带身份、`PlaybackData` 版本注释订正；Release 附件随 tag 发布
  （`wotb-replay-wasm-v0.3.1.zip`）。
- v0.3.2（2026-10-01，agent 仓库 `7fa0dc5`，fanypcd/WoT-Blitz-Agent#1）：Result 结算 parity 补齐
  （见 §3「v0.3.2 新增」）；meta.json 统一 UTF-8 lossy 读取，非法字节不再让 `arena_bonus_type` 整体丢失。
  Release 附件 `wotb-replay-wasm-v0.3.2.zip`。
- v0.3.3（2026-10-01，agent 仓库 `cdce004`，fanypcd/WoT-Blitz-Agent#2）：`winner_team` 读结算原始字段，
  无胜方（平局 / 结算缺胜方）= `0`，不再伪装成 1 队胜（Result 与 PlaybackData `meta.winner_team` 同步）。
