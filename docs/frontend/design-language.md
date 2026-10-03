# WotbTools 设计语言（Design Language）

> 状态：**v1.0 已批准**（2026-10-01）· 基础设施已落地：token 分层、`@layer`、stylelint（见 §12–§13）· 适用范围：`frontend/` 全部页面、Android WebView
> 维护方式：没有设计师，也没有 Storybook。本文件就是唯一事实源，stylelint 负责自动执行（§12）。
> 原则：**以业界通用最佳实践为准**。现有代码与本文冲突时，改代码，不改本文。每一节都注明依据。
> 背景：现状盘点见 [layout-audit-2026-09-30.md](layout-audit-2026-09-30.md)。313 种硬编码 hex、83 种字号、154 种内边距、14 种圆角、60 种阴影、约 40 个 z-index、945 处 `!important`；"简约"主题在关键页面约 30–80% 的文字对比度不达标。

---

## 0. 五条总原则

1. **数据优先。** 这是一个分析工具：先让数字清楚、可比较，然后才考虑氛围。装饰永远不能降低数据的可读性。
2. **主题只换"皮"，不换"骨"。** 两套主题的布局、间距、字号、组件结构、交互完全一致，只替换语义 token 的值和装饰插槽。
3. **组件只认语义 token。** 组件里不出现色值、像素魔法数、`!important`、裸 z-index。
4. **可访问性是底线，不是加分项。** WCAG 2.2 AA：对比度、触控尺寸、键盘可达、减少动画。
5. **一个概念一个名字。** 术语、图标、组件都遵守这条：同一件事在所有页面上叫法一致、长相一致。

---

## 1. Token 架构

**依据：** W3C Design Tokens Community Group（DTCG）的分层模型。Material 3、Adobe Spectrum、GitHub Primer 都用这种三层结构。

```
Primitive（原始值）     --orange-500: #e0a02e     只在 tokens 文件内部使用
      ↓
Semantic（语义）        --color-accent: var(--orange-500)     组件只能用这一层
      ↓
Component（可选）       --button-primary-bg: var(--color-accent)     仅复杂组件需要
```

- **文件：** `src/styles/tokens/scale.css`（间距、字号、圆角、层级、控件尺寸、动效等与主题无关的量，并在文件顶部声明 `@layer` 顺序）· `src/styles/tokens/color.css`（原始色层与两套主题的语义映射、层级阴影）。**原始层只收录被两个及以上语义 token 共用的颜色**（目前是 `--green-400/700`、`--red-400/700`，被 success / danger 与阵营色共用）；只被一个语义 token 使用的颜色直接写在语义映射里，等出现第二个引用方时再抽出。
- **主题切换：** `<html data-theme="dark|light">`。主题文件只重新映射**语义层**；原始层和 scale 层两套主题共用。
- **CSS 分层：** 目标顺序是 `reset, tokens, base, layout, components, patterns, pages, utilities`，靠层级顺序解决优先级，从此不需要 `!important`。**只声明已经在用的层**：目前 `scale.css` 顶部只有 `@layer tokens;`，第一次需要新层时按上面的顺序把它追加进这条语句（全站只有这一处声明）。
- **命名：** `--{类别}-{角色}-{变体}-{状态}`，例如 `--color-text-secondary`、`--color-surface-2`、`--color-border-focus`。
- **旧 token 迁移：** 与新刻度同名、同值的旧变量（`--space-1…4`、`--radius-sm/md/lg`）已迁入 `scale.css`，保持单一事实源；`--space-5/6` 的旧用法已改指取值相同的 `--space-6/8`。其余旧变量（颜色、`--z-*`、`--font-*`、`--friendly/--enemy` 等）保持原值、标注 deprecated，与新 token 并存。组件迁移时直接改用新 token；某个旧变量不再被任何地方引用时就删除（§13）。**不把旧变量整体改成指向新值的 alias**：新旧色值不同，整体 alias 会一次性改变全站视觉。

---

## 2. 主题

| | **沉浸**（`dark`，默认） | **简约**（`light`） |
|---|---|---|
| 定位 | 游戏氛围、夜间使用 | 白天、办公、截图分享、打印 |
| 布局 / 组件 / 字号 / 密度 | **完全相同** | **完全相同** |
| 语义色 | §3 暗色列 | §3 亮色列 |
| 装饰图像 | 允许，只能出现在**装饰插槽**里 | 关闭（插槽为 `none`），或换成低饱和版本 |
| 系统界面 | `color-scheme: dark`，`<meta name="theme-color" content="#0b0f11">` | `color-scheme: light`，`theme-color` 为 `#f6f5f2` |

