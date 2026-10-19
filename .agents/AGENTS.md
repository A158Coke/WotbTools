# AGENTS.md — 仓库级硬约定（repository-wide）

**默认 caveman mode**：回复极简、砍废话、无寒暄。用户说"退出 caveman"才恢复正常。

> 按作用域继承：进入具体目录时同时读取该目录的 `AGENTS.md`（contracts/java/frontend/common/deploy/.github/
> keycloak 两个 provider/map-semanticizer）。构建/运行命令见 `docs/DEVELOPER_GUIDE.md`，不在本文件重复。

项目：WoT Blitz `.wotbreplay` 回放工具集（解析/Excel/排行榜/评分/AI 复盘/Keycloak）。入口 wotbtools.com。

## 接手与调整方法（固定流程）

每次新任务先按这条路径接手；除非用户明确要求只做单个命令或只回答问题，否则默认执行到可交接状态。

1. **入口阅读** — 先读根 `AGENTS.md`、本文件、`docs/DEVELOPER_GUIDE.md`；进入具体目录再读该目录 `AGENTS.md`；改专项能力时读 `docs/README.md` 指向的对应专题文档。
2. **现实审计** — 先确认 `git status --short --branch`、`git remote -v`、当前分支/HEAD 与已有未提交改动；再用 `rg` 追真实调用链、配置、测试与文档。真实代码是 source of truth，文档只作为待校验线索。
3. **任务分类** — 判定是问答/排障、文档、小修、feature、大范围重构、跨层改动、数据/导出/API/部署/Android runtime。跨层改动加载 `wotb-sync`；增删列加载 `column-sync`；feature/大范围改动走 Feature 流程。
4. **计划契约** — 需要 Plan-First 时，计划必须写清范围、非目标、影响面、SSOT、风险、验证档位、回滚/失败处理；feature 类计划写入 `docs/current-plan.md` 并等批准。
5. **Reuse / SSOT 执行** — 新增 production abstraction 前先做 Reuse Audit；优先复用/扩展现有结构，避免第二份事实源。改动影响界面、导出、数据、构建、用法或运维时，同步更新文档。
6. **分层验证** — 先 targeted，再 module/feature，只有触发 Full-test 例外才跑 repository-level full validation；每次说明 Affected scope / Selected validation / Why，避免重复跑已失效范围外的测试。
7. **收尾交接** — 执行 Review-Fix；需要时走 review-with-docs；最终说明改了什么、验证了什么、未验证什么、剩余风险和下一步。

## 规则

