# 客户端解析迁移（服务器没有 parser）

> 状态：**已完成**（2026-10-01 确认范围，2026-10-02 一个 PR 收尾：A158Coke/WotbTools#447）。目标：**服务器没有 parser**——唯一解析器是上游 Rust Core
> （浏览器 / Android 跑 WASM）；汇总、评分、导出等一切对解析结果的计算也在客户端完成。服务端只保留存储、
> 去重键、授权、名人堂记录与 AI 编排。后端需要的字段一律向上游 Rust Core 要（用户同时是上游 contributor，
> 直接改上游、发版、升级 `deploy/agent/source.json`）。

## 已确认的决策
- 一致性：`tools/parity` 本地逐字段对比 Java 与 WASM；仓库 fixture 的 golden 常驻 CI（`frontend/src/replay-local/__golden__`），Java 删除后作为回归基线。
- 缺字段：只向上游要，不在客户端启发式推导（已补：v0.3.2 xp/credits/result_id/killer_account_id/map_key/survived；v0.3.3 无胜方）。
- WASM 解析失败：直接显示原因，**不回退服务端**。
- 名人堂：客户端解析后提交 facts，原始回放作为附件存档；防伪造靠管理员审核。
- 绑定账号验证：不再作为解析结果的旁路副作用；个人主页单独提供「用回放验证」按钮——本地解析出录像者账号，提交给服务端比对当前绑定账号（只影响主页的已验证徽章，不授予任何权限；客户端事实理论上可伪造，需要时再加附件抽检）。
- 可以接受 breaking change：旧接口直接删除，不保留兼容层；部署窗口内工作台短暂不可用可接受。
- 一个 PR 收尾（#447）：A–G 全部在同一 PR 内按模块分 commit。

## 结果（#447）

| 部分 | 做法 |
|---|---|
| 上游 Rust Core | fanypcd/WoT-Blitz-Agent#1（v0.3.2：xp/credits、result_id/killer_account_id、map_key、survived、meta UTF-8 lossy）、#2（v0.3.3：无胜方）、#3（v0.3.4：包流自行分帧，单个 pickle 偏差不再让整场失败） |
| 一致性 | 迁移期 `tools/parity`（随 Java 删除）：本地冠军赛语料 23 场 / 322 人解析 38 字段一致、27 个批次全链路一致；仓库 fixture golden 常驻 CI（`frontend/src/replay-local/__golden__`） |
| 工作台 | `useLocalReplayAnalysis`：Worker 解析 → 批次计算（`compute/`，Java 逐位移植）→ 表格；失败不回退服务端 |
| 导出 | `export/`：exceljs / fflate 按需加载，逐格对齐 Java POI 输出 |
| 2D 回放 | `playback/`：parsePlayback → BattlePlaybackDataset + MapOverview（位置 RMS 0.6–0.8 m，事件时刻 ≤ 0.006 s） |
| 名人堂 | 客户端 `facts`（Battle JSON）+ 回放附件；服务端 `ClientReplayFacts` 结构校验，管理员审核兜底 |
| 账号验证 | 个人主页「用回放验证」→ `POST /api/users/wotb-account/verify-replay` |
| Android | 本机分析完成即 ACK pending（无需新 APK：WebView 加载同一前端） |
| 服务端删除 | Maven 模块 contracts / minio / rabbitmq / result / playback / replay-coordinator / replay-processing / parser-worker；wotb-core parse / decoder / stream / export / rating / stats；processing-jobs / export-jobs / 2D 端点；Flyway V27 删除 processing 表；部署 / CI / OpenTofu 中的 parser-worker、RabbitMQ（MinIO 视用途） |
| AI 复盘 | 服务端只剩客户端投影解码（`ClientAiProjectionAdapter`）；测试改用冻结投影 `common/fixtures/replay-facts/*.json.gz`；前端维护门已于提交 `83884790` 解除 |

## 后续（不阻塞）

调研结论（2026-10-02），按建议顺序：

### 上游字段

- **`PlaybackData.damages[]`**：数据已在上游 `model.timeline.hp_events`（`combat/events.rs`），在 `playback.rs` 的
  `PlaybackData` 加 `damages: [{t, victim_eid, source_eid, hp, cause}]` 约 30–40 行，facet 版本不变（加字段）。
  落地后客户端删掉 `damageEventsFromAiReview` 和 2D 额外的那次 `parseAiReview`。
