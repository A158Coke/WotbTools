# AGENTS.md — 仓库级硬约定（repository-wide）

**默认 caveman mode**：回复极简、砍废话、无寒暄。用户说"退出 caveman"才恢复正常。

> 按作用域继承：进入具体目录时同时读取该目录的 `AGENTS.md`（contracts/java/frontend/common/deploy/.github/
> keycloak 两个 provider/map-semanticizer）。构建/运行命令见 `docs/DEVELOPER_GUIDE.md`，不在本文件重复。

项目：WoT Blitz `.wotbreplay` 回放工具集（解析/Excel/排行榜/评分/AI 复盘/Keycloak）。入口 wotbtools.com。

## 接手与调整方法（固定流程）

每次新任务先按这条路径接手；除非用户明确要求只做单个命令或只回答问题，否则默认执行到可交接状态。

1. **入口阅读** — 始终读根 `AGENTS.md`、本文件、当前 lifecycle Skill 与实际涉及目录的 `AGENTS.md`。`docs/DEVELOPER_GUIDE.md`、`docs/README.md` 作为索引，按任务定位相关章节、canonical owner 与领域 playbook；接手全仓维护 / onboarding 或 architecture-wide 任务才全文读 Guide。所有适用硬规则仍须加载，不递归预读所有链接；同一 revision 已读内容跨阶段复用，压缩上下文后按需恢复。
2. **现实审计** — 先确认 `git status --short --branch`、`git remote -v`、当前分支/HEAD 与已有未提交改动；再用 `rg` 追真实调用链、配置、测试与文档。真实代码是 source of truth，文档只作为待校验线索。
3. **任务分类** — 判定是问答/排障、文档、小修、feature、大范围重构、跨层改动、数据/导出/API/部署/Android runtime。问答/排障可直接回答；未提供可执行计划的 development task（含小修、bug fix、CSS、i18n、hotfix）进入 Designer → approved/authorized current-plan → Executor → Review With Docs；用户已提供计划时按 Designer 的规范化入口交给 Executor。跨层改动加载 `.agents/playbooks/wotb-sync.md`；增删列加载 `.agents/playbooks/column-sync.md`。
4. **计划契约** — 计划必须写清范围、非目标、影响面、SSOT、风险、验证档位、回滚/失败处理，编码前写入唯一 `docs/current-plan.md`；授权来源、手贴输入规范化与自动交接 / 必须批准边界只按 Designer「授权、计划输入与偏差边界」。Plan schema 唯一来源是 `.agents/skills/designer/SKILL.md`；Executor 只消费该 schema，不定义第二套 current-plan format。
5. **Reuse / SSOT 执行** — 新增 production abstraction 前先做 Reuse Audit；优先复用/扩展现有结构，避免第二份事实源。改动影响界面、导出、数据、构建、用法或运维时，同步更新文档。
6. **分层验证** — 先 targeted，再 module/feature，只有触发 Full-test 例外才跑 repository-level full validation；每次说明 Affected scope / Selected validation / Why，避免重复跑已失效范围外的测试。
7. **收尾交接** — Review With Docs 是唯一 final quality gate；通过后 Executor 再 commit/push/open PR；最终说明改了什么、验证了什么、未验证什么、剩余风险和下一步。

## 规则

1. **Plan-First** — 未提供可执行计划的新 development task 先走 `designer`，再按其授权边界交给 `executor`；用户提供的可执行计划按同一 Skill 的规范化入口消费，不因格式重新设计。小修 / CSS / i18n / hotfix 同样不得无计划直接编码。Plan schema、授权与偏差边界只以 `.agents/skills/designer/SKILL.md` 为准。

2. **生命周期（BLOCKER）** — 需求 → `designer` → approved/authorized `docs/current-plan.md` → `executor` → `review-with-docs`（唯一 final gate）→ PASS 后 executor commit/push/open PR → merge 后 executor 按 `.agents/playbooks/post-merge-cleanup.md` 收尾。PR reviewer findings → `prompt-repair` → `review-with-docs`。缺少适用执行授权不得编码；`review-with-docs` 未 PASS 不得开 PR。各阶段内部流程只维护在对应 Skill。