**装饰插槽**（这是唯一允许放背景图、渐变、毛玻璃的地方）：

1. 首页英雄区
2. 页面头部横幅（`PageHeader` 的 `hero` 变体）
3. 空状态插图
4. 登录页

**工作区表面**，也就是表格、回放、筛选、表单、抽屉，**两套主题都用纯色**。依据：WCAG 1.4.3 要求文字对比度稳定，而文字压在图片上时，对比度会随图片内容变化，没法保证。

**选择逻辑：**
- 首次访问跟随 `prefers-color-scheme`。
- 用户手动选择后记住，以用户选择为准。
- 在首次绘制之前，由 `index.html` 里的内联脚本设置 `data-theme`，避免闪烁。
- 用户菜单里提供"跟随系统 / 沉浸 / 简约"三个选项。实现方式：给 `wotb-ui-profile` 增加 `auto` 值，由 `useUiProfile` 按 `prefers-color-scheme` 解析为 showcase / classic；不新增独立的 theme 状态或存储 key（遵守 `frontend/AGENTS.md` 的 UI Profile 不变量）。

**验收标准：** 任何组件在两套主题下都必须通过 §3 的对比度要求。PR 需要附上两套主题的截图。

---

## 3. 颜色

**依据：** WCAG 2.2 AA。正文 ≥ 4.5:1；大字（≥ 24px，或 ≥ 18.66px 且加粗）≥ 3:1；UI 组件和图形 ≥ 3:1（1.4.11）。
下表每个值都已用脚本验证：在该主题的**全部 4 层表面**上取最差的一层，结果仍然达标。

### 3.1 表面与文字

| 语义 token | 沉浸 dark | 简约 light | 用途 |
|---|---|---|---|
| `--color-canvas` | `#0b0f11` | `#f6f5f2` | 页面底色 |
| `--color-surface-1` | `#11171a` | `#ffffff` | 卡片、面板 |
| `--color-surface-2` | `#172024` | `#f1efea` | 表头、嵌套区域、hover |
| `--color-surface-3` | `#1e292e` | `#e8e5de` | 选中行、按下、输入框底 |
| `--color-text-primary` | `#eceae4`（≥12.4） | `#1b1e1c`（≥13.4） | 正文、数字 |
| `--color-text-secondary` | `#aab1ac`（≥6.8） | `#4c534f`（≥6.3） | 标签、说明 |
| `--color-text-tertiary` | `#8a938e`（≥4.7） | `#5a615d`（≥5.1） | 辅助信息、占位符。**这是最浅的一级文字色** |
| `--color-border-subtle` | `#25313a` | `#e3dfd6` | 分隔线（装饰性，不承担信息） |
| `--color-border-strong` | `#6c7a82`（≥3.4） | `#7f7c74`（≥3.3） | 输入框、复选框等控件边框（需 ≥3:1） |

**深色主题的层级靠亮度区分，不靠阴影。** 表面越亮，离用户越近。依据：Material Design 的暗色主题指南。浅色主题则用阴影。

### 3.2 强调色与状态色

| 语义 token | 沉浸 dark | 简约 light | 规则 |
|---|---|---|---|
| `--color-accent` | `#e0a02e` | `#a0620c` | 主按钮底色、选中态、焦点环、进度条 |
| `--color-on-accent` | `#17130b`（8.1） | `#ffffff`（4.9） | 橙色底上的文字 |
| `--color-accent-text` | `#f0b33e`（≥8.0） | `#955708`（≥4.6） | **橙色文字只能用这个 token**，如链接、强调数字 |
| `--color-success` | `#5cc280` | `#16703c` | 成功、胜利 |
| `--color-danger` | `#f2786d` | `#b8352a` | 错误、删除、失败 |
| `--color-warning` | `#f5ca76` | `#855600` | 警告 |
| `--color-info` | `#6db3ec` | `#1a64a8` | 提示、链接（非品牌链接） |