1. **Plan-First** — 代码改动前先出 plan（范围/影响/风险），待用户批准后执行。小修小补（bug fix、CSS、i18n 缺漏）可跳过。
2. **Feature 流程** — feature 类/大范围改动：grill-me（需求澄清）→ plan-designer（方案设计）→ plan 写入 `docs/current-plan.md` → 等批准 → 执行 → Review-Fix 闭环 → 审查报告。未批准不得编码。
3. **文档生命周期与权威归属** — 持久文档按用途分层，任何改动都不得把「改动故事」写进 canonical 文档：
   - `HISTORY.md`：**仅产品/业务演进**——用户可见或商业能力为何引入、变化、退役，以及产品方向决策。不是技术架构史。
   - `docs/architecture/TECHNICAL_EVOLUTION.md`：**仅技术演进**——架构迁移、数据流/权威归属变化、基础设施与拓扑、身份模型、被引入又退役的技术方案。不是产品 changelog。
   - **当前状态文档**（以下全部只描述合并后的当前系统状态）：`README.md`、`docs/DEVELOPER_GUIDE.md`、架构现状文档、功能契约、运维 runbook、认证文档、Android 文档、前端文档、`docs/reference/**`、`contracts/**`，以及描述当前工作流的 `AGENTS.md` / `.agents/skills/**`。维护者打开任一份都应能假设「这就是 WotbTools 现在的工作方式」。
   - **例外（不按当前状态文档要求）**：
     - `HISTORY.md`：产品/业务历史。
     - `docs/architecture/TECHNICAL_EVOLUTION.md`：技术/架构历史。
     - `docs/ROADMAP.md`：仅未来方向。
     - `docs/research/**`：实验、逆向证据、被否证假设与样本来源；证据史本身就是目的，但不得把已退役架构描述成当前生产状态。
     - `docs/current-plan.md`：临时任务状态（gitignore），不是架构/行为权威。
     - `docs/android/releases/**`：**临时版本化发布记录**，豁免当前状态要求；迁移到 GitHub Release / tag / APK / `version.json` 后删除，迁移由 CI/CD 审计推进。
   - **语言**：持久开发者/维护者/运维文档的人类可读正文统一使用简体中文；类名、函数/类型名、源路径、API path、HTTP method、环境/配置 key、error code、enum、event 名、schema 字段、命令、外部产品/项目名与上游原文引用保留规范英文。英文正文（非上述技术字面量）= BLOCKER。
   - **current-plan 过渡门禁**：新增/修改的永久源码、配置、文档不得引用 `docs/current-plan.md` 作为架构/行为权威（BLOCKER）。D4 之前已存在的遗留引用登记为整改债务，不因本条在同一提交内追溯失败；已应用 Flyway migration 注释与受 Android release 版本门禁控制的 runtime 文件属于明确例外，只能在合法 migration/版本发布中移除。D4 完成后此门禁可按绝对规则执行。
   - 禁止 `archive/`、`old/`、`legacy-docs/`、`historical/` 等历史堆放目录，也禁止用 “Historical” 标签保留过期现状。Git 历史就是归档。
   - **更新文档 = 描述结果状态，不是追加变更日记**。行为从 A 变成 B 再变成 C 时，canonical 文档只写「系统使用 C」；A/B 只在不写就会丢失产品/技术决策理由时分别进入 `HISTORY.md` 或 `TECHNICAL_EVOLUTION.md`，否则删除。禁止在 canonical 文档写「本 PR / 本次 / 审查基线 / Step / review P1 / 当前候选 / 未来 Kx / 以最终实现为准 / 迁移完成」等实现过程叙事。
   - 影响界面、导出、数据、构建、用法或运维时，同提交更新对应的 canonical 专题文档、`DEVELOPER_GUIDE.md` 或 README；新增知识先找现有 owner，不靠新建 Markdown 文件分摊旧段落。
