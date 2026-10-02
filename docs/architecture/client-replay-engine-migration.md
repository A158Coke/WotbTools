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
| AI 复盘（维护中） | 服务端只剩客户端投影解码；测试改用冻结投影 `common/fixtures/replay-facts/*.json.gz` |

## 后续（不阻塞）

- 上游 `PlaybackData` 补 `damages[]`（伤害归因事件）：2D 目前多扫一次 `parseAiReview` 拿伤害事件。
- 上游 `hp[]` 样本来源标记（进入视野快照 vs 血量变化）：客户端比 Java 多出 8 / 7 段「进入视野→首次掉血」的掉血段。
- 上游补录像者车辆（meta `playerVehicleName`）：xlsx 单场表「录像者车辆」暂为空。
- xlsx「原始字段」表：Java 透视的 protobuf 原始字段客户端没有，只剩玩家 / 账号 ID 两列。
- AI 复盘恢复时基于上游 `parseAiReview` 重建客户端投影（服务端不再有重建器）。
- Java 移植时发现的可疑行为（战队名尾随空格、全部联赛回放冲突时报 NO_VALID_REPLAYS、`survival_time` 读兼容字段、用车统计按 tankId 字符串排序等）照原样保留，逐项决定是否修正。