- 遮罩：`--color-scrim` 暗色为 `rgb(0 0 0 / .6)`、亮色为 `rgb(0 0 0 / .35)`，所有弹窗、sheet 共用；组件里不再各写一个遮罩色。
- 状态色的背景版本（`--color-danger-bg` 等）统一用 `color-mix(in oklab, var(--color-danger) 14%, var(--color-surface-1))`，不再单独定义色值。
- **强调色要克制**：每个视图只保留一个主操作用橙色填充。其余按钮用 secondary 或 ghost（§7）。

### 3.3 领域色：阵营

| token | 沉浸 | 简约 | 色盲模式（设置项） |
|---|---|---|---|
| `--color-team-ally` | `#5cc280` | `#16703c` | 不变 |
| `--color-team-enemy` | `#f2786d` | `#b8352a` | `#c38bf0` / `#7b3fb3`（紫色） |

- **不能只靠红绿区分阵营。** 约 8% 的男性有红绿色觉障碍。阵营还必须通过**位置**（左本方、右敌方）、**文字标签**或**形状**再表达一次。
- 游戏本身有色盲模式，把敌方改成紫色。我们提供同样的开关，与玩家的习惯保持一致。
- 2D、3D、表格、雷达图共用这两个 token，不再各自定义红绿。

### 3.4 数据可视化

- 分类色板：8 色，对色盲友好（参考 Okabe–Ito），两套主题各一份，都要在 `surface-1` 上 ≥ 3:1。
- 顺序色板（热力图、穿透率等）：单色相，从浅到深；在亮色主题里方向反转。
- 图表**一律带图例**，关键数值直接标在图上，不能只靠颜色读值。

### 3.5 领域色：坦克类别

坦克百科用**边框色**区分车型类别，复用状态色 token（**不新造色**）：

| 类别 | token | 落点 | 判定字段 |
|---|---|---|---|
| 金币车 | `--color-warning` | 卡片边框 + 详情页 pill | `is_premium` |
| 收藏车 | `--color-info` | 卡片边框 | `is_collector` |

- **两者互斥**：数据上同出 `tanks.pb` field13 的枚举（1=金币、2=收藏），上游
  `tank_cache.json` 同时给出两个字段——实测 735 辆里金币 91 / 收藏 338 / 同时为真 **0**。
- **复用状态色是有意的**：这两个 token 在两档主题都有成对定义与达标对比度；新造领域色
  要在两档主题各调一次对比度，收益不成比例。将来类别继续增加（如"特种车"）再考虑独立 token。
- 收藏车占比很高（338/735 ≈ 46%），边框因此只做**低强度混合**
  （`color-mix(in oklab, var(--color-info) 55%, var(--color-border-subtle))`），
  避免半张列表都在"发亮"。

---

## 4. 字体排印

**依据：** 系统字体栈加载为零、CJK 渲染最好；模块化字号阶梯；数字用等宽数字（tabular），便于对齐比较。

- **字体：** `system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`；代码用 `ui-monospace, "SF Mono", Consolas, monospace`。不引入网络字体。
- **数字：** 所有表格、统计、计时都加 `font-variant-numeric: tabular-nums`。数字格式统一走 `Intl.NumberFormat(locale)`，例如 `3,231.8`；伤害和 HP 使用千分位。

| token | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| `--type-display` | 32 / 40 | 700 | 首页标题（**仅**用于装饰插槽） |
| `--type-h1` | 24 / 32 | 700 | 页面标题。**每页只有一个 h1** |
| `--type-h2` | 20 / 28 | 600 | 区块标题 |
| `--type-h3` | 16 / 24 | 600 | 卡片标题、抽屉小节 |
| `--type-body` | 14 / 20 | 400 | 正文、表格（桌面） |
| `--type-body`（触控） | 15 / 22 | 400 | 正文（`pointer: coarse` 时自动替换） |
| `--type-caption` | 12 / 16 | 400 / 600 | 标签、表头、辅助说明。**这是最小字号**，中文 < 12px 不可读 |

- 字号只有这 7 级，从现在的 83 种收敛下来。**禁止出现 12px 以下的文字。**
- **token 形态：** 每一级有两个原子 token `--font-size-{级}`、`--line-height-{级}`，以及一个组合 token `--type-{级}`（字重 + 字号 / 行高 + 字体，用于 `font` 简写）。`font-size` / `line-height` 只能引用原子 token，`font` 只能引用组合 token；触控档只覆盖 `--font-size-body` / `--line-height-body`，组合 token 自动跟随。长文阅读另有 `--line-height-prose`（1.7，只用于文档类页面的正文）。
- 字重只用 400 / 600 / 700。
- 大写字母 + 字间距的 "kicker" 标签（如 `WOTBTOOLS · REPLAY WORKSPACE`）只能出现在装饰插槽里，工作区不用。

