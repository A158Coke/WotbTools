# AGENTS.md — 仓库级硬约定（repository-wide）

**默认 caveman mode**：回复极简、砍废话、无寒暄。用户说"退出 caveman"才恢复正常。

> 按作用域继承：进入具体目录时同时读取该目录的 `AGENTS.md`（contracts/java/frontend/common/deploy/.github/
> keycloak 两个 provider/map-semanticizer）。构建/运行命令见 `docs/DEVELOPER_GUIDE.md`，不在本文件重复。

项目：WoT Blitz `.wotbreplay` 回放工具集（解析/Excel/排行榜/评分/AI 复盘/Keycloak）。入口 wotbtools.com。

## 接手与调整方法（固定流程）

每次新任务先按这条路径接手；除非用户明确要求只做单个命令或只回答问题，否则默认执行到可交接状态。

1. **入口阅读** — 先读根 `AGENTS.md`、本文件、`docs/DEVELOPER_GUIDE.md`；进入具体目录再读该目录 `AGENTS.md`；改专项能力时读 `docs/README.md` 指向的对应专题文档。
2. **现实审计** — 先确认 `git status --short --branch`、`git remote -v`、当前分支/HEAD 与已有未提交改动；再用 `rg` 追真实调用链、配置、测试与文档。真实代码是 source of truth，文档只作为待校验线索。
3. **任务分类** — 判定是问答/排障、文档、小修、feature、大范围重构、跨层改动、数据/导出/API/部署/Android runtime。跨层改动加载 `.agents/playbooks/wotb-sync.md`；增删列加载 `.agents/playbooks/column-sync.md`；feature/大范围改动走 Designer → approved current-plan → Executor → Review With Docs 生命周期。
4. **计划契约** — 需要 Plan-First 时，计划必须写清范围、非目标、影响面、SSOT、风险、验证档位、回滚/失败处理；feature 类计划写入 `docs/current-plan.md` 并等批准。
5. **Reuse / SSOT 执行** — 新增 production abstraction 前先做 Reuse Audit；优先复用/扩展现有结构，避免第二份事实源。改动影响界面、导出、数据、构建、用法或运维时，同步更新文档。
6. **分层验证** — 先 targeted，再 module/feature，只有触发 Full-test 例外才跑 repository-level full validation；每次说明 Affected scope / Selected validation / Why，避免重复跑已失效范围外的测试。
7. **收尾交接** — Review With Docs 是唯一 final quality gate；通过后 Executor 再 commit/push/open PR；最终说明改了什么、验证了什么、未验证什么、剩余风险和下一步。

## 规则

