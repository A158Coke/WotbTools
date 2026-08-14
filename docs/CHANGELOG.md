# 技术版本历史

技术架构、基础设施、CI/CD、重构、代码质量变更。产品功能见 `CHANGELOG-PRODUCT.md`。

## [Unreleased]

### Changed
- **文档信息架构归一化重构（docs IA）**：docs/ 从平铺 16 个 md 重构为 architecture / features / research / operations / reference 分层；新建 `docs/README.md` 索引与 `docs/ROADMAP.md`，删除 TODO.md / rating-progress.md（完成项归 CHANGELOG，未完成工程项转 GitHub Issues #78–#81，产品方向转 ROADMAP）；DEVELOPER_GUIDE 拆分为开发入口 + 专题文档（AI 复盘 / 回放重建 / 地图鸟瞰 / 评分 / 排行榜）；research/replay 逆向文档 verdict 置顶、状态词统一 PROVEN/PARTIAL/UNKNOWN/SUPERSEDED/DEPRECATED；全仓库旧路径链接与代码注释同步修正。纯文档变更，不影响代码与构建。
- **Agent 指令体系分层（AGENTS.md hierarchy）**：新增根 `AGENTS.md`（自动发现入口）与 8 个按作用域
  继承的目录级 `AGENTS.md`（java/frontend/common/deploy/.github/两个 keycloak provider/map-semanticizer），
  内容全部经真实代码/构建/CI 核对；`.agents/AGENTS.md` 收敛为 repository-wide 硬约定（115→39 行），
  修正与代码漂移的条目（tankopedia tier 四文件、八服务开发环境、AiReplayAnalysisService 为兼容 facade、
  remote 命名等）；`.agents/wotb-sync.md` 收敛为指向 `skills/wotb-sync/SKILL.md` 的指针（单一事实源）；
  DEVELOPER_GUIDE 文档地图补充层级说明。纯文档变更，不影响代码与构建。

### Fixed
- **地图鸟瞰换文件竞态**：loadMapOverview 为每次请求建立唯一 generation（递增序号 + AbortController）；选择/删除/清空文件（resetMap）与组件真正卸载时递增序号并 abort 旧请求；响应在成功/失败/finally 写状态前校验 generation——旧请求不得覆盖新文件的 mapOverview/mapError/mapLoaded/mapLoading、其 finally 不得提前解除新请求的 loading；KeepAlive deactivate 不触发卸载钩子，有效状态不受影响。新增 4 个 deferred-promise 竞态测试（A 后到不显示 / 任意返回顺序只显示 B / 旧 finally 不解除 B loading / 真实卸载 abort）。
- **战局回放选中 last-known/已击毁车辆后整图消失**：三语 locale `recon.map.playback.last_known`
  文案末尾裸 `@` 被 Vue I18n 11 当作 linked-message 语法，首次渲染该文案（选中位置中断/已击毁
  车辆时）抛 SyntaxError 导致 BattlePlayback 子树整体卸载；改为冒号文案，并新增真实
  `createI18n` 三语回归测试 `BattlePlayback.i18n.test.js`（不 mock `$t`，zh/en/ru 选车路径）。
- **战局回放 review 修复（4 项）**：① 炮塔方向证据文档 source-of-truth 统一为受控旋转实验定案
  PROVEN（历史 NOT_PROVEN 标 SUPERSEDED）；② `directionSamples` 只接受落在该车同一可信
  position-interval 内的 prop2 样本、hull yaw 仅从同区间位置配对（跨 gap 不取对侧、段末样本恒保留
  保证冻结）；③ playback 时长三优先级（`battle.durationS` → `BattleEndedEvent` → 位置流最后时刻）
  并对全部 event/interval/direction/deathSec 施加 `[0,durationSec]` 契约；④ 前端同一 AI 时间戳重复
  点击可再次 seek、单点 last-known 时间保持真实采样时间。
- **战局回放坦克名权威解析**：MapOverviewBuilder.buildPlayback 的 PlaybackVehicle.tankName 由空串改为 ReplayDisplayNames.tankName(tankId, tankName) 权威解析（与 AI 证据路径同源，如 29985 → "SPHT"），前端不再回退显示纯数字 tankId；新增 MapOverviewBuilderTest 坦克名非空/非数字断言。
- **positionAt 重新上报首点边界修复**：修复 t 恰为采样点（gap > 5s 后的重新上报首点）被误判为「gap 内」返回 null 的问题——该点应直接返回，否则 vehicleState.lastKnown=true 使敌方图标残留「最后已知位置」淡化；新增 battlePlayback.test.js 回归用例。

### Added
- **AI 复盘三板块折叠 + 时间链接跳回地图**：AnalysisResultPanel 复盘正文（call2）与 ReconstructionPage 地图区块新增独立折叠开关（默认展开，复用通用 recon.collapse/expand 三语）；点击 AI 报告时间链接（onAiSeek）改为 async，seek 后 scrollIntoView 回滚到地图区块。
- **地图鸟瞰独立端点 /api/replay/map-overview（不调 AI）**：ReconstructionController 新增同步端点（与 analyze 同角色/校验/稳定错误码，ReplayUsageMetrics.OP_MAP_OVERVIEW 计费）；新 MapOverviewQueryService 只解析回放并复用 MapOverviewBuilder 确定性聚合，地图不可构建返回 204（前端显示不可用提示）；analyze SSE done.mapOverview 字段保留兼容、前端不再消费。AI 复盘页新增独立「地图鸟瞰」区块（热力/路线/战局回放三视图，ReconstructionPage 手动按钮加载；AnalysisResultPanel 移除地图折叠块并把 AI 报告时间链接 seek 事件上抛给页面加载/跳转）；locale 新增 recon.map.{load,loading,unavailable} 三语。
- **战局回放视觉调整**：回放视图移除车辆路线渲染（pb-routes/routeSegments/.pb-route 删除，路线数据仍供位置插值与炮线端点复用；「路线」视图不受影响）；坦克图标上方常显坦克型号名标签（PlaybackVehicle.tankName 回退 tankId，位于反缩放按钮内 → 任意缩放下可见、字号恒定，不再限 ≥2× 且从下方移到上方）；炮线可见窗口 TRACER_BASE_SEC 0.5 → 1.0（1×/2×/4× 各约 1s 真实时间）。
- **AI 用词「簇 → 自然中文」确定性兜底**：prebattle/system.zh.md 强制规则新增禁「簇」条款（兵力/阵型集中一律「集群」）；PreBattleSectionRenderer.display() 对 LLM 自由文本做三层卫生——① 特殊自然表达（簇拥→聚集、簇状→集群状）→ ② 短语级替换（一簇→一批 / 同簇→集群 / 成簇→集群 / 分簇→分散 / 主力簇→主力集群 / 多簇→多股）→ ③ 剩余「簇」字符兜底为「群」（单字替换，不会把已替换出的「集群」二次污染），保证全部用户可见自由文本字段（队伍画像/对阵/胜机/假设）最终不含该字；team/single.zh.md 与 TeamPromptLocalizer.CAPTURE_RULE「多车同簇推进」→「多车集群推进」（md 与常量逐字一致）。
- **炮线激光化视觉**：tracerLines 输出扩展（纯函数，无定时器）——opacity 改「先亮后淡」（TRACER_HOLD_REAL_SEC=0.4，保持期后线性淡出到窗口结束）、新增 flashProgress（TRACER_FLASH_REAL_SEC=0.35，命中闪光进度）；BattlePlayback 每炮线渲染三层（外层阵营色光晕 6/view.scale×0.35 透明度 + 内芯亮白 1.75/view.scale + 命中端扩散淡出圆点），线宽从组级移到逐元素（屏幕宽度恒定语义不变）；1×/2×/4× 真实时长与保持期一致。
- **Grafana 使用统计 Dashboard 新增 AI 平均 Token 面板**：`wotbtools-usage` 新增「AI 平均每次调用 Token」stat 面板（`wotb_ai_upstream_tokens_total{token_type="total"}` 增量 ÷ `wotb_ai_upstream_requests_total` 增量，分母含失败调用、失败计 0 token）与「按模式平均每次调用 Token」timeseries 面板（按 `mode` 分维，分母 `clamp_min(...,1)` 避免无流量 mode 显示 NaN，可区分单机复盘 `PRE_BATTLE_STRATEGIC_PRIOR`+`TACTICAL_REVIEW_HARNESS` 与团队复盘 `SINGLE_TEAM_BATTLE`+`TEAM_AUTOPSY`）；`docs/operations/observability.md` 同步面板清单与统计口径。
- **AI 复盘点数局势证据与规则（PointsSituationSkill）**：wotb-core 新增纯函数 `PointsSituationSkill`
  （击杀夺分时间线——±40/击杀业务规则按双方阵亡时刻对齐、叙述口径非实时比分、只表达击杀换分项净差值而非整体点数；占领点区域位置存在——
  服务器位置流在 CONTAINS_CONTROL_POINT 九宫格的存在、位置存在≠占点产分；进攻推进窗口——车辆从
  非占领点区域移动进入占领点区域，同队窗口按 8s 合并）与 `PointsSituationSkillTest`（9 例）；
  wotb-web 新增 `PointsSituationEvidence`（复用 TeamEntityMapper 从重建事件流采集双方位置轨迹，
  推进窗口与 `DamageWindowClusterer` 掉血窗口联接成「推进方窗口内承受伤害=防守方过路费」，
  OBSERVED_DAMAGE_IS_PARTIAL 时抑制伤害数字）并接入团队复盘（`TeamEvidenceFormatter.appendPointsSituation`，
  P3 optional 预算内）与随机战个人复盘（Harness Call #2 裁剪阶梯 + fallback/full/fullNoRecon 三条旧路径）；
  prompt 三语规则同步：team/single.zh.md 占点规则 8 + `TeamPromptLocalizer` zh/en/ru 常量（逐字契约）、
  player/tactical/single/fallback.zh.md + `PlayerPromptRules` POINTS_SITUATION_RULE zh/en/ru 替换链、
  team/autopsy.zh.md 结算级点数规则（禁止编造比分与窗口级判断）；契约测试 `TeamPromptLocalizerTest`/
  `PlayerPointsSituationRuleTest`/`TeamAutopsyPromptBuilderTest`/`PointsSituationEvidenceTest` 扩展。
  数据边界不变：终局前绝对比分未解码，所有信号禁止冒充实时比分（PointsEvidenceProbeTest 结论继续有效）。
- **战局回放标记有效尺寸与固定屏幕线宽**：`BattlePlayback.vue` 标记 hull/turret 素材放大到按钮
  131% 并以共同 pivot 居中旋转（`translate(-50%,-50%) rotate(...)`；素材 512×512 有效车体 bbox
  实测 ≈210×336 → 桌面 28px 容器下有效车体 ≈15×24px，不随缩放变小）；路线 `<g>` 绑定
  `stroke-width=2/view.scale`、炮线 `1.5/view.scale`（屏幕宽度恒定，长度随地图坐标）；缩放 ≥2×
  时标记显示车名小标签（反缩放按钮内，字号恒定）；CSS 移除 `.pb-route/.pb-tracer` 的静态
  stroke-width（否则覆盖属性绑定）；组件测试新增固定线宽/居中旋转/车名标签 3 例（npm 288 全绿）。
- **战局回放炮线动画 + 地图缩放平移 + 敌我阵亡统一**：DAMAGE/KILL 已知射击的炮线
  （`utils/battlePlayback.js` 新增 `trustedPositionAt` 严格事件时刻可信位置——末点后/gap 内/
  首点前/非有限坐标拒绝，不用最后已知位置伪造射击位置；`tracerLines` 纯函数按 now/speed 推导 →
  seek 与 1×/2×/4× 天然正确、无一次性定时器；同刻 DAMAGE+KILL 去重为一条；未命中/盲射/弹道/
  瞄准线无数据依据不渲染）；`.pb-viewport` 单层 transform 缩放平移（滚轮/双指捏合 1×–4× 锚点
  缩放、>5px 阈值拖动平移、拖动后吞 click 防误选车、重置按钮、全图层严格对齐、卸载清理监听）；
  `pb-destroyed` 显式阵亡状态（敌我同款 opacity .35 + grayscale(1) 双层 + ✕，方向冻结最后可信
  样本，无样本以素材默认 0° 渲染，不并入 `pb-last-known`）。
- **AI 复盘点数口径与掉血窗口口径**：`FriendlyEnemyResult` 新增 `teamKills`/`teamDeaths`
  （原始结算事实）与 `standardSupremacyRules`/`provableEarlyPointsWin`（420s/1000 为
  **项目所有者确认的业务规则**，arenaBonusType 只证明战斗类别、不解码出 420s/1000；仅类别未知
  fail closed）；**撤回 `knownPointsSubtotal`/`killPointsDelta` 公式**（victoryPointsEarned 是否
  含击杀夺分未经证明，现有样本双方击杀净值为 0 无法区分）；结束方式只按「标准规则+时长+双方
  存活」判定，不使用任何点数公式；无权威胜方时不按占点分推断胜方（POINTS_INFERENCE 停止产出）；
  `TeamEvidenceFormatter` 只输出原始结算字段（victoryPointsEarned/Seized、kills、deaths），
  终局比分除业务规则可证明的胜方=1000 上限（1000 分上限业务约定）外一律 UNKNOWN；
  REACHED_1000 是结束原因（某一方达到 1000 分导致提前结束）而非胜方：winnerTeam 缺失时只写
  「某一方达到 1000 分导致提前结束、具体胜方未知」，双方终局比分一律 UNKNOWN；每据点每 tick 产分
  与 tick 间隔均未解码（无任何已验证的 tick 产分规则），不写入口径；
  `DamageWindowClusterer.DamageWindow` 新增 `damageVsBaseMaxHpPct`（累计伤害/基础满血量，
  tankopedia 基础值，只是计算基准不是实际掉血比例）/ `criticalWindow`（跨度 ≤10s 且伤害 ≥75%
  基础满血量）；不产出无法证明的「被秒杀」判定；type 8/sub 8 非直接伤害结果与 type 5 Spotting
  均为未解码候选（`ShotSpottingStreamProbeTest`/`PointsEvidenceProbeTest` 探针记录，不进入
  生产时间线）；prompt 规则三语同步（player×3 + team/single + PlayerPromptRules/
  TeamPromptLocalizer：短窗高额伤害窗口强制定性 + 禁止任何公式结果冒充终局比分 +
  禁止阵亡掉血 100% 废话）；`PointsVictoryProbeTest` 本地样本探针（CI 无样本自动跳过）。
- **战局回放炮塔方向契约与双层坦克标记（门禁 B 破解）**：type-7 propId=2 定案为
  炮塔相对车体偏航（u16 LE：`raw*360/65536-180` 度，完整 360° 且 ±180 回绕）——车体静止
  炮塔转一圈的旋转实验回放证明满圈 + wrap；开火命中锚点拟合（41 锚点残差 9.5°）+
  独立受击集交叉验证（34 锚点残差 2.3°）证明 `炮口世界方向 = normalize(hullYaw + turretRelativeYaw)`；
  新增 `TurretDirectionChangedEvent`（`EntityPropertyDecoder` propId=2）与
  `MapOverview.PlaybackVehicle.directionSamples`（`{timeSec, hullYawDeg, turretRelativeYawDeg}`，
  约 1s 降采样 + ≥10° 变化保点、finite、≤deathSec、时间升序）；`ReplayEvent` permits 扩展。
  前端 `BattlePlayback.vue` 圆点标记替换为 PR #72 四张运行时 PNG 的 HTML overlay 双层标记
  （hull 按 `hullYawDeg`、turret 按 `turretWorldYawDeg=normalize(hull+rel)` 独立旋转，
  共同 pivot，炮管不脱离炮塔；约 28px/移动端 22px；阵营色只来自素材；录像者 halo/选中 ring/
  最后已知淡化/阵亡 ✕ 为独立 overlay）；`utils/battlePlayback.js` 新增 `normalizeDeg`/
  `shortestArcDeg`/`interpolateDirection`（最短圆弧插值、跨 gap 冻结）/`screenRotation`
  （地图 yaw→屏幕 rotate，0=朝上/90=朝右/180=朝下/270=朝左）与四基准方向单测。
  `TurretDirectionProbeTest` 新增检查项 12（旋转实验时序 dump）与检查项 11（炮口模型拟合+
  交叉验证）；证据笔记与逆向文档同步。
- **AI 复盘结果页「地图鸟瞰」新增「战局回放」第三视图**：后端 `MapOverview` 扩展 `playback`
  （`durationSec` / `vehicles`（含 `positionIntervals` 位置上报区间与 `deathSec`）/ `events`：
  `DAMAGE` / `DESTROYED` / `KILL` / `POSITION_REPORTED` / `POSITION_STALE`，身份经
  `TeamEntityMapper` 实体映射解析，无法可靠解析不输出；`POSITION_REPORTED/STALE` 只表达
  服务器位置流覆盖变化——type-10 是服务器完整实体流、与点亮无关，敌方静止时不上报位置，
  故不得把位置中断当「失察」）；前端新增 `BattlePlayback.vue` 与 `utils/battlePlayback.js`
  （RAF 播放、仅在同一可信连续点 gap≤5s 间插值、gap 内淡化最后已知位置而不消失、从未上报
  位置不显示、阵亡切换 ✕、进度条事件按秒聚合标记、播放/暂停/±5s/上一/下一事件/1×2×4×/
  拖动 seek（拖动即暂停）、随机战默认录像者相关事件过滤、`formatClock` 先取整杜绝 00:60）；
  `MarkdownContent` 把 AI 报告中的明确时间文本（`03:20` / `3分20秒` / `3m 20s` /
  `3 мин 20 с`，不识别普通数字/比分）转成 `#seek=` 链接，点击后展开鸟瞰、自动切换战局回放
  并 seek 暂停；三语 locale 与文档同步。