4. **跨层一致** — 列 key（snake_case）API/前端/导出三方一致；显示名前端三语 locale + 导出两处一致。跨层改动走 `.agents/skills/wotb-sync/SKILL.md`（单一事实源）；增删列再走 `column-sync`。
5. **API 纯英文** — 只回 key+数据；中文归前端/导出。
5a. **HTTP Contract First** — FE ↔ BE 序列化契约唯一事实源是 `contracts/http/openapi.yaml`；generated FE transport 不手改，domain enum 必须显式映射，旧 artifact 兼容只放读取边界。服务器没有回放解析器，不存在 Control ↔ Worker / MQ 契约。
6. **测试策略 — Fast Feedback First** — 开发过程中禁止无理由重复运行 repository-level full test。
   默认分层验证：
   1. **Targeted**：修改后运行与改动直接相关的最小测试集（单个测试类 / 单个组件测试）；
   2. **Module / Feature**：一个实现阶段完成后运行 affected module / feature 测试，捕获本次改动影响范围内的回归；
   3. **Regression**：review/fix 后运行相关 regression tests；
   4. **Repository validation 由 PR CI 统一执行**（唯一 authoritative gate）；唯一 PR workflow
      对每个 PR 执行实际 validation jobs，并以稳定的 `CI / Required Gate` 作为 merge gate。
   Agent 开 PR 前不默认重新运行 java 全量 `mvn test`、frontend 全量 `npm test`、frontend `npm run build`；
   PR CI 是 repository-level full validation 入口；本地 full validation 仍按下方例外控制。

   **Full-test 例外（仅以下情形允许 Agent 主动运行 repository-level full validation）**：
   1. 用户明确要求 full test；
   2. 修改 Maven parent / dependencyManagement / plugin configuration；
   3. 修改 Node/Vite/Vitest 全局配置；
   4. 修改跨多个 module 的公共 contract；
   5. 修改 architecture rules；
   6. 修改 test infrastructure 本身；
   7. 修改 build infrastructure，且无法通过 targeted validation 判断影响范围；
   8. CI 当前不可用，但必须给出高置信度验证，或 affected scope 无法可靠确定。
   即便触发 full test，也必须先说明原因（Affected scope / Selected validation / Why），
   禁止以「为了保险，再跑一次全量」为由执行。

   Targeted / Module / Full 的具体命令与分层见 `java/AGENTS.md` 与 `frontend/AGENTS.md`。

   **PR 快速上线规范**：用户已明确给出实现计划并要求直接上线时，Agent 完成实现后默认直接
   `commit → push → open PR`，由 PR CI 作为验证入口；不因等待本地全量测试而阻塞推送。只有用户明确
   要求本地验证、CI 前必须复现/排查、或安全上无法通过静态检查确认时，才运行本地测试。推送前仍必须
   做必要的 `git diff --check`、生成契约检查和安全/配置静态检查；CI 失败后只复现失败 job 的最小范围。

   选档决策树：
   ├─ 单一 class / function / component → Targeted tests
   ├─ 单一 feature 多文件 → feature test group
   ├─ 单个 Maven module → Module tests
   ├─ build / config / dependency / architecture → broader validation（可能触发 Full）
   └─ 无法确定影响范围 → Full-test 例外，先说明原因

   **CI 结果获取——实时 watch，禁止 sleep 轮询**：等待 CI 一律用阻塞式 watch（流式输出、失败退出非 0），
   不要 `sleep N` 之后再查状态：
   - 实时看整个 PR：`gh pr checks <pr-number> --watch`（每个 check 状态变化即打印一行，非 TTY/后台也可见）；
   - 等某个 run 的结论：`gh run watch <run-id> --exit-status --compact`（阻塞到结束；被管道/后台接管时
     只在结束时整体输出，不要指望逐行进度）；
   - 取 run-id：`gh run list --branch <branch> --limit 1 --json databaseId,headSha`（run 绑定 head SHA，不可变，
     同一 run 可反复查看，不必重跑）。刚 push 完 checks 可能尚未创建——此时 `gh pr checks --watch` 会直接
     `no checks reported`（退出 1），先用上一行取 run-id 再 `gh run watch`。
   **退出码**：`--exit-status` 的成败信号就是进程退出码——不要把它管进 `| tail` 之类的管道（管道退出码取末段命令，
   会把失败吞成 0）；要么不加管道，要么 `set -o pipefail`。
   Agent 执行时把 watch 放**后台**运行、结束后读输出，等待期间并行做其它工作；禁止 sleep 循环轮询
   `gh run list` / `gh run view`（丢流式进度、失败感知滞后）。push 会按 workflow 的 concurrency 取消在途
   run——要留存某 head 的 CI 证据时，先等它的 watch 结束再 push 下一个提交。
   **本规则适用于一切等待任务**（2026-10-13 用户裁示）：CI、本地门禁、构建、后台命令等**所有等待都必须
   实时获取返回结果**——用任务自带的完成通知或一次阻塞式等待，不得 `sleep N` 后轮询；等待期间有可推进
   的其它工作就先推进，没有就阻塞等结果。

   迭代验证去重与失效：
   - CI 失败后只复现失败 job 对应的本地范围（backend 失败→重跑失败测试；bundle 失败→`npm run build`），
     修复后 `git push` 让 PR CI 重新成为权威验证，不默认再跑整个 repository full suite。
   - 同一任务内测试已通过且对应代码/依赖代码/测试配置均未变化 → 不得重复运行同一测试。
   - review 修复后按修改决定哪些验证已失效：改了 A 对应代码 → A 失效需重跑；只改 README → 不失效。

   **测试层级去重** — Prefer native validators and real integration tests over source-text
   assertions. Add custom contract/policy tests only for project-specific architectural or
   production-safety invariants that native tooling would consider valid.
   **测试入口最小化** — 默认禁止新增 standalone `test-*.sh` / `*-contract.sh`。必须先按
   `reuse > extend > merge > create` 复用现有 native validation、policy test 或 integration smoke；
   只有存在无法合理并入现有入口的独立职责时，才允许新增 shell test entrypoint，并在计划/PR 中明确说明
   为什么现有入口无法承载。不得为普通字段存在性、文档 wording、可由 `tofu validate` /
   `docker compose config` / compiler / typechecker / real runtime smoke 覆盖的检查新增独立脚本。