3. **文档生命周期与权威归属（BLOCKER）** — canonical 文档只描述合并后的当前系统：`HISTORY.md` 只写产品/业务史，`docs/architecture/TECHNICAL_EVOLUTION.md` 只写技术史；分层、例外、future-only 归属与存量偏差过渡见 `docs/README.md`「文档分层与权威归属」。
   - **语言（BLOCKER）**：持久开发者 / 维护者 / 运维文档正文使用简体中文；类名、函数/类型名、源路径、API path、HTTP method、配置 key、error code、enum、event、schema 字段、命令、外部产品名与上游原文保留规范英文。英文正文 = BLOCKER。
   - **current-plan 门禁（BLOCKER）**：永久源码、配置、文档不得引用 `docs/current-plan.md` 作为架构/行为权威；`scripts/ci/check-repository-hygiene.sh` 对每个 PR 变更文件强制，结构性例外见 `is_current_plan_allowlisted()`；遗留引用在被触及或明确治理时迁移。
   - 禁止 `archive/`、`old/`、`legacy-docs/`、`historical/` 等历史堆放目录与 “Historical” 标签；Git 历史就是归档。
   - 更新文档只描述结果状态：禁止变更日记与实现过程叙事（本 PR / 本次 / 审查基线 / Step / 未来 Kx / 以最终实现为准）。
   - 影响界面、导出、数据、构建、用法或运维时同提交更新 canonical 文档；先找现有 owner，不新建 Markdown 分摊旧段落。

4. **跨层一致** — 列 key（snake_case）在 API / 前端 / 导出三方一致；显示名在前端三语 locale 与导出两处一致。跨层改动走 `.agents/playbooks/wotb-sync.md`；增删列再走 `.agents/playbooks/column-sync.md`。

5. **API 纯英文** — 只回 key+数据；中文归前端/导出。

5a. **HTTP Contract First** — FE ↔ BE 序列化契约唯一事实源是 `contracts/http/openapi.yaml`；generated FE transport 不手改，domain enum 必须显式映射，旧 artifact 兼容只放读取边界。不存在 Control ↔ Worker / MQ 契约。

6. **测试策略 — Fast Feedback First** — 开发中禁止无理由重复运行 repository-level full test。
   - 本地必做：**Targeted**（直接相关最小测试集）→ **Module / Feature**（affected 范围回归）→ **Regression**（review/fix 后）；三者不受 Full-test 例外限制。
   - Repository validation 由 PR CI 统一执行（authoritative gate：`CI / Required Gate`）；Agent 开 PR 前不默认跑 Java 全量 `mvn test`、frontend 全量 `pnpm test` 或 `pnpm run build`。
   - **Full-test 例外**（仅以下情形可主动跑 repository-level full validation）：用户明确要求 full test；改 Maven parent / dependencyManagement / plugin 配置、Node/Vite/Vitest 全局配置、跨 module 公共 contract、architecture rules、test infrastructure，或 build infrastructure 且 targeted 无法判断影响面；CI 不可用但需高置信验证或 affected scope 无法可靠确定；CI 前必须用 full suite 复现 / 排查，或安全上无法用 targeted/static 确认。触发前必须说明 Affected scope / Selected validation / Why，禁止「为了保险再跑一次」。
   - 推送前仍需 `git diff --check`、生成契约检查与安全 / 配置静态检查；CI 失败只复现失败 job 的最小范围。
   - 去重：同一任务内已通过且相关代码 / 依赖 / 测试配置未变化 → 不重复运行；review 修复后只重跑失效范围。优先原生校验器与真实集成测试，不用源码文本断言；只有项目特有架构 / 生产安全不变量才新增自定义 contract/policy test。
   - 测试入口最小化：默认禁止新增 standalone `test-*.sh` / `*-contract.sh`，先按 `reuse > extend > merge > create` 复用现有入口；确需独立入口时说明原因。具体命令与分层见 `java/AGENTS.md`、`frontend/AGENTS.md`。