### Changed
- **打手最高等级显示名调整**：保留数据库/API 内部兼容值 `AVERAGE_GOD`，仅把界面中文名改为“殿堂级”、英文名改为 `Mythic`，俄文同步对应译名；管理员编辑授予、普通申请禁用及每服最多一名的规则不变。
- **AI 复盘胜负来源证据层级与全歼双向语义（battle result 权威）**：`CAPTURE_RULE`（ZH/EN/RU）
  不再宣称所有 result 行都来自权威 winnerTeam，改为按 `resultSource` 三级证据描述——
  BATTLE_RESULTS（battle_results#winnerTeam 权威，最高优先级，LLM 不得用事件流/存活数/点数
  覆盖胜方）/ SURVIVOR_SETTLEMENT（结算存活状态推导，非权威不得伪装）/ POINTS_INFERENCE
  （双方存活时占点分推断，非权威规则候选）；`TeamAiPromptBuilder` mandatory header 同时输出
  `result` 与 `resultSource`（不再只放在可能被 token 预算裁掉的 CAPTURE_AND_POINTS）。
  全歼语义双向：本方获胜且对方 survivors=0 → 「全歼敌方获胜」；本方落败且本方 survivors=0 →
  「被敌方全歼落败」；双方均有存活才进入点数结束方式（≥1000 提前获胜 / 双方 <1000 时间耗尽
  点数判定，pointsEndReason 前置条件=双方均未全员阵亡）；`autopsy` 提示词规则 9 同步。
  `annihilationSuffix` fail-closed 升级为**结算阵容完整前提**（`Battle.rosterComplete`）：
  ReplayParser 解析名册 `#201→#2→#3`（名册来源队伍）并与战绩 `#301` 对比——账号集合完全一致且
  每个账号队伍一致才标记完整；非法 perspectiveTeam、players 缺失/为空、阵容不完整或任一方队伍
  不在 roster 时一律不输出全歼后缀，winnerTeam 缺失时也不得推导 SURVIVOR_SETTLEMENT 胜方，
  不得把未知当成零存活；不写死每队 7 人，完整名册的非 7v7 训练房同样生效。新增
  `TeamResultSourceBoundaryTest` 覆盖部分缺失敌方/本方、winnerTeam 存在与缺失、主 result 行与
  Autopsy 结果行、完整 7v7 与合法非 7v7 场景。
  **点数推断同步 fail-closed**：`resolveTeamBattle` 的 POINTS_INFERENCE 仅在 rosterComplete=true
  时可用（winnerTeam 缺失 + 阵容不完整 → DRAW_OR_UNKNOWN/UNKNOWN，残缺点数不推断胜方）；
  winnerTeam 存在时胜方仍为 BATTLE_RESULTS，但 rosterComplete!=true 时 pointsEndReason 降级
  UNKNOWN，result 只写通用「点数判定」，不得写「时间耗尽/达到 1000 分」；
  `CAPTURE_AND_POINTS` 在阵容不完整时输出 `SETTLEMENT_ROSTER_INCOMPLETE=true` /
  `pointsTotalsUnavailable=true` 并抑制逐人/双方占点分总量（写 UNKNOWN），与 mandatory header
  和 `CAPTURE_RULE`（ZH/EN/RU 新增 2d 条）口径一致。新增 ReplayParser 解析级负向测试
  （#201/#301 账号不一致、队伍不一致 → rosterComplete=false）。
  新增 golden case `cw-annihilation-win-01` / `cw-annihilation-loss-01` + fixtures + lessons；
  `cw-cap-win-01` / `cw-cap-points-decided-01` 断言 mandatory header `resultSource=POINTS_INFERENCE`
  且不出现 BATTLE_RESULTS；`AiEvalHarnessTest` 断言 ZH 规则含全歼双向语义与三级证据、
   EN/RU 本地化后不残留中文规则。
- **AI 复盘结果一键复制正文**：`AnalysisResultPanel` 面板头部（右上角）新增「复制」按钮，一键复制
  `result.analysis`（最终复盘正文，可能包含团队剖析与免责声明；不含独立的
  preBattleSection/mapOverview）。Clipboard 降级链：`navigator.clipboard.writeText` 优先，
  writeText 缺失或 reject 时降级 `execCommand('copy')`（textarea 经 try/finally 保证移除；
  execCommand 返回 false 或抛异常时不显示「已复制」）；复制后按钮显示「已复制」1.5s 后复位，
  组件卸载清理定时器。新增三语 locale `recon.copy` / `recon.copied` 与组件测试
  （仅复制最终正文、排除赛前预测/地图鸟瞰、Clipboard 成功/缺失/reject、execCommand false/抛异常、
  textarea 清理、卸载清理定时器）。
- **战局回放坦克标记素材定稿（PR #72）**：最终方案为通用半立体 MT 双层模型；新增车体与炮塔同图生成的
  authoritative master，并由该单一基材拆出友军暖金/敌军青蓝四张 `512×512` RGBA 运行时素材；
  两阵营共用完全一致的 alpha 蒙版，敌军色为确定性换色，不依赖运行时 CSS filter。重新生成可正常解码的
  状态规范表和运行时验收板，覆盖双层叠加、0°/90°/180°/270° 旋转、28px 深浅背景、录像者/选中/
  最后已知/阵亡 overlay；删除早期废弃的四车型 SVG 与两张非同源旧 PNG。素材 README 与
  `.agents/AGENTS.md` 固化 `(256,256)` 旋转中心、`hullYaw` / `turretRelativeYaw` /
  `turretWorldYaw = hullYaw + turretRelativeYaw`、轨迹≠朝向及未来播放器接入边界（PR #71 不变）。
- **技能更名：grill-with-docs → plan-designer（开发方案设计）**：开发前方案 grill 技能更名为
  `plan-designer`，调用时**自动前置 grill-me**（需求澄清：复述理解 → 逐层提问 ≤3 个/轮 →
  输出《需求确认单》），需求已明确时跳过并注明；随后进入方案设计流程（可落地性核对 →
  影响面扫描 → 分步方案 → 风险与默认决策 → 输出《开发方案单》→ 交给 Plan）。
  全仓交叉引用同步：`AGENTS.md`（Feature 流程 / Phase 1）、`grill-me`（交接）、`plan-executer`
  （输入与互补）、`review-with-docs`（current-plan 检查项）、`finish-task`（current-plan 头部模板）、
  `DEVELOPER_GUIDE`（技能库注释）。流程职责与《开发方案单》输出契约不变。
- **Player fallback killVictims 事件流伤害数字纳入 partial 门禁**：`buildPlayerContextSummary`
  在构建基础 summary 时即读取 `hasObservedDamagePartial(ctx)`——partial 下
  `DAMAGE_EXCHANGE_AGGREGATED_OBSERVED` 输出 `UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)`，
  `KILL_ATTRIBUTION` 仅保留「你击杀了谁 / 谁击杀了你」身份信息、抑制
  `累计直接伤害/击穿/致死前累计 N 点伤害`；权威结算（YOU_AUTHORITATIVE/阵容/总伤害）不受影响；
  complete coverage 保持逐目标累计伤害与击杀归因明细。清理
  `TacticalEvidenceFormatter` 零调用的 `renderEvidenceSections(EvidenceSkillResult)` 重载。
- **AI 复盘 partial 事件流伤害证据全链路抑制（Player Harness/fallback + Team）**：
  `EvidenceSkillEngine` 在 `OBSERVED_DAMAGE_IS_PARTIAL` 时跳过 `EngagementTradeSkill`，
  `CriticalWindowSkill` 基于过滤后的 HP 动量/阵亡/支援/路线/单走证据重新聚合窗口；
  `TacticalReviewPromptBuilder` 在 Prompt 边界再防御性剔除 ENGAGEMENT_TRADE 与携带
  recorderDamage* 的窗口；`TeamAiPromptBuilder` 把合并后的 limitations 传入
  `appendOptionalDetails`/`appendHighPriorityFacts`，partial 时
  `TEAM_ENGAGEMENTS_OBSERVED_SUBSET` 与 `OBSERVED_EVENT_SUBSET` 均不输出事件流伤害数字。
  覆盖完整时换血/团队交火证据保持不变。
- **AI 复盘整体超时预算 400s → 1100s（切页后台跑完不中断）**：`AiReviewWorkerExecutor` 默认
  overall-deadline、`application.yml`、前端 `AI_ANALYZE_TIMEOUT_MS`（`ReconstructionPage.vue`）、
  nginx `proxy_read/send_timeout`、`SseEmitter` 超时与部署 env（`deploy.yml` / `.env.example` /
  `docker-compose.prod.yml`）统一对齐 1100s / 1120s——团队复盘 3 次 AI 调用
  （Call #1 + Call #2 + Team Autopsy，各 ≤315s）的最坏耗时不再被旧 400s 硬杀；
  `TacticalReviewHarness.ENDPOINT_DEADLINE_SEC` 同步更新；新增 `AiTimeoutChainContractTest`
  配置契约测试（application / compose / workflow / frontend / nginx / SseEmitter 防漂移），
  deploy.yml 固定使用 1100 并在 `deploy.sh` fail-fast 校验，杜绝旧 400 静默生效。
  前端新增 KeepAlive 切页回归测试（开始复盘 → 切「回放解析」→ 预览 → 切回：
  不 abort、不调 cancel、结果可见）。
- **争霸赛点数胜负结束方式（pointsEndReason）**：`FriendlyEnemyResult` 新增 `PointsEndReason`
  派生（`REACHED_1000` / `TIME_EXPIRED` / `UNKNOWN` / `NOT_APPLICABLE`）并纳入
  `TeamBattleWinner`；`CAPTURE_AND_POINTS` 输出 `pointsEndReason`；`CAPTURE_RULE`（ZH/EN/RU）
  写明结束条件三分法——点数胜负叙述必须体现「时间耗尽」或「达到 1000 分提前获胜」，
  禁止把 <1000 的中间比分当作获胜理由；团队剖析胜负标签与 `resolveTeamResult` 按结束方式输出。
- **掉血时间范围（规则 + 窗口证据）**：新增三语 `HP_LOSS_TIME_RULE`（player/team 提示词共用）——
  凡提及掉血必须给时间范围与掉血量；小窗口大量掉血先描述为「短时间集中掉血/高压掉血窗口」，
  仅当窗口总跨度 ≤15 秒、解析出 ≥2 个不同攻击者且无未解析攻击者时才可写「被多车集火」，
  攻击者无法解析、只有 1 个攻击者或窗口总跨度超阈值（含 ≤10s 间隔链式聚类形成的大跨度窗口）时不得断言集火。
  新增 `DamageWindowClusterer`（≤10s 间隙聚类掉血窗口，含不同攻击者数）：真实 decoder 的
  `DamageEvent` 账号字段恒为 null，窗口沿 `ParticipantMappingEvent` 的 entityId→accountId 映射
  （复用 `TeamEntityMapper`）解析攻击者/受击者；不再依赖生产中恒为 false 的 `lethal()`，
  删除不可达的「致死」宣称。player 路径输出 `RECORDER_DAMAGE_RECEIVED_WINDOWS`（fallback 与
  Tactical Harness 主路径同格式/同口径），团队路径输出 `MEMBER_DAMAGE_RECEIVED_WINDOWS`
  （均受 `OBSERVED_DAMAGE_IS_PARTIAL` 覆盖率抑制，覆盖不全时输出 UNAVAILABLE 不给数字）。
  新增真实回放集成回归测试 `ReplayDamageWindowIntegrationTest`
  （common/fixtures 的 rift 随机战夹具：真实 decoder 账号字段为 null、经 entity 映射生成窗口、
  battle-relative 时间、partial 抑制、Harness/fallback/团队三路径、单一攻击者不标集火）。
  同根因修复：逐次伤害段 `PER_HIT_DAMAGE_EVENTS` 与逐对手对炮段 `DAMAGE_EXCHANGE_BY_OPPONENT`
  一并改用同一 entity 映射解析（真实回放不再显示 UNAVAILABLE/空段）。
- **AI 复盘维持分析 + 地图可视化改进**：`App.vue` 视图渲染改为 `<component :is>` +
  `<KeepAlive :include="['ReconstructionPage']">`——切走「AI 复盘」视图不再卸载/取消，SSE 流继续，
  返回时进度/结果直接可见（关标签/刷新仍由 `beforeunload` 取消）；`ReconstructionPage` 移除卸载时
  取消，超时改为「setTimeout 兜底 + 流内墙钟 deadline」双保险，后台标签定时器节流不再影响 1100s 语义；
  `MapOverview` 新增 `arenaBonusType` / `recorderAccountId`（`MapOverviewBuilder` 从
  `Battle.arenaBonusType` / `Battle.recorderResult()` 填充），随机战路线视图新增「仅玩家」筛选；
  前端新增 `utils/mapPalette.js` 自适应配色——底图平均相对亮度（阈值 0.45）分暗/亮两套色板，
  地图鸟瞰网格/九宫格/出生点/路线/热力颜色随底图明暗切换并为路线加对比描边；canvas 不可用时回退默认色板。
  新增 `mapPalette` 单测与 `MapOverview`/`ReconstructionPage` 回归测试（仅玩家筛选、深浅色板、
  卸载不取消、流内墙钟超时）。
- **单走/图控否定判断加伤害覆盖门禁（OBSERVED_DAMAGE_IS_PARTIAL）**：事件流观测伤害与权威结算不一致时，`teammateBenefit` 判定为 UNKNOWN（不得把“没观察到队友获利”当确定无获利）、开局图控不得用“未观察到交火”证明未接火（Team/Player 两路径一致）；正向观测到的交火/承伤仍可作为证据；SOLO_DELAY 必须 TRUE、SOLO_DETACHED 必须 FALSE、UNKNOWN 均不生成。新增生产契约回归测试与 2 个 golden false-positive cases（`cw-damage-partial-benefit-unknown-01` / `player-damage-partial-opening-01`），golden 27/27。
- **十级车战术 profile 数据修正（0de5719c）**：`common/tank_tactical_profiles.json` 调整多辆十级车的 mobility/strengths/weaknesses/roles/burstPotential/sustainedDpm/hullDownAbility（350+/281-），为手工数据修正；数据基线来自 BlitzKit 车辆库（alpha/hp/机动数值）驱动的车型基线 + 手工战术微调，LOW/MEDIUM/HIGH 与 strengths/weaknesses 沿用既有受控词表；`TankTacticalProfileRegistryTest` 7/7（含全部 Tier X 覆盖断言）通过。
- **AI 模型切换为 deepseek-v4-pro（官方稳定别名）**：`AI_MODEL` 默认值从 `deepseek-v4-flash` 切换为 `deepseek-v4-pro`——官方稳定别名直接调用最新 Pro 版本（当前对应 DeepSeek-V4-Pro-0813），调用方式不变，不使用带日期的显示名（`application.yml` / `.env.example` / `docker-compose.prod.yml` / `docker/online/docker-compose.yml` / `deploy.yml` workflow / `DEVELOPER_GUIDE` / gateway 测试字面量同步）；已显式设置 `AI_MODEL` 的环境以环境值为准。
- **地图语义全部完成人工核验（33 张 verified=true）**：`common/map-semantics/*.semantic.json` 全部置 `verified=true`——用户已逐图人工核对区域名称/类型/边界/favors/risks/relationships/spawnSemantics（含 Desert Sands 的坐标、建筑位置与 Z/坡度算法校验）；自动测试、结构一致性校验与 Z 校验仅作为辅助，不替代人工核验。Call #1 渲染为「人工地图核验: 已完成」；同步更新 `MapTacticalSemanticsRegistryTest` / `PreBattlePromptBuilderTest` 断言与 `map-semanticizer/README.md`、`docs/DEVELOPER_GUIDE.md`。4 张新图（rudniki/grossberg/moon/iceworld）仍缺 `mapCodes`（未登记显示名，既有已知项，不影响核验状态）。
- **AI 复盘单走候选修复（时间口径 + 主力簇识别 + 用词去技术化）**：`TeamSoloIntentSkill` 改为每个 15s 窗口先确定全局主力簇（平票不判、主力簇成员不产生候选、非主力簇需人数差 ≥2 且距离 ≥150m）；`teammateBenefit` 只使用窗口内证据（主力质心位移 / 窗口内队友有利交火），删除整场击杀/占点分与 `team==1` 硬编码；开局图控与脱节判定改用窗口内接火/承伤/阵亡证据，battlePhases 缺失时不把整场当开局；`SoloPlayIntentSkill` 的 `stationaryRatio==null` 不再等价于 MOVING、region/语义未知不再等价于远离目标点、SOLO_DETACHED 必须有窗口内距离增长证据（从 checkpoints 计算）、后期掉血/阵亡不污染早期窗口。单走证据摘要改自然中文（「主力簇」→「主力」、去掉「候选」等内部词），三语规则新增禁用「簇/质心/候选/规则候选/PARTIAL」等内部术语。新增回归测试（主力 5+2 分簇、Team2 不读 Team1 占点、窗口外击杀/占点/承伤/阵亡不影响、后期阵亡不判脱节、未知移动≠MOVING、未知目标点≠远离、无增长不判脱节、后期掉血不抑制开局图控、阶段缺失不判开局）+ 3 个 golden false-positive cases（`cw-main-cluster-no-solo-01` / `player-no-growth-01` / `player-unknown-stationary-01`），评估 harness 18/18。全量 `mvn -s settings.xml test` 全绿。
- **AI 复盘单走/占点证据（图控 · 拖延 vs 脱节 · 争霸赛占点）**：新增 `TeamSoloIntentSkill`（wotb-core）从阵型簇/移动段/交火/占点分推导单走行为候选（`OPENING_MAP_CONTROL` / `SOLO_DELAY` / `SOLO_DETACHED`，PARTIAL 规则候选）——开局散开标图控并抑制脱节；单走判拖延以「队友是否获利」为条件（B1 口径，只给时序关联不声称因果）；`TeamEvidenceFormatter` 新增 `SOLO_INTENT_CANDIDATES` 与 `CAPTURE_AND_POINTS` 段（P3 optional，争霸赛占点分/点数胜负/占领点区域）；`TeamPromptLocalizer` 新增三语 `SOLO_INTENT_RULE` / `CAPTURE_RULE` 并微调「不得推断玩家心理意图（可判可观测行为模式）」条款；player 路径新增 `SoloPlayIntentSkill`（复用 `RouteSkill` 脱节窗口，同口径，个人复盘无队友获利维度）并在 `EvidenceSkillEngine` 注册，player prompt（fallback/single/tactical）追加三语规则；评估 harness golden cases 扩至 15 个（新增 cw-cap-* 占点 4 个 + player 路径 3 个，探针按 mode 分流走真实证据链）+ 7 篇 lessons + 生产反馈登记模板 `docs/ai-eval/feedback-checklist.md`；Type 31/7 占点时间线探测（`CaptureTimelineProbeTest`，默认排除；`docs/replay-capture-probe.md`）结论：事件流无占点时间线结构，CAPTURE_TIMELINE 不升级，维持结算级 + 静态语义。全量 `mvn -s settings.xml test` 全绿。
- **移除多文件 AI 复盘死代码（单文件策略确认）**：删除 `MULTI_SYSTEM_PROMPT` / `MULTI_TEAM_PROMPT`（含 md 资源）、`analyzeMulti`（Player/Team 三入口）、`MULTI_PLAYER_BATTLE` / `MULTI_TEAM_BATTLE` AI 分支、团队多视角分区合并（`TeamPartitionBuilder` / `TeamContextBuilder.buildMultiTeamContext` / `TeamAiPromptBuilder.multi` / `MultiTeamBattleAnalysisContext` / `TeamBattleAnalysisSummary` / `TeamRosterResolver` 多场 roster 阈值辅助）；`analyzeTeamGroups` 简化为逐 context 单队调用；`BatchAnalyzer` / `ReplayAnalysisMode` 保留（非 AI 批量端点仍支持多文件）。同步清理约 30 个多场/分区测试，全量 `mvn -s settings.xml test` 全绿。
- **AI 提示词拆分 md（行为不变）**：AI 提示词正文从 Java 文本块常量迁移到 `java/wotb-web/src/main/resources/prompts/*.zh.md`（单一事实源），新增 `AiPromptLibrary` 惰性加载/缓存（`classpath:/prompts/<key>.zh.md`，CRLF 归一化）；8 个 prompt 模板（player fallback/single/tactical、team single/autopsy、prebattle system/user-header/confidence-legend）字节级不变，EN/RU 本地化替换链不变；新增 `AiPromptLibraryTest` 回归门禁（全部 key 可加载 + tactical=fallback+harness 不变量 + 无文本块残留）。全量 `mvn -s settings.xml test` 全绿。
- **地图资源整理（统一命名 + 单一权威）**：`assets/maps/*.png` 全部按英文展示名小写中划线命名（15 个改名：`Normandy→normandy`、`Middleburg→middleburg`、`malinov→winter-malinovka`、`newbay→new-bay` 等；`alpen→horrorstadt` 补齐 lumber/山麓角逐 素材，28/29 图有素材，仅 `holmeisk`(Wasteland) 待补）；删除后端 `MapImageCatalog`（`MapOverview.image` 恒 null），`frontend/src/data/mapImages.js` 成为唯一素材权威；新增 `docs/map-catalog.md` 存档内部 code↔展示名(zh/en/ru)↔语义 mapId↔素材 映射与新增素材流程；DEVELOPER_GUIDE 素材约定同步；无素材样例改用 `holmeisk`。
- **地图鸟瞰标题三语化**：`MapOverview` 新增 `displayNames{zh,en,ru}`（`MapNames.localized`，来自 map_names.json，未收录时三语同 code），前端按 vue-i18n 当前 locale 显示标题（中文界面显示「黄沙荒漠」等中文名，缺失回退英文 `displayName`）；`map-catalog.md` 注明语义 JSON 手工调整后勿重跑语义化器（会整份覆盖）。