---

## 5. 间距、尺寸、圆角、阴影、层级

**依据：** 4pt 网格（Material、Apple HIG、多数设计系统的做法），以及有限的离散刻度。

**间距**：`--space-{0,1,2,3,4,5,6,8,10,12}` = `0, 4, 8, 12, 16, 20, 24, 32, 40, 48px`

- 组件内间距用 1–4 级，组件之间用 4–6 级，区块之间用 8–12 级。
- 页面左右边距：`--gutter` = 手机 16 / 平板 24 / 桌面 32。

**控件尺寸与密度**（默认紧凑；`pointer: coarse` 时自动切换到触控档）：

| token | 紧凑（鼠标） | 触控（`pointer: coarse`） | 依据 |
|---|---|---|---|
| `--control-h-sm` | 28 | 36 | 仅用于次要的行内操作 |
| `--control-h-md` | 32 | 44 | 按钮、输入框、下拉框 |
| `--control-h-lg` | 40 | 48 | 主操作 |
| `--row-h` | 36 | 48 | 表格行、列表行 |
| `--control-check` | 18 | 24 | 复选框 / 单选框的可视尺寸（所在单元格或 label 另保证最小点击区域 `--hit-min`） |
| 最小点击区域 | 24×24 | **44×44** | WCAG 2.5.8 最低 24；Apple HIG 44pt；Material 48dp |

**圆角**（从 14 种收敛为 4 种）：`--radius-sm: 6px`（标签、小徽章、小控件）· `--radius-md: 8px`（按钮、输入框、卡片）· `--radius-lg: 12px`（弹窗、sheet、抽屉）· `--radius-full: 999px`（胶囊、头像）

**阴影 / 层级**（从 60 种收敛为 3 级）：

| token | 用途 | 暗色 | 亮色 |
|---|---|---|---|
| `--elevation-1` | 卡片 | 无阴影，用 `surface-1` + `border-subtle` | 轻阴影 `0 1px 2px rgb(0 0 0 / .06)` |
| `--elevation-2` | 下拉菜单、吸顶栏 | `surface-2` + `0 4px 12px rgb(0 0 0 / .4)` | `0 4px 12px rgb(0 0 0 / .10)` |
| `--elevation-3` | 弹窗、sheet | `surface-2` + `0 12px 32px rgb(0 0 0 / .5)` | `0 12px 32px rgb(0 0 0 / .16)` |

**Z-index**（从约 40 个值收敛为 8 级，**只能用 token**）：

`--z-base: 0` · `--z-sticky: 100` · `--z-header: 200` · `--z-drawer: 300` · `--z-sheet: 400` · `--z-menu: 500` · `--z-dialog: 600` · `--z-toast: 700`

**动效**：`--duration-fast: 120ms`（hover、按下）· `--duration-base: 200ms`（展开、切换）· `--duration-slow: 300ms`（sheet、抽屉进出）· `--ease-standard: cubic-bezier(.2, 0, 0, 1)`。`prefers-reduced-motion: reduce` 时三个时长都归零。

回放、3D 等组件内部的叠放用 `isolation: isolate` 建立局部层叠上下文，内部只用 1–9，不参与全局竞争。

---

## 6. 响应式与输入方式

**依据：** 布局按**可用空间**决定，交互尺寸按**输入方式**决定，两件事分开处理。这也是 Material 3 "window size classes" 的思路。

- **断点只有三档：** `compact < 768` · `medium 768–1199` · `expanded ≥ 1200`。
  - CSS 只允许写 range 语法：`@media (width < 768px)`、`(768px <= width < 1200px)`、`(width >= 1200px)`。
  - JS 使用 `useBreakpoint()`，与 CSS 共用同一份常量。
- **输入方式：** `@media (pointer: coarse)` 只用来切换密度 token（§5），**不用来改布局**。JS 使用 `usePointer()`。
- **组件级适配**用容器查询 `@container`，例如：表格在容器 < 560px 时切换成卡片。组件不应该知道视口有多大。
- **视口单位：** 用 `dvh` / `svh`，不用 `100vh`；宽度用 `100%`，不用 `100vw`。
- **安全区：** 顶栏、底部 Tab 栏、底部操作栏、全屏回放都要加 `env(safe-area-inset-*)`。
- **hover 效果**包在 `@media (hover: hover)` 里，避免触屏上的"粘滞 hover"。

