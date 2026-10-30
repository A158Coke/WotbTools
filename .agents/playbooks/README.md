# 内部 Playbooks

这些是内部 playbook / checklist / tool guidance，不是顶层 Skill，不参与“现在处于生命周期哪一阶段”的选择。

lifecycle 只有四个 orchestrating Skills（另有一个不参与 lifecycle 的 operational 入口 `product-qa`，见下）：

1. `designer` — deeply define the work；完整设计 pipeline authority 只在 `.agents/skills/designer/SKILL.md`，产出已批准/授权的 `docs/current-plan.md`；授权、手贴计划规范化与偏差边界只由该 Skill 定义。
2. `executor` — 执行已批准/授权的文件或手贴计划、targeted validation；review-with-docs PASS 后 commit/push/open PR；merge 后 cleanup。
3. `prompt-repair` — 基于现成 repair prompt / PR findings 做 minimum-delta 增量修复；只有 finding 按 Designer 偏差边界证明设计实质失效才返回 Designer。
4. `review-with-docs` — 验证 implementation against plan + repository reality + canonical docs + acceptance criteria 要求的 runtime evidence；唯一 final quality gate。

## 加载规则

领域实现 playbook 由四个 lifecycle Skills 按需加载。`product-qa/` 是例外：它是独立 operational product-audit playbook，由用户显式触发（Product QA / 全站 QA / 周期产品审查），不由 lifecycle Skills 加载，也不属于 PR final gate；它的薄入口 Skill 是 `.agents/skills/product-qa/`，只指向本目录的 README，不复制正文。

| Playbook | 加载方 | 时机 |
|---|---|---|
| `requirement-clarification.md` | designer | Designer Phase 1 中需求模糊、边界不清、验收标准缺失时 |
| `wotb-sync.md` | designer / executor / prompt-repair / review-with-docs | 跨层改动：解析、列、API、导出、i18n、auth、Flyway |
| `column-sync.md` | designer / executor / prompt-repair / review-with-docs | 新增/重命名/删除数据列 |
| `frontend-architecture.md` | designer / executor / prompt-repair / review-with-docs | 前端目录、路由、状态 ownership、API transport 边界 |
| `keycloak-upgrade`（目录） | designer / executor / prompt-repair / review-with-docs | Keycloak / SPI / provider 版本升级 |
| `komodo-server-lifecycle.md` | designer / executor / prompt-repair / review-with-docs | 新增/迁移/下线服务器、Komodo Stack、持久数据迁移 |
| `product-qa/`（目录） | 独立（用户显式触发） | 周期性 / 显式 production product audit（默认 `https://wotbtools.com`）；不是 PR final gate |
| `code-quality.md` | review-with-docs | 代码质量 6 项检查 |
| `code-smell.md` | review-with-docs | 过度设计 / 无意义抽象 / 架构复杂化品味审查 |
| `fallow.md` | review-with-docs | 前端 dead-code / circular-deps / duplication / complexity 诊断 |
| `post-merge-cleanup.md` | executor | PR merge 后清理分支、worktree、current-plan 与任务状态 |

## 边界

- Playbook 回答“这个领域具体应该怎么做”。
- 顶层 Skill 回答“现在处于生命周期哪一阶段”。
- 只有 `review-with-docs` 可以判定 final quality gate / zero blocker。
- `designer` 不做 production implementation / final implementation review；`executor` 不自行判定 review pass；`prompt-repair` 不自行判定 final pass。
- Product QA findings 需要开发时进入 GitHub Issue / `designer`；Product QA 不拥有 commit / push / PR / merge / final implementation PASS。