### Added
- **AI 复盘结果页「地图鸟瞰」（热力 + 路线，双阵营）**：后端 SSE `done` 载荷新增可空 `mapOverview`（`AnalyzeResponse` 第三字段，向后兼容 null）——`MapGridRegistry` 从 `map-semantics/*.semantic.json` 读取 `playableBoundsMeters` / `analysisGrid.cells`(6x6) / `sceneEvidence.battlePoints`(出生点)；`MapOverviewBuilder` 聚合：路线（双方 14 车，2s 均匀采样 ≤200 点 + `firstObservedSec/lastObservedSec` 观测区间 + 阵亡时刻，坐标与 playableBounds 同系 x=回放x、y=回放z）、六张热力（本方/敌方 × 驻留/伤害/阵亡，36 格；伤害按受击方位置落格、驻留/阵亡为事件计数，前端归一化）、阶段切片（开局/中期/残局，残局=战斗末 15s 窗口）、出生点；未知地图/无观测/无名册/视角未解析 → null。随机战（SINGLE_PLAYER）与团队战（SINGLE/MULTI_TEAM）路径均接入；`MapImageCatalog` 登记 17 张已提供素材的图片元信息（前端 mapImages.js 为渲染门控）。新增 `MapOverviewBuilderTest`（真实 rift 夹具完整输出 + 降级 null），后端全量 621 测试全绿。
- **前端「地图鸟瞰」区块**：`MapOverview.vue` 纯 SVG 渲染——底图拉伸铺满 playableBounds + 6x6 网格 + 九宫格线/编号 + 出生点；热力视图（阵营 Tab 本方/敌方 × 类型 Tab 驻留/伤害/阵亡，36 格半透明着色 + legend）；路线视图（阵营 Tab 本方/敌方/全部 × 阶段 Tab 全部/开局/中期/残局，本方暖色系/敌方冷色系各 7 色、起点圆点、阵亡 ✕、gap>5s 断线、悬停 tooltip、迟观测「位置观测自 X 秒起」提示）；`AnalysisResultPanel` 在 `done.mapOverview` 非 null 且 `mapImages` 有该地图素材时渲染可展开/收起区块（无素材整块跳过）。`frontend/src/assets/maps/` 入库 18 张素材（17 张已映射，alpen 待对应地图语义）。i18n 三语 key；vitest 169 全绿、vite build 通过。

### Changed
- **DI 注入方式收敛为构造器注入**：消除后端 9 处 `@Autowired` 字段注入（`MeterRegistry` / `ReplayUsageMetrics` 可选依赖），统一改造为构造器参数注入（参数级 `@Autowired(required = false)`）。改造范围：`AiReplayReviewService` / `AiReviewWorkerExecutor` / `PreBattleStrategicService` / `TacticalReviewHarness` / `TeamAutopsyService` / `TeamReplayAnalysisService` / `ReconstructionController` / `ReplayService`；`AiReplayAnalysisService` 测试包级构造器连动传 `null`。所有改造依赖字段升级为 `final`，便于单测直接 `new XxxService(mockDep)` 构造无需反射；行为零变更，`mvn -s settings.xml -pl wotb-web -am test` 618 用例全绿。`review-with-docs` skill 同步新增 DI 注入检查单（方法级 + 参数级 `@Autowired(required = false)` 改造优先级、不可变性、测试可构造等 5 项 sub-checks）。

### Fixed
- **AI 复盘切页后不再被 400s 预算中途掐断**：KeepAlive（v2.11.0）已保证切页不取消，但长复盘
  （团队 3 次 AI 调用）会撞整体 400s deadline 被 `AI_TIMEOUT` 杀掉；本次把全链路预算提到 1100s
  并对齐前端 / nginx / SseEmitter / 部署 env，切页做其他操作期间复盘可继续跑完并保留结果。
- **地图鸟瞰体积与九宫格标注调整**：`MapOverview.vue` 鸟瞰 SVG 宽度由 scoped CSS 控制——
  桌面/平板为容器 66.7%（约 2/3）并居中，`max-width: 768px`（手机端）恢复 100%；移除九宫格
  数字标注（region-label 文本、`--map-region-label` 与 mapPalette `regionLabel` 死代码一并清理），
  保留 region-line 分区框与 6×6 网格；新增「无 region-label、region-line=9、SVG 无内联宽度绑定」
  回归断言；versions 2.11.2。
- **地图鸟瞰渲染边界修正（图片坐标 vs 分析边界分离）**：`frontend/src/data/mapImages.js` 为全部
  28 张已登记地图增加 `coordinateBounds`（来源：对应 `map-semantics/*.semantic.json` 的
  `coordinateSystem.worldBounds`，当前均为 -300..300，逐图可校准）；`MapOverview.vue` 渲染统一改用
  `renderBounds = coordinateBounds ?? playableBounds` 换算路线/起点/阵亡标记/热力/分析网格，
  `playableBounds` 继续承担 6×6 分析网格、热力分桶与可玩区域判断——修复越靠近地图边缘偏移越大的问题
  （如 Molendijk `Spawn_1_02` 由 (110.6, 741.7) 校正至 (152.4, 693.7)）。新增 Molendijk 真实坐标
  校准、中心映射、右上出生点、无 coordinateBounds 兼容回退与路线/出生点/阵亡/网格同变换回归测试。
- **打手管理编辑回归与等级规则**：打手新增/编辑改为 `Teleport` 模态框，支持遮罩/Esc 关闭与焦点约束；编辑已有打手时关联用户只读且不再显示/提交 Keycloak UUID，PATCH 仅发送等级、资格状态、接单状态、联系方式、擅长及实际变更过的人工备注。资格申请审批不再把 `application_id`、账号 ID、档期、微信、自评等系统字段拼入 `booster_profile.description`；Flyway V14 只清理与旧自动模板精确相等的历史备注，保留人工修改内容。申请等级由四档扩为五档（新增 `MASTER`/大师级）；兼容内部值 `AVERAGE_GOD` 的“殿堂级”（英文 `Mythic`）仅允许管理员编辑已有打手时授予。`booster_profile` 新增由绑定资料/审批申请回填的 `wotb_server`，等级 CHECK + 应用预检 + 数据库部分唯一索引共同保证合法等级及每个区服最多一名殿堂级打手，`BoosterDto` 同步返回区服。
- **客户陪练需求支持四服**：客户需求 `BoostRegion` 现在接受 `CN / ASIA / EU / NA`，提交页从动态选项展示四服，客户/管理员/打手订单视图均显示需求区服。`BoostAssignmentDto` 新增 `region` 透传给打手工作台；参数化回归测试覆盖四服、大小写/空白规范化与未知区服拒绝，API 契约测试锁定四个选项值。`boost_request.region` 原本就是无 CN-only CHECK 的 `varchar`，无需数据库迁移。
- **打手资格申请支持四服**：`BoosterApplicationService` 现在接受并规范化 `CN / ASIA / EU / NA`，申请记录保存用户资料中的真实区服，不再拒绝 Wargaming 亚洲、欧洲、北美服玩家或把其区服误写为 `CN`；参数化回归测试覆盖四服与未知区服拒绝。
- **真实回放夹具进 CI（随机战斗样例）**：提交 `common/fixtures/replays/random-battle-example.wotbreplay`（rift 随机战，按用户指示原样提交、不脱敏）；`ParityTest` / `WebApiTest` 无条件加载提交夹具（gitignored `common/data` 仅本地扩展），新增 `ReplayParserFixtureTest` 断言名册/胜负/输出总量/幸存数等解析值；`.gitignore` 放开 `common/fixtures/replays/*.wotbreplay`。
- **定点重构（行为不变）**：R1 Replay archive 读取统一为 `ReplayArchiveReader`（`ReplayParser` / `ReplayReconstructionService` 复用，大小限制语义逐字节一致）；R2 时间格式规则复用 `ZH_TIME_RULE` 常量（消除 4 处内联字面量）；R3 观测伤害覆盖判定抽 `ObservedDamageCoverage`（Team / Player 共用）；R4 Team 分析 single/multi 的 evidence 限制与 first-result 记录收敛。
- **README / 首页叙事升级**：README（zh/en）重写——项目定位、mermaid 架构图、AI 证据链、8 条核心工程取舍；首页 hero 副标题三语更新。
- **AI 复盘 Call #2 流式修复（thinking 关闭 + 阶段事件 + 分块兜底）**：① Call #2 自由文本复盘默认关闭 thinking——新增独立配置 `AI_THINKING_ENABLED_CALL2`（`wotb.ai.call2-thinking-enabled`，默认 `false`），player/team/harness 三处 Call #2 请求统一使用（`AiReplayAnalysisConfig` 的 `thinkingEnabled` 更名为 `call2ThinkingEnabled`；`AI_THINKING_ENABLED` 保留为 legacy 键）；DeepSeek 推理模式下 content 末尾一次性到达、破坏 SSE 流式的问题由此修复；② 团队路径在 Call #2 前补发 `evidence_done` 阶段事件（`TeamReplayAnalysisService.analyzeTeamGroups`，与随机战 harness 对齐），前端阶段指示不再卡在「证据分析中…」；③ `SpringAiChatGateway` 新增超大 delta 分块兜底——单块 >512 字符时按句子边界切成 ≤128 字符片段、每片间隔 ~20ms 转发（上限 512 片，超长自动放大单片段），保证即使上游仍粗粒度也逐段出字；正常 token 流不引入延迟。新增回归测试：Call #2 默认 thinking=false / 开启时透传、团队 evidence_done 发射、`splitChunks` 边界与片数上限、大 delta 分片转发。
- **AI 复盘未知阵亡时间不再渲染成 `0分00秒`（PR #56 修复）**：`PlayerAnalysisTerms` 新增 `knownDeathClock`（deathSec<=0 → 「未知」），`survivalDisplay` 复用；团队 DEATH_TIMELINE、随机战死亡时间线、Autopsy 死亡时间线、opposing lineup、member facts、团队聚合首/末阵亡与随机战 KeyEvent 死亡标签统一语义——未知时刻输出「未知 … 阵亡（时刻未知）」，且未知玩家排序到已知时间之后（不再因 deathSec=0 被排到最前）。`BattlePhaseSummary.deathSourceLabel` 修正为真实语义：全部 deathTimeMillis>0 → 权威结算；结算缺失但事件流估出（deathSec>0）→ 事件流估算；存在 deathSec<=0 → 未知。新增回归测试（`TeamAiPromptBuilderTest` / `BattlePhaseSurvivalTest` / `PlayerSecondPersonAndPerHitDamageTest` / `TeamAutopsyPromptBuilderTest`）。
- **PreBattle AREA 三语泄漏修复（PR #56 修复）**：`PreBattleSectionRenderer.mapAreaNames` 接入 `AllowedLanguage`——ZH 保留 semantic 中文 label（东侧高地区域（3/5/6/9区））；EN/RU 不再泄漏中文 label 与 raw AREA ID，输出通用区域名 + 九宫格编号（`Regions 3/5/6/9` / `Области 3/5/6/9`），无编号时用 `Area` / `Область`。新增 EN/RU 回归测试。
- **AI 复盘/赛前预测质量收敛（反馈 13 项闭环）**：① 阶段时间线行明确「至阶段末」存活人数并输出 `DEATH_SOURCE`（权威结算 vs 事件流估算，`BattlePhaseSummary.deathSourceLabel`），prompt 注入双方逐车阵亡时间线（`DEATH_TIMELINE`，团队 + 随机战），system prompt 禁止把阶段末人数误读为「某时刻前全灭」；② 团队 prompt 证据数据不再输出裸秒（`deathTimeSec=`/`averageDeathTimeSec=` 等改为 `X分XX秒`），对方阵容逐车补充阵亡时刻；③ 事件流观测子集在覆盖未达 100% 时抑制数字（`OBSERVED_DAMAGE_IS_PARTIAL` 改为条件触发：观测=权威时自动消失），随机战交火段同步抑制「观测输出子集 + 百分比」，强制以权威结算为唯一可信口径；④ 赛前预测用户可见渲染覆盖 TEAM 变体（A队/B队/A 队/队伍1 等）、AREA ID → 中文名 + 九宫格编号（复用 `map-semantics` 语义库）、composition 键值三语翻译；⑤ 团队剖析段「主要战犯/MVP」标题与玩家名 ** 加粗、移除用户可见「限制:」段；⑥ `AnalyzeResponse.analysis` 统一追加三语免责结尾（AI复盘仅供参考）；⑦ 新增公共证据逻辑规则 `COMMON_EVIDENCE_LOGIC_RULE`（ZH/EN/RU）：禁止「被击毁=承受满血伤害=集火彻底」同义反复、禁止机器标签直出（CLAMPED/VALID/离散度/质心等）、标题必须 `## ` 带空格独占一行；⑧ 前端 `MarkdownContent` 标题归一化（`^(#{1,6})(?!#|\s)` 补空格，跳过围栏代码块，抽离 `utils/markdownHeadingNormalize.js`），修复 `##一、` 字面输出。
- **SSE worker 生产化加固（12 项 hardening）**：`/api/replay/analyze` 的 SSE 异步执行（`AiReviewWorkerExecutor`）由无界同步派发收敛为**有界 worker 池**——默认 4 concurrent workers + 4 queued（最多 8 active/pending），第 9 个请求被立即拒绝并返回 `503 AI_REVIEW_BUSY`（新增稳定错误码 `AiReviewBusyException` → `@ExceptionHandler`），不再阻塞 servlet request 线程排队。容量经环境变量 `AI_REVIEW_WORKER_MAX_CONCURRENT` / `AI_REVIEW_WORKER_QUEUE_CAPACITY` 可调（无需 rebuild）。拒绝策略固定为 `ThreadPoolExecutor.AbortPolicy`——绝不使用 `CallerRunsPolicy`（会让 request 线程同步执行整段 AI 复盘，重新引入 SSE blocking bug）。**HTTP request-envelope 校验前置**：`files` 为空 / 文件超 `MAX_FILES` / 类型/大小非法等请求在提交 worker 前就抛 `IllegalArgumentException` / `ReplayFileCountExceededException` → `@ExceptionHandler` 映射 **HTTP 400 结构化错误码**，不再进入 SSE 流后再以 `error` 事件传达。**queued cancellation 检查**：任务在队列中等待期间被取消（客户端断开 / cancel 端点）后获取 worker 时直接 `complete()` 并清理，不调回放解析、不调 AI Gateway、不向已断开的连接写入。**emitter 生命周期回调**：`onTimeout` / `onError`（客户端断开）只翻 cancellation token、不主动 complete（连接错误由 Servlet async lifecycle 终止 emitter，worker `finally` 清理 `AiRequestContext` 与 registry），与显式 cancel 端点幂等（token 为 CAS 一次性翻转，重复触发无副作用），避免为无人等待的请求继续计费。**随机战 team label 修复**：`PreBattleSectionRenderer.renderRandomBattle` 不再把录像者 nickname 附加为「友军（Player123）画像」——只显示「友军画像/敌军画像」；团队复盘继续保留真实 clan/team label（走 `render(...)` 路径）。新增饱和回归测试 `AiReviewWorkerSaturationTest`（workers+queue 满 → 503 / 不在 caller 线程执行 / registry 不泄漏；queued cancellation 不调 `analyzeStreaming`）。
- **AI 复盘伤害语义区分（损失血量 vs 格挡伤害）**：AI 提示词把 damageReceived 统一改称「损失血量」（不再叫「承伤」），并新增共用伤害语义规则（`COMMON_DAMAGE_SEMANTICS_RULE`，ZH/EN/RU 三语）：格挡伤害（damageBlocked）越高越好；损失血量本身中性，好坏取决于车型职责与场景——重坦/装甲车抗线掉血可接受，薄皮输出车无价值掉血或过早阵亡前大量掉血才是问题；评价玩家不得仅因损失血量高判定表现差。覆盖个人复盘（fallback/harness/多场）、团队复盘与 Team Autopsy（战犯证据类别同步改写为「损失血量明显偏高且与车型职责/存活时长/输出不匹配」）；数据行、事件流摘要与换血证据标签统一为「损失血量」。
- **AI 结构化 JSON 调用空响应修复（thinking 关闭）**：生产实测 `PRE_BATTLE_STRATEGIC_PRIOR`（Call #1）与 `TEAM_AUTOPSY` 在 `AI_THINKING_ENABLED=true` + `AI_REASONING_EFFORT=max` 下全部返回空正文（`AI_EMPTY_RESPONSE`）——DeepSeek 把整个输出预算（Call #1 4096 / Autopsy 2048）消耗在 reasoning 上，`finish_reason=length` 且 content 为空；导致随机战 Call #1 一直静默降级旧路径、训练房/联赛判负不输出战犯名单。修复：两个结构化 JSON 调用在 `AiChatRequest` 层强制 `thinkingEnabled=false`（`reasoningEffort=null`）；线上复现验证关闭后 `finish_reason=stop` 直接输出契约 JSON（Autopsy 实测 1421 字符、568 completion tokens）。新增断言测试：TEAM_AUTOPSY 与 Call #1 请求均关闭 thinking。
- **WG 登录后 Profile 同步链修复**：`PUT /api/users/wotb-account/from-login` 在 Profile 不存在时原子创建 WARGAMING Profile、空 Profile 升级为 WARGAMING、已绑定 MANUAL 返回 409 冲突；`PATCH/DELETE` 在 JWT 明确为 WG 身份时即使数据库仍未同步也返回 `WARGAMING_PROFILE_READONLY`（杜绝同步异常窗口内手动绑定）；`wotb_verified` 兼容 boolean 与字符串 `"true"`；后端对 WoTB 账号拒绝类错误码输出安全 WARN 诊断（仅错误码）。前端：WG 登录按 JWT claims 判定只读（`isWargamingLogin`），同步失败不再静默——显示「同步失败 + 重试」且绝不显示手动设置/编辑/解绑入口。
- **Wargaming 登录回调失败修复（prolongate payload 兼容 + 安全 stage 诊断）**：prolongate 成功响应兼容 `data` payload 与旧根节点 payload（优先 `data`），修复生产环境登录成功但回调被拒的问题；`WargamingEndpoint` 失败日志升级为 WARN 并包含安全 `stage`（prolongate / account-info / callback-* / identity-callback），仍不记录 token、application_id、state 或完整响应。
- **Wargaming 登录生产故障修复（认证 Host 分离）**：认证接口（login/prolongate/logout）改用 `api.worldoftanks.{asia|eu|com}/wot/auth/`（生产实测 `api.wotblitz.*` 不提供 `/wot/auth/*`，真实返回 `METHOD_NOT_FOUND`）；WoT Blitz 账号接口（account/info）仍走 `api.wotblitz.{asia|eu|com}/wotb/account/`。登录成功响应改为从 `data.location` 读取；WG `status=error` 时抛安全错误信息（code/message/field，不含 error.value / token / 完整响应），`performLogin` 捕获初始化异常返回安全错误响应，不再让用户只看到 generic unexpected error。三个 IdP 实例无需删除重建，仅重新构建 Keycloak 镜像。