---

## 7. 组件规范（最小集合）

每个组件都必须具备这些状态：`default / hover / focus-visible / active / disabled / loading`（适用的部分）。

- **焦点环统一：** `outline: var(--focus-outline); outline-offset: var(--focus-outline-offset);`（即 2px 实线强调色、偏移 2px），只在 `:focus-visible` 时显示。旧的 `--focus-ring` 是颜色值，迁移后删除。

| 组件 | 变体 | 规则 |
|---|---|---|
| **Button** | `primary`（橙色填充）· `secondary`（描边）· `ghost`（无边框）· `danger` · 尺寸 sm/md/lg · 纯图标按钮 | 取代现在的约 20 种按钮 class。每个视图最多一个 `primary`。纯图标按钮必须有 `aria-label` 和 tooltip。加载时显示 spinner，同时保持按钮宽度不变 |
| **IconButton** | — | 图标 20px，点击区域遵守 §5 的最小尺寸 |
| **Input / Select / Textarea** | — | 标签放在控件上方（不能只靠 placeholder）；下方放说明文字和错误文字；错误态 = 边框用 `danger` + 图标 + 文字 |
| **SearchSelect** | 单选 / 多选 | 选项超过 15 项时必须可搜索，例如名人堂的选车器 |
| **FileDrop** | 单文件 / 多文件 | **全站只有这一个上传组件**，替换现在的 3 套；原生 `<input type=file>` 视觉隐藏，但保持键盘可达 |
| **SegmentedControl** | — | 页面内的视图切换，例如 汇总 / 单场、数据 / 2D / 3D |
| **Tabs** | — | 页面级分区。和 SegmentedControl 的区别：Tabs 切换的是内容区域，SegmentedControl 切换的是同一内容的呈现方式 |
| **Chip** | 筛选 chip · 状态 chip | 已生效的筛选条件显示为可移除的 chip |
| **Badge** | 中性 / 状态 / 阵营 | 只放短文本（≤ 6 个字） |
| **Card** | 默认 / 可点击 | 可点击卡片整卡都是点击区，并且可用键盘聚焦 |
| **DataTable** | — | 数字右对齐 + 等宽数字；表头吸顶；首列可冻结（手机上只冻结一列）；可排序列用 `<button>` 并带 `aria-sort`；容器 < 560px 时自动切换成卡片列表 |
| **Stat** | — | 标签（caption）+ 数值（h2，等宽数字）+ 可选的变化量 |
| **Dialog** | 确认 / 表单 | 焦点陷阱，Esc 关闭，关闭后焦点回到触发元素，`aria-modal`；手机上变为底部 sheet；**取代 `window.confirm`** |
| **Sheet** | 底部 / 侧边 | 手机上的筛选、详情、面板都用 sheet；有 2–3 个吸附高度 |
| **Drawer** | — | 桌面上是常驻侧栏，平板上是推开式侧栏（不遮盖内容），手机上变成全屏 sheet |
| **Menu** | — | 下拉菜单，支持方向键导航和 Esc 关闭 |
| **Toast** | 成功 / 错误 / 信息 | 用于操作结果反馈；错误 toast 不会自动消失，并提供"重试" |
| **Banner** | 页面级 | 用于持续性状态，例如"迁移中""维护中" |
| **Skeleton / Spinner / Progress** | — | 预计超过 1s 用 skeleton；能算出进度的一律用 Progress |
| **EmptyState** | — | 插图（装饰插槽）+ 说明"为什么是空的" + 下一步操作按钮 |
| **PlaybackControls** | — | 2D 和 3D **共用**：时间统一为 `mm:ss / mm:ss`，倍速 0.5 / 1 / 2 / 4 / 8× |

---

## 8. 图标

**依据：** 一个项目只用一套图标，风格才一致。emoji 在不同系统和 WebView 上渲染不一致，也无法控制颜色，不应该当图标用。