- **`hp[]` 样本来源**：上游 hp 是「首个 Type5 快照 + method1 链」，快照恒为 `hp[0]`。在契约里写明即可（零代码）；
  需要显式区分时再加 `hp_seed`（约 10 行）。
- **录像者车辆**：`parseResult` 已有 `author_tank_id` / `author_tank_name`，客户端经 tankopedia 解析即可，**无需上游**。
  可选：上游加 `author_vehicle_codename`（meta `playerVehicleName`，约 8 行）。

### xlsx「原始字段」表

原是开发调试用的 `#N` protobuf 原始字段透视；唯一的另一个消费者 `ReplayHpTimeline` 已被上游 `hitpoints_left` 取代。
**保持现在的两列（玩家 / 账号 ID）并在表头注明。** 真有需要时再给上游加默认关闭的 `includeRawSettlement` 选项（每场约 6–10 KB）。

### AI 复盘恢复（推荐方案 B）

- `parseAiReview` 单独不够：位置 / 炮塔 / checkpoints / finalState / 占点只能从 `parsePlayback` 推导。
- **两个与方案无关的阻断**：
  1. 契约矛盾：openapi 的请求 schema（当时名为 `AiReviewReconstruction`，现为 `ClientAiReviewProjection` 投影）与 `ai-review.md` 不传 `metadata` / `diagnostics`，但
     `BattleTimelineBuilder.validate` 要求二者存在，按契约发出的请求必被拒（`TIMELINE_META_INVALID` / `STREAM_CORRUPTED`）。
  2. 体积：冻结 fixture 解压 46 MB（events 31.7 MB、checkpoints 14.3 MB），只留被消费的事件仍 14.3 MB，
     超过 16 MiB 请求上限且未启用 gzip 请求体。
- **方案 A**（客户端适配成现有 `ReplayReconstruction` JSON，wotb-ai 不动）：约 8–10 人日，绕不开体积问题，
  等于在前端重写 Java reconstructor。
- **方案 B（推荐）**：请求改为直接上传 `{battle, aiReview, playback}` 三个 facet，wotb-ai 输入层组装成内存
  `ReplayReconstruction`，下游约 40 个 evidence / feature / timeline 类不改；`metadata` / `diagnostics` 服务端合成、
  列式 facet 体积小，两个阻断一并消失。约 6–8 人日。
- 需上游补：`coverage`（packet 计数与 `decodedPacketRatio`）、`finish_reason`、Damage 未钳零的原始 HP 状态
  （区分 HP_ZERO / DEATH_FFFD）、`unsupported_damage`（只有双方无数值）、Visibility 的 currentHp；
  并实测确认 `Shot.game_hit_result` 与 Java `primaryResultRaw` 同义。
- Parity：对三个冻结 fixture 对应的原始回放跑 WASM → 适配器 → 与 fixture 逐层比对（实体映射全等、
  开战时钟 ≤1e-3、HP 观测序列一致、AoI 窗口 ≤0.1 s、checkpoint 位置 ≤0.5 m），最后比 `TeamGroundingFacts` /
  `EvidenceSkillEngine` 输出与渲染后的 prompt 证据段；**前提是找得到这三份原始回放**。

### Java 移植时照原样保留的可疑行为

| 处理 | 项 | 位置 |
|---|---|---|
| 修 | 全部联赛回放互相冲突时 `CONFLICTING_REPLAYS_FOR_ARENA` 诊断丢失，只报 NO_VALID_REPLAYS；让 `NoValidReplaysError` 带上联赛失败 | `compute/finalize.ts` |
| 修 | 战队标签不 trim（`CHRD ` 与 `CHRD` 会拆成两队）；golden 按有意偏离更新 | `battleFacts.ts` |
| 删 | `populateBattle` 的 contribution / kast / impact 无消费者 | `compute/performance.ts`、`model.ts` |
| 删 | `ROSTER_INCOMPLETE` 已不可能产生；顺手给导出补缺失的失败码文案（如 `INVALID_STAT_FACTS`） | `league-rating.ts`、`export/sheets.ts` |
| 改（低） | 用车统计并列时按 tankId 字符串排序 → 数值排序 | `compute/performance.ts` |
| 保留 | 冲突指纹用时长、`survival_time` 兼容字段、注释矛盾、导出细节、进度回调；导出时间用浏览器本地时区（Java 线上是 UTC，记为有意偏离） | — |