### Refactored
- **工程健康度收敛（A/B 纯拆分，行为不变；C/D/E 为生产加固，见下方 Added）**：A1 `PlayerReplayPromptBuilder`（1400 行 → 门面 + 3 协作类）拆分出 `PlayerPromptRules`（规则/多语言/system prompt）、`PlayerEvidenceFormatter`（证据渲染）、`PlayerSummaryBuilder`（prepare* 编排与摘要）；A2 `DefaultTeamBattleFeatureExtractor` 拆分出 `TeamAggregateExtractor` / `TeamEngagementExtractor` / `TeamFormationExtractor` / `TeamKeyEventsExtractor`；A3 `TeamReplayAnalysisService` 拆分出 `TeamRosterResolver` / `TeamPartitionBuilder` / `TeamPromptLocalizer` / `TeamContextBuilder`；A4 `deploy.yml`（611→316 行）拆分出 `deploy/docker-compose.prod.yml`（GitHub 表达式→compose 环境变量插值）与 `deploy/deploy.sh`（secrets/vars 由 workflow `envs` 透传，等价命令，需一次生产部署验证）；B1 `TeamAiPromptBuilder` 拆分出 `TeamEvidenceFormatter`（含 BudgetWriter）；B2 `SingleReplayPromptPlanner` 拆分出 `PlannerLevelEvidence`（LEVEL 2~5 证据生成）；B3 `EventStreamReader` 拆分出 `ReplayPacketParser` / `ReplayEventExtractors` / `DeathTimeEstimator`；B4 抽取共享 `ReplayUploadValidator`（Controller 三个端点与 `AiReplayReviewService` 复用，错误码一致）。各拆分点原类保留编排入口/测试 forwarder；新增契约与单测覆盖，后端全量回归 + 前端 162 测试 + build 全绿。
- **AI 复盘 analyze 端点改为 SSE 流式（breaking change）**：`POST /api/replay/analyze` 由同步 JSON 响应改为 `text/event-stream`（旧同步端点不保留），阶段事件 + 主复盘 token 逐段实时到达。SSE 协议（自定 JSON event，`data` 为 JSON）：`call1_start` / `call1_done`（Call #1 赛前战略基线开始/结束，真实发起调用时必发，无论成败）、`evidence_done`（后端证据分析完成）、`call2_token`（主复盘 token 增量，`{"delta":"..."}`）、`autopsy_start` / `autopsy_done`（Team Autopsy 开始/结束）、`done`（全部完成，`{"analysis":"...","preBattleSection":"..."}` 双字段载荷）、`error`（流中途失败，`{"code":"AI_..."}` 稳定错误码）。异常传达规则：request-envelope 校验（locale/文件数/类型/大小/总量）与 worker 池饱和在返回 `SseEmitter` 前由 `@ExceptionHandler` 映射 HTTP 400 / 503；worker 启动后的失败经 `error` 事件传达。`AiChatGateway` 新增 `stream(request, consumer)`（Spring AI `ChatModel.stream`，单次尝试不流内重试，总预算 watchdog 与 `correlationId` cancel 语义保留——`AI_TIMEOUT`/`AI_CANCELLED` 与同步路径一致）；`ReplaySseWriter` 负责事件序列化，SSE 超时对齐 nginx 420s；同步路径委托流式实现（NOOP listener），校验/指标/异常语义不变。前端 `ReconstructionPage` 改用 fetch `ReadableStream` 解析 SSE（阶段状态 + token 滚动预览），`AnalysisResultPanel` 保持消费 `done` 载荷。nginx `/api/replay/analyze` location 新增 `proxy_buffering off` + `X-Accel-Buffering: no` + HTTP/1.1 + 清空 `Connection` 头（chunked 流式反代必需），`proxy_read/send_timeout` 420s 保留。
- **团队复盘输出质量收敛（AI 复盘 7 条反馈）**：① Call #1 输入新增双方总血量（tankopedia maxHp 求和）与单车血量，`preferredPlans` 契约要求分阶段（开局/中期/残局）输出；② Call #2 改为"战局类型识别（常规/一波流/蹲坑等）+ 预期 vs 实际对照"，移除逐条 CONFIRMED/NOT_OBSERVABLE 强制判定（TEAM_PRIOR_RULE 三语同步）；③ 后端新增"阵亡时刻与主力质心距离"特征（`TeamMemberFeatureSet.DeathProximity`，OBSERVED 位置 + 观测时间差 + 置信度，无 OBSERVED 不硬算），Prompt 强制用 canonical 距离判断脱节、禁止用九宫格编号差推断距离（TEAM_REGION_RULE 三语）；④ 输出删除"数据限制"章节，开局分路改为从首次显著分路（约 30s 后）描述、出生点同区不得当结论；⑤ 胜负用实际队名（TeamPerspectiveLabelResolver，如 CHRD）替代 TEAM_A/B 机器标签，Team Autopsy 枚举渲染中文化（HIGH→高、PARTIAL→部分等，MVP 保留英文），JSON 契约保持英文枚举不变。
- **每张地图独立坐标 profile（九宫格校准）**：`MapCoordinateProfile` 新增 `centerX/centerZ` 中心偏移；新增 `MapCoordinateProfileRegistry` 从 `map-semantics/*.semantic.json` 的 `playableBoundsMeters` 推导每图 profile（外接可玩区半边长 + 中心偏移，未知地图回退默认 ±250），替换统一 ±250 假设——himmelsdorf、karieri、forgecity 等不对称地图不再裁掉边角。`MapRegionResolver` 新增按 mapCode 的重载（`resolve/resolveRegionFromRaw/canonicalDistanceMeters`），全部消费方（Player/Team feature extractor、RouteSkill、NearbySupportCounter、SingleReplayPromptPlanner、Player/Team prompt builders）接入。九宫格切分与语义化器 `analysisGrid.cells.nineGridRegion` 全量自洽（新增 `MapCoordinateProfileRegistryTest`：33 张图 profile 覆盖可玩区 + 全部 analysisGrid cell region 一致 + area.gridRegions 与 cells 一致）。
- **地图语义数据修正（回放验证发现）**：新增手动校准探针 `MapCoordinateCalibrationProbeTest`（`-Dprobe.replays=` 批量，不进 CI）——用回放开局位置对照 semantic spawnpoint 验证坐标轴映射与边界。修正 neptune `spawnpoint` 的 team 标签 1↔2（回放实证与 malinovka 相反）；修正 himmelsdorf `analysisGrid` 第 5 列 6 个 cell 的 `nineGridRegion`（8→9、5→6、2→3）并同步 area `gridRegions`。
- **回放解析覆盖率可观测**：AI 复盘入口（`AiReplayReviewService`）对每个回放输出 `Replay event-stream parsed` 日志（file / map / packets / decoded / partial / unknown / failed / decodedRatio），可在 Loki 按回放查看事件流解码覆盖率。真实样本实测 `decodedRatio ≈ 0.31–0.35`（完全解码），`unknown ≈ 37–40%`：type 39（1.6–2.7 万包）、type 31（1800–5300）、type 35（1400–2300）、type 7（1.5–2.4 万属性包，propId→血量映射待逆向）为主要缺口桶，后续逆向按此清单推进。
- **AI 复盘可观测性（Call #1 覆盖日志）**：新增结构化日志——`Pre-battle Call #1 input`（地图名、地图语义 found/UNKNOWN、verified、areas/relationships/spawnSemantics 数量、source、displayName、双方人数、curated/fallback 车辆战术 Profile 覆盖）、`Pre-battle Call #1 success`（hypotheses/matchups/winConditions/双方 strengths·plans 数量）、`Harness prior obtained`（确认 prior 注入 Call #2）、`Harness fell back to old path: <reason>`、`Team autopsy success`（liabilities/mvps 数量）；新增指标 `wotb_ai_review_map_semantics_total{status=found|unknown}`。生产实测（thinking 修复部署后）`PRE_BATTLE_STRATEGIC_PRIOR` 已正常执行（reasoning_tokens=0、completion 正常），现在可按 requestId 在 Loki 逐请求验证地图语义与车辆语义是否进入 Call #1 并注入 Call #2。
- **PR #54 第三轮 review 修复（3 项 Evidence correctness）**：① Call #2 Prompt 不再输出 raw momentumSeries（逐采样点可观察 HP 差的观察集合可能不同，unspot 会伪装成 HP momentum），只输出 `HpMomentumSkill.detect()` 安全比较后的 HP_MOMENTUM 证据；② HP before/after/swing/coverage/commonEntityCount 必须来自同一 comparison cohort——HpMomentum 合并窗口取 hpSwing 最大的单个代表候选，CriticalWindow 取 hpSwing 最大的代表 HP signal，禁止跨 cohort 拼接（新增 cross-cohort 回归测试，杜绝 5000 swing 假信号）；③ RouteSkill 敌方人数优势要求友军侧完整覆盖（observedEnemy 作为真实敌军下界，observedEnemy ≥ 精确友军 + 2 才能断言），友军 partial 时禁止生成 enemy-majority 证据。
- **PR #54 第二轮 review 修复（3 项）**：① Call #2 user prompt 顺序修正——TASK 移到 Prompt 最尾部（BATTLE SNAPSHOT → PRE-BATTLE STRATEGIC PRIOR → TOP PIVOTAL WINDOWS → BATTLE PHASE SUMMARY → TACTICAL EVIDENCE → CRITICAL DECISION WINDOWS → TASK），任意预算下 TASK 都是最后一个业务 section，Snapshot / Prior / TASK 永不被裁剪；② HpMomentumSkill 支持 confirmed DESTROYED 的 lethal HP loss——`LifeState.DESTROYED` 按 0 HP 计入（可靠终态），普通 unspot / STALE / 非 confirmed REMOVED 仍不当作 damage，共同实体改为交集口径（消失实体不贡献、不跳过整窗）；③ NearbySupportCounter denominator 改为当前时刻存活名单（复用 `PlayerResultFormat.deathSec`），阵亡车辆不再永久污染 observation coverage，存活敌军全部被观察时可重新得到 `enemyFullyObserved=true` / EXACT。
- **Tactical Profile 十级全覆盖**：`common/tank_tactical_profiles.json` 由 24 辆扩展到全部 84 辆十级车（车种基线 + alpha/hp 数据驱动微调 + 手工微调，保留 Blitz 语义、无 PC WoT/SPG 标签）；新增回归测试断言 tankopedia-tier10 每辆车都有 curated profile。
- **AI Review Harness V1 blocker 修复（PR #54 review）**：新增 Map Tactical Semantics 层（`MapTacticalSemanticsRegistry` + `common/map_tactical_semantics.json` 空语义库；V1 所有地图明确 UNKNOWN、禁止编造区域语义，待真实数据源填充）；双 Call End-to-End 预算（`AiChatRequest.callTimeoutSec` stage budget：Call #1 45s、Call #2 用剩余预算并留安全余量、Call #1 失败后剩余不足时不启动旧路径 fallback，总 deadline = `AI_CALL_TIMEOUT_SEC`）；HpMomentum 改为共同观察实体口径（unspot/STALE 不伪造 HP swing，Prompt 区分观察子集与权威结算）；NearbySupportCounter observed 语义（两侧完整覆盖才 EXACT、敌军数量表达为"至少观察到 N"、隐藏/点亮不制造 local flip）；tank_tactical_profiles.json 清洗 PC WoT/SPG 标签（artillery_magnet / gold_dependent / hull_down_immunity / absolute_frontline）；CriticalWindow HP 聚合取最早 before / 最晚 after。
- **计划文件统一（`docs/current-plan.md`）**：`docs/current-plan.md` 成为当前开发计划唯一载体（本地文件，不入库）；`grill-me` 的需求确认单与 `grill-with-docs` 的开发方案单均写入该文件（与 k3-planner 计划格式兼容）；`review-with-docs` 文档检查清单新增「current-plan 计划文件同步」项；`.agents/AGENTS.md` 的 Phase 1 输出 plan 与 Phase 4 报告均要求更新该文件；本地 `.opencode/agents` 工作流配置（不入库）路径引用统一为 `docs/current-plan.md`。
- **审查技能改名 + 需求 grill 技能新增**：`grill-fix` → `review-fix`、`grill-with-docs` → `review-with-docs`（职责不变：代码变更后审查闭环、文档同步 + 死代码清理）；新增 `grill-me`（开发前需求澄清：目标/范围/非目标/验收标准/假设，逐层提问每轮 ≤3 个，输出《需求确认单》）与 `grill-with-docs`（开发前结合文档与代码的实现角度 grill：可落地性/影响面/分步方案/验收路径，输出《开发方案单》）；`.agents/AGENTS.md` 改动流程新增 Phase 1 需求 grill 步骤并同步全部交叉引用。
- **环境配置清理（第六轮 / 收尾扫描）**：`application.yml` 全部 30 个环境变量确认有消费者（0 未用）；`theme.css` 71 个 CSS 变量 0 未用。`common/assets/goldenShit.jpg` 曾因运行时零引用被误删，实为评分「倒数」金便便标记 `frontend/src/assets/poop.png` 的源图（`296edf3` 去黑底派生），已恢复保留。
- **后端 AI 死代码清理（第五轮 / 收尾扫描）**：删除 `AiPromptBudgetGuard.enforceMessages`（零调用公有方法）及未用 import；扩展私有方法零引用扫描至 Keycloak provider 模块（0 命中）；实体 getter / `@Scheduled` / 事务回调经框架引用确认保留。
- **前端 i18n 死 key 清理**：删除三语 locale 中全仓（含测试）零引用的 34 个静态孤儿 key（`admin.unknownError`、`app.back/homepage/logout/unknownUser`、`home.apiDesc/apiTitle/planned/statsCard*`、`leaderboard.back/upload_failed`、`profile.*` 23 个残留 key）；动态家族（`api_errors.*`、`player_labels.*`、`recon.errors.*`、`boost.*`、`contact.*`、`version.*` 等）经逐一确认保留。前端 141 测试 + build 通过。
- **后端 AI 死代码清理（第四轮 / 死接口删除）**：删除全仓零引用的单实现接口 `ReplayProcessingService`、`PlayerBattleFeatureExtractor`、`TeamBattleFeatureExtractor`（除声明与自身 `implements` 外无任何类型引用），Default 实现直接作为类使用并去掉 `@Override`；`AiChatGateway`/`AiTokenEstimator` 因有多个测试替身实现保留（合法测试性抽象）。`docs/replay-data.md` 目录树同步。
- **后端 AI 死代码清理（第三轮 / AnalyzeResponse 收窄）**：`/api/replay/analyze` 响应由 16 字段收窄为仅 `{ analysis }`——前端只消费 `analysis`，其余统计/诊断字段（计数、`files`、`analyses`、`keyEvents`、`limitations`）全仓零读取，属提前性载荷。级联删除：`AnalyzeResult`/`TeamAnalyzeResult`/`PreparedAiPrompt` 的未读字段、`AiReplayReviewService` 的文件状态/统计机制（`buildFileStatuses`/`countFailed`/`ReplayUploadResult`）、`TeamReplayAnalysisService` 的 per-unit 结果/限制簿记（`buildTeamAnalysisUnits` 等）、`AnalysisUnitAssembler.buildAnalysisUnits`；保留 prompt 构建内部的限制/截断逻辑（`TeamAiPromptBuilderTest` 覆盖）；连带删除 13 个只测响应单元的测试与前端 fixtures/i18n 相关清理，文档同步。
- **后端 AI 死代码清理（第二轮）**：删除 `TeamAiPromptBuilder.estimateTokens`（全仓零引用私有方法）；深度扫描确认 fallow 无真实前端死代码（仅平台 optionalDependencies 误报）、AI facade 公有方法/api-boost 导出/其余私有方法均无死代码。
- **后端 AI 死代码清理（按 grill-with-docs 第 7 项执行）**：删除 `AiChatRequest`/`AiChatResponse` 的 `metadata` 字段（生产构造恒为 `null`、全仓零读取，仅一处测试断言 correlationId 透传）与 `AttemptBudgetContext()` 无参构造（零引用），连带清理对应测试断言与未用 import；行为无变化，全量后端测试通过。
- **grill-with-docs 增加 AI 死代码清理**：`grill-with-docs` 技能在 grill-fix 与文档同步之间新增第 7 项「AI 死代码/提前性代码清理」——针对 AI 生成代码的单实现抽象、从不覆盖的字段/参数、占位空壳等提前性死代码，执行「识别 → 全仓零引用证明 → 三分类（真死/假死/待定）→ 安全删除 → 全量验证」闭环；假死代码安全边界（API 契约/反射/metrics/i18n/DB）写入检查单，品味判断引用 `code-smell` 技能。
- **API URL 常量化**：新增 `ApiPaths` 常量类（`wotb-web/.../config/ApiPaths.java`）作为 API 路径单一来源，`SecurityConfig` 的全部请求匹配器与各 Controller 的映射注解共用；端点路径字面量不再在两处硬编码，URL 变更只需改一处。纯重构，对外 API 与行为不变。
- **前端依赖安装统一为 `npm ci`**：deploy workflow 与 `java/README` 由 `npm install` 改为 `npm ci`（按 `package-lock.json` 精确安装、先清空 node_modules），与 CI（`ci.yml`）和 `Dockerfile.frontend` 保持一致。
- **主 README 精简为 brief 文档索引**：README.md / README.en-US.md 收敛为项目简介 + 文档入口 + 快速开始指针；运行/构建、备份、目录结构与数据格式细节统一指向 `DEVELOPER_GUIDE`、`java/README`、`replay-data`、`observability` 等文档，不再在 README 重复。
- **OkHttp watchdog 生命周期修复（AI_CALL_TIMEOUT_SEC 覆盖响应体读取/解析）**：attempt 级 `AttemptBudgetContext` 收敛 Call 引用与过期标记；okhttp interceptor 不再提前清除 Call，看门狗可覆盖连接→请求发送→等待响应→响应体读取→SDK JSON 反序列化→Spring AI response 创建全过程；处理 watchdog 先于 interceptor 触发（设置 Call 后复检并立即取消）；成功返回前再次检查总 deadline，超时后绝不返回 success、不记录 success/token 指标，统一返回稳定 `AI_TIMEOUT`。watchdog executor 使用 `ScheduledThreadPoolExecutor.setRemoveOnCancelPolicy(true)` + daemon + `@PreDestroy` 关闭。新增真实 HTTP 慢响应取消测试（原生 ServerSocket drip，模型 read timeout 60s、gateway 总预算 5s，仅看门狗能停）、watchdog 先于 interceptor 竞态测试（hook 确定性触发）、fake-clock 响应完成但 deadline 已过测试。
- **AI 总调用超时边界（AI_CALL_TIMEOUT_SEC 语义修正）**：`AI_CALL_TIMEOUT_SEC` 现在覆盖一次 `AiChatGateway.chat()` 的整个生命周期（首次请求 + 全部 retry + 全部 backoff + 响应解析），不再只是单次 HTTP request 的 timeout。实现：单调时钟（`System.nanoTime`）计算总 deadline；每轮尝试前检查剩余预算，不足时不再发起请求并返回稳定 `AI_TIMEOUT`；backoff 受剩余预算限制；in-flight 请求在预算耗尽时通过 okhttp interceptor + 看门狗中止（单轮实际上限 = `min(AI_TIMEOUT_SEC, 剩余预算)`）。retry 语义不变（429/网络/部分 5xx 可重试；认证/权限/invalid request/model not found/context too large/空或无效 completion 不重试）。新增 `SpringAiChatGatewayDeadlineTest`（fake clock/sleeper，8 个测试覆盖 Review 要求的 10 个检查点）。
- **Timeout / Retry / 脱敏 / AI Observability 加固（Spring AI 迁移阶段四）**：timeout 与 retry 收敛为单一配置来源（`wotb.ai.*` 环境变量）。显式四段超时：`AI_CONNECT_TIMEOUT_SEC`（connect）、`AI_TIMEOUT_SEC`（read/response，默认 300 不变）、`AI_CALL_TIMEOUT_SEC`（单次调用总边界，默认 315，必须 ≥ connect+read）、write 显式取 read 值；经官方 `OpenAiHttpClientBuilderCustomizer` 写入 SDK `Timeout`，不再依赖框架默认值。单层 retry：`AI_RETRY_MAX_ATTEMPTS`（默认 3）、`AI_RETRY_INITIAL_BACKOFF_MS`（1000）、`AI_RETRY_MAX_BACKOFF_MS`（8000）、`AI_RETRY_BACKOFF_MULTIPLIER`（2.0）；SDK `maxRetries` 固定 0，杜绝 retry×retry。可重试：429 / 连接失败与超时 / 500/502/503/504；不重试：认证、权限、invalid request、model not found、context too large、空/无效 completion（避免重复付费）。集中脱敏 `AiSecretRedactor`（Authorization/Bearer、api-key/api_key/apiKey/apikey、token/secret/password/client_secret、query parameter、嵌套 JSON、异常消息，大小写不敏感）接入 gateway 日志路径。Observability 保留原 `wotb_ai_upstream_*` 三个指标（requests 按 attempt、errors 按最终失败、duration 含重试），新增低基数指标：`success_total`、`retries_total`、`retry_outcome_total{mode,outcome}`、`tokens_total{mode,token_type}`；禁止高基数 tag（昵称/account/file/correlation ID/Prompt/Completion/错误正文）；Spring AI Observation 使用 NOOP，Prompt/Completion 默认不记录。
- **Spring AI Provider transport 迁移（Spring AI 迁移阶段三）**：删除临时 `DeepSeekRestAiChatGateway`、手写 `RestClient`、Provider 请求 map / 响应 DTO 与手工 HTTP 解析；生产路径唯一 adapter 为 `SpringAiChatGateway`（Spring AI 2.0.0 + 官方 OpenAI-compatible adapter，连接 `https://api.deepseek.com`）。模型/温度/max tokens 使用一等 options；`thinking:{type}` 与 `reasoning_effort` 通过官方 `extraBody` 机制原样传递（2.0.0 DeepSeek Starter 的 `DeepSeekChatOptions` 无这两个字段，已逐字节核对 jar）。异常映射（认证/限流/超时/连接/4xx/5xx/context too large/空响应/无效响应/未知错误）、`wotb_ai_upstream_*` 指标、`AI_NOT_CONFIGURED` 无 key 启动语义与前端错误码契约不变。`AiGatewayConfig` 自建 `OpenAiChatModel`（无 key 时不建 client）；application.yml 排除 OpenAI auto-config 保证无 key 启动。测试替换为 mock `ChatModel` 的 `SpringAiChatGatewayTest`/`SpringAiChatGatewayMetricsTest`，禁止真实 DeepSeek 调用。Spring AI BOM 2.0.0 引入父 POM dependencyManagement，`wotb-web` 仅增加 `spring-ai-starter-model-openai`。
- **拆分 Player/Team 业务编排（Spring AI 迁移阶段二）**：`AiReplayAnalysisService` 由 2000+ 行压缩为约 120 行薄兼容 facade，仅注入并委托 `PlayerReplayAnalysisService`/`TeamReplayAnalysisService`，不再构建 Prompt、不发送 HTTP、不处理 Provider DTO。Player 单场/fallback/multi 编排、Prompt Builder 调用与 `AnalyzeResult` 组装进入 `PlayerReplayAnalysisService`；single/multi team 分区（complete-link）、perspective 隔离、roster 一致性、team limitations 与每个 analysis unit 的处理进入 `TeamReplayAnalysisService`。Token/上下文预算收敛为唯一实现 `AiPromptBudgetGuard`（`PlayerReplayPromptBuilder` 内部重复判断已删除并统一委托）；`analysisUnitId` 映射、`AnalysisUnitResult` 计数与 `findRecorder` 收敛为 `AnalysisUnitAssembler`；Player/Team 共享预算与模型选项由 `AiReplayAnalysisConfig` 装配。Controller/API、请求响应结构、异常语义、Prompt 文案与错误码不变；新增 `AiReplayAnalysisServiceFacadeTest` 校验纯委托行为。
- **AI Provider 调用边界隔离（Spring AI 迁移阶段一）**：新增项目内部 `AiChatGateway` 接口、供应商无关 `AiChatRequest`/`AiChatResponse` 模型与临时 `DeepSeekRestAiChatGateway` 适配器。`AiReplayAnalysisService` 不再持有 `RestClient`、不再处理 Authorization、不再定义 Provider 响应 DTO、不再构建 DeepSeek 请求体；生产环境唯一 AI HTTP 入口收敛到 Gateway。HTTP 错误分类、`safeProviderSummary` 脱敏、token usage、上游调用耗时/成功/失败指标、`correlationId` 生成全部移入 Gateway；稳定错误码与 `AiUpstreamException` 语义、前端 HTTP 契约不变。`AiUpstreamException` 新增 cause 构造器以保留 stack trace。
- **提取 Player Replay Prompt 与证据构建**：新增 `PlayerReplayPromptBuilder` 与 `PreparedAiPrompt` 记录，承接 Player system prompt、common/player 规则常量、单回放完整特征与 fallback user content、多场趋势摘要、对炮/击杀归因/死亡时间线/区域时间线/交火/阶段/关键事件/限制拼装，并内部完成 token 预算密度裁剪（`SingleReplayPromptPlanner`）。`AiReplayAnalysisService` 仅保留业务编排：接收上下文 → 调用 Builder → 在 `call()` 中做 token budget 检查 → 调 `AiChatGateway` → 返回 `AnalyzeResult`。Prompt 文案、friendly/enemy 解析、`你` 第二人称契约、时间格式、注入边界与证据语义全部不变。
- **AI Replay 测试重构**：`AiReplayAnalysisServiceTest` 由本地 HttpServer 切换为 `FakeAiChatGateway` 契约断言；HTTP/脱敏/metrics 测试移入 `gateway` 子包新增的 `DeepSeekRestAiChatGatewayTest`/`DeepSeekRestAiChatGatewayMetricsTest`；新增 `PlayerGatewayPromptContractTest` 捕获 `AiChatRequest` 的 system/user/model/analysisMode。