7. **Review-Fix 闭环** — 每次代码变更后自审（残留/硬编码/未用 import/命名/空值/并发），修复后循环到零问题；影响界面/导出/数据/构建的变更再走 `review-with-docs`（含文档同步 + AI 死代码清理）。
8. **Git** — 推送前先 `git remote -v` 确认实际 remote（本机 remote 名/SSH 别名以本机配置为准，不写死）；仓库账号 A158Coke。中文提交、尾带 `Co-Authored-By`；禁止 force push、禁止改写已公开历史、禁止动与当前任务无关的分支/PR。
9. **子代理** — spawn 子代理后必须显式验证其完成状态与产物（不可假设自动完成），完成后以醒目格式通知用户。
10. **大需求拆分** — 一次性大需求拆为多个小任务，每个小任务一个子代理，主代理最后执行 review-fix。
11. **Ponytail — 懒资深工程师模式** — 懒=高效：先理解问题（读任务+读它触碰的代码+端到端追真实流程），沿梯子往上爬，停在第一个成立的档（不建→复用→标准库→平台特性→已装依赖→一行→最小代码）。Bug fix 修根因不修表象（grep 全部调用方，在共享函数处修一次）。删优于增、文件数最少；故意抄近路留 `ponytail:` 注释（写明天花板+升级路径）。带非平凡逻辑的懒代码留一个最小自检。不许偷懒：理解问题、输入校验、防数据丢失、安全、可访问性、被明确要求的东西。
12. **Reuse / Extend First — 单一 SSOT 优先** — 新建 abstraction 的优先级：`reuse > extend > simplify/merge > create`。
   任何新增 production class / interface / record / DTO / util / helper / service / manager /
   resolver / facade / enum / module / file 前必须先走 Reuse Audit：
   1. repo-wide 搜索是否存在相同或高度相似职责的现有实现；
   2. 检查能否直接复用已有 API；
   3. 检查能否扩展职责匹配的现有 abstraction（而非新建）；
   4. 检查新增 abstraction 是否只是把已有逻辑搬到另一个文件；
   5. 检查是否会形成第二个 SSOT（同一业务 switch / rule / validation contract 只允许一份）；
   6. 检查新增长期维护成本是否真的低于复用 / 扩展现有结构。
   仅当 1~6 条均确认现有结构无法合理承载该职责时才允许新建 abstraction。
   禁止：「发现一段逻辑 → 默认新建一个类」；单调用方无必要 wrapper/helper/manager/resolver/facade；
   为所谓 clean architecture 机械新增 abstraction；两个类维护同一业务 switch/rule/validation contract；
   用新 abstraction 转移而非减少复杂度。Agents/skills 只引用并执行本规则，不复制维护第二份完整定义。
   具体执行点：`.agents/skills/plan-executer/SKILL.md`（Reuse Audit）与
   `.agents/skills/review-with-docs/SKILL.md`（新增 abstraction 审查 gate）。
