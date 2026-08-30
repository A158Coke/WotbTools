# AGENTS.md — 仓库级硬约定（repository-wide）

**默认 caveman mode**：回复极简、砍废话、无寒暄。用户说"退出 caveman"才恢复正常。

> 按作用域继承：进入具体目录时同时读取该目录的 `AGENTS.md`（java/frontend/common/deploy/.github/
> keycloak 两个 provider/map-semanticizer）。构建/运行命令见 `docs/DEVELOPER_GUIDE.md`，不在本文件重复。

项目：WoT Blitz `.wotbreplay` 回放工具集（解析/Excel/排行榜/评分/AI 复盘/Keycloak）。入口 wotbtools.com。

## 规则

1. **Plan-First** — 代码改动前先出 plan（范围/影响/风险），待用户批准后执行。小修小补（bug fix、CSS、i18n 缺漏）可跳过。
2. **Feature 流程** — feature 类/大范围改动：grill-me（需求澄清）→ plan-designer（方案设计）→ plan 写入 `docs/current-plan.md` → 等批准 → 执行 → Review-Fix 闭环 → 审查报告。未批准不得编码。
3. **改动即更新文档** — 影响界面/导出/数据/构建的改动，同提交更新 CHANGELOG、CHANGELOG-PRODUCT、DEVELOPER_GUIDE、相关 README、`docs/current-plan.md`（任务状态）。
4. **跨层一致** — 列 key（snake_case）API/前端/导出三方一致；显示名前端三语 locale + 导出两处一致。跨层改动走 `.agents/skills/wotb-sync/SKILL.md`（单一事实源）；增删列再走 `column-sync`。
5. **API 纯英文** — 只回 key+数据；中文归前端/导出。
6. **测试策略 — Fast Feedback First** — 开发过程中禁止无理由重复运行 repository-level full test。
   默认分层验证：
   1. **Targeted**：修改后运行与改动直接相关的最小测试集（单个测试类 / 单个组件测试）；
   2. **Module / Feature**：一个实现阶段完成后运行 affected module / feature 测试，捕获本次改动影响范围内的回归；
   3. **Regression**：review/fix 后运行相关 regression tests；
   4. **Repository full validation 由 PR CI 统一执行**（唯一 authoritative full-validation gate）。
   Agent 开 PR 前不默认重新运行 java 全量 `mvn test`、frontend 全量 `npm test`、frontend `npm run build`；
   只有改动影响跨模块 / build / test infrastructure（无法可靠限定影响范围）时才允许 full validation。

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

   选档决策树：
   ├─ 单一 class / function / component → Targeted tests
   ├─ 单一 feature 多文件 → feature test group
   ├─ 单个 Maven module → Module tests
   ├─ build / config / dependency / architecture → broader validation（可能触发 Full）
   └─ 无法确定影响范围 → Full-test 例外，先说明原因

   迭代验证去重与失效：
   - CI 失败后只复现失败 job 对应的本地范围（backend 失败→重跑失败测试；bundle 失败→`npm run build`），
     修复后 `git push` 让 PR CI 重新成为权威验证，不默认再跑整个 repository full suite。
   - 同一任务内测试已通过且对应代码/依赖代码/测试配置均未变化 → 不得重复运行同一测试。
   - review 修复后按修改决定哪些验证已失效：改了 A 对应代码 → A 失效需重跑；只改 README → 不失效。
7. **Review-Fix 闭环** — 每次代码变更后自审（残留/硬编码/未用 import/命名/空值/并发），修复后循环到零问题；影响界面/导出/数据/构建的变更再走 `review-with-docs`（含文档同步 + AI 死代码清理）。
8. **Git** — 推送前先 `git remote -v` 确认实际 remote（本机 remote 名/SSH 别名以本机配置为准，不写死）；仓库账号 A158Coke。中文提交、尾带 `Co-Authored-By`；禁止 force push、禁止改写已公开历史、禁止动与当前任务无关的分支/PR。
9. **子代理** — spawn 子代理后必须显式验证其完成状态与产物（不可假设自动完成），完成后以醒目格式通知用户。
10. **大需求拆分** — 一次性大需求拆为多个小任务，每个小任务一个子代理，主代理最后执行 review-fix。
11. **Ponytail — 懒资深工程师模式** — 懒=高效：先理解问题（读任务+读它触碰的代码+端到端追真实流程），沿梯子往上爬，停在第一个成立的档（不建→复用→标准库→平台特性→已装依赖→一行→最小代码）。Bug fix 修根因不修表象（grep 全部调用方，在共享函数处修一次）。删优于增、文件数最少；故意抄近路留 `ponytail:` 注释（写明天花板+升级路径）。带非平凡逻辑的懒代码留一个最小自检。不许偷懒：理解问题、输入校验、防数据丢失、安全、可访问性、被明确要求的东西。

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