### Added
- **公开回放接口 nginx 限流（C）**：`/api/preview` `/api/export` `/api/rating` 应用 `limit_req`（单 IP 1r/s + burst 10 nodelay）与 `limit_conn`（单 IP 并发 5），超频 429 / 超并发 503；仅 nginx 层，后端 100 文件/20MiB/200MiB 额度契约不变（`nginx -t` 校验通过）。
- **AI 取消 correlationId 加固（D）**：`AiCancellationRegistry` 仅接受 canonical UUID（格式+长度），重复活跃 id 拒绝（不复用 token），`unregister(id, token)` 改为 compare-and-remove；analyze 与 cancel 端点校验客户端 correlationId 为 UUID，非法/重复返回 400。
- **AI Review 整体 deadline 对齐（E）**：请求提交时刻计算 `now + overall-deadline-sec`（`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC`，默认 400s，对齐前端 400s / nginx 420s），经 `AiRequestContext` 暴露给 worker；团队与随机战预算起点回溯到提交时刻（排队计入预算），启动时预算耗尽直接干净失败 `AI_TIMEOUT`；排队等待记日志与 Micrometer timer（`wotb_ai_review_queue_wait`）。
- **敌方最后已知位置特征（AI 复盘"敌方走位"）**：新增 `EnemyLastKnownPositionResolver`（core）聚合敌方逐车最后已知位置——输入最终战场状态快照 + 权威名册 + perspective 队伍，只统计 `OBSERVED` 且有位置的车辆，输出每辆敌车的最后已知位置（九宫格区域 / 距你方（perspective 方）OBSERVED 有位置车辆质心的 canonical 距离 / battle-relative 最后观察时间）；无 OBSERVED 记录输出显式 UNKNOWN 行，绝不把观测子集伪装成全知。置信度口径沿用 `NearbySupportCounter`（全部敌方有 OBSERVED → EXACT，覆盖不全 → PARTIAL，名册无敌方 → UNKNOWN）。`EnemyLastKnownPositionsSection`（web）渲染 prompt 段，随机战行「敌方 昵称 坦克: 最后已知位置: N区 距你方主力质心: Xm 最后观察时间: X分XX秒」、团队行沿用 OPPOSING_TEAM_LINEUP 的 opponent 机器键；段头标注「观测子集」，时间一律 X分XX秒。随机战 harness / fallback / 完整特征与团队复盘（single）全路径注入，团队路径与其它 optional 证据同级、超预算整体被裁剪。
- **阶段时间线 + 双方存活人数特征**：`BattlePhaseSummary` 新增 `buildRelativePhasesWithSurvival`——与既有 `buildRelativePhases` 完全相同的阶段边界，附加每阶段结束时的双方存活人数与密集击杀段标记（`denseKills`，15 秒窗口内双方合计阵亡 ≥3 启发式）。人数只来自 `SurvivalTimeline.fromBattleResults`（battle_results 权威死亡时刻，`PlayerResultFormat.deathSec`）；某侧人数不可算（无名册/视角未知/存在未知死亡时刻）时为 null，渲染为「未知」/ UNKNOWN，绝不猜测。随机战（harness / fallback / 完整特征）与团队复盘 prompt 统一经 `BattlePhaseTimelineSection` 渲染：随机战行「X分XX秒 阶段名 | 我方存活 N 敌方存活 M（密集击杀）」，团队行输出 friendlyAlive/enemyAlive/denseKills/confidence 机器键，段头附权威口径说明。
- **赛前预测区块（preBattleSection）**：`AnalyzeResponse` 由单字段扩展为 `{ analysis, preBattleSection? }`（`TeamAnalyzeResult` 同步扩展）。`PreBattleSectionRenderer` 将 Call #1 prior 渲染为用户可见中文 Markdown（去除机器段头，`TEAM_A`/`TEAM_B` 替换为可读标签；随机战 harness 用中性「队伍1/队伍2」，团队复盘按视角队伍交换为「我方/对方」），含队伍画像 / 关键对阵 / 战略胜机 / 战略假设四个小节。Call #1 失败 / 降级 / 非中文时 `preBattleSection` 为 null。前端 `AnalysisResultPanel` 新增可折叠「赛前预测」区块（默认展开，`recon.prebattle.*` 三语文案），`v-if` 空值不渲染。
- **Team Autopsy 仅用于 team perspective（结算级 TEAM_AUTOPSY）**：随机战斗个人复盘不评判 MVP/战犯（`TacticalReviewHarness` 为双 Call，不输出团队剖析段）；战犯/MVP 只应用于训练房/联赛团队复盘——`TeamReplayAnalysisService` 单团队单元成功后追加结算级独立 TEAM_AUTOPSY 调用，输入只有权威逐人结算（本链路无 Call #1 Strategic Prior / Critical Window / Route 证据，使用结算级 system prompt）。**完整七人 roster 门禁**：仅当 recorderTeam 恰好存在 7 名有效本方玩家时才生成 P1..P7 并调用 Gateway，0～6 人或超过 7 人时不调用并记录 roster_incomplete（保留团队主复盘）。**settlement-only 置信度边界**：LLM 生成的 contribution / MVP / 战犯判断不是权威结算事实，confidence 只能为 PARTIAL/UNKNOWN，Parser 拒绝出现 EXACT/INFERRED 的整个响应，System Prompt 契约同步为 PARTIAL|UNKNOWN。玩家身份改用无业务推断的 `playerKey`（按本方 roster 稳定编号，同队同名坦克可区分）：Parser 要求 players 的 playerKey 集合与 roster **完全相等**（不缺失/不额外/不重复，超长不得截断）、contribution 仅 HIGH/MEDIUM/LOW/UNKNOWN、MVP/战犯各自最多 3 人（超限拒绝）、每条 verdict 引用有效 playerKey 且列表内不重复、reason 非空、evidence 至少一条、判胜至少一个 MVP / 判负至少一个战犯、空结果拒绝，任何契约不成立整段返回 null；最终渲染按 playerKey 回查后端权威昵称/坦克名。`TeamAutopsyStatsBuilder` 只构建 recorderTeam 本方玩家，weakOutput 均值只使用本方队伍（敌方伤害不影响）；权威结算与派生 flag 置信度分离（earlyDeath/weakOutput 为规则候选、deathInCriticalWindow 继承窗口 confidence 且结算级代理不得 EXACT）；死亡时间线仅含本方。TEAM_AUTOPSY 预算按整体剩余时间裁剪（min(30s, 剩余 - margin)，不足安全余量不启动并记录 budget_exhausted），`AI_CANCELLED` 重新抛出不被吞掉。
- **地图关系语义无损保留**：`MapTacticalSemantics` 的 `relationships` 由有损分组结构（controls/connects/enablesPressureAgainst/higherThan/containsPoints）改为 `List<TacticalRelationship>`，与 semantic.json 原始语义一致（from/type/to/reason/confidence 全部原样保留）；ADJACENT_TO 不再改名为 connects，CONTAINS_CONTROL_POINT 与 CONTAINS_STRATEGIC_POINT 不再合并。Call #1 Prompt 按原始类型渲染（如 `ELEVATED_TERRAIN_02 ADJACENT_TO VEGETATED_TERRAIN_02` + reason/confidence），系统提示明确 ADJACENT_TO 仅表示确定性分析网格相邻，不代表可通行路线/视线/交叉火力，不得据此声称 CONTROLS 或 ENABLES_PRESSURE_AGAINST。
- **地图显示名一致性（map_names.json）**：`map-semanticizer` 批量生成时自动用 `map_names.json` 的 en 名填充 `displayName`（未收录的新图回退 mapId），语义数据不再全是内部代码；`MapTacticalSemantics`/Registry 保留并消费 `displayName`，Call #1 Prompt 语义段渲染「地图: "Desert Sands"（内部 code: "desert_train"）」可读标识。新增 Python 测试（displayName 与 map_names en 一致 / 未收录回退 mapId）。
- **地图语义可信度边界保留 + Semanticizer 自动验证测试**：`MapTacticalSemantics`/`MapTacticalSemanticsRegistry` 保留并消费 `verified`、`source` 与区域 `confidence`（geometry/objectPositions/objectCategories/areaBoundary/favorsAndRisks）；Call #1 Prompt 新增可信度图例（EXACT_CLIENT_DATA/EXACT_SCENE_DATA=客户端直接事实、NAME_HEURISTIC=对象位置精确但类别由资源名推断、GRID_RULE_DERIVED=区域名称/边界/合并是规则候选、RULE_DERIVED_CANDIDATE=favors/risks 是假设候选），`verified=false` 明确渲染"尚未完成人工地图核验"，与全局置信度不一致的区域单独标注差异。新增 `map-semanticizer/tests/test_map_semanticizer.py`（15 项：heightmap 16×16 分块还原、variant auto 与无标签图、mapCodes token 边界、区域置信度保留、关系引用有效、禁止关系类型、全部语义文件可解析、生产 map code 恰好单覆盖、gridRegions 1–9、Z 校验 P90 规则），由仓库维护者手动运行（不接入 CI）；`24_milibase_mlb` 的 Z 校验 MAE=1.45m 但 P90=0.08m，说明为少量高架出生点所致，验证规则以 P90 为准不判 heightmap 失败。
- **地图语义九宫格对齐（GRID_REGION_1~9）**：`map-semanticizer` 每个语义网格 cell 输出 `nineGridRegion`、每个 AREA 汇总 `gridRegions`，与后端 `MapRegionResolver` 使用同一坐标约定（回放 raw ±250 m → 500×500 canonical → 3×3：北/上 1|2|3、中 4|5|6、南/下 7|8|9，列自西向东）；`MapTacticalSemantics.TacticalArea` 新增 `gridRegions`，Call #1 Prompt 为每个语义 AREA 标注 `九宫格=GRID_REGION_N`，系统提示明确 GRID_REGION 与 AREA 对应关系（无语义数据时仍只是位置编号）；33 张地图语义数据已随脚本重新生成。若部署端调整 `REPLAY_COORDINATE_HALF_EXTENT`，需同步 `NINE_GRID_HALF_EXTENT` 并重新生成。
- **地图语义化真实数据接入（PR #54 地图语义 V1）**：新增 `map-semanticizer`（Python，读 Wot Blitz 客户端 `.sc2` + `.heightmap` 解码生成 `<mapId>.semantic.json`，含 `areas` / `relationships` / `spawnSemantics` / `mapCodes`，无第三方依赖）；`common/map-semantics/` 首批 33 张战斗地图语义数据进入构建资源（`wotb-core/pom.xml` + `Dockerfile.backend` 复制目录），脚本支持 `--variant auto`（按 SC2 标签选主变体，夜战/无标签图按精确场景数据解析出生点）与 `--map-names-file`（批处理按 token 边界推导 `mapCodes`，`milibase`→`milbase` 登记在 `MAP_ID_CODE_ALIASES`）。`MapTacticalSemantics` 扩展出生点语义与关系类型（`higherThan` / `containsPoints`）；`MapTacticalSemanticsRegistry` 改为加载 `classpath:/map-semantics/*.semantic.json` 并按 `mapCodes` / `mapId` / token 边界别名查询（删除旧的空 `common/map_tactical_semantics.json`）；Call #1 对已收录地图渲染真实区域/关系/出生点语义，favors/risks 标注规则候选，CONTROLS / ENABLES_PRESSURE_AGAINST 未提供时禁止声称；未收录地图保持 UNKNOWN。
- **AI Review Harness V1（双 Call 战术复盘）**：新增赛前战略基线 Call #1（`PreBattleStrategicService` + `PreBattlePromptBuilder` + `PreBattleStrategicParser`，roster-only 输入、严格剥离战绩字段、结构化 JSON 输出 ≤4k tokens）；新增 6 个确定性 Backend Evidence Skill（`HpMomentumSkill` / `EngagementTradeSkill` / `LocalSupportSkill` / `DeathCascadeSkill` / `RouteSkill` / `CriticalWindowSkill`，统一 `AiEvidence` 含 confidence / provenance / priority）；新增 Call #2 Priority Bookends Prompt（`TacticalReviewPromptBuilder`，相关性预算裁剪 + Controlled Redundancy）；`TacticalReviewHarness` 编排并定义降级阶梯（非 ZH / 无重建 / 录像者未解析 / 特征不可用 / Call #1 失败 / 无证据 → 旧单 Call 路径）。地图语义 V1 不可用：区域统一九宫格 `GRID_REGION_1~9`，禁止 LLM 编造点位/区域名；TEAM_A/B ↔ 队伍 1/2 固定映射。新增 `common/tank_tactical_profiles.json`（Tank Tactical Profile 语义层，精选 + 车型 fallback）。对外 API 与响应结构不变；EN/RU 保持旧路径。
- **Tankopedia 同步流程顺序修复（业务范围过滤先于完整性门禁）**：`main()` 改为 `parse_tanks → filter_to_business_tiers(tier 7-10) → apply items/equipment → merge_extra_info → validate_integrity → write 4 tier files`；真实 blitzkit 全量 `tanks.pb` 中的 1–6 级车辆不再触发 `TANKOPEDIA_TIER_OUT_OF_RANGE`，`Update Tankopedia` workflow 可正常生成 tier 7–10 四个文件。新增 tier 5/8/10 混合回归测试（tier 5 不进入任何 JSON、T-34-2 仍为 400、extraInfo 保留）。
- **Team AI prompt 补齐结构化车辆事实**：`TEAM_MEMBERS` 与 `OPPOSING_TEAM_LINEUP_AUTHORITATIVE` 两条路径新增 `alphaDamage` / `hp` / `extraInfo`（仅 Tankopedia 提供时输出；10 级多炮车无权威 alphaDamage 时省略，不猜测；`extraInfo` 按不可信数据 JSON 引用/转义）。新增 SPHT/Kranvagn/E 100 与 extraInfo 转义的 Team prompt 测试。
- **Tankopedia 更新完整性门禁**：`update_tankopedia.py` 在写入前校验——解析为空、总车辆数或单 tier 数量相对已有数据下降超 20%（允许少量真实删除）、tank ID 重复、tier 不在 7–10、车辆缺 id/name/hp/gun 均失败，失败不写文件、不提交。新增 8 个 Python 完整性测试。
- **Python 测试进入 CI**：`ci.yml` 新增 `python` job，运行 `python3 -m unittest discover -s common/python/tests -p 'test_*.py'`。
- **Tankopedia 权威炮伤语义修正（alphaDamage 不再按数组顺序猜）**：`guns[].isDefault` 与 vehicle 级 `alphaDamage` 改为基于炮等级（`GunDefinition.tier`）——7–9 级默认炮 = 顶配炮（最高 tier，同 tier 取最高 alpha，T-34-2 由错误的 200 修正为 400，已用 origin/main 全量 454/457 验证）；10 级多终局炮车（E 100 / B-C 25 t 等 9 辆）保留完整 `guns[]` 但**不标默认、不输出 vehicle 级 alphaDamage**（回放无可靠实际炮，AI structured facts 省略炮伤，不再把数组第一把炮伪装成本场实际炮伤）；10 级单炮车（SPHT=400 等）正常输出。Java `Tankopedia` 只读 vehicle 级 `alphaDamage`，删除 `defaultGunInt` 的 `guns[0]` 兜底。新增 T-34-2 / E 100 / SPHT 回归测试。
- **车辆库按等级拆分为 4 个文件**：`common/tankopedia.json` 拆分为 `common/tankopedia-tier{7,8,9,10}.json`（meta 新增 `tier`，`count` = 该级车辆数）；`update_tankopedia.py` 参数改为 `--existing-dir`/`--output-dir`，只输出 7–10 级四个文件；Java `Tankopedia.load()` 依次加载 4 个 classpath 资源合并查询，`wotb-core/pom.xml` 与 `Dockerfile.backend` 同步复制 4 个文件；`Update Tankopedia` workflow 改为同步并提交 4 个文件。
- **车辆库全面切换 blitzkit + 新格式（vehicles 数组，全英文）**：`update_tankopedia.py` 数据源由 WG 百科切换为 blitzkit（`assets.blitzkit.app/definitions/tanks.pb` + `consumables.pb` + `provisions.pb` + `equipment.pb`，游戏客户端直出，含 WG 未收录的新车如 SPHT / AC Atlas）；输出改为 `meta` + `vehicles` 对象数组，每辆车一条记录，**全部字段与值均为英文/数字**：`name/id/tier/class/nation/hp/forwardSpeed/reverseSpeed/turretRotationSpeed/hullRotationSpeed/powerToWeightRatio/guns/alphaDamage/allowedProvision/allowedConsumables/allowedEquipment/extraInfo`。10 级顶配炮塔多炮车不再拆记录，改用 `guns` 数组按炮区分（`gunId`/`isDefault`/`alphaDamage`/`shells`，默认炮语义见上一条修正）；每发弹输出 `shells`（type/damage/penetration，type 归一化 ap/apcr/heat/he）；`allowedProvision`/`allowedConsumables` 由 blitzkit include/exclude 过滤器（tier/ids/clip/nations）判定并映射 `common/wotb-item-catalog-json` 的逻辑 id/code；`allowedEquipment` 由车辆 equipment_preset 槽位装备映射为 catalog 装备 code（含 VK 72.01 / Type 71 俯角、履带齿等专属装备）；`extraKnowledge` 更名为 `extraInfo` 按 tank_id 保留合并。Java 端 `Tankopedia` 适配新格式，车种/国家返回英文值，AI 复盘正文语言由前端 `lang` 参数控制，`VehicleCodes`/`Rating` 兼容英文输入。`Update Tankopedia` workflow 同步简化：blitzkit 为公开 CDN，runner 直接同步提交，不再需要 `WG_APPLICATION_ID` / `VPS_*` secrets 与 IP 白名单。
- **WG 官方车辆百科 + 每车知识点注入 AI prompt（本 PR 中间方案，已被上一条 blitzkit 全面切换取代）**：`update_tankopedia.py` 数据源由 blitzkit 切换为 Wargaming 官方 WoT Blitz 百科（`WG_APPLICATION_ID`，默认只保留 7–10 级），WG 百科未收录的新车（如 11.19 的 SPHT 等）由 `common/python/blitzkit_fallback.json` 兜底（`--fallback`：WG 优先、缺车才补，meta 记录 `fallback_count`）；新增手动触发的 GitHub Actions **`Update Tankopedia`**——因 WG application_id 有 IP 白名单（上限 10、runner IP 动态不可加），workflow 改为 SSH 到 VPS（IP 已白名单）执行同步并把 `tankopedia.json` 拉回提交到 main；`tankopedia.json` 新增 `hp` 与手工维护的 `extraKnowledge` 字段（刷新脚本按 tank_id 保留合并，不覆盖个人知识点）；同步脚本加固：`--existing`/`--output` 路径分离（输入输出互不覆盖）、仍存在车辆的知识点保留失败即中止、分页防死循环（上限 100 页 + 无进展检测）、`alphaDamage` 取 `default_profile.shells` 第一发（标准弹，已用真实响应验证，不使用 max）、日志不含 application_id、新增 Python 单元测试；实体标签注入 炮伤/血量/知识（`EntityIdentityResolver.appendStructuredTankFacts`），prompt 规则白名单放行新结构化字段；`TankInfo.alphaDamage` 从死数据变为 prompt 实际消费。
- **Wargaming.net ASIA / EU / NA 三服登录完整闭环**：新增 Keycloak 自定义 Identity Provider `keycloak-wargaming-provider`（Provider ID `wargaming`，一个类型、ASIA/EU/NA 三个实例），走 WoT Blitz 官方认证/账号接口（ASIA→`api.wotblitz.asia`、EU→`api.wotblitz.eu`、NA→`api.wotblitz.com`，实测 `application_id` 按 Blitz 游戏注册、跨区通用，三服共用一个 `WG_APPLICATION_ID`）；WG 登录创建独立账号（**username = `wg_{region}_{account_id}` 区服隔离**、broker = `wg:{region}:{account_id}`），重复登录自动刷新昵称与展示名；**登录身份安全绑定**：`POST /wot/auth/prolongate/` 服务端响应返回 token 所属 `account_id`（官方契约字段），broker/username/wotb.account_id 全部取自该可信值，浏览器回调的 account_id/nickname/expires_at 仅作一致性检查，杜绝「有效 token + 篡改回调 account_id 登录成他人账号」；JWT 新增 `wotb_region` / `wotb_account_id` / `wotb_nickname` / `wotb_verified(boolean)` claims；后端 `user_profile` 新增 `wotb_account_source` / `wotb_account_verified_at`（V12），V13 `CHECK (wotb_server IN ('CN','ASIA','EU','NA'))`，创建/同步/只读逻辑按 JWT `wotb_region` 参数化，`PUT /api/users/wotb-account/from-login` 幂等同步；登录入口为 Keycloak 托管登录页（未登录直接跳转，页面列出 QQ + 三个 WG IdP，前端无自定义登录页），个人中心按 `wotbAccountSource=WARGAMING` 判定只读并展示中国/亚洲/欧洲/北美四个服务器标签。存量用户已补 `region=CN`（138/138）。
- **联系页**：新增 `ContactPage.vue`（`?view=contact`），展示 QQ（1582536892）、微信（a1582536892）、Discord（a158coke）三个渠道，支持一键复制并带「已复制」反馈；顶栏新增「联系我」入口（`contact.*` 三语文案）。
- **版本历史独立页面**：版本历史从首页拆出为 `VersionPage.vue`（`?view=version`），顶栏新增「更新历史」入口（`version.btn`）；首页不再内嵌版本列表。
- **顶栏反馈入口**：`App.vue` 顶栏新增 `app.feedback` 三语按钮（zh 反馈 / en Feedback / ru Обратная связь），`target="_blank" rel="noopener"` 直达 `https://github.com/A158Coke/WotbTools/issues/new`，无需登录。
- **AI 复盘输出语言跟随界面语言**：`/api/replay/analyze` 的 multipart 表单字段 `lang`（必填，白名单 zh/en/ru）控制 AI 复盘输出语言；缺失时返回 400，空白或未知值返回 400 `UNKNOWN_LOCALE`。语言经 ReviewService/facade/Player/Team Service 传入 Prompt Builder：ZH system prompt 字节级不变；EN/RU 在中文基座上替换互斥的中文输出强制句（输出语言、称谓、车种、时间格式、未知字段与无法确定措辞），保留不编造、坦克专有名词原样、perspective/friendly-enemy、权威结算与观测子集、注入防护、数据限制等业务约束。en 时间格式统一为 `Xm Xs`（如 `1m 15s`、`3m 0s`、`3m 12s`），ru 为 `X мин X с`（如 `1 мин 15 с`、`3 мин 0 с`、`3 мин 12 с`）。覆盖 Player full/fallback/multi 与 Team single/multi 全部路径；地图/坦克/clan/昵称等专有名词不翻译。前端按 vue-i18n 当前 locale 携带 `lang`。
- **Grafana MCP server（生产）**：VPS 新增 `grafana/mcp-grafana` 容器（StreamableHTTP，`GRAFANA_URL=http://grafana:3000`，SA Token 认证，仅绑 `127.0.0.1:8000`），Caddy 按 `/mcp*` 路径分流到 `https://monitor.wotbtools.com/mcp`；opencode 等 AI 客户端可直接远程连接，无需本地中转容器。本地 `docker/online/docker-compose.yml` 同步增加 `mcp-grafana` 服务（需 `GRAFANA_MCP_TOKEN_FILE`）；生产 `deploy.yml` heredoc 同步增加该服务（需 GitHub Secret `GRAFANA_MCP_TOKEN`，CI 部署时写入 `.env` 并自动拉起，同时清理手动部署的旧容器避免端口冲突）。
- **使用统计 Dashboard（WotBTools 使用统计）**：新增 `wotbtools-usage` 面板，展示前端使用情况——回放解析使用次数与 AI Review 使用次数（按 HTTP 请求计数，含累计/区间/按操作分布/趋势），非全链路内部调用统计。
- **AI Review 单文件上传限制**：`AiReplayBatchPolicy.MAX_FILES` 从 16 改为 1；前端移除 `multiple` 属性、替换（非追加）文件选择逻辑；多文件相关的测试已适配为单文件语义。
- **AI Review 单文件上传限制**：每次只能上传一个 `.wotbreplay`；每次只解析一场战斗；每次 DeepSeek API 调用都是独立请求。
- **DeepSeek 百万上下文支持**：新增 `AiModelProperties` 统一配置（`contextWindowTokens`/`singleReplayMaxInputTokens`/`maxOutputTokens`/`promptSafetyMarginTokens`/`thinkingEnabled`/`reasoningEffort`），环境变量注入，Spring Boot 启动时用 `long` 算术校验 budget 合法性。
- **Token 估算器**：新增 `AiTokenEstimator` 接口与 `ConservativeDeepSeekTokenEstimator` 实现。
- **API usage 追踪**：`ChatCompletionResponse` 新增 `Usage`/`CompletionTokensDetails` record，`call()` 成功后记录 `prompt_tokens`/`completion_tokens`/`reasoning_tokens`/`cache_hit`/`cache_miss` 到日志。
- **思考模式/推理力度配置化**：`thinkingEnabled`、`reasoningEffort` 通过环境变量控制，请求统一使用配置值而非硬编码。
- **可观测系统（第一阶段）**：
  - Backend 接入 Spring Boot Actuator + Micrometer + Prometheus（独立管理端口 `8088`，仅 Docker 内部网络可达，不映射公网）。
  - 结构化 JSON 日志（logstash 格式）；新增 `RequestIdFilter`：请求头继承或生成 `X-Request-ID`、写入 MDC，响应头回写，日志可按 `requestId` 关联。
  - `AiReplayAnalysisService` 由 `System.Logger`（JUL）迁移到 SLF4J，AI 失败日志可带 `requestId`；新增 AI Review 指标（请求量/成功失败拒绝/耗时/并发/错误分类）。
  - 新增 Replay 解析使用指标 `wotb_replay_*`（请求量、文件数、成功失败、耗时、并发），覆盖 preview/export/rating/process/reconstruct。
  - 观测栈容器：Prometheus（7 天/2GiB）、Loki（7 天）、Alloy（采集 backend 日志）、Grafana（provisioning 自动配置 Datasource 与两个 Dashboard：`WotBTools Backend Overview`、`WotBTools Replay Parser`）；固定镜像版本、内存上限合计约 1GB。
  - 所有服务 Docker 日志轮转（json-file 20MB × 3）；观测数据独立 volume，不写入 PostgreSQL。
  - `monitor.wotbtools.com` 子域反代配置（host 级 DNS/TLS 需管理员完成）；`.env.example` 新增 `GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD`/`GRAFANA_ROOT_URL`/`OBSERVABILITY_ENVIRONMENT`。
  - 运维文档：`docs/observability.md`。