13. **外部数据生命周期** — 持久化外部 API 返回的个人或统计数据时，必须同时提供明确的 retention/deletion path；删除流程需限定数据来源、遵守真实 FK 顺序，并保护仍被其他业务引用的共享文件或记录。
14. **Android Version-as-Code** — Android production runtime 改动必须递增 committed `android/gradle.properties:wotbVersion`；不得手工编辑 `versionCode` 或依赖 release workflow 版本参数。Native Bridge wire breaking change 必须同时更新 `contracts/android-native-bridge.json`、递增 `bridgeVersion`、更新 Native/FE，并在同一 PR 通过 deterministic compatibility tests。FE 远程加载时先让 FE 兼容旧/新协议，再发布 Native；FE 随 APK 打包（local-first，当前形态）时 FE 与 Native 同版本发布、只声明新版本，由 contract gate 与 `guard_bridge_covered` 强制 `ANDROID_MIN_SUPPORTED_VERSION_CODE` 覆盖这次 cutover。**顺序：major / bridge cutover 的 floor 必须在合并（触发自动 stage）之前设好**——stage preflight 自己执行 `guard_min_supported` / `guard_local_first_cutover` / `guard_bridge_covered`，floor 未到位时合并触发的自动 stage 会 fail-closed（修好变量后幂等重跑只是恢复路径，不是正常流程）。完整顺序：设 floor → 合并 → main 自动运行 Android stage 与随 PR 带来的基础设施 workflow（如 `caddy.yml`；生产网关只从 fresh main 部署，不得在合并前手工 SSH / 复制 PR 文件 / 放宽门禁）→ 两者都成功 → 真机验收 → publish（Android 客户端 rollout / production `version.json` 的唯一 commit point；网关等基础设施变更在合并后即已上线）。
    **版本号按变更等级递增（2026-10-14 用户裁示）**：① **major**（`2.3.3 → 3.0.0`）= breaking change（含 Native Bridge wire breaking）、重大功能、删除功能、中大型 bug 修复——**强制更新门槛必须抬到该 major 的 `X.0.0`**（`ANDROID_MIN_SUPPORTED_VERSION_CODE` = `X×1_000_000`，随 publish 写入）；② **minor**（`2.3.3 → 2.4.0`）= 增加中小功能，不抬门槛；③ **patch**（`2.3.3 → 2.3.4`）= 小 bug 修复，不抬门槛、不强制升级。**门槛按发布候选相对线上版本判定**：候选 major > 线上 major（两次 publish 之间合并过尚未发布的 major）时，即使候选本身是 minor/patch（如线上 2.3.3、发布 3.0.1）也必须把门槛抬到 `X.0.0`——继承未发布 major 的强制义务；候选与线上同 major 才不得改动门槛。一次变更跨多个等级取最高；等级拿不准（尤其 bug 是"中大型"还是"小"）由用户裁定；PR 描述与 `docs/android/releases/<版本>.md` 写明所选等级与理由。
    **版本号只在候选取得 immutable release identity 时才被消耗**——同一个尚未形成 immutable identity 的候选，在 code review / CI / 真机验收中的修复**不因此递增 patch**，保持原计划版本（release docs 只记录真实存在的 release identity，不为 review 轮次保留幽灵版本号：`git log` 才是 review 过程的记录）。immutable release identity = ① `android-vX.Y.Z` tag、② staged APK 已在**任意一台** immutable origin（TX1 **或** TX2 的 no-clobber origin 路径）成功落位并核验 SHA-256、③ staging evidence、④ production `version.json`；四者**任一**成立即锁版本，此后任何会改变该 immutable staged Android candidate identity / APK artifact 的修改（Android 源码与构建输入、进入 APK 的 bundled frontend / WASM / 资产、Native Bridge contract / `bridgeVersion`）都必须选更高的 `wotbVersion`（不是只有 publish 之后才锁，也不是两台 origin 都成功才锁）。Unrelated main evolution does not by itself consume a new Android version：docs / Caddy / 无关基础设施修改不自动 bump，已完整 stage 的候选仍按 tag target 发布并照常经过 publish 守卫；部分 stage 只能在 `origin/main` 仍是原提交时重跑补齐。A failed stage may still have consumed the version if an immutable artifact was already materialized：stage 失败后要逐项检查上述四类 artifact（含 TX1、TX2 各自），全部不存在才可复用同一版本。Distribution replica（清华云盘副本）**不是** identity authority：它可被 `replace=1` 覆盖、只是分发副本与 origin 的冷启动源，单独不消耗版本号；但任意一台 origin 已从它 seed 并核验成功时，版本即已锁定（上列 ②）。Distribution replicas may be replaceable and do not consume a version by themselves. 细则见 [`docs/android/release-process.md`](../docs/android/release-process.md)「版本号递增规则」。

## 视觉验证归属（2026-10-03）

**3D 回放、坦克/模型查看、场景渲染等"看起来对不对"的验收由用户执行。** Agent：

