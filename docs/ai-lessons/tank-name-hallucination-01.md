# AI Lesson：tank-name-hallucination-01 — 坦克名幻觉（Kranvagn 被写成「埃米尔1951」）

- **案例 id**：`tank-name-hallucination-01`
- **场景**：训练房团队复盘（CHRD vs A178，回放
  `20260725_1600__CHRD-A158布丁_A178_SPHT_9034890693886323`），我方玩家 Awesomeman954 驾驶
  Kranvagn（tankId 4481，tier 10，tankopedia 基础血量 2400）；AI 在「1分07秒」写成
  「埃米尔1951（Awesomeman954）」，且错误保持全文。
- **AI 常见误判**：把坦克名称翻译成中文译名、或写成原型/相似车——EMIL 1951（tankId 4737，
  tier 8，基础血量 1750）与 Kranvagn 共用原型底盘，极易混；错误一旦出现会沿全文传播。
- **正确判定**：玩家处的坦克名必须以本场 roster 权威名（tankId → tankopedia）为准，本案例应写
  Kranvagn。模型在错误行写「基础满血 2400」与 Kranvagn 一致，说明它用了正确数据却写错了名字——
  是生成侧幻觉，不是解析/结算/证据数据 bug。
- **判定依据**：确定性后校验 `TankNameCorrector`——R1 昵称锚定纠正（`坦克名（昵称）` /
  `昵称（坦克名）` / 「的」所属式，与 roster 权威名不一致即替换）、R1+ package 级两阶段传播
  （analysis 与 preBattleSection 视为一个 correction package：Pass 1 跨全部段收集昵称锚点已证明
  的「错名 → roster 车」唯一共享映射，Pass 2 逐段传播到同一 canonical 的 standalone 提及——
  别名/英文原文一并修正，与出现顺序无关）、R2 别名与大小写归一化
  （`common/tank-name-aliases.json`，如 KRV/克朗瓦根/埃米尔1951 → 权威名）、R3 无昵称锚定/
  有歧义的非 roster 已知车名只记录不改写（DETECTED，fail closed 不猜测）。
  `AiReplayReviewService.correctTankNames` 在 `done.analysis` 前对正文与 preBattleSection
  应用；流式中间 token 不纠正（最终事件为准）。传播 fail closed 边界：source canonical 本身在
  roster（standalone 可能是真车）、或同一错名被多个锚点指向不同 roster 车（映射冲突）时不传播。
- **对应 golden case**：无（零容忍回归由
  `TankNameCorrectorTest.productionCase_kranvagnWrittenAsEmil1951_isCorrected` 承担；
  synthetic 复现收益低，v1 不做 ai-eval case）。
- **规则引用**：prompt「坦克名称专有名词规则（强制）」新增禁止中文翻译与相似车替代条款
  （`PlayerPromptRules.COMMON_TANK_PROPER_NOUN_RULE` 与
  `prompts/{team/single,player/fallback,player/single,player/tactical}.zh.md` 逐字一致；
  `prebattle/system.zh.md` 第 4 条同步）。