### Removed
- **生产 Grafana MCP server（P0 安全下线）**：`mcp-grafana` 公网 `/mcp` 存在匿名访问漏洞——SA Token 只是访问 Grafana 的后端凭据、并非调用者认证，未设置 `MCP_GRAFANA_SERVER_TOKEN`/`--server-auth-token` 时匿名 MCP initialize 返回 200 并建立 session。因使用频率低选择彻底下线：生产与本地 compose 移除 `mcp-grafana`；部署链路（`deploy.yml` / `deploy.sh` / `.env`）停止传递 `GRAFANA_MCP_TOKEN`；CI deploy-smoke 新增「生产 compose 不得含 MCP 服务 / 8000 端口」回归断言。生产侧已同步执行（2026-08-11）：移除 `wotb-mcp-grafana-1` 容器、关闭 8000 端口、宿主 Caddy `/mcp*` 改为 `respond 404` 并热重载；Grafana MCP Service Account/Token 与 GitHub Secret 清理为人工步骤（见 `docs/observability.md`）。
- **`/api/replay/reconstruct` 与 `/api/replay/state-at` 端点**：前端简化后已无调用方，一并移除 `ReconstructSummary`/`StateAtResponse` DTO、`ReplayReconstructionService.stateAt()` 与 `SecurityConfig` 对应 matcher。重建能力保留在 core（`BattleStateReconstructor.stateAt(...)` 仍是公共 API），由 `/api/replay/analyze` 内部调用。
- **AI 复盘页重建 UI**：删除 `ReplayReconstructionActions.vue`、`ReconstructionSummaryPanel.vue`、`BattleStatePanel.vue`；`ReplayInputPanel` props 8 → 3、emits 8 → 4；`AnalysisResultPanel` 去掉 `close` 事件与关闭按钮；三语各删 33 个不再引用的 `recon.*` key（29 个因本次简化失效，4 个为历史遗留）。