1. **Plan-First** — 代码改动前先出 plan（范围/影响/风险），待用户批准后执行。小修小补（bug fix、CSS、i18n 缺漏）可跳过；但需要 Designer 时，完整设计 authority 以 `.agents/skills/designer/SKILL.md` 为准。
2. **生命周期** — 模糊需求 / 明确需求 → `designer`（deeply define the work）→ approved `docs/current-plan.md` → `executor`（实现 + targeted validation）→ `review-with-docs`（唯一 final gate）→ PASS 后 executor commit/push/open PR → merge 后 executor 加载 `.agents/playbooks/post-merge-cleanup.md`。PR reviewer findings → `prompt-repair` → `review-with-docs`。未批准不得编码；review-with-docs 未 PASS 不得开 PR。Designer 的 Understand / Ambition / Depth / Range / Design / Outside Judge / Execution Plan / internal Design Grill 完整定义只维护在其 Skill，不在本文件复制。
3. **文档生命周期与权威归属** — 持久文档按用途分层，任何改动都不得把「改动故事」写进 canonical 文档：
   - `HISTORY.md`：**仅产品/业务演进**——用户可见或商业能力为何引入、变化、退役，以及产品方向决策。不是技术架构史。
   - `docs/architecture/TECHNICAL_EVOLUTION.md`：**仅技术演进**——架构迁移、数据流/权威归属变化、基础设施与拓扑、身份模型、被引入又退役的技术方案。不是产品 changelog。
   - **当前状态文档**：`README.md`、`docs/DEVELOPER_GUIDE.md`、架构现状文档、功能契约、运维 runbook、认证文档、Android 文档、前端文档、`docs/reference/**`、`contracts/**`，以及描述当前工作流的 `AGENTS.md` / `.agents/skills/**` / `.agents/playbooks/**`。它们只描述合并后的当前系统；维护者打开任一份都应能假设「这就是 WotBTools 现在的工作方式」。`README.md` 是仓库唯一当前 canonical README；维护者/开发者文档正文统一使用简体中文，不维护英文镜像副本。
   - **例外**：
     - `HISTORY.md`：产品/业务历史。
     - `docs/architecture/TECHNICAL_EVOLUTION.md`：技术/架构历史。
     - `docs/research/**`：实验、逆向证据、被否证假设与样本来源；证据史本身就是目的，但不得把已退役架构描述成当前生产状态。
     - `docs/current-plan.md`：ephemeral 当前已批准任务状态（gitignore），不是架构/行为权威。
     - `docs/android/releases/**`：**临时版本化发布记录**，豁免当前状态要求；迁移到 GitHub Release / tag / APK / `version.json` 后删除，迁移由 CI/CD 审计推进。
   - **future-only 内容不持久化为 repository docs**：属于当前 approved task → `docs/current-plan.md`；已经是明确独立 follow-up → GitHub Issue；其它 uncommitted / speculative wishlist → 删除，不保存。不得为 wishlist 新建 future/backlog/ideas 类文档，也不得塞进历史或 current-state owner。
   - **语言**：持久开发者/维护者/运维文档的人类可读正文统一使用简体中文；类名、函数/类型名、源路径、API path、HTTP method、环境/配置 key、error code、enum、event 名、schema 字段、命令、外部产品/项目名与上游原文引用保留规范英文。英文正文（非上述技术字面量）= BLOCKER。
   - **current-plan 门禁**：新增/修改的永久源码、配置、文档不得引用 `docs/current-plan.md` 作为架构/行为权威（BLOCKER）。已应用 Flyway migration 注释与受 Android release 版本门禁控制的 runtime 文件属于明确例外，只能在合法 migration/版本发布中移除。其它遗留权威引用应在被触及或明确治理时迁移到 canonical owner。
   - **存量偏差过渡**：本治理规则首次进入仓库之前已经存在、且未被当前变更触及的 current-state / 历史文档偏差，在对应偏差被实际修复或登记为例外前按整改债务保留；新增或修改的持久文档必须满足本规则。
   - 禁止 `archive/`、`old/`、`legacy-docs/`、`historical/` 等历史堆放目录，也禁止用 “Historical” 标签保留过期现状。Git 历史就是归档。
   - **更新文档 = 描述结果状态，不是追加变更日记**。行为从 A 变成 B 再变成 C 时，canonical 文档只写「系统使用 C」；A/B 只在不写就会丢失产品/技术决策理由时分别进入 `HISTORY.md` 或 `TECHNICAL_EVOLUTION.md`，否则删除。禁止在 canonical 文档写「本 PR / 本次 / 审查基线 / Step / review P1 / 当前候选 / 未来 Kx / 以最终实现为准 / 迁移完成」等实现过程叙事。
   - 影响界面、导出、数据、构建、用法或运维时，同提交更新对应的 canonical 专题文档、`DEVELOPER_GUIDE.md` 或 README；新增知识先找现有 owner，不靠新建 Markdown 文件分摊旧段落。
