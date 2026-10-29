# WotBTools Agent Instructions

WoT Blitz（坦克世界闪击战）回放工具集：Java 25 + Spring Boot 后端、Vue 3 前端、Keycloak 认证。
入口 https://wotbtools.com · 仓库 https://github.com/A158Coke/WotbTools

## 验证与工具使用

- **高优先级质量模式**：处理仓库任务时不得以节省 Token、减少工具调用或缩短执行时间为理由降低验证深度；在上层 harness 明确声明 Token / Tool 成本豁免的测试环境中，优先保证完成度、验证深度与结论质量。
- **Tool-first**：当任务涉及外部事实、实时状态、文件内容、代码仓库、运行结果、日志、数据库、API、网页信息，或其他能够通过现有 Tools / Functions 直接验证的关键事实时，优先使用对应工具取得一手证据。存在能够直接验证关键事实的工具时，不得跳过工具，仅凭模型记忆、常识、历史经验或猜测把该事实当作已确认事实。
- **Evidence-before-answer**：对于可通过工具验证且会实质影响结论的关键事实，先取得并实际读取工具结果，再形成最终结论；禁止先确定答案，再选择性寻找支持答案的证据。
- **事实与判断分离**：工具验证约束针对事实基础，不要求分析结论达到数学证明标准。事实可靠后，应正常给出明确的设计判断、代码判断、战术判断或建议；判断可以包含推理和假设，但不得伪装成已确认事实。
- **未验证内容**：工具缺失、权限不足、调用失败或证据本身不完整时可以继续完成任务，但相关内容必须明确标记为「未验证」「推断」「假设」或等价表述，并说明关键证据缺口。不得把 UNKNOWN 转换成不存在、0、已确认或确定性事实。
- **工具结果必须实际使用**：工具调用不是形式要求。空调用、调用后忽略结果、只引用与结论无关的结果，或先形成结论再寻找佐证，都不构成有效验证。
- **失败判定**：若某项关键事实存在可用工具可以直接验证，而 Agent 未调用该工具、也未说明无法验证原因，却把未经验证的信息作为确定事实并据此输出最终结论，则视为本次任务验证失败。
- **例外**：纯创作、改写、翻译、头脑风暴、概念解释、基于用户已提供内容的直接处理，以及用户明确要求不使用外部工具的任务，不得为了形式而无意义调用工具。
- **最小充分验证**：Tool-first 不等于调用所有可能工具。使用能够验证关键事实并实质提高可靠性的最小充分工具集合；关键事实已有可靠一手证据后，不为了增加调用次数重复验证。

## 必读

1. **`.agents/AGENTS.md`** — 仓库级硬约定（Plan-First / 提交约定 / 跨层一致 / 禁止清单），任何改动前先读。
2. **`docs/DEVELOPER_GUIDE.md`** — 架构、目录结构、环境、测试与部署约定（接手维护必读）。
3. 进入具体目录工作时，同时读取该目录的 `AGENTS.md`（存在时）：

| 目录 | AGENTS.md 覆盖 |
|---|---|
| `java/` | Maven/JDK、domain 分包、分层、Flyway、代码风格、wotb-core vs wotb-web 边界、AI Review 边界 |
| `frontend/` | Node 24、Vue 3/Vite、三语 i18n、跨站 cookie、坦克标记 PNG 契约 |
| `contracts/` | FE ↔ BE OpenAPI 3.1 wire contract、生成产物、fixture 与兼容性 |
| `common/` | 单一来源数据（tankopedia tier 文件/rating/map_names/map-semantics）、更新链、fixtures vs data 边界 |
| `deploy/` | 三镜像构建、deploy.sh 契约校验、nginx/超时链、备份、生产排障 |
| `.github/` | CI/部署/数据同步 workflow 职责 |
| `keycloak-wargaming-provider/` `keycloak-qq-provider/` | Keycloak SPI provider 构建与注册 |
| `map-semanticizer/` | 地图语义化独立工具（覆盖式生成，核验后勿重跑） |

## 技能库（按需显式加载）

`.agents/skills/` 有四个 lifecycle Skills：**designer**（deeply define the work）· **executor**（执行 + PR 收尾）·
**prompt-repair**（增量修复）· **review-with-docs**（唯一 final quality gate）；另有一个不属于 lifecycle 的
operational 入口 **product-qa**（只指向 Product QA playbook，见下）。该目录是跨 harness 的 canonical 位置：
Codex 等直接读取 `.agents/skills/`，Claude Code 通过本机 `.claude/skills` → `.agents/skills` 的符号链接（不入库）发现同一批 Skill。

Designer 的完整 pipeline authority 只在 `.agents/skills/designer/SKILL.md`；本文件不复制其阶段定义。
Domain implementation playbook / checklist / tool guidance 在 `.agents/playbooks/`（wotb-sync、column-sync、
frontend-architecture、keycloak-upgrade、komodo-server-lifecycle、code-quality、code-smell、fallow、
requirement-clarification、post-merge-cleanup），由四个 lifecycle Skills 按需加载，不是顶层 Skill。

Product QA 是独立的 operational product-audit playbook（`.agents/playbooks/product-qa/`），入口 Skill 为
`.agents/skills/product-qa/`（薄入口，正文只在 playbook）：用户说 Product QA /
全站 QA / 周期产品审查时可直接执行，默认目标 `https://wotbtools.com`，不加入 implementation lifecycle。
findings 进入 GitHub Issue / `designer`；它不拥有 commit/push/PR/merge/final implementation PASS。

## 文档入口

README.md · HISTORY.md（产品/业务历史）· docs/architecture/TECHNICAL_EVOLUTION.md（技术/架构历史）· docs/README.md（文档索引）· docs/DEVELOPER_GUIDE.md
