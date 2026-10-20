---
name: executor
description: >
  开发生命周期的实现与收尾阶段：执行 docs/current-plan.md 中已批准的计划，做 targeted validation，
  在 review-with-docs PASS 后 commit/push/open PR，并在 merge 后清理 worktree、分支与计划文件。
  Trigger: 用户说"执行 current-plan / 按计划执行 / 继续执行计划"、计划已由 designer 批准，
  或用户针对已合并 PR 明确要求 post-merge cleanup / 清理 worktree / 清理已合并分支 / 收尾。
  它不设计需求、不自行判定 review pass；final quality gate 只属于 review-with-docs。
---

# Executor（计划执行 + PR 收尾）

> 生命周期位置：approved current-plan → **Executor** → targeted validation → Review With Docs。
> 只有 review-with-docs PASS 后，Executor 才 commit/push/open PR；merge 后加载
> `.agents/playbooks/post-merge-cleanup.md` 做 post-merge cleanup。

定位：把已批准的《开发方案单》（`docs/current-plan.md`）落地为代码；或在 PR 已确认 merge 后执行
生命周期收尾。实现阶段不重新讨论方案、不扩大范围、每步可独立验证。

## 输入

二选一：

- 实现路径：`docs/current-plan.md`（必须完整读取，不要跳过任何章节）；
- post-merge cleanup 路径：已合并 PR / merge commit / 已确认合并的任务分支。此路径不要求存在
  `docs/current-plan.md`，先验证 merge 事实，再加载 `.agents/playbooks/post-merge-cleanup.md`。

## 流程

0. **Post-merge cleanup fast path**：若用户请求仅为已合并 PR 的 cleanup / 收尾，先验证目标 PR
   的 `merged=true` 或等价 merge commit 事实；确认后直接加载 `.agents/playbooks/post-merge-cleanup.md`
   执行其 cleanup contract。若无法确认已合并，停止并汇报，不把未合并任务当 cleanup。此路径不进入
   下方 implementation phases，也不要求重新创建/读取 approved plan。
1. **完整读取计划**：实现路径读 `docs/current-plan.md`，按 Designer canonical schema 读取 `# Execution Steps`（每步的 `Status` / Goal / Scope / Files / Change / Validation / Commit boundary）、`# Impact Surface`、`# Validation / Outside Judge`、`# Non-Goals`、`# Unverified Assumptions` 与 `# Evidence Gaps`。不假设另外存在“分步计划状态表”“影响面清单”“验收标准”“待确认项”等第二套字段。
2. **授权校验**：plan 必须已获用户批准；`# Unverified Assumptions` / `# Evidence Gaps` 中存在未确认且会阻塞执行的项 → 停下汇报，不执行；用户明确说"执行/批准"即视为已授权。
3. **从已验证的最新 main remote 创建任务 worktree 与分支（分支名符合任务主题）**：
   - 从计划内容提取主题：优先 `# Goal` / `# Actual Outcome`；无明确标题时用 `# Impact Surface` 中最核心的动词短语。
   - 分支名 grammar：`<branch> = feat/<kebab-case-suffix> | fix/<kebab-case-suffix> | refactor/<kebab-case-suffix> | chore/<kebab-case-suffix>`。
     suffix 必须为 lowercase，只允许字母、数字与连字符；不得有空格或额外 `/`；必须能直接看出任务主题；
     总分支名长度 ≤ 60。`/` 只允许作为上述 prefix 与 suffix 之间的单个 separator。
   - 先确认当前 worktree 的未提交改动、现有 worktree、`git remote -v` 与同名分支；
     不切换或修改其他任务的检出。确认实际承载 upstream/main 的 remote，并记录为 `<remote>`；
     同时记录精确 main baseline：`<main-ref> = <remote>/main`。后续所有 main baseline 命令与 final review handoff
     都复用这个已验证 `<main-ref>`，不得重新猜 remote 或默认 `origin/main`。
   - 执行 `git fetch <remote> main`，以更新后的 `<main-ref>` 为新任务起点；涉及 main baseline 的
     merge-base / compare / worktree 命令也统一使用 `<main-ref>`。
   - 新任务优先使用 Codex 的 `create_worktree`；工具不可用时用
     `git worktree add -b <branch> <task-worktree-path> <main-ref>`。
     worktree 路径应独立且能识别任务。若同名分支或 worktree 已存在，确认其属于当前计划后
     复用并说明；无法确认时停下询问，不重置或覆盖。
   - 在任务 worktree 中确认分支与起点；后续读取、编辑、验证、提交、推送和开 PR
     均以该 worktree 为工作目录。若批准的计划仅存在于原检出，先将该计划文件带入任务
     worktree 并核对内容，保留原检出及其其他改动。
4. **确定执行顺序**：按 `# Execution Steps` 顺序执行 `Status: PENDING` 的步骤；
   只执行当前计划内步骤。
5. **逐项执行（每步）**：
   - 读该步 `Scope / Files`、`Change`、`Validation`，并对照 `# Impact Surface` 定位相关代码（用 `rg` / `rg --files`）；
   - **Reuse Audit（新增 production type/file 前）**：先 `rg` / repo-wide 搜索候选现有实现，优先 reuse / extend；如仍需新增，在实现 reasoning 中明确为什么现有 abstraction 无法合理承载（按 `.agents/AGENTS.md` 的 Reuse / Extend First contract，只引用不复制、无需长 ADR）；
   - 开始该步前把 `Status` 置为 `IN_PROGRESS`；
   - 实现，遵循项目约定（`.agents/AGENTS.md`、`.agents/playbooks/wotb-sync.md` 跨层检查单）；
   - 运行该步 `Validation`；失败先修复再前进；
   - 该步 `Status` 置为 `DONE`，并在 commentary 简短汇报。
