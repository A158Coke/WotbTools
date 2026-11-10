# UI 设计与设计审计：Refactoring UI + Apple Design

> 现有 Designer → Executor → Review 生命周期内的领域 Playbook，不是新的顶层 Skill。UI 规则唯一 owner 是 `docs/frontend/design-language.md`；第三方参考文本固定在 `.agents/references/design-methods/`。

## 入口与模式

| 用户请求 | 路由 | 输出 | 是否修改代码 |
| --- | --- | --- | --- |
| 「设计审计 / Design Audit / 视觉评审 / 交互评审某页面」 | `designer` → 本 Playbook 的 **AUDIT_ONLY** | 设计 Findings + 证据与覆盖率，不产生实施计划 | 否 |
| 「重新设计 / 改进某页面 / 先看方案」 | `designer` → **DESIGN**（plan-only） | 基线 + 候选方案/可操作原型 + 验证方式，必要时形成 Executor-ready plan | 未授权时否 |
| 「实现已批准的 UI 方案」 | `executor` → **IMPLEMENT** | 受控改动 + Before/After + 相关测试 | 是 |
| 「Review 已实现的 UI PR」 | `review-with-docs` → **VERIFY** | 对照计划和真实渲染的 final gate | 否（修复交还 Executor/Prompt Repair） |

`AUDIT_ONLY` 是 Designer 的只读诊断工作：运行需要的浏览器/DevTools 探针、查看源文件和截图可以，但不得改生产源码、文档或提交 PR；不要求为一次纯诊断创建 `docs/current-plan.md`。当用户转而要求实施时才进入标准 Designer 计划与授权流程。`review-with-docs` 保留唯一实现 final PASS 权限，不能用设计审计的结论替代。

典型用法（自然语言即可，不依赖斜杠命令）：

- 「使用 Designer 的 UI Design Audit 模式，审计 WotBTools 首页，**只出报告，不改代码**；使用 Refactoring UI 与 Apple Design，两套主题/手机和桌面都有证据。」
- 「使用 Designer 为 3D 回放工具栏提出视觉与交互改进，先展示具体 Before/After 与 Contract 冲突；**暂不执行**。」
- 「按照已批准计划实现 UI 修改，并使用 Review With Docs 独立验证设计和交互证据。」

## 加载与优先级

1. 从仓库根目录读取 `.agents/references/design-methods/README.md` 的上游版本与脚本禁用说明，再读取 `refactoring-ui/SKILL.md`、`apple-design/SKILL.md`。Refactoring UI 的 `references/13-audit-rubric.md`、`14-antipatterns.md` 用于 Sweep/Audit；其他参考章节按具体问题加载。对设计构建按需读取 `12-component-recipes.md`，不自动执行 Workflow A（已有 Design Tokens）。
2. 读取 `docs/frontend/design-language.md` 与 `docs/frontend/ui-system.md`，查当前页面代码、组件、样式、语义 Token、动效 owner、浏览器测试。Vue + `motion-v` + Reka 现有实现优先，不擅自添加 Tailwind、shadcn、新动画库或状态系统。
3. **产品事实、回放语义、数据真实性、可达性与安全底线不能被美学建议覆盖。** 已有审美规范（例如纯色材料、动画参数、固定布局）是允许挑战的设计选择，不能因为现有 `DC-*` 把设计探索直接驳回。设计阶段明确标注 `Contract Conflict` 并提出最小规则修订；通过真实证据/授权后在原文件更新，而不是形成第二套 SSOT。
4. 设计原则不等于 Apple 外观模板。数值、字号、动画参数只是候选；先确认本项目的 typography、密度、平台和中文/西班牙语/英语内容。

## AUDIT_ONLY — 只审计、可直接运行

### A0 — 输入与基线

- 用户指定的页面/流程优先；未指定全站时不擅自扩大。记录 URL/route、Git SHA、UI profile、视口尺寸、输入方式、浏览器/GeckoView 版本、认证/数据状态。无权限或无法访问时如实标记 `UNVERIFIED`，不能假装已渲染。
- 检查真实页面的默认、hover/focus/active、loading/empty/error、浮层打开等与目标相关的状态。至少在有能力的环境测桌面 1280px 与手机 375px；四季主题、旋转、Reduced Motion 依风险追加覆盖。对 UI 图像用截图对照，对动态行为用录屏/帧时间。
- 收集每个现有 Contract 冲突点的完整规则 ID 和对应代码/画面；不把 UX 个人偏好当成客观故障。

### A1 — 双镜头审计

- **Refactoring UI：** 视觉层级 → 布局/分组间距 → 排版/信息密度 → 颜色与对比度 → 深度/材质 → 图片 → finishing。先查信息结构，最后查微调，不为达到规则数目制造问题。
- **Apple Design：** 按下反馈 → 直接操控与触摸目标 → 可中断/可反向动画 → velocity handoff/空间连续性 → 合理材质与层级 → 无障碍/Reduced Motion → 帧耗时；无可交互原型时后半项必须标 `UNVERIFIED`。
- **WotBTools 边界：** 数据区可读性、红/绿阵营非纯颜色表达、2D/3D HUD 遮挡、真实 Seek/暂停/反向的时间语义、Android GeckoView 与语言长度。实际渲染和源码可分别证明不同类型事实，不互相冒充。

### A2 — Finding 输出契约

