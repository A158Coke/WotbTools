# Internal Playbooks

这些是内部 playbook / checklist / tool guidance，不是顶层 Skill，不参与“现在处于生命周期哪一阶段”的选择。

顶层只有四个 orchestrating Skills：

1. `designer` — 需求澄清与方案设计，产出 approved `docs/current-plan.md`。
2. `executor` — 执行已批准计划、targeted validation；review-with-docs PASS 后 commit/push/open PR；merge 后 cleanup。
3. `prompt-repair` — 基于现成 repair prompt / PR findings 做增量修复。
4. `review-with-docs` — 唯一 final quality gate。

## 加载规则

| Playbook | Loaded by | When |
|---|---|---|
| `requirement-clarification.md` | designer | 需求模糊、边界不清、验收标准缺失 |
| `wotb-sync.md` | designer / executor / prompt-repair / review-with-docs | 跨层改动：解析、列、API、导出、i18n、auth、Flyway |
| `column-sync.md` | designer / executor / prompt-repair / review-with-docs | 新增/重命名/删除数据列 |
| `frontend-architecture.md` | designer / executor / prompt-repair / review-with-docs | 前端目录、路由、状态 ownership、API transport 边界 |
| `keycloak-upgrade`（目录） | executor / prompt-repair / review-with-docs | Keycloak / SPI / provider 版本升级 |
| `komodo-server-lifecycle.md` | executor / prompt-repair / review-with-docs | 新增/迁移/下线服务器、Komodo Stack、持久数据迁移 |
| `product-qa/`（目录） | review-with-docs | 明确要求真实浏览器黑盒 QA / 易用性验收 |
| `code-quality.md` | review-with-docs | 代码质量 6 项检查 |
| `code-smell.md` | review-with-docs | 过度设计 / 无意义抽象 / 架构复杂化品味审查 |
| `fallow.md` | review-with-docs | 前端 dead-code / circular-deps / duplication / complexity 诊断 |
| `post-merge-cleanup.md` | executor | PR merge 后清理分支、worktree、current-plan 与任务状态 |

## 边界

- Playbook 回答“这个领域具体应该怎么做”。
- Top-level Skill 回答“现在处于生命周期哪一阶段”。
- 只有 `review-with-docs` 可以判定 final quality gate / zero blocker。
- `designer` 不 review；`executor` 不自行判定 review pass；`prompt-repair` 不自行判定 final pass。
