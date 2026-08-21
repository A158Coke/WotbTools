# 技术版本历史

技术架构、基础设施、CI/CD、重构、代码质量变更。产品功能见 `CHANGELOG-PRODUCT.md`。

## [Unreleased]

### Added
- **战局回放 Details Panel 增加 Tier X 车型图**：从 BlitzKit 公开 CDN 确定性下载 Tankopedia
  全部 84 辆十级车的透明 WebP 车型图并随前端发布；选中车辆时按 tankId 懒加载，非十级车、
  缺图或加载失败静默降级，production 不访问 BlitzKit。新增 Tier X 100% 图片覆盖测试与
  `blitzkit-references.mjs --emit-portraits` 可重复生成入口。

### Fixed
- **战局回放（Battle Playback）当前状态面板与伤害/碰撞语义修复（docs/current-plan.md 1-28）**：
  - Details Panel 收敛为 current-state 面板：删除「最大 HP」「HP %」「协助伤害」「最终战绩」分区。
  - 车辆类型 fallback：replay tankType → tankopedia class（英文）→ 空串。
  - 伤害语义：核心推导 PlaybackCombatReconstruction（Type-7 HP sample 权威掉血 + attribution）；
    playback DAMAGE 字段 damage 更名 rawProtocolValue，新增 observedHpLoss；飘字/记录/统计改用权威掉血；
    「造成伤害」改为「已记录伤害」。
  - DESTROYED/KILL 事件恢复（type-7 alive=false 推导击毁 + 同炮 DAMAGE 支撑击杀）。
  - Marker 碰撞几何：真实 screen-space footprint（core + HP HUD + 标签盒），优先级 marker > selected > HP > tank > player。
  - **PR #107 审查修复（Blocker 1/2/3）**：
    - Blocker 1：Type-8 rawProtocolValue 不再作为任何生产消费者的真实伤害——热力图、
      掉血窗口聚类（DamageWindowClusterer）、玩家对炮/逐次伤害/击杀归因（PlayerEvidenceFormatter）、
      占点窗口承受伤害（PointsSituationEvidence）、Player/Team 特征抽取与 ObservedMaxHp 全部改走
      §12/§13 权威 HP loss；剩余 raw 用法逐项审计合法（parse-layer 结算、DTO labeled raw 字段）。
    - Blocker 2：marker 碰撞 footprint 不再假设固定 36×28——BattlePlayback 实测
      `.pb-vehicle` offsetWidth 作为 coreSize（MARKER_CORE_PX fallback），labelLayout 支持
      hpBoxW/hpBoxH 真实渲染尺寸参数。
    - Blocker 3：attacker/killer 归属措辞收敛为「有支持证据的归属」，不再声称权威；
      probe 输出 attribution 措辞同步。

### Changed
- **AI 模型切回 deepseek-v4-flash（官方稳定别名）**：`AI_MODEL` 默认值从
  `deepseek-v4-pro` 统一切回 `deepseek-v4-flash`——官方稳定别名直接调用最新 Flash 版本，
  调用方式不变，不使用带日期的显示名（`application.yml` / `.env.example` /
  `docker-compose.prod.yml` / `docker/online/docker-compose.yml` / `deploy.yml` workflow /
  `docs/architecture/ai-review.md` / gateway 测试字面量同步）；已显式设置 `AI_MODEL` 的
  环境以环境值为准（GitHub Repository Variable 优先级最高，若仍为 `deepseek-v4-pro` 需人工
  改为 `deepseek-v4-flash` 或删除该 Variable，代码无法覆盖）。

### Added
- **Team AI Review 启用 DeepSeek 官方 JSON Output（Team Call #2）**：
  ① **输出格式契约**——`AiChatRequest` 新增 `AiResponseFormat`（TEXT/JSON_OBJECT，默认 TEXT，
  兼容构造器回退 TEXT）；`SpringAiChatGateway.buildPrompt` 在 per-request `OpenAiChatOptions` 上
  映射 `response_format=json_object`（Spring AI 2.0.0 原生 `responseFormat` API），TEXT 不发送该参数，
  绝不写入连接级/全局 model options。
  ② **仅 Team Call #2 启用**——`TeamReplayAnalysisService.callRaw` 显式传 JSON_OBJECT（输出格式
  属于 request contract，不由 analysisMode 隐式推断）；Player / Pre-battle / Harness / Autopsy 保持 TEXT，
  存量请求行为等价。
  ③ **职责三层不变**——provider JSON mode = syntax guarantee；`TeamReviewEnvelopeParser` = business
  schema guarantee（合法 JSON 但 schema 违反仍 fail-close）；`TeamFactualConsistencyValidator` = truth
  guarantee（V1–V6/BINDING 全部保留，不因 JSON mode 放宽）。
  ④ **Parser 可诊断化**——新增 `parseDetailed()` 返回 `ParseResult`（envelope + 稳定 `ParseFailureReason`
  枚举：EMPTY_OUTPUT/INVALID_JSON/MISSING_PRIMARY_DIAGNOSIS/MISSING_REVIEW_MARKDOWN/INVALID_CLAIMS/
  UNKNOWN_CLAIM_TYPE/INVALID_MACHINE_FIELD_TYPE/MISSING_REQUIRED_MACHINE_FIELD/TOO_MANY_CLAIMS/
  TOO_MANY_EVIDENCE_IDS）；`parse()` 保持兼容委托。
  ⑤ **Validator reasonCode**——`FactConflict` 新增 `reasonCode`（UNKNOWN_EVIDENCE/EVIDENCE_TYPE_MISMATCH/
  SUBJECT_MISMATCH/TIME_MISMATCH/REGION_MISMATCH/KNOWLEDGE_MISMATCH/COUNT_MISMATCH/UNSUPPORTED_HARD_FACT/
  TEMPORAL_OWNERSHIP/IDENTITY_AMBIGUITY 等，2 参构造按 checkId 推断），production 可直接判断 validator 为什么失败。
  ⑥ **全链路结构化日志**——统一 `event=... correlationId=...` 事件日志（ai_review_started/finished/failed/
  cancelled、ai_upstream_call_started/completed/failed、ai_transport_retry、ai_prompt_budget、
  team_review_grounding_ready、team_review_validation_attempt_completed、team_review_parse_result、
  team_review_validation（conflictCount/checks）、team_review_validation_conflict（DEBUG，check/reasonCode）、
  ai_validation_retry、team_review_completed、ai_review_sse_opened/completed）；一次请求可用单个
  correlationId 在 Loki 重建完整时间线；敏感数据（API key/prompt/completion/回放内容）严禁入日志，
  新增回归测试断言。
  ⑦ **指标**——新增 `wotb_ai_team_review_validation_attempt_total{result=pass|parser_invalid|validation_failed}`
  （低基数，仅 result tag）；请求/错误/耗时沿用现有 `wotb_ai_review_*` / `wotb_ai_upstream_*`，不重复造指标。
  ⑧ **测试**——HTTP boundary（JSON_OBJECT 请求体含 `response_format={"type":"json_object"}`、TEXT 不含）、