7. **Review With Docs 闭环（BLOCKER）** — 任何实现完成后都进入 `review-with-docs`；代码质量（含品味，见 `.agents/playbooks/code-quality.md`）、fallow、文档、架构与领域 playbook 检查是其内部阶段。先构造 task-related candidate files 并显式记录 exclusions；candidate 非空且 calculated review scope = 0 时 BLOCKER；scope 非零仍须证明每个 task-related file 已审查或有等价覆盖证据。只有它可以输出 final PASS / zero blocker；PASS 后 Executor 才 commit/push/open PR。

8. **Git** — 推送前 `git remote -v` 确认实际 remote（不写死）；仓库账号 A158Coke；提交信息中文，尾带 `Co-Authored-By`。禁止 force push、改写已公开历史、动与当前任务无关的分支/PR。

9. **子代理** — spawn 后必须显式验证子代理完成状态与产物，不得假设自动完成；完成后醒目通知用户。

10. **大需求拆分** — 一次性大需求拆为多个小任务，每个小任务一个子代理，主代理最后执行 `review-with-docs` final gate。

11. **Ponytail — 懒资深工程师模式** — 先理解问题（任务、触碰代码、端到端流程），沿梯子停在第一个成立档：不建 → 复用 → 标准库 → 平台特性 → 已装依赖 → 一行 → 最小代码。Bug fix 修根因：grep 全部调用方，在共享函数修一次。删优于增、文件数最少；故意抄近路留 `ponytail:` 注释写明天花板与升级路径；非平凡逻辑留最小自检。不得省：输入校验、防数据丢失、安全、可访问性、明确要求的功能。

12. **Reuse / Extend First — 单一 SSOT 优先** — 新建 abstraction 顺序：`reuse > extend > simplify/merge > create`。新增 production class / interface / record / DTO / util / helper / service / manager / resolver / facade / enum / module / file 前必须做 repo-wide Reuse Audit：是否已有同职责实现、能否复用 API / 扩展现有 abstraction、是否只是搬迁逻辑、是否形成第二 SSOT、维护成本是否真的更低。仅当现有结构无法合理承载时才新建；禁止单调用方 wrapper/helper/manager/resolver/facade、机械 clean-architecture 分层、第二份业务 switch/rule/validation contract。Skills 只引用本规则。

13. **外部数据生命周期** — 持久化外部 API 返回的个人或统计数据时，必须同时提供 retention/deletion path；删除需限定数据来源、遵守真实 FK 顺序，并保护仍被其他业务引用的共享文件或记录。

14. **Android Version-as-Code** — Android production runtime 改动必须递增 committed `android/gradle.properties:wotbVersion`；不得手改 `versionCode` 或依赖 release workflow 版本参数。Native Bridge breaking change 必须同 PR 更新 `contracts/android-native-bridge.json`、递增 `bridgeVersion`、更新 Native/FE，并通过 deterministic compatibility tests。FE 远程加载先让 FE 兼容旧/新协议再发 Native；FE 随 APK 打包时 FE 与 Native 同版本发布，由 contract gate 与 `guard_bridge_covered` 强制 support floor 覆盖 cutover。完整发布与版本锁定以 `docs/android/release-process.md` 为 authority；support floor 由 production `version.json` 与该文档共同定义，frontend architecture 不重复固定。

15. **PR 跟进循环 — 会话内低频监控** — 仅在用户授权的当前会话内跟进指定 PR；不跨会话持久化状态、不新增状态文件或第二 SSOT。启动/恢复与每次 push 后重读 PR、Review、comments、HEAD SHA、required checks 与 mergeable，CI 结论只归属该 SHA；按最后已处理 Review / Comment ID 去重并补扫；仅在环境支持非阻塞有限后台任务与完成通知恢复时启动后台监控，禁止前台 sleep 轮询、阻塞 watch、无限任务、跨会话服务。预算与事件处理见 `.agents/playbooks/pr-follow-up.md`；合并后清理只委托 executor 与 `.agents/playbooks/post-merge-cleanup.md`，本规则不定义清理命令。

