# Coach Lab 争霸赛复盘规范

2026 国服夏季赛四强 34 局（客户端 11.19，全部争霸赛）逐局人工复盘沉淀出来的分析规范、规则库和案例索引。每条判定都经过人类教练评分或纠正（败者组决赛 G2–G7 为授权默认同意）。

**它是团队 AI 复盘的最高优先级规则**：精简版作为 `java/wotb-ai/src/main/resources/prompts/tactical-skills/coach-standard.zh.md` 注入 Team Call #2 system prompt（紧跟 `team/reasoning-contract`），与旧 tactical-skills 模块冲突时以它为准。本目录是它的完整出处。

| 文件 | 内容 |
|---|---|
| `analysis-standard.md` | 分析流程、点数机制、判定标准（失误 / 正确 / 无法判定）、已知常见错误 |
| `rules.md` | RULE-001–020，每条带前提、正反例、例外和成熟度 |
| `casebook.md` | 33 局一行一局的根因、教训和对应规则，按局面分类索引 |
| `vehicles/11.19-china.md` | 11.19 国服车辆定位表（SPHT = 肉车为人工确认，其余待确认） |

维护约定：
- 规则或判定变化时，先改本目录，再同步 `coach-standard.zh.md` 和 `TeamPromptLocalizer.COACH_STANDARD_RULE_EN/RU`（`PromptRuleContractTest`、`TeamPromptLocalizerTest` 与 golden case `team-tactical-skill-v01-i` 会检查）。
- 新版本另建 `vehicles/<版本>.md`，不要沿用旧表。
- 逐局分析、配图、回放与分析脚本保存在 Coach Lab 项目共享目录（体积大，不入库）；`casebook.md` 里的 Case ID 对应那里的 `analyses/` 与 `lessons/`。