- 统一使用 **Lucide**（MIT 协议，支持按需引入，线性风格，1.5–2px 描边）。
- 尺寸：16（行内）· 20（按钮默认）· 24（导航、空状态）。颜色用 `currentColor`。
- **全面替换 emoji 和 Unicode 符号：** 🔍 🗑 ⬇ ☰ ✎ ✕ ⚠ ★ ✓ ↻ 等。
- 纯装饰图标加 `aria-hidden="true"`；承载含义的图标要配文字，或者加 `aria-label`。
- 游戏资产（车辆图、国旗、车种图标）不属于图标系统，单独作为"资产"管理。

---

## 9. 布局模式

| 模式 | 规则 |
|---|---|
| **AppShell** | 平板 / 桌面：左侧边栏（`--z-header`，铺满视口高度），没有顶栏（`--header-h: 0`）。桌面默认展开（240px，图标 + 文字），可折叠成 72px 图标栏并记住偏好；平板固定为图标栏。侧边栏从上到下：品牌 · 主栏目（首页 · 回放 · 名人堂 · 坦克百科）· 管理组（按角色）；底部：更多（弹出面板，只放低频的显示设置与关于 / 支持）· 账户 · 折叠开关。手机 / App：48px 标题栏 + 底部 Tab 栏（56px + 安全区），更多是整页。当前侧边栏宽度写入 `--sidebar-w`（手机为 0），顶栏高度写入 `--header-h`；布局偏移只读这两个值 |
| **PageHeader** | `compact`（工作区用：标题 + 右侧操作，一行，≤ 56px）· `hero`（装饰插槽，只用于首页 / 名人堂）。**工作区禁止用 kicker + h1 + 说明 + 标签块占掉首屏** |
| **容器宽度** | `content`（阅读类，≤ 760）· `wide`（≤ 1280）· `full`（回放、数据工作台，铺满可用宽度） |
| **Master–Detail** | expanded：列表 + 常驻详情。medium：列表 + 推开式详情。compact：列表 → 全屏详情（支持左右滑动切换）。回放工作台、射击分析、坦克百科都用这个模式 |
| **筛选** | expanded / medium：行内工具栏。compact：一个"筛选"按钮 → sheet，已生效的条件以 chip 显示在列表上方 |
| **主操作位置** | expanded：页面头部右侧。compact：底部固定操作栏（带安全区） |

---

## 10. 状态与反馈

**依据：** Nielsen 可用性原则第 1 条"系统状态可见"。任何等待超过 1s 的操作都要有反馈，任何失败都要有提示。

| 场景 | 必须做到 |
|---|---|
| 加载 | 超过 1s 显示 skeleton 或进度；超过 10s 显示"仍在处理"，并允许取消 |
| 失败 | **永远不能静默失败**（审计里的 BZ-01、3D-09、WS-01）。说明发生了什么 + 可能的原因 + 下一步操作（重试 / 返回 / 联系） |
| 空状态 | 说明为什么是空的 + 怎样才能有内容 + 主操作按钮 |
| 破坏性操作 | 能撤销的用 toast 加"撤销"；不能撤销的用 Dialog 确认，按钮写明具体动作，例如"清空 6 场结果" |
| 权限 | 未登录：AuthGate 说明登录后能做什么，再给登录按钮。无权限：说明原因，不能静默重定向 |
| 功能关闭 | 隐藏入口；如果必须保留，就显示 Banner 说明，不能留下死 Tab |

---

## 11. 文案与术语

**依据：** 同一个概念只用一个名字；使用用户的语言，不用实现层的术语。

- **禁止出现在界面上的词：** WebAssembly、WASM、资产源、静态资产包、滤波、位姿、eid、（Agent）、Keycloak、内部枚举值（如 `heavyTank`、`china`、`map_43`、`tank_6929`）。
- **术语表：** 新增文件 `docs/frontend/glossary.md`，中英俄三语对照。初始条目取自审计 §7.3：

| 概念 | 中文 | 说明 |
|---|---|---|
| 主导航"回放" | 回放 | 替代"回放解析 / 回放工作台 / 回放数据提取 / 数据解析 / 批量解析" |
| 2D 回放 | 2D 回放 | 替代"战局重建 / 战局回放 / 战斗回放" |
| 3D 回放 | 3D 回放 | |
| 射击分析 | 射击分析 | 替代"射击复现" |
| 装甲查看器 | 装甲查看器 | 替代"3D 装甲检视器" |
| 评分 | Rating | 表格、抽屉、导出统一叫"Rating"，不再混用"评级" |