- 不启动/驱动浏览器去读屏、截图或目视核对 3D 画面，也不拿截图当验收证据（本仓与上游
  Agent 仓同规则）；3D 画面依赖真实 GPU/地形/资产面状态，分离或无头浏览器给不出可信结论。
- 交付方式改为：实现 + 锁定不变量的测试（纯函数单测、场景源码级接线守卫、既有
  `npm run test:browser-*` 自动化门禁），然后明确写出「需要人工看什么」交给用户确认。
- 上游 Agent 仓（WoT-Blitz-Agent）的 `frontend/` 已冻结、不再维护：**前端改动与前端测试
  都在本仓**，不要再去上游改前端或在上游跑前端测试。

## 本机测试（全功能联调）

在本机把产品跑成"可测状态"的完整 runbook 见
[`docs/frontend/local-testing.md`](../docs/frontend/local-testing.md)：Agent 引擎产物
（`scripts/fetch-agent-wasm.sh`，`deploy/agent/source.json` pin 变更后必须重跑）、资产服务
（**Agent 仓根目录** `node scripts/serve_asset_pack.mjs 8123`）、自检探针、故障对照、自动化门禁。

- **换 pin 的完整动作链**：除重跑 fetch 脚本，还须重生成 AI 投影 golden——`common/fixtures/ai-projection/*.json.gz`
  内嵌 pin provenance（`projection.engine.agentRelease`/`agentCommit`）：
  `WOTB_UPDATE_AI_PROJECTION_GOLDEN=1 npx vitest run src/replay-local/ai/toClientAiReviewProjection.test.ts`，
  并校验 `battle`/`projection` 逐字段不变、仅 provenance 更新，随同一 PR 提交。**该"仅 provenance"不变式
  只在「pin 单独升级、投影规则未变」时成立**：若同一 PR 有意改变投影形状（如 writer 开始发送新的
  canonical 字段 `hpState`），golden 差异必须在同一 PR 内显式重生成，并在 PR 描述里按差异类别逐条
  说明（新增了哪些字段、为什么），**不得**写成"与 main 逐字段一致、仅 provenance 变化"。漏跑则该文件 3 个
  fixture 因 provenance 失配而红、Required Gate 拦下；失败信息只显示 release/commit 不符，先比对
  两个 release 的 `wotb_replay_wasm_bg.wasm` sha256（可能字节相同）再排查行为回归。
- 管理视图与管理 API 的权限事实源统一为当前 access token 的 `realm_access.roles`：本机调试使用具有
  `wotbtools-admin` / `HoF-admin` 等真实 realm role 的测试账号；任何 URL 参数都不得提升权限，见 runbook §4。
  Replay 五能力公开可见，个人回放的 3D / shots 与全部 AI 要求登录；已验证的官方示例额外匿名放行
  3D / shots，不放行 AI 或服务端写操作；装甲查看器（含 Tankopedia 入口卡）匿名可用，不依赖 admin；
  `viewFromRoute` 不再承担 Agent capability 的 admin 闸门。
- `/api/admin/**`、`/api/ai/**` 等受保护能力按真实 token 鉴权，边界见 runbook §5。

## 禁止

- 改 `target/` `node_modules/` `dist/` `.m2repo/` 内文件
- 按终端乱码判文件损坏
- API 塞中文；模块内放 tankopedia 副本
- 使用公司 token/凭据；把 secret/环境变量写进仓库
- 在付款/赞助页面或代码中硬编码个人收款信息
- 用推测值冒充权威方向/可见性（回放数据只信已证明的解码，见 `docs/research/replay/protocol.md`）

## 技能库（.agents/skills/，按需显式加载）

开发前：grill-me · plan-designer · plan-executer · frontend-architecture · column-sync · wotb-sync
修复：prompt-repair-executor（基于现成 repair prompt 增量修复，Delta Discovery）
开发后：review-fix · review-with-docs · code-smell · fallow
收尾：finish-task；Keycloak 版本升级：keycloak-upgrade

> 深入背景见 `docs/DEVELOPER_GUIDE.md`；本文件与各 scope AGENTS.md 以真实代码为准，发现漂移先修正文档。