4. **跨层一致** — 列 key（snake_case）API/前端/导出三方一致；显示名前端三语 locale + 导出两处一致。跨层改动走 `.agents/playbooks/wotb-sync.md`（单一事实源）；增删列再走 `.agents/playbooks/column-sync.md`。
5. **API 纯英文** — 只回 key+数据；中文归前端/导出。
5a. **HTTP Contract First** — FE ↔ BE 序列化契约唯一事实源是 `contracts/http/openapi.yaml`；generated FE transport 不手改，domain enum 必须显式映射，旧 artifact 兼容只放读取边界。服务器没有回放解析器，不存在 Control ↔ Worker / MQ 契约。
6. **测试策略 — Fast Feedback First** — 开发过程中禁止无理由重复运行 repository-level full test。
   默认分层验证：
   1. **Targeted**：修改后运行与改动直接相关的最小测试集（单个测试类 / 单个组件测试）；
   2. **Module / Feature**：一个实现阶段完成后运行 affected module / feature 测试，捕获本次改动影响范围内的回归；
   3. **Regression**：review/fix 后运行相关 regression tests；
   4. **Repository validation 由 PR CI 统一执行**（唯一 authoritative gate）；唯一 PR workflow 对每个 PR 执行实际 validation jobs，并以稳定的 `CI / Required Gate` 作为 merge gate。
   **Targeted / affected Module / Feature / Regression 属于实现路径的必做本地验证，不受 Full-test 例外限制。** Agent 开 PR 前不默认重新运行 java 全量 `mvn test`、frontend 全量 `npm test`、frontend `npm run build`；这些 repository-level full validation 由 PR CI 统一执行，本地 full validation 仅按下方例外控制。

   **Full-test 例外（仅以下情形允许 Agent 主动运行 repository-level full validation）**：
   1. 用户明确要求 full test；
   2. 修改 Maven parent / dependencyManagement / plugin configuration；
   3. 修改 Node/Vite/Vitest 全局配置；
   4. 修改跨多个 module 的公共 contract；
   5. 修改 architecture rules；
   6. 修改 test infrastructure 本身；
   7. 修改 build infrastructure，且无法通过 targeted validation 判断影响范围；
   8. CI 当前不可用，但必须给出高置信度验证，或 affected scope 无法可靠确定。
   即便触发 full test，也必须先说明原因（Affected scope / Selected validation / Why），禁止以「为了保险，再跑一次全量」为由执行。

   Targeted / Module / Full 的具体命令与分层见 `java/AGENTS.md` 与 `frontend/AGENTS.md`。

   **PR 快速上线规范**：Fast path 只表示不等待本地 repository-level full validation；**affected targeted tests / static validation 仍为 mandatory**，并且绝不跳过 `review-with-docs`。实现完成后先运行与本次改动直接相关的 targeted tests；一个实现阶段跨多个文件时按 affected scope 运行对应 module / feature tests；review/fix 后运行相关 regression tests。完成这些 affected validation 后，再运行 `review-with-docs` 对完整 **task-related candidate tree**（committed range + staged + unstaged + task-related untracked）审查；PASS 后才 `commit → push → open PR`，由 PR CI 做 repository-level authoritative validation。与当前 task 无关的 preserved user work / scratch 必须显式 exclusion + reason，但不得让 candidate predicate 误判为非空。只有用户明确要求 **repository-level full validation**、CI 前必须用 full suite 复现/排查，或安全上无法通过 targeted/static validation 确认时，才在本地运行 full test。推送前仍必须做必要的 `git diff --check`、生成契约检查和安全/配置静态检查；CI 失败后只复现失败 job 的最小范围。

   选档决策树：
   ├─ 单一 class / function / component → Targeted tests
   ├─ 单一 feature 多文件 → feature test group
   ├─ 单个 Maven module → Module tests
   ├─ build / config / dependency / architecture → broader validation（可能触发 Full）
   └─ 无法确定影响范围 → Full-test 例外，先说明原因

   **CI 结果获取——实时 watch，禁止 sleep 轮询**：等待 CI 一律用阻塞式 watch（流式输出、失败退出非 0），不要 `sleep N` 之后再查状态：
   - 实时看整个 PR：`gh pr checks <pr-number> --watch`；
   - 等某个 run 的结论：`gh run watch <run-id> --exit-status --compact`；
   - 取 run-id：`gh run list --branch <branch> --limit 1 --json databaseId,headSha`。
   刚 push 完 checks 尚未创建时，先取得绑定 current head 的 run-id 再 watch。`--exit-status` 不得被无 `pipefail` 的管道吞掉。
   Agent 等待时使用任务自带完成通知或一次阻塞式等待；有其它工作则并行推进，禁止 `sleep N` 轮询。

   迭代验证去重与失效：
   - CI 失败后只复现失败 job 对应的本地范围，修复后 push 让 PR CI 重新成为权威验证；
   - 同一任务内测试已通过且对应代码/依赖代码/测试配置均未变化 → 不得重复运行同一测试；
   - review 修复后按修改决定哪些验证已失效。

   **测试层级去重** — 优先使用原生校验器与真实集成测试，而不是源码文本断言；只有项目特有的架构或生产安全不变量才新增自定义 contract/policy test。
   **测试入口最小化** — 默认禁止新增 standalone `test-*.sh` / `*-contract.sh`。必须先按 `reuse > extend > merge > create` 复用现有 native validation、policy test 或 integration smoke；只有存在无法合理并入现有入口的独立职责时才允许新增，并说明原因。
