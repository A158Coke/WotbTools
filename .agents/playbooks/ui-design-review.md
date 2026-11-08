# UI 设计审查：Refactoring UI + Apple Design

> 这是现有 **Designer → Executor → Review** 流程的领域 Playbook，不是新增的顶层 Skill。
> 第三方参考资料保存在 `.agents/references/design-methods/`；WotBTools 的设计规则唯一来源是 `docs/frontend/design-language.md`。

## 何时加载

当任务涉及视觉重设计、视觉层级、布局与排版、配色、半透明/毛玻璃材质、动效、导航交互、移动端体验或 UI 审计时，Designer 加载本文件；Executor 只在已批准的 UI 计划中使用；Review 对受影响界面执行对应审查。普通后端任务不加载。

按需阅读 `../references/design-methods/refactoring-ui/SKILL.md` 与 `../references/design-methods/apple-design/SKILL.md`，只加载与当前问题相关的 Refactoring UI 章节。**不要自动执行上游 Token 生成工作流**：WotBTools 已有设计系统。辅助 Python 脚本的使用限制和独立复现的缺陷，以 [参考资料入口](../references/design-methods/README.md) 为准；不得把上游脚本的输出当作合规证明。

## 设计前审计（Designer）

1. 检查当前 Vue 组件、`docs/frontend/design-language.md`、`docs/frontend/ui-system.md`、语义 Token、Motion Policy 所有权和直接相关的测试。
2. 在固定 Git commit 上采集真实页面基线：桌面、触屏竖屏和横屏；覆盖相关四季主题、浮层打开状态、极端字体/文案和 Reduced Motion。仅当 Android/GeckoView 行为有差异时补充真机证据。
3. 按 Refactoring UI 的顺序审计：视觉层级 → 布局/间距 → 排版 → 颜色 → 深度/材质 → 图片 → 细节。每项 Finding 记录截图位置、实际问题、适用的上游原则、冲突的 `DC-*` 规则（如有）、严重程度和未验证假设。
4. 依据 Apple Design 审计交互：按下即反馈、直接操作、动画可中断与速度继承、空间连续性、材质层级、Reduced Motion、帧性能。没有真实交互或帧数据时，不得声称动画更流畅。
5. 有证据时可以质疑旧有审美限制。Design Contract 可以修订，但两个外部 Skill 不会自动覆盖项目业务语义；通过独立验证后，把新决策写回现有权威文件。
6. 优先提出小范围、可回滚的原型；没有原型比较和实测证据时，不扩大到全站改版。

## 实施（Executor）

- 制作 Before/After 原型并附相同场景的截图或录屏，确保业务信息与路由行为未改变。
- 优先复用 Vue 共享组件、现有 `motion-v`、语义 Token 与 `motionPolicy.ts`。确有需要时可在同一个 Motion Policy 中扩展 Spring/手势模型，不默认增加第二个动画库。
- 数据区域可以考虑半透明和毛玻璃，但必须验证动态背景下的文字对比度、可读性、降级表现和真实设备性能；不以玻璃效果本身作为设计目标。
- 回放/HUD/镜头/时间轴允许探索表现层动效，但回放时间、事件、HP 和 Seek 等事实语义必须保持准确；覆盖快速中断、暂停、Seek、反向操作及 CPU/GPU 开销。
- 纯视觉任务不隐式授权 API、领域逻辑、身份认证、全站重写或按主题复制业务实现。

## 独立验收（Outside Judge）

- 对比相同场景、断点及四季主题的改动前后截图；对实际叠合背景取样，而不是只检查 Token 的理论配色。
- 在 `frontend/` 运行受影响范围的 `pnpm run lint:css`、`pnpm run typecheck`、Vitest 和浏览器交互/遮挡测试；不以工具未覆盖的检查冒充通过。
- 动效改动要有交互录屏和代表性设备的帧性能数据；先量测 baseline，再讨论改善。验证 `prefers-reduced-motion` 与无障碍。
- 确认没有重复 Token/状态、不必要的依赖、键盘或触控不可达、回放事实偏移。
- 将每项 Finding 标记为 `Confirmed`、`Unverified`、`Contract Conflict` 或 `Already Compliant`，明确证据限制；不得仅凭审美偏好宣称客观改善。

本 Playbook 借用方法，不复制品牌视觉；不自动把页面变成 Apple 风格，也不引入一套 Tailwind Design Tokens。