### Changed
- **随机战 Call #2 走位数据接入 + 团队成员区域序列**：个人路径 Harness 快照新增 `RECORDER_REGION_TIMELINE_BACKEND_COMPUTED`（区域时间线 + 压缩区域序列 1-9 区）与「移动段（压缩）」（时间区间/移动类型/距离/速度/起止区域）——此前 fallback 路径有而 Harness 完全缺失（快照只写了"位置时间线可用"却不展开）；团队路径 `MEMBER_MOVEMENTS` 每个成员新增 `regionSequence`（整场路线压缩序列），复用 `MapRegionResolver` 九宫格约定。走位渲染抽为 `PlayerReplayPromptBuilder.appendRecorderMovementEvidence` 供 Harness 与 fallback 共用。
- **随机战 Call #2 数据增量 + 口语化**：`TacticalReviewPromptBuilder` 关键窗口上限 3→8（TOP PIVOTAL WINDOWS 索引与 CRITICAL DECISION WINDOWS 完整证据同步放宽），新增「对炮明细（ENGAGEMENTS·后端确定性）」段——逐次交火的时间区间、对方昵称（按 battle players 回查）、你输出/损失、结果与置信度；三语语言规则新增语气约束（像资深教练当面复盘：自然口语化、避免模板化套话与机械罗列、数据充分时直接下判断、不处处免责）。940k input 预算下随机战 Call #2 实际 prompt 用量从 ~4.5k tokens 明显提升；仍由 effectiveLimit 兜底裁剪。
- **团队复盘应用 Call #1（赛前战略基线）**：训练房/联赛团队复盘与随机战一样先执行 `PreBattleStrategicService`（地图 + 双方阵容先验，含开局/分路假设），按视角队伍把 prior 重标为 TEAM_A=你的队伍（teamLabel）/ TEAM_B=对方队伍 后注入团队 Prompt（视角队伍为 2 时交换 Call #1 的 TEAM_A/TEAM_B 标签），系统 prompt 新增战略假设逐条判定规则（CONFIRMED / VIOLATED / NOT_OBSERVABLE / IRRELEVANT_AFTER_STATE_CHANGE，ZH/EN/RU）；单队与多队（per-perspective）路径都覆盖。Call #1 失败不阻断团队复盘（仅缺 prior 段）；Team Autopsy 保持结算级（无 prior）。预算沿用整体 deadline（Call #1 45s + 团队复盘剩余预算 + Autopsy min(30s, 剩余-margin)）。
- **Grafana 升级 11.4.0 → 11.6.16**：生产与本地 compose、`docs/observability.md` 组件表同步镜像版本；升级前已备份 `grafana_data` 卷（`/opt/wotb/backups/grafana/`）。11.6 无影响本项目的 breaking changes（未使用 API key；provisioning/dashboard schema 兼容）。
- **AI Review 未成功次数零值回退修复（PR #44）**：`wotbtools-usage` Dashboard「未成功次数」面板改为两个独立 Target （failure / rejected，各带 `or vector(0)` 与固定 legend），修复原 `sum by (result) ... or vector(0)` 因标签集合不匹配 在无数据时产生无标签 0 序列的问题；无数据时明确显示 failure 0 / rejected 0，两类结果保持独立。
- **使用统计 Dashboard 统计口径修正（enhance-monitor）**：移除误导性「累计」字段（Counter 在 Backend 重启后归零，非历史累计）；全部次数改为所选时间范围估算增量（`increase()` + `round()` + `or vector(0)`，整数显示、无数据显 0）；回放预览次数仅统计 `operation="preview"`；新增「AI Review 成功次数」与「未成功次数」（failure/rejected 独立标签）；文档补充统计口径与 7 天保留说明。
- **AI 战术复盘按钮样式**：`ReplayAnalysisAction` 主按钮补充 scoped CSS，与 `btn-primary` 主题一致（accent 强调色、双主题变量、hover/active/disabled 状态），修复按钮缺样式问题。
- **AI Review 指标移到服务边界（PR #43）**：指标从 `AiReplayAnalysisService.call()`（按上游调用）移到 `AiReplayReviewService.analyze()`（一次 HTTP = 一次 Review）；`call()` 仅保留 upstream 请求量/耗时/错误分类。新增 `wotb_ai_review_requests_total`/`results_total{result=success|failure|rejected}`/`errors_total{type=固定枚举}`/`duration_seconds`/`in_flight`。
- **自定义 Timer 启用直方图（PR #43）**：`wotb_ai_review_duration_seconds`/`wotb_ai_upstream_duration_seconds`/`wotb_replay_parse_duration_seconds` 启用 `publishPercentileHistogram()`，Dashboard P50/P95/P99 有真实 `_bucket` 数据；新增 `CustomTimerPrometheusTest` 验证。
- **AI Review 的 Replay 解析计入 Replay 指标（PR #43）**：`/api/replay/analyze` 的 processing 以 `operation=ai_review` 记入 `wotb_replay_*`，不双重统计。
- **RequestIdFilter 显式早于 Security（PR #43）**：加 `@Order(Ordered.HIGHEST_PRECEDENCE)`，401/403 响应也带 `X-Request-ID`；新增 `RequestIdFilterTest`（8 用例）。
- **Loki requestId 顶层字段（PR #43）**：MDC 的 `requestId` 在 logstash JSON 为顶层字段（非 `mdc.requestId`），Dashboard/文档 LogQL 改为 `requestId=~"${requestId:.*}"`；新增 `LogstashMdcTopLevelTest` 实证。
- **Dashboard 补齐（PR #43）**：新增 HTTP Method 分布、2xx/4xx/5xx 分布、AI 成功率/失败率/拒绝率、AI 完整耗时 P50/P95/P99 面板。
- **生产 Grafana Secret 安全化（PR #43）**：CI 将 `GRAFANA_ADMIN_USER/PASSWORD` 写入 `/opt/wotb/.env`（`chmod 600`），compose 用 required-variable 语法引用，密码不落入 compose 文件。
- **CI 增加观测配置验证 job（PR #43）**：`observability-config` 校验 compose/promtool/Loki/Alloy（`fmt -t`）/provisioning YAML/Dashboard JSON/端口映射。
- **CI 端口检查按服务断言（PR #43 跟进）**：prometheus/loki/alloy/grafana/wotb-backend 不得有任何宿主端口映射（直接断言 ports 为空，防 `18088:8088` target 绕过）；frontend `8088:80` 为合法对外入口不在此列。
- **AI upstream 指标语义修正（PR #43 跟进）**：`checkTokenBudget()` 先于指标统计执行；只有检查通过、准备执行 `restClient.post()` 才 +1 `wotb_ai_upstream_requests_total` 并启动 duration Timer；token budget rejection 不产生 request/error/duration。新增 `AiReplayAnalysisServiceUpstreamMetricsTest`（3 用例）。
- **删除误导性 `wotb_replay_results_total`（PR #43 跟进）**：解析失败以 `ReplayProcessingResult.status=FAILED` 返回而非抛异常，异常判定不可靠，删除该指标及 Replay Parser Dashboard「解析失败率」「成功/失败」面板；保留 requests/files/duration/in-flight。AI Review 自己的 results_total 不受影响。
- **Dashboard 变量修正（PR #43 跟进）**：两个 Dashboard 的 Loki 查询 `requestId=~"${requestId:.*}"` → `${requestId:raw}`（textbox 默认仍 `.*`）；删除未被任何查询使用的 `operation` 变量。
- **文档验证边界诚实化（PR #43 跟进）**：删除 `alloy run --dry-run` 与 `fmt --check`（v1.4.2 实际用 `fmt -t`）；明确 CI 仅验证本地 compose 与配置文件语法/结构，不验证生产 heredoc 渲染、不验证指标名真实存在；完整 Alloy/指标验证标注为生产部署后手动项。
- **AI Review 长耗时 Broken pipe 修复**：`deploy/nginx/nginx.conf` 为 `/api/replay/analyze` 增加专用 location（`^~` 前缀优先），`proxy_read_timeout`/`proxy_send_timeout` 提升到 300s，其他 `/api/` 保持 120s 不变；`GlobalExceptionHandler` 新增 cause-chain 断连识别（`ClientAbortException`/`HttpMessageNotWritableException`/`AsyncRequestNotUsableException` 及消息含 "broken pipe"/"connection reset"/"forcibly closed" 的 IOException），断连仅记 WARN、不写错误 JSON、不产生 Unhandled exception ERROR 堆栈；新增 `GlobalExceptionHandlerTest`（12 用例）。
- **AI Review 入口去角色门控**：`App.vue` 移除 `canUseAiReview` 对导航按钮、`allowedViews` 和组件渲染的门控，视图列表改为静态常量（连带移除随之失效的异步鉴权 `watch` 与 `userNavigated`）；登录检查下移到 `ReconstructionPage.onMounted`，未登录调用 `login('reconstruction')`。
- **`useAuth.login(view)` 支持指定回跳视图**：默认仍为 `profile`，个人中心与陪练行为不变。
- **`ReconstructionController` 构造器 3 → 2 参数**：不再注入 `ReplayReconstructionService`；类 Javadoc 修正 —— 原文声称「开发和验证用 / 需 wotbtools-admin」，与 `SecurityConfig` 实际的 `wotbtools-user` 或 `wotbtools-admin` 不符。
- **AI Review prompt 三层预算和精度契约**：actual-size mandatory/high-priority block planning；high-priority block 原子写入；`AiPromptBudgetExceededException` 本地 400 映射；`includedUnitIds`/`omittedUnitIds`/`truncatedUnitIds` 三位 struct；global/per-unit limitation 分离；`AnalyzeResponse` 四类计数（analyzed/omitted/unavailable/total）；multi-partition `PERSPECTIVES_OMITTED_COUNT_<TOTAL>` 聚合；provider body 不落日志（`[PROVIDER_BODY_REDACTED]`）；三语 omission locale。
- **Controller → AiReplayReviewService 分层**：Controller `analyze()` 精简为 `service.analyze(files)`；AiReplayReviewService 接管 validate/process/BatchAnalyzer/AI orchestration；16 → 1 文件 Service boundary。
- **响应 body 安全**：provider error 日志仅含 provider/model/status/code/requestChars/mode/correlationId；provider body 原文不进入日志（统一替换为 `[PROVIDER_BODY_REDACTED]`）；不可信 textual value 不进入日志/异常/API。

### Changed
- **删除 Player/Team 固定 30,000 字符限制**：移除 `MAX_SINGLE_PLAYER_PROMPT_CHARS`/`MAX_INPUT_CHARS`，所有 `MAX_*` 固定 N 条截断（`MAX_MEMBERS`/`MAX_ENGAGEMENTS`/`MAX_MOVEMENTS`/`MAX_KEY_EVENTS`/`MAX_PERSPECTIVES` 等）一并移除。
- **TeamAiPromptBuilder 重构**：`BudgetWriter` 改为 token 估算（`finish()` 接受 `AiTokenEstimator`+`maxInputTokens`），删除字符预算逻辑。
- **全量事件写入**：`appendEventStreamEvidence` 不再有 `movementBudget`/`engagementBudget` 字符预算，所有 movement/engagement/phase/key events 全部写入 Prompt。
- **checkTokenBudget 双层检查**：先检查 `singleReplayMaxInputTokens`（输入预算），再检查 `contextWindowTokens - safetyMargin - maxOutput`（总上下文）。
- **DeepSeek request body 标准化**：所有入口统一使用 `max_tokens`/`thinking`/`reasoning_effort`，值从 `AiModelProperties` 获取。
- **配置字段重命名**：`singlePlayerMaxInputTokens` → `singleReplayMaxInputTokens` 更准确地表示单回放而非单玩家。

### Changed / Fixed
- **AI 复盘时间域/坐标域/证据边界正确性修复（PR #39）**：
  - `buildRelativePhases()` 边界修复：`battleEndRelative` 要求 finite 且 `>=0`（否则返回稳定空 fallback，不再抛异常或生成非法 phase）；引入 `UNKNOWN_FIRST_CONTACT=-1` 语义，`firstContact==0` 视为合法接敌；`openingEnd` 裁剪进 battle end；FIRST_CONTACT 仅在 first contact `finite && >=0 && <=battleEnd` 时创建（消除 `[40,30]` 与 `[0,45]`>battleEnd 场景）。`BattlePhaseSummary` compact constructor 兜底 finite/`>=0`/`start<=end`。
  - Team damage 排除 pre-battle：新增统一 `isPreBattle(event, battleStartRes)` 分类器，准备阶段伤害不再进入 attributed/unattributed、observed aggregate、engagement、first contact、focus fire、key event。
  - Team battle-end 与 fallback clock 转 battle-relative：`findBattleEndEvidence(...)`/`lastObservedClock(...)` 接收并使用 `BattleStartResolution`，replay raw clock 经 `battleRelative(...)` 转换，`battle.durationS` 直接使用不再二次减 start；raw absolute clock 不再泄漏进 phase/key event。
  - `auditPositionEvidence(...)` 真正使用 `BattleStartResolution` 排除 pre-battle 与无效时间戳；`observedPositionEventCount`/`clampedPositionEventCount` 由同一分析集合派生，`TeamFeatureCoverage` 增加 `0<=clamped<=observed` 不变量。
  - 坐标域：`TeamFormationPhase.centroid` 由裸 `Vector3` 改为强类型 `CanonicalMapPosition`；`TeamAiPromptBuilder` 用 `formatCanonicalPosition(...)`（含 region，不再 raw 二次映射），raw 坐标格式化方法重命名 `formatPositionInfo`→`formatRawPosition`；cluster centroid 改为「先对每个成员 resolve/clamp 到 canonical 再求平均」。
  - movement distance/speed 改为 canonical 米：新增共享 `MapRegionResolver.canonicalDistanceMeters(...)`，Player 与 Team member movement 共用；stationary 阈值改名 `STATIONARY_THRESHOLD_METERS`（canonical 米）；无效/倒序/零时间差不再产生 Infinity/NaN 速度；无效时间戳与 INVALID 坐标的位置不参与 movement。
  - 死代码清理：删除 `DefaultTeamBattleFeatureExtractor.rawToCanonical()`/`toCanonicalOrNull()`（合并进共享 helper）、`DefaultPlayerBattleFeatureExtractor` 遗留同包冗余 import。
  - Team damage/position 时间证据统一走单一 `classifyTime()` 分类器（USABLE/INVALID_TIMESTAMP/PRE_BATTLE），供 damage 循环、`teamPositionsByEntity`、`auditPositionEvidence`、phase guard 复用；invalid-timestamp damage 只计 invalid coverage、不再计 unattributed；`timedEvents` 列表改为轻量 `hasUsableTimedEvent` 判定。
  - `MovementSegment` 增加 compact-constructor 不变量（有限/非负/`start<=end`/非空）；坐标字段重命名 `startPosition`/`endPosition` → `rawStartPosition`/`rawEndPosition` 明确 raw 坐标域。
  - 新增回归测试覆盖上述契约（phase 边界、pre-battle 精确伤害 200/first contact 2s、relative battle-end 180/fallback 90、clamped<=observed、敌方位置不计入、canonical cluster centroid 456.2375+CLAMPED status、canonical 距离 100m/速度 20m/s、MovementSegment 非法值拒绝），均能让旧实现失败；`replayBattleEndKeepsItsSourceAndConfidence` 改用非零 battle start，`invalidEventTimestampsAreIgnoredAndReported` 更正为 unattributed=0。
- **AI 能力模型修复**：`ReplayProcessingCapabilities` 改为 scope-independent 事实字段（`summaryAvailable`/`recorderResultAvailable`/`reconstructionAvailable`/`recorderParticipantResolved`/`recorderEntityMapped`/`perspectiveTeamResolved`/`playerFeatureExtractionPossible`/`teamFeatureExtractionPossible`）。`aiAnalyzable` 和 `fullFeatureAnalysisAvailable` 移除，scope 可分析规则位于 `BatchAnalyzer.isAiAnalyzable()`。`recorderEntityMapped` 需匹配 `ParticipantMappingEvent` 的 entityId。
- **AI Prompt 权威 vs 事件流对账**：`buildPlayerContextSummary` 新增权威结算与事件流观测伤害子集的对比输出；交火段数值标记为"观测子集"而非权威总伤害；每个 engagement 输出置信度；Prompt 末尾追加 `limitations` 章节。
- **Duplicate 响应修复**：`ExactReplayDuplicate` 独立记录（含构造期不变量校验），`ExactReplayDuplicateDetector` 独立于 scope 检测精确重复。`duplicateOf` 指向保留的原始文件而非自身。`ReplayFileAnalysisStatus.duplicate()` 保留文件原始 `SUCCESS` 状态不再标记为 `FAILED`。`ReconstructionController` 中 `perspectiveTeam` 使用 `gp.key().perspectiveTeam()` 而非硬编码 0；`failedFileCount` 只统计 `INDEPENDENT_BATTLE + FAILED + error != null`。个人分析入口继续在 recorder 或完整特征不可用时走权威结算 fallback。
- **AI 上游错误与前端本地化**：将 400/401/403/408/413/422/429/5xx、读超时、空响应、畸形 JSON 和非法响应映射为稳定英文错误码；日志只记录模型、状态、请求字符数、模式、关联 ID；provider body 原文不进入日志（统一替换为 `[PROVIDER_BODY_REDACTED]`），不记录 API Key、Authorization 或完整 Prompt。前端 zh/en/ru 只展示本地化错误码，未知后端文本不会直接暴露给普通用户。
- **Team 证据边界修复**：团队位置过滤非法时间戳与明显越界坐标，movement 继承最低位置置信度；未归因 damage/position 分开计数。多场 roster 趋势同时要求至少 75% 有效 accountId 覆盖和 Jaccard `>= 0.60`。不可信文件名、昵称、地图名和证据文本改为 JSON 字符串边界，并在 system prompt 中声明仅为数据。
- **PR CI + streamComplete 诚实化 + 补测试**：新增 `.github/workflows/ci.yml`（仅 `pull_request→main` 触发，已与文档一致），跑后端 `mvn -s settings.xml test` + 前端 `npm ci/test/build`——补上 PR 缺失的自动检查（deploy.yml 仅在 push main 时跑）。`ReplayStreamDiagnostics.streamComplete()` 由恒真算术式改为显式 `reachedPhysicalEnd`（扫描到达物理末尾；超包数/重同步硬上限时读取器直接抛异常，不会返回半截诊断）。补充测试：`stateAt` 时钟回退、`DefaultReplayProcessingFacade`（mode=NONE/能力/去重）、`PositionDecoder`（49B=EXACT、45–48B=PARTIAL、<45=MALFORMED）。（批处理为顺序 for 循环且单文件 ≤ 20 MiB、请求合计 ≤ 200 MiB，无 `parallelStream`，内存/并发风险已受控。）
- **AI 分析支持多文件 + 能力模型 + DI**：`POST /api/replay/analyze` 改为接收 `files[]`（1..N），经统一门面逐文件处理；模式按去重和 perspective 分组后真正可分析的**分析单元数量**判断——0→`NO_BATTLE_DATA`、1→单场深度复盘、≥2→多场趋势复盘（每个单元独立取结算摘要，**不拼接原始事件流**）。`ReplayProcessingCapabilities` 改为 scope-independent 事实字段（`summaryAvailable`/`recorderResultAvailable`/`reconstructionAvailable`/`recorderParticipantResolved`/`recorderEntityMapped`/`perspectiveTeamResolved`/`playerFeatureExtractionPossible`/`teamFeatureExtractionPossible`）。scope 可分析由 `BatchAnalyzer.isAiAnalyzable(result, scope)` 统一计算。`ReplayProcessingResult` 增加 `capabilities` 与 `reconstructionError`。`ReconstructionController` 改为构造器注入。
- **全项目统一 Jackson 3**（`tools.jackson.*`）：`wotb-core` 依赖改为 `tools.jackson.core:jackson-databind`（版本由 Spring Boot 4.1 BOM 托管），`ObjectMapper` 统一 `JsonMapper.builder().build()`，适配 `fields()/fieldNames()→properties()`、`TextNode→StringNode` 等改名；注解包 `com.fasterxml.jackson.annotation` 保持不变。
- **回放代码审查修复**：前端 `/api/replay/*` 统一携带 Keycloak Bearer Token（含 401/403 处理）；`stateAt` 修正时钟回退下漏事件的问题（不再遇首个超时事件即 break）；`PositionDecoder` 截断（<49B）位置包降级为 PARTIAL；`PositionDecoder`/`ProtobufDecoder`/`EntityMethodDecoder` 修正越界与 varint 边界；`EntityPropertyDecoder` 改为解析已确认的 Type 7 结构（entity/prop/valueLen/value），**不臆断血量语义**（逐帧血量为已知限制，见 `docs/replay-data.md`）。