7. **Review With Docs 闭环** — 任何实现完成后都进入 `review-with-docs`；代码质量、code-smell、fallow、文档、架构与领域 playbook 检查均作为其内部阶段。先构造 task-related candidate files，显式记录 exclusions；只有 task-related candidate files 非空且 calculated review scope = 0 才 BLOCKER。只有 `review-with-docs` 可以输出 final PASS / zero blocker；通过后 Executor 才 commit/push/open PR。
8. **Git** — 推送前先 `git remote -v` 确认实际 remote（本机 remote 名/SSH 别名以本机配置为准，不写死）；仓库账号 A158Coke。中文提交、尾带 `Co-Authored-By`；禁止 force push、禁止改写已公开历史、禁止动与当前任务无关的分支/PR。
9. **子代理** — spawn 子代理后必须显式验证其完成状态与产物（不可假设自动完成），完成后以醒目格式通知用户。
10. **大需求拆分** — 一次性大需求拆为多个小任务，每个小任务一个子代理，主代理最后执行 review-with-docs final gate。
11. **Ponytail — 懒资深工程师模式** — 懒=高效：先理解问题（读任务+读它触碰的代码+端到端追真实流程），沿梯子往上爬，停在第一个成立的档（不建→复用→标准库→平台特性→已装依赖→一行→最小代码）。Bug fix 修根因不修表象（grep 全部调用方，在共享函数处修一次）。删优于增、文件数最少；故意抄近路留 `ponytail:` 注释（写明天花板+升级路径）。带非平凡逻辑的懒代码留一个最小自检。不许偷懒：理解问题、输入校验、防数据丢失、安全、可访问性、被明确要求的东西。
12. **Reuse / Extend First — 单一 SSOT 优先** — 新建 abstraction 的优先级：`reuse > extend > simplify/merge > create`。
   任何新增 production class / interface / record / DTO / util / helper / service / manager / resolver / facade / enum / module / file 前必须先走 Reuse Audit：
   1. repo-wide 搜索是否存在相同或高度相似职责的现有实现；
   2. 检查能否直接复用已有 API；
   3. 检查能否扩展职责匹配的现有 abstraction；
   4. 检查新增 abstraction 是否只是把已有逻辑搬到另一个文件；
   5. 检查是否会形成第二个 SSOT；
   6. 检查新增长期维护成本是否真的低于复用 / 扩展现有结构。
   仅当 1~6 条均确认现有结构无法合理承载该职责时才允许新建 abstraction。禁止单调用方无必要 wrapper/helper/manager/resolver/facade、机械 clean-architecture abstraction、第二份业务 switch/rule/validation contract。Skills 只引用并执行本规则，不复制第二份完整定义。