6. **阻塞处理**：遇到依赖用户决策、外部数据或超出计划范围的改动时，把该步 `Status` 置为 `BLOCKED`，
   停下汇报并给出选项；不静默扩大范围、不自行改方案。若 repository reality 证明 approved plan 的关键 assumption 错误
   （`# Unverified Assumptions` 失效），停止执行并返回 Designer / 用户，不得在 Executor 内悄悄 redesign。
7. **全部完成后**：
   - 按 `# Validation / Outside Judge` 与 `# Final Verification` 逐条验证（映射到具体测试/检查，禁止口头宣称通过）；
   - 运行本任务 affected regression tests（targeted / module / feature）；
     repository-level full validation 交由 PR CI 统一执行，**不在任务结束重复跑全量**（仅在 `.agents/AGENTS.md`
     的 Full-test 例外情形下才跑全量，并须先声明 Affected scope / Selected validation / Why）；
   - 影响行为/文档时更新对应 canonical 当前状态文档；只有确有长期历史价值时才更新历史：产品 / 业务演进归 `HISTORY.md`，技术 / 架构 / 数据流 / 身份 / 生产拓扑 / 工程演进归 `docs/architecture/TECHNICAL_EVOLUTION.md`，不要求每个改动都更新历史；
   - 汇总：修改文件、测试结果、仍存在的真实限制；
   - **自动调用 review-with-docs 审查**（必须执行，不是建议）：读
     `.agents/skills/review-with-docs/SKILL.md`，并把步骤 3 已验证的精确 `<main-ref>` 作为 final-gate 输入交给它；
     Review With Docs 必须复用这个 baseline，不得重新默认 `origin/main`。对本次全部变更执行其流程
     （代码质量审查 + 文档同步 + AI 死代码清理）。审查范围必须是完整 candidate tree：
     committed range（以 `<main-ref>` 为 base）+ staged + unstaged tracked + untracked implementation files；
     不得先 commit 以制造干净 diff，也不得只看 `<main-ref>..HEAD`。审查发现的问题先修复，
     再复查直到零问题；单轮无法闭环的阻塞项停下汇报。
   - **review-with-docs 零 blocker 即验收通过，PASS 后才提交并开 PR**：提交（git add/commit，
     中文信息 + Co-Authored-By，按 `.agents/AGENTS.md` 约定）→ 推送 → `gh pr create`，
     无需再等用户指示；存在 blocker/未闭环问题时禁止开 PR。
8. **计划文件收尾**：所有 execution step 的 `Status` 置为 `DONE`；按 `current-plan.md` 头部约定
   决定清理回初始状态（默认保留完成记录，询问用户是否清理）。
   任务分支与提交保留；review-with-docs 零 blocker 时按步骤 7 在 PASS 后开 PR。
   PR 合并后加载 `.agents/playbooks/post-merge-cleanup.md` 清理分支、worktree 与计划文件。

## HTTP Contract Audit

涉及 API/跨层 shape 时，核对 `contracts/http/openapi.yaml` 是否为唯一 wire authority；确认 generated FE artifacts 已重生成且无 drift、required/nullable/enum 与实际序列化一致、domain→transport mapping 显式、旧 artifact 兼容仅在读取边界、ApiError 与 204 语义未被混淆。

## 规则

- 新任务必须先验证实际 upstream/main remote，再基于最新 `<main-ref> = <remote>/main` 创建独立 worktree 与主题分支；续做任务可复用其已有 worktree。所有变更只落在任务 worktree，不在 main 或其他任务的检出中执行。
- 已验证 `<main-ref>` 是 Executor → Review With Docs 的 lifecycle handoff 信息；final gate 必须复用它，不得重新硬编码或猜测 remote。
- 只执行计划内任务：`# Non-Goals` 内的改动一律不做。
- 每步必须有验证，禁止"改完就继续"；每步 `Status` 按 `PENDING → IN_PROGRESS → DONE`，真实阻塞置 `BLOCKED`。
- `# Unverified Assumptions` / `# Evidence Gaps` 中未确认且阻塞的项，未获用户答复前不得执行。
- 发现方案与代码事实冲突时停下汇报（引用 `文件:行`），不擅自推翻已批准方案。
- 执行完成后必须调用 review-with-docs 审查并闭环（修复 → 复查 → 零问题），
  审查结果写入最终汇报；本技能不替代审查。review-with-docs 零 blocker 后允许
  PASS 后提交并开 PR（无需再等用户指示）；存在 blocker/未闭环时不得开 PR。

## Post-merge cleanup

PR merge 后，加载 `.agents/playbooks/post-merge-cleanup.md`：切回 main 并更新、清理 `docs/current-plan.md`、删除任务 worktree、删除已合并 PR 的本地/远端分支。fresh-context 的 cleanup 请求也由本 Skill 的 fast path 进入这里，不要求重新拥有 approved plan。

## 内部 playbooks

按需加载 `.agents/playbooks/`：`wotb-sync.md`、`column-sync.md`、`frontend-architecture.md`、`keycloak-upgrade/`、`komodo-server-lifecycle.md`、`post-merge-cleanup.md`。它们不是顶层 Skill，不参与生命周期选择。