每条报告必须有：`ID | Surface（route/组件/状态/断点） | Lens/上游原则 | 现状与影响 | Evidence（URL/截图/录屏/文件行） | Severity | DC-* 或 Contract Conflict | 最小建议 | 独立验收 | Status`。

- `P0`：确定的不可读、无障碍不合规、关键操作不可用/错误事实；`P1`：已观察到的信息层级、分组、状态或操作连续性问题；`P2`：可选择的视觉打磨。没有实际证据的审美意见只能写成 `Hypothesis`，不得包装为 Confirmed P0/P1。
- `Status` = `Confirmed`（直接证据足以证明）/ `Unverified`（缺渲染或设备证据）/ `Contract Conflict`（提案与旧规则冲突，需要 Designer 决策）/ `Already Compliant`（实际符合）。代码的确定性违规可由代码+可运行断言证明；“不好看”“感觉卡”不能只靠源码确认。
- 报告最后必须列出 `Coverage`（页面/断点/主题/状态/设备哪些看过）、`Evidence Gaps`、优先级排序和 `No-change` 清单。没发现问题时明确报告，没有必修修改。
- **只读审计的完成标准**是有界的可复查诊断结果，不是“审美全面改善”，也不自动创建 GitHub Issue、plan 或 PR。

## DESIGN — 形成可以交付的方案

1. 复用 A0/A1 采集基线并按两套方法审计；明确 Actual Outcome 和信息优先级，先解决结构/可用性，再讨论装饰。
2. 对 Confirmed 问题按收益和改动成本选择最小可逆候选方案；如用户授权了设计探索，可制作相同业务内容的 Before/After 草图、截图或可交互原型。没有渲染工具时提供具体布局/组件/状态方案，**标记未验证**。
3. 每个候选记录修改涉及的组件/Token owner、对 `DC-*` 的影响、交互状态、备选方案、风险、fallback 与回滚。与旧审美规则冲突不是自动拒绝；先测，再决定是否更改原 Contract。
4. Outside Judge：在相同 viewport/profile/数据状态对比信息可达、文字对比度、交互完成、动效可中断性、帧时间；无 baseline 先测，不编造改善百分比。需要 Android 的行为必须真机/GeckoView 验证。
5. 用户要求「出 plan」或授权实施时，回到 Designer 的**唯一** canonical plan schema 与授权边界，不在此 Playbook 重复维护 plan 结构；未授权时停止在可审核方案。

## IMPLEMENT / VERIFY — 实施与审查

- Executor 只实施已批准范围的设计；复用现有组件和 semantic tokens。Glass、Spring、回放表现层动效均允许在设计中探索，但须分别证明对比度/性能、可中断性/Reduced Motion、Seek/暂停/事实一致性。
- Review With Docs 检查实际 before/after 证据是否来自同一场景，且与计划和 `docs/frontend/design-language.md` 一致（或同一 PR 已明确更新 Contract）。不得把 Stylelint/CI 绿色当作视觉检查通过。
- 对改动运行受影响的 `pnpm run lint:css`、`pnpm run typecheck`、Vitest 与浏览器遮挡/交互测试。不同浏览器、触摸、GeckoView、合成材质和动画的运行时差异要有外部证据；没有就 `UNVERIFIED`，不能给视觉/动效 PASS。`DC-ACC-02` 对 3D/回放场景的用户验收仍然有效：场景截图/录屏可作诊断或性能证据，但**不得替代用户对实际回放画面的验收**。
- 对流畅度用浏览器 Performance trace/帧时间和代表性 Android 设备测量，先记录 baseline；不凭主观体验声称 FPS 改善。不得为通过测试而放宽已有无障碍/回放语义门禁。
- 所有 UI 改动可回滚到前一组件/Token 状态；若设计变更需要公共 Contract 更新，作为同一计划的明确 Scope，禁止静默加入。

## 交付前自检（让入口真正可用）

| 独立用例 | 预期行为 |
| --- | --- |
| 用户说「只审计首页设计」 | Designer 加载本 Playbook 与两套上游资料；输出 findings/coverage，不修改文件或创建计划 |
| 用户说「重新设计抽屉，先不要实现」 | Designer 给出备选和原型/待验证说明，不启动 Executor |
| UI PR 需要 final review | Review With Docs 读取本 Playbook，逐项检查计划、视觉证据、对比度/动效/交互与 Design Contract |
| 只有源码、浏览器无法打开 | 报告源码可证事实，并将视觉/动画判断标记 Unverified，不虚报截图/帧性能 |
| 遇到旧的纯色/固定缓动限制 | 允许提出可验证的 Contract 修改，不直接执行与现有规则冲突的 production 变更 |
| 上游脚本建议直接生成 Token | 根据来源 README 的禁用说明，使用现有项目 Token/测试，不生成第二套设计系统 |

## 与独立 Product QA 的关系

`product-qa` 的唯一入口是 `.agents/skills/product-qa/SKILL.md`，正文在 `.agents/playbooks/product-qa/README.md`。真实用户黑盒阶段先独立完成并冻结结果，**之后**在同一个 QA 报告内按该 Playbook §7.1 读取本文件的设计镜头。Product QA 不自动变成 Designer，也不拥有实现计划、PR 或 final PASS；Designer 的单独 AUDIT_ONLY 仍适用于用户明确要求的设计诊断。避免新增 `design-qa` 顶层 Skill 或第二份 Finding 事实源。

本 Playbook 是设计领域方法，不是全局技能路由、第二份设计规则、自动部署系统或视觉评分服务。