- **语气：** 简洁、直接，对用户说话；按钮用动词开头（"导出 Excel""提交记录"）。
- **i18n：** 所有界面文字都走 `$t()`，**包括 3D 页面**；枚举值通过映射表翻译；复数用 vue-i18n 的复数语法。
- **数字和单位：** 数字和单位之间加空格（`255 mm`、`3.4 °/s`）；时间统一为 `mm:ss`；百分比保留 1 位小数。

---

## 12. 执行与守护（替代 Storybook）

1. **stylelint**（`npm run lint:css`，配置见 `frontend/stylelint.config.mjs`，CI 必过）：
   - `declaration-no-important`：禁止 `!important`。
   - `scale-unlimited/declaration-strict-value`：`*color`、`fill`、`stroke`、`z-index`、`font`、`font-size`、`line-height`、`border-radius`、`box-shadow` 只能用 `var(--*)` 或豁免值。豁免值（`TOKEN_EXEMPT_VALUES`）：`transparent`、`currentColor` / `currentcolor`（插件区分大小写）、`inherit`、`initial`、`unset`、`revert`、`none`、`0`、`auto`、`normal`。
   - `color-no-hex`、`color-named: never`、`function-disallowed-list: rgb/rgba/hsl/hsla`：组件里不出现色值；只有 `src/styles/tokens/**` 例外。需要半透明时用 `color-mix()`。
   - `media-feature-range-notation: context`、`media-feature-name-value-allowed-list: width → 768px / 1200px`、`media-feature-name-disallowed-list: min-width / max-width / device-width`：断点只有三档，且必须写 range 语法。
   - `declaration-property-unit-disallowed-list`：块方向尺寸（`height`、`block-size` 及其 min/max，`top`、`bottom`、`inset`、`inset-block*`）禁止 `vh`，用 `dvh` / `svh`；行方向尺寸（`width`、`inline-size` 及其 min/max）禁止 `vw`，用 `%`；`flex-basis` 两者都禁。
   - 旧文件列在 `frontend/stylelint.legacy.json` 忽略名单里（基线），新文件一律严格检查；每迁完一个文件就从名单里删掉，名单长度即迁移进度。
2. **frontend/AGENTS.md** 引用本文件："改动 UI 前必须阅读 design-language.md；新增视觉值必须先加 token。"
3. **视觉回归（后续 PR）：** 在已有的 `test:browser-layout` 里加上两套主题 × 三档宽度的截图，以及基于 axe-core 的对比度检查。
4. **PR 自查清单：**
   - [ ] 只用了语义 token
   - [ ] 两套主题都截了图
   - [ ] 三档宽度都截了图
   - [ ] 键盘能走完整个流程
   - [ ] 新文案进了 i18n 和术语表

---

## 13. 迁移策略（不推倒重来）

1. **建立基础：** 新增 tokens 分层文件和 `@layer tokens` 声明；同名同值的间距、圆角迁入 `scale.css`，其余旧变量原值保留、与新 token 并存；接入 stylelint。视觉上保持不变。
2. **组件：** 先实现 Button / Input / FileDrop / Dialog / Sheet / DataTable / EmptyState / PlaybackControls，再逐页替换。
3. **删除 showcase 覆盖层：** 每迁完一页，就删掉 `showcase*.css` 和 `classic-profile.css` 里对应的选择器。简约主题改为纯语义映射。
4. **收紧 lint：** 迁移完成的目录开启严格规则，并在 CI 里阻断。
5. **收尾：** 删除 `tokens.css`、`classic-profile.css`、`showcase*.css` 中已无人引用的旧 token 与覆盖规则。`!important` 数量作为进度指标，目标是 0。

---

## 决策记录

2026-10-01 已确认：
- 两套主题的定位：沉浸 = 暗色 + 装饰插槽，简约 = 亮色 + 无装饰；布局、组件、密度完全一致。
- 默认主题跟随系统（通过 profile 的 `auto` 值实现）。
- 色盲模式的开关放在"我的 → 显示设置"。
- 图标库使用 Lucide（第一个使用它的组件 PR 再引入依赖）。
- 每个视图只允许一个橙色主按钮。

2026-10-02 已确认：
- 平板 / 桌面的主导航从顶栏移到左侧边栏（顶栏放不下主栏目 + 管理入口）；"更多"在侧边栏里是弹出面板，只放不常用的设置与关于 / 支持。