## 视觉验证归属（2026-10-03）

**3D 回放、坦克/模型查看、场景渲染等“看起来对不对”的验收由用户执行。** Agent：

- 不启动/驱动浏览器去读屏、截图或目视核对 3D 画面，也不拿截图当验收证据；3D 画面依赖真实 GPU/地形/资产面状态，分离或无头浏览器给不出可信结论。
- 交付方式：实现 + 锁定不变量的测试（纯函数单测、场景源码级接线守卫、既有 `pnpm run test:browser-*` 自动化门禁），然后明确写出「需要人工看什么」交给用户确认。
- 上游 Agent 仓（WoT-Blitz-Agent）的 `frontend/` 已冻结、不再维护：前端改动与前端测试都在本仓。

## 本机测试（全功能联调）

完整 runbook 见 [`docs/frontend/local-testing.md`](../docs/frontend/local-testing.md)。Agent 引擎产物由 `scripts/fetch-agent-wasm.sh` + `deploy/agent/source.json` pin 管理；换 pin 时同时按 runbook 重生成并核验 AI projection golden。管理权限只信 access token `realm_access.roles`；任何 URL 参数不得提升权限。受保护 `/api/admin/**`、`/api/ai/**` 按真实 token 鉴权。

## 禁止

- 改 `target/` `node_modules/` `dist/` `.m2repo/` 内文件（`scripts/ci/check-repository-hygiene.sh` 拒绝其入库）
- 按终端乱码判文件损坏
- API 塞中文；模块内放 tankopedia 副本
- 使用公司 token/凭据；把 secret/环境变量写进仓库
- 在付款/赞助页面或代码中硬编码个人收款信息
- 用推测值冒充权威方向/可见性（回放数据只信已证明的解码，见 `docs/research/replay/protocol.md`）

## Skills（.agents/skills/，四个 lifecycle Skills + operational / 收尾薄入口）

1. **designer** — deeply define the work；完整 pipeline authority 在 `.agents/skills/designer/SKILL.md`，产出已批准/授权的 `docs/current-plan.md`，授权与停止条件只在该 Skill 定义。
2. **executor** — execute approved/authorized 文件或手贴 plan、targeted validation、review-with-docs PASS 后 commit/push/open PR、merge 后 cleanup。
3. **prompt-repair** — reviewer findings 的 minimum-delta 增量修复；只有 finding 按 Designer 偏差边界证明设计实质失效才返回 Designer。
4. **review-with-docs** — 验证 implementation against plan + repository reality + canonical docs + runtime evidence；唯一 final quality gate。

Domain implementation playbooks、检查单与工具指南在 `.agents/playbooks/`，由四个 lifecycle Skills 按需加载；它们不是顶层 Skill，不参与生命周期选择。

**finish-task**（收尾薄入口）— `.agents/skills/finish-task/SKILL.md` 委托 Executor 的 post-merge cleanup fast path，不是第五个 lifecycle 阶段；cleanup authority 仍属于 Executor 与其 playbook。

5. **product-qa**（operational 入口，不属于 lifecycle）— `.agents/skills/product-qa/SKILL.md` 只指向 Product QA playbook，让 Claude Code、Codex 等 harness 能按名字调用；流程与规则的唯一正文仍是 `.agents/playbooks/product-qa/README.md`。

`.agents/skills/` 是跨 harness 的 canonical 位置：Codex 等直接读取它（`agents/openai.yaml` 提供展示元数据），Claude Code 通过本机 `.claude/skills` → `.agents/skills` 的符号链接（不入库）发现同一批 Skill。

Product QA 是独立的 operational product-audit playbook（`.agents/playbooks/product-qa/`）：周期性或用户显式触发，默认目标 production `https://wotbtools.com`；不加入 implementation lifecycle，不属于 `review-with-docs` 的 gate，不拥有 commit/push/PR/merge/final implementation PASS。findings 进入 GitHub Issue / `designer`。

> 深入背景见 `docs/DEVELOPER_GUIDE.md`；本文件与各 scope AGENTS.md 以真实代码为准，发现漂移先修正文档。