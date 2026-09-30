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
- **三个独立 WASM 入口**（浏览器通道，`wotb-replay-wasm` v0.1.7）：
  `parseResult(bytes)` / `parsePlayback(bytes)` / `parseShotReplays(bytes)`，
  不做双 API 兼容；只要 Result 时不得被迫物化 ~MB 级 Playback。
- **AI 事件数据保持 Agent 服务端/CLI 能力**（`AiReviewFacet`，DTO 冻结 v1），
  不在 WASM 浏览器面。
- 消费方接口：`frontend/src/api/agent-replay-facets.ts`（三能力装载 + 形状校验
  + `projectHoF` 投影；样例锁定测试同目录）。

## 2. 契约形状总则

- 切面顶层均带 `"version": 1`；同版本只加字段（消费方忽略未知键），不兼容变更递增 version。
- 语义原则：**unknown ≠ 0 ≠ false ≠ 没发生**。观测缺失一律字段缺省（`skip_serializing_if`）或显式 null；
  `0` 只在该字段语义就是数值零时出现。协议哨兵（如 `game_hit_result: 255 = 未获取`、`killer_eid: 0 = 无归属`）
  在字段文档中显式标注。
- 单 POV / AoI 是真实信息边界：回放由录制者客户端产生，未进入本队视野的实体没有位姿/事件数据
  （与 `docs/research/replay` 的 single POV 结论一致）。缺失不代表实体不存在。

## 3. 结果能力（BattleResult）

- WASM 入口：`parseResult(new Uint8Array(fileBuffer))` → BattleSummary JSON。
- 只解析 meta + battle_results——**不读包流、不建时序模型**，单文件毫秒级；
  批量扫描与 HoF 投影均走此通道。
- DTO 冻结（`BattleSummary`）：`file_name / timestamp / datetime / room_type /
  map_id / map_name / battle_duration_secs / winner_team / author_* / author / players[]`。
  `players[]` 为 `PlayerSummary` 结算行（`damage_dealt / damage_blocked /
  damage_assisted_1|2 / n_enemies_destroyed / base_xp / credits_earned / mm_rating? …`，
  字段语义见上游 `crates/replay-core/src/models/battle.rs`）。
- 样例：`samples/result.sample.json`（与 ai-review 样例同场，真实匿名回放经 v0.1.7 重导出）。

## 4. 时序能力（PlaybackData）

- WASM 入口：`parsePlayback(new Uint8Array(fileBuffer))` → PlaybackData JSON
  （单次扫描；与服务端 `/api/playback/data` 同一构建语义）。
- 形状与 v1 回放切面一致（version 1）：0.1s 网格位姿（列式）、炮塔/炮管角、
  全员弹道、血量链、击杀流、战局阶段、AoI 可见性窗口。
- `vehicles[]` 自带花名册语义（`nickname / tank_id / team / is_author`）——
  消费方联表（如射击复现的 target/shooter tank_id 富化）以此为准，不依赖 AI 切面。
- 客户端路径已知取舍：无 tank_cache / models.pb 时 `tank_name` 空串、
  `gun_pitch` 走车体 pitch 兜底、无俯仰极限锚定（质量标记如实透传）；
  `map_name` 为解析器枚举名（前端按 `map_id` 键控）。

## 5. 射击复现能力（ShotReplays）

- WASM 入口：`parseShotReplays(new Uint8Array(fileBuffer))` → shots JSON 数组
  （作者严格路径 + 他人宽松路径合并；弹道/命中判定/逐发质量标记/双方渲染锚点）。
- **index 语义**：合并后两路各自持局部 index——消费方必须按 `time_s` 排序后全局
  重编号（`index = i + 1`，与上游 Web `/api/replay/shots` 同规则；上游
  `shots.rs` "合并后由调用方重编号" 注记）。WotBTools 消费端由
  `normalizeAgentShotIndices` 收敛。

## 6. AI 事件数据（Agent 服务端/CLI 能力；DTO 冻结）

- `AiReviewFacet`（花名册 + 类型化事件流 spawn/shot/damage/kill/visibility/
  counter/damage_tick + 结算锚点）经 `wotb-agent facets --parts ai` 与服务端
  通道产出；DTO 冻结 v1（counter 语义 = code 低字节基类型 + seq 同类型内序号，
  上游 v0.1.6 复合编码修正）。
- **不在 WASM 浏览器面**；样例 `samples/ai-review.sample.json` 保留作 DTO 对照
  （与 result 样例同场，GravityMode / map 13）。

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