- **完整回放重建处理流水线**：新增 `com.wotb.core.processing` 包（统一单/多文件处理门面），将现有 `ReplayParser` 战绩解析与 `ReplayReconstructionService` 完整重建整合为 `ReplayProcessingResult`；新增 `ReplayProcessingOptions` 控制是否执行重建，普通 preview 不承担额外成本；新增 `ReplayAnalysisMode`（`NONE`/`SINGLE_PLAYER_BATTLE`/`MULTI_PLAYER_BATTLE`/`SINGLE_TEAM_BATTLE`/`MULTI_TEAM_BATTLE`）由后端根据去重后的可分析 perspective 单元数量自动确定。新增 `POST /api/replay/reconstruct-batch`（批量重建）和 `POST /api/replay/process?reconstruct=`（可选重建）端点，需 `wotbtools-user` 或 `wotbtools-admin` 角色（后续统一为与 `/api/replay/analyze` 相同的角色要求）。`com.wotb.core.replay.feature` 已提供玩家与团队两套生产特征模型和 Single/Multi AI context。
- **陪练订单完成确认**：新增 Flyway V11 的完成提交/自动确认时间字段、客户确认接口 `PATCH /api/boost/requests/my/{id}/confirm-completion`、72 小时默认自动确认调度与悲观锁幂等完结路径；客户、管理员和定时任务统一将需求置为 `CLOSED`、分配置为 `COMPLETED` 并释放打手。相关写操作统一锁顺序并重检需求/分配状态，管理员使用显式转换矩阵且不能重开终态，自动确认按订单使用独立事务隔离失败。
- **回放解析资源预算**：ZIP 仅接受标准条目并限制压缩/解压大小；pickle、protobuf 增加长度、栈、opcode、字段数与 varint 边界；单回放名册/战绩最多 64 人，事件流最多 200000 包与 1000000 次扫描（高于已观测约 112K 合法样本）；公开解析任务增加文件数、请求总量与单实例并发限制。
- **生产双库备份恢复**：新增 `wotb`/`keycloak` 部署前备份、每日香港时间 03:15 定时备份、7 日保留、完整归档校验及带显式确认的手动恢复脚本。
- **前端回归测试**：新增 Vitest，覆盖 API 错误码、本地化显示与异步搜索仅接收最新响应。
- **打手自助接单开关**：新增 `PATCH /api/boost/boosters/my/availability`，打手可在个人中心直接暂停或恢复接收新订单；接口返回最新 `BoosterDto`，前端即时刷新当前接单状态。
- **打手历史订单视图**：`GET /api/booster/assignments` 新增可选参数 `includeHistory=true`，个人中心可查看打手的进行中订单和历史订单；默认不带参数仍只返回活跃订单，保持工作台行为不变。
- **生产诊断 Workflow**：新增手动/路径触发的 `prod-diagnostics.yml`，可通过 GitHub Actions 读取线上 compose 状态与后端/前端日志，用于排查 502。
- **站内通知基础版**：新增 `user_notification` 表（Flyway V10）与 `/api/users/notifications` 系列接口，陪练页展示未读通知、列表和一键已读；打手分配、订单状态变化、资格申请通过/拒绝会写入站内通知。
- **陪练订单状态细化**：新增 `ACCEPTED`、`IN_PROGRESS`、`PENDING_CONFIRM`、`EXCEPTION` 订单状态；打手工作台支持接单、开始、提交完成和拒单动作。
- **打手资格申请链路**：新增 `booster_application` 申请表（Flyway V9）、玩家申请 API、管理员资格审批 API；审批通过由 `BoosterService` 编排 `booster_profile` 与 Keycloak `booster` role。
- **潜在场均链路**：`data.wotreplay` 的 direct HP damage 事件会推断击杀目标并填充 `killVictims`，用于 `/extended` 实时 rating 的 `potential_damage_avg`。
- **通用错误码系统**：`ErrorCode` 枚举（`util/ErrorCode.java`），取代 JSON 加载的 `ErrorCodes` 工具类。
- AGENTS.md 规则 19（StringUtils.hasText）、20（优先 Stream）、21（禁止 import \*）、22（Mapper 替代 toXxx）、23（子代理确认 + 完成通知）。
- **Java 后端包重构**：按 domain 分包（`user/` `leaderboard/` `replay/` `boost/` `admin/`），删除旧层分包（`service/` `entity/` `repository/` `mapper/`）。
- **displayName JWT 映射**：`wotbtools-web` client 新增 `display-name-mapper` protocol mapper。
- **打手关联用户**：`booster_profile` 新增 `keycloak_user_id`（Flyway V8）。
- **QQ username 生成**：`{清洗后昵称}-{sha8(socialUid)}` 确保唯一。
- **异常响应契约**：`GlobalExceptionHandler` 统一只返回 `error` + `timestamp`，可读文案由前端三语字典渲染。
- **Keycloak/数据库一致性**：打手创建、换绑、删除与资格审批先 flush 数据库约束，再修改 realm role；事务回滚自动执行反向补偿。管理员删除用户同样先 flush 本地删除，再调用 Keycloak。
- **部署 Workflow 拆分**：`deploy.yml` 改为 3 个独立 build job（按变更路径条件并行构建）。
- **测试包修复**：`src/test/test/` → `src/test/java/`，修正包声明。
- **打手工作台**：新增 `MyAssignmentController` + `GET /api/booster/assignments`，打手查看自己的活跃分配、联系方式、需求状态与分配备注。

### Changed
- **消息通知移至个人主页**：站内通知面板从陪练页（`BoostPage.vue`）迁移至个人中心（`ProfilePage.vue`），右侧栏顶部展示未读小红点，点击展开最近 30 条通知列表，支持单条和全部已读。所有登录用户均可查看通知，不限于打手。
- **资格审批图片按需加载**：玩家与管理员申请列表改用 `BoosterApplicationSummaryDto` 的 JPA 构造投影，查询不再读取两列 Base64 原图；审核状态变更也只返回摘要。管理员点击详情后才调用单条详情接口获取完整资料与截图，缩略图启用浏览器原生延迟解码。
- **Boost API 去本地化**：移除 `*Label`、`message`、`warning`，统一返回 raw enum、`code`/`error` 与 `warningCode`；排行榜跳过原因改为 `reasonCode`。
- **回放 API 值去本地化**：车型、国家、潜在伤害解析状态、存活状态和评分车型系数统一返回稳定英文码，中文仅由前端三语词典与导出层生成。
- **赞助配置外置**：恢复首页赞助入口和三语赞助页面；支付二维码不再进入仓库或镜像，改由 VPS `sponsor-config.json` 与只读静态资源目录在运行时提供。
- **Maven 配置可复现**：跟踪可移植的 `java/settings.xml`，以 `${user.dir}/.m2repo` 隔离依赖，删除失效的桌面构建模板生成流程。
- **安全默认拒绝**：未显式匹配的 `/api/**` 一律拒绝；`boost-manager` 仅能访问 `/api/admin/boost/**`，其他管理员接口只允许 `wotbtools-admin`。
- **CI/CD 门禁与增量检测**：后端测试、前端测试和构建通过后才构建镜像；变更检测改用完整 push range，并覆盖评分、地图、公共资源和部署脚本。
- **测试依赖统一**：Testcontainers 模块统一到 2.0.5 命名与版本，移除 `spring-boot-starter-test` 已包含的重复依赖。
- **地图名三语映射**：`common/map_names.json` 改为 `zh/en/ru` 结构，前端 `mapLabel()` 按当前 locale 渲染，导出层 `MapNames.cn()` 继续固定中文。
- **回放预览列选择持久化**：`useColumns.js` 现在分别记忆单场/汇总列的可见性与顺序，并在响应列集合变化时自动补齐新增列，避免旧缓存导致新列消失。
- **wotb-web 单测执行**：显式启用 Surefire 3.5.0，让 JUnit5 Web/boost 单测实际执行；`WebApiTest` 在无 Docker 环境自动跳过，避免本地测试硬依赖 Testcontainers。
- **扩展 Rating V2 入口**：主 Vue SPA 新增 `?view=extended` 路由，复用独立 `/extended` 的实时 rating 页面，并在首页与顶栏暴露入口。
- **Keycloak 自助注册**：realm 导入配置开启 `registrationAllowed`，注册入口仍由 Keycloak 托管。
- Keycloak 从 26.6.3 升级至 26.6.4。
- **前端视觉系统**：统一 Vue SPA 全局色板、按钮、表格、上传区、顶栏和深浅色变量，改为 Blitz 工具站风格。
- **前端页面打磨**：统一回放解析、排行榜、个人中心、陪练、管理员和扩展页的卡片、表格、按钮、状态徽章和移动端间距。
- **首页最高伤害记录**：首屏伤害 tag 改为读取 `/api/leaderboard/top-damage?page=1&size=1` 的当前最高单场伤害。
- **打手调度体验**：分配弹窗按资格状态、接单状态、活跃订单数、等级和擅长内容推荐打手；打手已有活跃订单时自动显示为忙碌，不再允许继续分配新单。
- 删除未被入口引用的旧 `VersionPage.vue`，版本历史继续由首页 `versions.json` 渲染。

### Fixed
- **资格审批截图查看**：管理员点击战绩截图后改用站内大图层展示，支持遮罩、关闭按钮和 `Esc` 退出；资格申请列表默认筛选按创建时间倒序的待审批记录。
- **打手删除因申请审批记录被误拦截**：`BoosterService.deleteById` 锁定打手后仅以任意订单分配历史阻止硬删除；`booster_application.approved_booster_id` 会先解除引用，审批记录保持 `APPROVED` 状态。
- **管理员删除用户联动打手档案**：删除用户前先锁定本地用户资料并清理其无订单分配历史的打手档案；打手创建/换绑复用同一用户行锁，避免并发产生孤立档案。若存在分配历史则返回 `BOOSTER_HAS_DEPENDENCIES`；其他打手清理异常会先记录 `FAILED_LOCAL_DELETE` 审计再返回同名错误码，均不会继续删除本地资料或 Keycloak 用户。
- **资格审核通知**：进入 `REVIEWING` 不再误发拒绝通知，只有真实拒绝才发送 `BOOSTER_APPLICATION_REJECTED`。
- **管理员搜索竞态**：忽略已过期的用户搜索响应，选择用户或离开页面时取消待处理结果。
- **后台分页契约与竞态**：Boost 管理页按 Spring `Page.number` 读取当前页，连续筛选/翻页只接受最新响应，避免页码失效或旧结果覆盖。
- **用户删除约束处理**：本地删除显式 flush，数据库依赖冲突不会再发生在 Keycloak 用户已删除之后；Keycloak 删除响应会关闭并校验 HTTP 状态，避免 4xx/5xx 被误判成功。
- **部署拉取失败门禁**：`docker compose pull` 三次重试全部失败后立即终止部署，不再继续使用旧镜像并误报成功。
- **中俄文案修复**：修复损坏为 `????` 的 locale 文案，并补齐 API 错误码、状态与枚举三语映射。
- **打手接单状态空值保护**：`BoosterService.setAvailability(...)` 现在会拒绝 `available=null` 并返回明确的 `BOOSTER_AVAILABILITY_REQUIRED`，避免自助/管理员切换接单状态时把空值写入 `booster_profile`。
- **空白字符串归一化**：`wotb-core` 与排行榜入库统一用 `StringUtils.hasText(...)` 处理录像者、昵称、版本号、地图映射与时间戳，空白字符串不再污染昵称回退、版本入库或触发时间解析异常。
- **线上 502 热修**：站内通知改用 Jackson 3 `tools.jackson` 本地 mapper，避免 Spring Boot 4 不再注入旧 `com.fasterxml.jackson.databind.ObjectMapper` 导致后端启动失败。
- **部署健康检查**：`deploy.yml` 改为等待后端 `/api/health` 真正可访问，失败时输出后端/前端日志，避免容器刚 Started 就误判部署成功。
- **打手状态文案去歧义**：打手管理页把 `booster_profile.status` 明确显示为"资格状态"，把 `available + activeAssignmentCount` 明确显示为"可接单/忙碌/暂停接单"，避免出现"正常 + 不可用"的误读。
- 个人中心补齐陪练身份卡片的三语 i18n key，避免直接显示 `profile.booster*` 原始 key。
- 车辆库更新脚本补全 `alphaDamage`：从 BlitzKit `tanks.pb` 炮/弹模块解析最高等级炮的首发弹伤害，并修正脚本输出路径，避免潜在伤害补增因炮伤为空恒为 0。
- CI/CD 部署：`docker compose pull` 添加 3 次重试。
- 前端 nginx 增加 UTF-8 charset。
- Keycloak `check-sso` 配置 `silentCheckSsoRedirectUri`，避免公共首页本地预览被静默登录流程整页跳转。
- 回放解析评分徽章：最低评分为 `0` 时也正确显示金 shit，且全员同分时不误发最高/最低标记。
- 评分等级颜色：补齐前端 `r-elite` / `r-great` / `r-good` / `r-mid` / `r-poor` 样式，避免评分徽章只显示默认底色。
- 评分规则弹窗：区间符号改为 ASCII，避免终端或浏览器编码异常时出现乱码。
- `/extended` 独立入口补充主题变量，避免扩展分析页脱离主入口时丢失深浅色样式。

### Removed
- 删除已被 `ErrorCode` 枚举取代的 `common/error-codes.json`。
- `MAX_SINGLE_PLAYER_PROMPT_CHARS` 30,000 字符人工限制
- `TeamAiPromptBuilder` 的 `MAX_MEMBERS`/`MAX_ENGAGEMENTS`/`MAX_KEY_EVENTS`/`MAX_FORMATION_PHASES`/`MAX_BATTLE_PHASES`/`MAX_PERSPECTIVES`/`MAX_MOVEMENTS_PER_MEMBER`/`MAX_INPUT_CHARS` 固定截断常量
- Player 和 Team 内旧的字符预算裁剪逻辑（`movementBudget`/`engagementBudget`/`scored` 排序）
- 硬编码的 `thinking=enabled` 和 `reasoning_effort=high`

### Fixed
- **顶栏响应式修复**：`App.vue` 顶栏增加横向滚动兜底，并在 ≤1080px 时切换为 sticky + flex-wrap（导航换行第二行），屏幕不够宽时不再丢失右侧按钮。
- **赞助页返回入口**：`frontend/homepage/sponsor.html` 顶栏新增「返回」按钮（`history.back()`，无历史时回首页），三语 `back` 文案随页面 i18n 切换。

### Changed
- **修复增量构建与 SHA 镜像不匹配导致的部署阻断**：生产部署从「按路径增量构建」改为**每次统一构建 backend/frontend/keycloak 三个 `sha-<SHA>` 镜像**（避免 compose 引用未构建镜像导致 `docker compose pull` 失败）；新 compose 先写入 `docker-compose.next.yml`，`pull` 成功后才备份 `docker-compose.prev.yml` 并替换正式文件，`pull`/`up`/健康检查失败时恢复上一版，回滚成功保留 `DEPLOYED_SHA` 旧值——pull 失败不再污染正式 compose 与回滚目标。
- **生产部署钉住 Commit SHA + 失败自动回滚**：`deploy.yml` 生产 compose 三个 wotb 镜像由 `latest` 改为钉住 `sha-<SHA>`（short SHA）；部署前把当前 compose 备份为 `docker-compose.prev.yml` 并记录 `DEPLOYED_SHA`；部署后三端健康检查（后端 `/api/health`、前端经 nginx E2E、Keycloak realm 可用性）失败时自动回滚到上一版本并复检，回滚成功同样更新标记，回滚失败保留现场、输出日志并人工介入；`docker image prune -af` 移到健康检查通过/回滚成功之后，失败时不再提前清掉旧镜像；deploy 与备份的 concurrency 统一 `cancel-in-progress: false`，避免回滚中途被新 push 取消；`cleanup-images` 每周清理补充 keycloak 镜像。
- **AI 全链路超时对齐 + 客户端取消**：前端 analyze 请求增加 400s 安全超时与取消按钮（`AbortController` + `correlationId`），超时/取消/页面离开经 `POST /api/replay/analyze/cancel` 通知后端；后端 `AiCancellationRegistry` 中断 in-flight 上游调用并停止重试（稳定错误码 `AI_CANCELLED`），避免为无人等待的响应继续计费；`AiRetryPolicy` 不再重试 `AI_TIMEOUT`（上游可能已计费，重试会重复扣费）；容器 nginx `/api/replay/analyze` 代理超时 360s → 420s 对齐链路（前端 400s < 代理 420s，减少 504）；`AI_CANCELLED` 计入 `wotb_ai_review_errors_total` 可观测。

## [2.0.0] - 2026-06-29

### Changed
- Keycloak 从 26.1 升级至 26.6.3。
- Spring Security 启用 OAuth2 Resource Server JWT 认证，自定义嵌套 claim 提取（realm_access.roles）。
- 移除离线/桌面模式：删除 DesktopLifecycle、--desktop 启动参数、/api/shutdown 端点。
- 合并 @Profile("postgres") 为单一配置，移除双 profile 架构。
- 顶栏响应式优化（768/480px 断点）。

### Fixed
- JWT 角色提取：JwtGrantedAuthoritiesConverter 不支持嵌套 claim，改为手动解析。
- api.js 死代码清理（shutdown/getMe/getWotbAccount/getMyRecords）。
- PostgreSQL 18 volume 挂载路径适配。

## [1.9.0] - 2026-06-28

### Changed
- CI/CD 镜像从 DockerHub 迁移至 GHCR。
- `cleanup-images` workflow 改为清理 GHCR 旧版本（`actions/delete-package-versions@v5`）。
- PostgreSQL 18 volume 挂载点适配。
- 文档（README、java/README、HANDOVER、DEVELOPER_GUIDE）同步镜像路径。

## [1.8.0] - 2026-06-27

### Added
- nginx 单 server block，wotbtools.com/replay 合并

### Changed
- 移除 offline 版本。

## [1.7.0] - 2026-06-27

### Added
- `common/assets/` 单一来源（logo + favicon）。
- AGENTS.md 新增规则：三语 i18n、数据库迁移、安全、Java final。
- Java 全量 final 审计：局部变量、方法入参一律 `final`。

### Changed
- homepage 目录归入 `frontend/homepage/`。
- AGENTS.md 精简并增强（12 条规则 + 6 条禁止）。

## [1.6.0] - 2026-06-26

### Changed
- 后端删除未使用的 `/api/columns` 和 `/api/leaderboard/records/{id}` 端点（`/api/columns` 后续因列选择器需求恢复，当前仍存在）。

## [1.5.0] - 2026-06-26

### Added
- PostgreSQL 数据库：`postgres:18-alpine`，Flyway 管理 schema 迁移。
- `GlobalExceptionHandler`：统一异常 → JSON 错误响应。
- 部署健康检查：workflow 容器状态轮询。
- 离线版 Docker 分发：`offline/start.bat` + `offline/start.sh`。

### Changed
- 容器拆分：单镜像 → 三服务（postgres + backend + frontend）。
- 项目重构：`offline/` `frontend/` `online/` 移至仓库根。
- 前端重构：抽取 composables + utils，App.vue 缩减 68%。
- 离线版方案：jpackage exe → Docker 镜像分发。
- 数据库 schema 管理：`ddl-auto: update` → Flyway 版本化 migration。
- Hibernate 方言移除：`PostgreSQLDialect` 由 Spring Boot 自动检测。

### Removed
- 旧版 jpackage 离线 exe。
- 旧版单镜像 `Dockerfile`。
- ReplayService 与 LeaderboardService 耦合桥接。
