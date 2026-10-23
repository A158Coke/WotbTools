# Coach Lab 争霸赛复盘规范

2026 国服夏季赛四强 34 局（客户端 11.19，全部争霸赛）逐局人工复盘沉淀出来的分析规范、规则库和案例索引。每条判定都经过人类教练评分或纠正（败者组决赛 G2–G7 为授权默认同意）。

**团队 AI 复盘使用它的判定格式和条件规则**：精简版作为 `java/wotb-ai/src/main/resources/prompts/tactical-skills/coach-standard.zh.md` 注入 Team Call #2 system prompt（紧跟 `team/reasoning-contract`）。精简版每条规则都保留关键前提与例外，只在前提有当时证据时适用，不声明覆盖其他模块。本目录是它的完整出处。

| 文件 | 内容 |
|---|---|
| `analysis-standard.md` | 分析流程、点数机制、判定标准（失误 / 正确 / 无法判定）、已知常见错误 |
| `rules.md` | RULE-001–020，每条带前提、正反例、例外和成熟度 |
| `casebook.md` | 33 局一行一局的根因、教训和对应规则，按局面分类索引 |
| `solo-standard.md` | 随机战（野队）个人复盘规范 v1.0：操作 80% / 意识 20%，S-001–S-007、S-101–S-103，34 场全量统计和 7 局案例，适用于有完整开炮/装填数据的离线复盘。生产 prompt `prompts/tactical-skills/solo-standard.zh.md` 只取当前 AI 投影能判定的 S-002、S-101，不带样本统计和权重，注入 `player/single`、`player/fallback`、`player/tactical` |
| `vehicles/11.19-china.md` | 11.19 国服车辆定位表（SPHT = 肉车为人工确认，其余待确认） |

维护约定：
- 规则或判定变化时，先改本目录，再同步 `coach-standard.zh.md` 和 `TeamPromptLocalizer.COACH_STANDARD_RULE_EN/RU`（`PromptRuleContractTest`、`TeamPromptLocalizerTest` 与 golden case `team-tactical-skill-v01-i` 会检查）。
- 随机战个人复盘规范变化时，先改 `solo-standard.md`，再判断新规则所需的证据是否在 `ClientAiReviewProjection` 里（`unavailableEvidence` 里的不进生产 prompt），然后同步 `solo-standard.zh.md` 和 `PlayerPromptRules.SOLO_STANDARD_RULE_EN/RU`（`PromptRuleContractTest` 会检查）。
- 精简进 prompt 的团队规则必须带上 `rules.md` 里的关键 Preconditions / Exceptions。
- 新版本另建 `vehicles/<版本>.md`，不要沿用旧表。
- 逐局分析、配图、回放与分析脚本保存在 Coach Lab 项目共享目录（体积大，不入库）；`casebook.md` 里的 Case ID 对应那里的 `analyses/` 与 `lessons/`。