13. **外部数据生命周期** — 持久化外部 API 返回的个人或统计数据时，必须同时提供明确的 retention/deletion path；删除流程需限定数据来源、遵守真实 FK 顺序，并保护仍被其他业务引用的共享文件或记录。
14. **Android Version-as-Code** — Android production runtime 改动必须递增 committed `android/gradle.properties:wotbVersion`；不得手工编辑 `versionCode` 或依赖 release workflow 版本参数。Native Bridge wire breaking change 必须同时更新 `contracts/android-native-bridge.json`、递增 `bridgeVersion`、更新 Native/FE，并在同一 PR 通过 deterministic compatibility tests。FE 远程加载时先让 FE 兼容旧/新协议，再发布 Native；FE 随 APK 打包（local-first）时 FE 与 Native 同版本发布，由 contract gate 与 `guard_bridge_covered` 强制 support floor 覆盖 cutover。完整发布与版本锁定规则以 [`docs/android/release-process.md`](../docs/android/release-process.md) 为 authority；production `version.json` 与该文档共同定义当前 support floor，frontend architecture 不重复固定 floor。

## 视觉验证归属（2026-10-03）

**3D 回放、坦克/模型查看、场景渲染等“看起来对不对”的验收由用户执行。** Agent：

- 不启动/驱动浏览器去读屏、截图或目视核对 3D 画面，也不拿截图当验收证据；3D 画面依赖真实 GPU/地形/资产面状态，分离或无头浏览器给不出可信结论。
- 交付方式：实现 + 锁定不变量的测试（纯函数单测、场景源码级接线守卫、既有 `npm run test:browser-*` 自动化门禁），然后明确写出「需要人工看什么」交给用户确认。
- 上游 Agent 仓（WoT-Blitz-Agent）的 `frontend/` 已冻结、不再维护：前端改动与前端测试都在本仓。

## 本机测试（全功能联调）

完整 runbook 见 [`docs/frontend/local-testing.md`](../docs/frontend/local-testing.md)。Agent 引擎产物由 `scripts/fetch-agent-wasm.sh` + `deploy/agent/source.json` pin 管理；换 pin 时同时按 runbook 重生成并核验 AI projection golden。管理权限只信 access token `realm_access.roles`；任何 URL 参数不得提升权限。受保护 `/api/admin/**`、`/api/ai/**` 按真实 token 鉴权。

## 禁止

- 改 `target/` `node_modules/` `dist/` `.m2repo/` 内文件
- 按终端乱码判文件损坏
- API 塞中文；模块内放 tankopedia 副本
- 使用公司 token/凭据；把 secret/环境变量写进仓库
- 在付款/赞助页面或代码中硬编码个人收款信息
- 用推测值冒充权威方向/可见性（回放数据只信已证明的解码，见 `docs/research/replay/protocol.md`）

## Skills（.agents/skills/，只有四个 lifecycle Skills）

1. **designer** — deeply define the work；完整 pipeline authority 在 `.agents/skills/designer/SKILL.md`，产出 approved `docs/current-plan.md`。
2. **executor** — execute approved plan、targeted validation、review-with-docs PASS 后 commit/push/open PR、merge 后 cleanup。
3. **prompt-repair** — reviewer findings 的 minimum-delta 增量修复；只有 finding 证明 approved plan 失效才返回 Designer。
4. **review-with-docs** — 验证 implementation against plan + repository reality + canonical docs + runtime evidence；唯一 final quality gate。

领域知识、检查单与工具指南在 `.agents/playbooks/`，由四个 Skills 按需加载；它们不是顶层 Skill，不参与生命周期选择。

> 深入背景见 `docs/DEVELOPER_GUIDE.md`；本文件与各 scope AGENTS.md 以真实代码为准，发现漂移先修正文档。