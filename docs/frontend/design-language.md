# WotbTools Design Contract v1（设计语言）

> 适用范围：`frontend/` 全部页面、Android GeckoView。
> 本文件是视觉与交互规则的唯一 owner。token 数值以 `frontend/src/styles/tokens/` 为准，实现位置与页面现状见 [ui-system.md](ui-system.md) 和 [replay-workspace.md](replay-workspace.md)。规则与代码不一致时按代码核实：事实描述错了就修文档，规则被违反就修代码，不把文档对齐隐式扩大为产品改动。

---

## 0. 五条总原则

1. **数据优先。** 这是一个分析工具：先让数字清楚、可比较，然后才考虑氛围。装饰永远不能降低数据的可读性。
2. **主题只换"皮"，不换"骨"。** 两套主题的布局、间距、字号、组件结构、交互完全一致，只替换语义 token 的值和装饰插槽。
3. **组件只认语义 token。** 组件里不出现色值、像素魔法数、`!important`、裸 z-index。
4. **可访问性是底线，不是加分项。** WCAG 2.2 AA：对比度、触控尺寸、键盘可达、减少动画。
5. **一个概念一个名字。** 术语、图标、组件都遵守这条：同一件事在所有页面上叫法一致、长相一致。

### 规则结构

每节开头的规则表是可判定的契约，表后的说明是它的细节。引用规则时写稳定 ID（如 `DC-SEL-03`），ID 不复用，规则废止时删除整行。

- **强度：** `MUST` 违反即不通过审查；`SHOULD` 默认遵守，偏离时在 PR 写明理由；`MAY` 明确允许的选择。
- **验证：** 优先写可运行的命令或测试。写「人工」表示没有自动判定，由 PR 审查或用户验收按规则核对；不得把人工项说成已被门禁覆盖。
- **存量：** `frontend/stylelint.legacy.json` 名单内的文件在迁移前不受静态校验，迁移时一并修复。
- **外部资料：** 规则依据可以引用外部规范，但比例、弹簧参数这类经验值不自动成为规则，只有能在本项目验证并写进本文件才算数。

---

## 1. Token 架构

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-TOK-01 | MUST | 全部组件 | 组件只用语义 token；需要新的视觉值时先加 token，不写字面量 | `src/styles/tokens/**` | `pnpm run lint:css` |
| DC-TOK-02 | MUST | `stylelint.legacy.json` | 名单只减不增，新文件不进名单 | 无 | 人工 |

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
- **CSS 分层：** 目前 `scale.css` 顶部只有 `@layer tokens;`（全站只有这一处声明），只声明已经在用的层。
- **命名：** `--{类别}-{角色}-{变体}-{状态}`，例如 `--color-text-secondary`、`--color-surface-2`、`--color-border-focus`。
- **旧 token 迁移：** 与新刻度同名、同值的旧变量（`--space-1…4`、`--radius-sm/md/lg`）已迁入 `scale.css`，保持单一事实源；`--space-5/6` 的旧用法已改指取值相同的 `--space-6/8`。其余旧变量（颜色、`--z-*`、`--font-*`、`--friendly/--enemy` 等）保持原值、标注 deprecated，与新 token 并存。组件迁移时直接改用新 token；某个旧变量不再被任何地方引用时就删除。**不把旧变量整体改成指向新值的 alias**：新旧色值不同，整体 alias 会一次性改变全站视觉。

---

## 2. 主题

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-THM-01 | MUST | 两档 Profile | 布局、组件结构、交互完全一致，只替换语义 token 和装饰插槽；不按 Profile fork 业务实现 | 无 | `src/styles/classic-profile-css.test.js`；`frontend/AGENTS.md` UI Profile 不变量 |
| DC-THM-02 | MUST | 全站 | 背景图、渐变、毛玻璃只出现在本节列出的装饰插槽 | 无 | 人工 |
| DC-THM-03 | MAY | 工作区页面 | 在数据区之上放一个 Showcase Hero | 无 | 人工 |
| DC-THM-04 | MUST | Showcase Hero | 只放在数据区之上，不进入表格、筛选、表单、抽屉；expanded 档首屏必须能看到数据区 | 无 | 每页 PR 大屏截图，人工 |
| DC-THM-05 | MUST | Showcase Hero | 文字落在纯色遮罩上，遮罩上最差取样点满足 §3 对比度，两档 Profile 都测 | 无 | 人工取样 |
| DC-THM-06 | MUST | Showcase Hero | Classic 下降级为纯色；`prefers-reduced-motion: reduce` 下无动效 | 无 | 人工；首页由 `pnpm run test:browser-home` 覆盖动效 |

| | **沉浸**（`dark`） | **简约**（`light`） |
|---|---|---|
| 定位 | 游戏氛围、夜间使用 | 白天、办公、截图分享、打印 |
| 布局 / 组件 / 字号 / 密度 | **完全相同** | **完全相同** |
| 语义色 | §3 暗色列 | §3 亮色列 |
| 装饰图像 | 允许，只能出现在**装饰插槽**里 | 关闭（插槽为 `none`），Hero 降级为纯色 |
| 系统界面 | `color-scheme: dark`，`<meta name="theme-color" content="#0b0f11">` | `color-scheme: light`，`theme-color` 为 `#f6f5f2` |

**装饰插槽**（这是唯一允许放背景图、渐变、毛玻璃的地方）：

1. 首页英雄区（`HomePage.vue` 自己拥有；`PageHeader` 不提供 `hero` 变体）
2. 工作区 Showcase Hero（规则见 DC-THM-03 至 DC-THM-06）
3. 空状态插图
4. 登录页

**数据区**，也就是表格、回放、筛选、表单、抽屉，**两套主题都用纯色**。依据：WCAG 1.4.3 要求文字对比度稳定，而文字压在图片上时，对比度会随图片内容变化，没法保证。

**选择逻辑：**
- 首次访问跟随 `prefers-color-scheme`。
- 用户手动选择后记住，以用户选择为准。
- 在首次绘制之前，由 `index.html` 里的内联脚本设置 `data-theme`，避免闪烁。
- 用户菜单里提供"跟随系统 / 沉浸 / 简约"三个选项。`wotb-ui-profile` 的 `auto` 值由 `useUiProfile` 按 `prefers-color-scheme` 解析为 showcase / classic；没有独立的 theme 状态或存储 key（遵守 `frontend/AGENTS.md` 的 UI Profile 不变量）。

**验收标准：** 任何组件在两套主题下都必须通过 §3 的对比度要求。

---

## 3. 颜色

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-CLR-01 | MUST | 全站 | 正文 ≥ 4.5:1，大字与 UI 图形 ≥ 3:1，两档 Profile 都成立 | 无 | 人工 |
| DC-CLR-02 | MUST | 单个视图 | 只保留一个橙色填充主操作 | 无 | 人工 |
| DC-CLR-03 | MUST | 阵营表达 | 不能只靠红绿区分，必须再用位置、文字或形状表达一次 | 无 | 人工 |
| DC-CLR-04 | MUST | 物理队伍色 | Team 1 / Team 2 颜色不随录像者交换 | 无 | 人工 |

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

- 遮罩：`--color-scrim` 暗色为 `rgb(0 0 0 / .6)`、亮色为 `rgb(0 0 0 / .35)`，所有弹窗、sheet 共用；组件不各自定义遮罩色。
- 状态色的背景版本（`--color-danger-bg` 等）统一用 `color-mix(in oklab, var(--color-danger) 14%, var(--color-surface-1))`，不单独定义色值。
- **强调色要克制**：每个视图只保留一个主操作用橙色填充。其余按钮用 secondary 或 ghost（§7）。

### 3.3 领域色：阵营

**两套概念，不得互相替代**：

| 概念 | token | 用途 |
|---|---|---|
| **物理队伍**（回放 Team 1 / Team 2，固定身份色） | `--color-team-1` / `--color-team-2` | 需要「队伍 1 就是队伍 1」的身份表达；不决定名册左右位置 |
| **记录者视角**（我方 / 敌方） | `--color-team-ally` / `--color-team-enemy` | 2D / 3D 名册、顶栏双方总血量与比分、基地归属、胜负横幅 |
| 未知 / 中立 | `--color-team-neutral` | 未识别阵营、无主基地 |

| token | 沉浸 | 简约 | 色盲替代色 |
|---|---|---|---|
| `--color-team-1` | `#5cc280` | `#16703c` | 不变 |
| `--color-team-2` | `#f2786d` | `#b8352a` | 改用 `--color-team-enemy-cb`（`#c38bf0` / `#7b3fb3`，紫色） |
| `--color-team-ally` | = `--color-team-1`（别名） | = `--color-team-1` | 不变 |
| `--color-team-enemy` | = `--color-team-2`（别名） | = `--color-team-2` | 改用 `--color-team-enemy-cb` |

- **物理队伍色是固定身份**：Team 1 永远同一个颜色、Team 2 永远同一个颜色，**不随录像者属于哪一队交换**。
  严禁把 `team1 → ally 色 / team2 → enemy 色` 当成映射——那是把物理身份和记录者视角混成一个概念。名册呈现使用录像者视角：`rosterLanesFor` 将己方放左侧、敌方放右侧，`PlaybackRoster` 根据 `friendlyTeam` 使用视角色与标题；这不改变数据里的物理队伍身份。
- `--color-team-ally` / `--color-team-enemy` 是物理队伍色的别名；地图标记、基地条、状态条使用视角色，需要「物理队伍」语义时直接用 `--color-team-1/2`。
- **不能只靠红绿区分阵营。** 约 8% 的男性有红绿色觉障碍。阵营还必须通过**位置**（当前名册：左本方 / 右敌方；录像者队伍未知时回退到左 Team 1 / 右 Team 2）、**文字标签**或**形状**再表达一次（名册标题始终是文本）。
- 敌方色的色盲替代色是紫色（`--color-team-enemy-cb`），与游戏内色盲模式一致；替代色不取消位置与文字标签要求。当前只定义了 token，产品没有切换入口。
- 2D、3D、表格、雷达图共用这几个 token，不各自定义红绿。
- 可玩边界（游戏内实际战斗范围）的 2D 红线使用 `--color-map-playable-boundary`（与 3D 边界带同义 `#ff2f2f`），它不是阵营色，不得改用 `--color-team-enemy`。

Playback 车辆标签由同一个 `PlaybackVehicleLabel.vue` 渲染；2D 地图定位和 3D 相机投影
只负责 anchor，不各自维护字色、背景、HP/装填样式。姓名/车型、HP 数值与百分比、逐发装填
共用语义 CSS token，使用文字阴影与克制的视觉辅助保持可读，不铺整卡不透明黑底。
3D 使用屏幕空间 HTML，因此直接消费 CSS token，无需 Canvas 色值副本。标签 overlay
不得以空白区域截获场景指针；长姓名/车型必须受限并截断，不能撑宽战场。

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
  要在两档主题各调一次对比度，收益不成比例。
- 收藏车占比很高（338/735 ≈ 46%），边框因此只做**低强度混合**
  （`color-mix(in oklab, var(--color-info) 55%, var(--color-border-subtle))`），
  避免半张列表都在"发亮"。

---

## 4. 字体排印

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-TYP-01 | MUST | 全站 | 文字不小于 12px | `--font-size-caption-xs`（11px）只用于放不下 12px 的密集节点标签：地图卡角标、回放名册、科技树模块 | `pnpm run lint:css` + 人工 |
| DC-TYP-02 | MUST | 表格、统计、计时 | 数字用 `tabular-nums`，格式走 `Intl.NumberFormat(locale)` | 无 | 人工 |
| DC-TYP-03 | MUST | 展示字阶 | 超过 `--type-display-hero` 的字号只能用于 Showcase Hero 的标题和关键数字，上限 104px，由 `scale.css` 的 token 提供；数据区不得使用 | 无 | `pnpm run lint:css` + 人工 |
| DC-TYP-04 | MUST | 字体 | 只用系统字体栈，不引入网络字体 | 无 | 人工 |

**依据：** 系统字体栈加载为零、CJK 渲染最好；模块化字号阶梯；数字用等宽数字（tabular），便于对齐比较。

- **字体：** `system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`；代码用 `ui-monospace, "SF Mono", Consolas, monospace`。不引入网络字体。
- **数字：** 所有表格、统计、计时都加 `font-variant-numeric: tabular-nums`。数字格式统一走 `Intl.NumberFormat(locale)`，例如 `3,231.8`；伤害和 HP 使用千分位。

| token | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| `--type-display-hero` | `clamp(40, 6vw, 72)` / 1.05 | 700 | 首页英雄区标题（装饰插槽，§2）。流体取值：手机 40px、宽屏 72px。数据区不使用这一级 |
| `--type-display` | 32 / 40 | 700 | 装饰插槽内的强调数字（如首页实时数据带） |
| `--type-h1` | 24 / 32 | 700 | 页面标题。**每页只有一个 h1** |
| `--type-h2` | 20 / 28 | 600 | 区块标题 |
| `--type-h3` | 16 / 24 | 600 | 卡片标题、抽屉小节 |
| `--type-body` | 14 / 20 | 400 | 正文、表格（桌面） |
| `--type-body`（触控） | 15 / 22 | 400 | 正文（`pointer: coarse` 时自动替换） |
| `--type-caption` | 12 / 16 | 400 / 600 | 标签、表头、辅助说明。**这是最小字号**，中文 < 12px 不可读 |

- 工作区只用 7 级字阶；`display-hero` 与 DC-TYP-03 的展示字阶只属于装饰插槽。
- **token 形态：** 每一级有两个原子 token `--font-size-{级}`、`--line-height-{级}`，以及一个组合 token `--type-{级}`（字重 + 字号 / 行高 + 字体，用于 `font` 简写）。`font-size` / `line-height` 只能引用原子 token，`font` 只能引用组合 token；触控档只覆盖 `--font-size-body` / `--line-height-body`，组合 token 自动跟随。长文阅读另有 `--line-height-prose`（1.7，只用于文档类页面的正文）。
- 字重只用 400 / 600 / 700。
- 大写字母 + 字间距的 "kicker" 标签（如 `WOTBTOOLS · REPLAY WORKSPACE`）只能出现在装饰插槽里，工作区不用。

---

## 5. 间距、尺寸、圆角、阴影、层级

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-SIZ-01 | MUST | 触控档 | 可交互元素命中区 ≥ 44×44 | 页脚备案链接等法定文字 | `pnpm run test:browser-interaction`、`pnpm run test:browser-armor-mobile` |
| DC-SIZ-02 | MUST | 层级 | z-index 只用 token，不靠大数值收尾 | 场景型工作台内部用局部 1–9 | `pnpm run lint:css` |
| DC-MOT-01 | MUST | 动效 | 时长与缓动只取自 `--duration-*` / `--ease-*`，JS 侧经 `motionPolicy.ts` 读取 | 无 | `src/shared/motion/motionPolicy.test.ts` |
| DC-MOT-02 | MUST | 动效 | `prefers-reduced-motion: reduce` 时动效归零 | 无 | `motionPolicy.test.ts`、`pnpm run test:browser-home` |
| DC-MOT-03 | MUST | 播放帧路径 | 3D、2D 场景、timeline、HP、camera 不使用 UI 动效 | 无 | `src/shared/ui-dependency-ownership.test.ts` + 人工 |
| DC-MOT-04 | MUST | 动效 | 禁止 `transition: all`，列出具体属性 | 无 | 人工 |
| DC-MOT-05 | SHOULD | 动效 | 优先动画 `transform` / `opacity`；动画可被用户操作打断 | 选中指示器等 shared layout | 人工 |

**依据：** 4pt 网格（Material、Apple HIG、多数设计系统的做法），以及有限的离散刻度。

**间距**：`--space-{0,1,2,3,4,5,6,8,10,12}` = `0, 4, 8, 12, 16, 20, 24, 32, 40, 48px`

- 组件内间距用 1–4 级，组件之间用 4–6 级，区块之间用 8–12 级。
- 页面左右边距：`--gutter` = 手机 16 / 平板 24 / 桌面 32。

**控件尺寸与密度**（默认紧凑；`pointer: coarse` 时自动切换到触控档）：

| token | 紧凑（鼠标） | 触控（`pointer: coarse`） | 依据 |
|---|---|---|---|
| `--control-h-sm` | 28 | 44 | 仅用于次要的行内操作；触控档同样要满足最小点击区域 |
| `--control-h-md` | 32 | 44 | 按钮、输入框、下拉框 |
| `--control-h-lg` | 40 | 48 | 主操作 |
| `--row-h` | 36 | 48 | 表格行、列表行 |
| `--control-check` | 18 | 24 | 复选框 / 单选框的可视尺寸（所在单元格或 label 另保证最小点击区域 `--hit-min`） |
| 最小点击区域 | 24×24 | **44×44** | WCAG 2.5.8 最低 24；Apple HIG 44pt；Material 48dp |

**圆角**：`--radius-sm: 6px`（标签、小徽章、小控件）· `--radius-md: 8px`（按钮、输入框、卡片）· `--radius-lg: 12px`（弹窗、sheet、抽屉）· `--radius-full: 999px`（胶囊、头像）

**阴影 / 层级**：

| token | 用途 | 暗色 | 亮色 |
|---|---|---|---|
| `--elevation-1` | 卡片 | 无阴影，用 `surface-1` + `border-subtle` | 轻阴影 `0 1px 2px rgb(0 0 0 / .06)` |
| `--elevation-2` | 下拉菜单、吸顶栏 | `surface-2` + `0 4px 12px rgb(0 0 0 / .4)` | `0 4px 12px rgb(0 0 0 / .10)` |
| `--elevation-3` | 弹窗、sheet | `surface-2` + `0 12px 32px rgb(0 0 0 / .5)` | `0 12px 32px rgb(0 0 0 / .16)` |

**Z-index**（**只能用 token**）：

`--z-base: 0` · `--z-sticky: 100` · `--z-header: 200` · `--z-drawer: 300` · `--z-sheet: 400` · `--z-menu: 500` · `--z-dialog: 600` · `--z-tooltip: 650` · `--z-toast: 700`

**动效**：`--duration-fast: 120ms`（hover、按下）· `--duration-base: 200ms`（展开、切换）· `--duration-slow: 300ms`（sheet、抽屉进出）· `--ease-standard: cubic-bezier(.2, 0, 0, 1)`。`prefers-reduced-motion: reduce` 时三个时长都归零。JS 侧（motion-v）不另设时长：`shared/motion/motionPolicy.ts` 只读取这些 token；overlay 进出场用同一组 token 的 CSS keyframes。动效只用于低频 UI chrome（menu / popover / dialog / sheet / 选中指示器 / chip 增删 / 详情头部进入），播放帧路径（3D、2D 场景、timeline、HP、camera）不使用。

场景型工作台（2D / 3D 回放、装甲查看器）内部的叠放用 `isolation: isolate` 建立局部层叠上下文，内部只用 1–9，不参与全局竞争。**隔离必须真的写出来**：`position: relative` 与 `overflow: hidden` 都不建立层叠上下文，少了 `isolation: isolate` 时局部的 1–9 会和页面里任何裸 z-index 在外壳的上下文里裸比大小，"局部刻度"只是错觉。当前隔离点：`.playback-workspace`（工作台根）与 `.pb-map`（2D 场景）。

局部阶梯按下面的概念层序排列，token 见 `tokens/scale.css`：`--pb-z-canvas: 1` → `--pb-z-hud: 5` → `--pb-z-scrim: 6` → `--pb-z-controls: 7` → `--pb-z-transient: 8` → `--pb-z-modal: 9`。

需要越过该局部上下文的顶级浮层（手机底部 sheet、dialog、从工作台内部打开的菜单）必须 Teleport 到 `body`；提高 z-index 不会离开局部层叠上下文，仍会被根层 `AppTabBar` / 侧栏盖住。Teleport 出去的浮层不继承父级的 `display: none` / KeepAlive 停用，父级必须在 capability 隐藏或 `onDeactivated()` 时主动关闭。

### 遮挡与可达（occlusion / reachability）

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-OCC-01 | MUST | 主内容 | 常驻 UI 不得实质遮挡主内容（下文规则 1） | game-style overlay HUD | `pnpm run test:browser-layout`、`pnpm run test:browser-interaction` |
| DC-OCC-02 | MUST | 瞬态面 | 瞬态面压过同一上下文的常驻控件（下文规则 2） | 无 | `pnpm run test:browser-interaction` |
| DC-OCC-03 | MUST | 可交互选项 | 可见即可达（下文规则 3） | 无 | `pnpm run test:browser-interaction` |
| DC-OCC-04 | MUST | 四种形态 | 上述规则覆盖状态组合（下文规则 4） | 无 | `pnpm run test:browser-interaction --occlusion` |

层级只决定「谁盖住谁」，不决定「盖住多少」和「还点不点得到」。下面三条和 z-index 刻度同级，是**可判定**的规则，由 `pnpm run test:browser-layout`（几何）与 `pnpm run test:browser-interaction`（真实命中）守护。判定靠网格命中发现常驻面，不靠控件清单。

**1. 主内容遮挡。** 常驻 UI（`fixed` / `sticky` / 浮动控件 / 工具栏 / 底栏 / 侧板）不得实质遮挡该页的主任务内容——地图 / canvas / 3D 视口、表格与结果列表、图表、表单与复盘正文、搜索与百科内容。判定：

- 常驻控件与主内容盒的交集 **≤ 主内容面积的 5%**；
- 且**不得压入主内容的中心 60% 盒**。

交互本身要求的覆盖（打开的 sheet / dialog / 菜单）不受此限——它们是瞬态面，由规则 2 管。

**例外：game-style overlay HUD。** 3D 回放的 HUD、名册车道与控制条按产品设计就浮在场景上
（游戏同款布局，`.pb-root` 的常驻层都是 `position: absolute`），不适用上面的 5% 面积上限，但：

- 控制条与 HUD 仍不得压入中心 60% 盒，并须满足规则 3 的可达性；
- 例外只看紧凑控制条形态（`.pb-root.compact-bar`），不看设备类型：手机横屏与高度 ≤ 700px 的工作台（含矮窗口下的平板与桌面）里，名册车道与击杀流贴边、可由 Display 一键隐藏（击杀流还会短时淡出且不可交互），这些形态放不进 20% 边带，各自允许占 **≤ 中心盒的 15%**。其余形态没有这个例外，车道宽度与击杀流行数都按场景收口。

2D 的地图不是这种形态：它的常驻控件归控制条，地图盒里不放常驻 UI。

> 5% 的来历：2D 手机横屏实测基线，三个文字 quick action 在 740×360 下占地图 9.52%、844×390 下 6.94%（绝对像素恒定 ≈5.2–5.7k px²，视口越小占比越高）；收成单个图标入口后在 244px 地图上约 3.25%、竖屏约 1.27%。阈值取在两者之间，双向都有余量。

**2. 瞬态优先。** 瞬态交互面激活时必须压过同一上下文里的常驻控件。概念层序：

1. 页面 / 主内容
2. 页面 HUD / 上下文装饰
3. 常驻工具栏 / sticky 控件
4. 菜单 / 下拉 / popover / 选择器 / tooltip
5. drawer / modal / sheet
6. 关键通知层（如有）

概念序是「谁压谁」的默认关系；`--z-menu` 数值高于 `--z-sheet` 是因为 sheet 里打开的菜单必须在它之上，dialog 内的选择器则留在 dialog 的上下文里。

**不得用「给一个很大的 z-index」收尾**。先核实层叠上下文、containing block、transform / filter / opacity、`overflow` 裁剪与组件归属：跨上下文时提高数值无效，正确做法是 Teleport；同上下文时按上面的 token 阶梯取值。

**3. 可见即可达。** 可见的交互选项必须真的能点到。以下任一条成立即不合格：被其它元素覆盖、被祖先 `overflow` 裁剪、落在可用视口外、被 sticky / fixed 控件挡住、落在 safe area 内、或者看得见但指针到不了（例如 `pointer-events: none`，指针穿透落到祖先上）。

- **部分**覆盖与**部分**裁剪同样不合格：中心点露着不等于可达，按钮底部被切掉 10px 也是缺陷。容差 2px，只放过边框、阴影级别的亚像素误差。
- 裁剪只沿 containing block 链计算：`position: fixed / absolute` 的元素逃出了中间那些祖先，它们的 `overflow` 裁不到它；滚出可滚动容器属于「可滚动触达」，此时要求的是滚动容器本身不被外层裁掉。
- 判定用浏览器真实命中测试：在选项盒内多点采样 `elementFromPoint`，只有命中选项自身或其后代才算点得到——命中它的祖先恰恰说明指针穿透了它。门禁里的真实点击另以输入事件记录佐证。
- 触控档最小命中区见上表（44×44）。

**4. 适用形态。** 上面三条必须在手机竖屏、手机横屏、平板与桌面都成立，并覆盖**状态组合**（工具栏 + 菜单开、sticky 表头 + 下拉开、名册展开 + 浮层开、底栏 + sheet 开、drawer + 背景 sticky、断点切换），不只是静止初始态。

---

## 6. 响应式与输入方式

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-RSP-01 | MUST | 全站 | 断点只有 compact / medium / expanded 三档，CSS 写 range 语法 | 无 | `pnpm run lint:css` |
| DC-RSP-02 | MUST | 全站 | 响应式只改 presentation，不改能力语义：同一能力在三档都可达 | 明确按平台隐藏的入口（如 APK 的首页与下载） | `pnpm run test:browser-interaction` |
| DC-RSP-03 | MUST | compact | 360 与 390 宽度页面无横向溢出，宽表只在自身容器内滚动 | 无 | `pnpm run test:browser-layout`、`pnpm run test:browser-armor-mobile`，其余页面每页 PR 核对 |
| DC-RSP-04 | MUST | 尺寸 | 断点决定 topology，普通尺寸走 §6.1 的 bounded fluid sizing | 无 | 人工 |
| DC-RSP-05 | MUST | 贴边元素 | 顶栏、底栏、底部操作栏、全屏回放加 `env(safe-area-inset-*)` | 无 | 真机人工 |
| DC-RSP-06 | MUST | hover | hover 效果包在 `@media (hover: hover)` 内，核心操作不依赖 hover | 无 | 人工 |
| DC-RSP-07 | MUST | viewport | 不禁用缩放（`user-scalable=no`、`maximum-scale`） | 无 | 人工 |
| DC-RSP-08 | MUST | 手势 | 手势不是唯一入口，拖动、滑动、捏合都有点击或键盘替代 | 3D 场景的相机操作 | 人工 |
| DC-RSP-09 | SHOULD | sheet / 抽屉 | 浮层内滚动不传递到背景（`overscroll-behavior: contain`） | 无 | `pnpm run test:browser-interaction` + 人工 |

**依据：** 布局按**可用空间**决定，交互尺寸按**输入方式**决定，两件事分开处理。这也是 Material 3 "window size classes" 的思路。

- **断点只有三档：** `compact < 768` · `medium 768–1199` · `expanded ≥ 1200`。
  - CSS 只允许写 range 语法：`@media (width < 768px)`、`(768px <= width < 1200px)`、`(width >= 1200px)`。
  - JS 使用 `useBreakpoint()`，与 CSS 共用同一份常量。
- **输入方式：** `@media (pointer: coarse)` 只用来切换密度 token（§5），**不用来改布局**。JS 使用 `usePointer()`。
- **组件级适配**用容器查询 `@container`，例如：表格在容器 < 560px 时切换成卡片。组件不应该知道视口有多大。
- **视口单位：** 用 `dvh` / `svh`，不用 `100vh`；宽度用 `100%`，不用 `100vw`。
- **安全区：** 顶栏、底部 Tab 栏、底部操作栏、全屏回放都要加 `env(safe-area-inset-*)`。
- **hover 效果**包在 `@media (hover: hover)` 里，避免触屏上的"粘滞 hover"。

### 6.1 Fluid bounded sizing：固定值只定义边界

普通组件尺寸默认采用 **bounded fluid sizing**，而不是给每个断点写一套固定宽高。

- **固定值只负责边界和可用性约束。** 用语义 token 定义最小可用尺寸（防止内容、触控目标或关键数据被压坏）与最大合理尺寸（防止侧栏、面板在大屏无限膨胀）；固定值不负责描述中间态。
- **中间尺寸随所属容器连续变化。** 优先使用百分比、`fr`、`minmax()`、`clamp()` 和 container-relative units（`cqw` / `cqh`）；组件级尺寸相对于自己的 workspace/container，而不是默认绑定整个 viewport。
- **推荐模型：** `clamp(var(--component-min), <fluid container-relative size>, var(--component-max))`。也就是 **min → fluid → max**：小屏守住最低可用，大屏连续增长，到合理上限后停止。
- **Breakpoint 决定 topology，不决定普通尺寸。** 断点只用于真正的结构变化，例如三栏 → 纵向流、常驻栏 → sheet；禁止仅为了把 `144px` 改成 `196px` / `224px` 而增加 breakpoint-specific fixed sizing。
- **主内容优先吃剩余空间。** 辅助区域（roster、filters、details/navigation wings）在自己的 min/max 之间 fluid；主工作区使用 `minmax(0, 1fr)` 等方式取得剩余空间。存在二维约束时（例如正方形 Stage），尺寸取可用宽和可用高中的较小值，而不是用某个 viewport magic subtraction 猜测。
- **允许固定尺寸的场景：** 触控下限、图标、明确的设计 token、协议/素材本身要求的固定比例，以及确实不会随容器增长的 intrinsic control。需要新的固定视觉值时仍按 §1 / §5 先进入 token，而不是写组件魔法数。

示意：

```css
.workspace {
  --side-w: clamp(var(--side-min), 14cqw, var(--side-max));
  grid-template-columns: var(--side-w) minmax(0, 1fr) var(--side-w);
}
```

这条规则的目标不是“所有尺寸都写百分比”，而是：**固定值负责防止过小 / 过大，正常区间由可用空间连续决定。** Playback 的 roster / square Stage 是当前参考实现。

---

## 7. 组件规范（最小集合）

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-CMP-01 | MUST | 组件 | 具备适用的 `default / hover / focus-visible / active / disabled / loading` 状态 | 无 | 人工 |
| DC-CMP-02 | MUST | 第三方 primitive | 页面只用 `AppDialog` / `AppSheet` / `AppTooltip` / `MenuButton` / `SegmentedControl`，不直接引入 Reka 或 motion | 无 | `src/shared/ui-dependency-ownership.test.ts` |
| DC-FOC-01 | MUST | 可聚焦元素 | `:focus-visible` 显示统一焦点环；移除 outline 必须有替代 | 无 | 人工 |
| DC-FOC-02 | MUST | 键盘 | 主流程键盘能走完；Dialog 关闭后焦点回到触发元素 | 无 | `pnpm run test:browser-interaction` + 人工 |
| DC-FOC-03 | MUST | sticky / overlay | 不遮住当前焦点元素 | 无 | 人工 |
| DC-A11-01 | MUST | 语义 | 操作用 `<button>`，导航用 `<a>` / router link；icon-only 按钮有 `aria-label` | 无 | 人工 |
| DC-A11-02 | MUST | 表单 | 控件有 `<label>` 或 `aria-label`，不能只靠 placeholder | 无 | 人工 |
| DC-A11-03 | SHOULD | 异步反馈 | toast、校验、加载结果用 `role="status"` / `role="alert"` 或 `aria-live` 通知 | 无 | 人工 |
| DC-A11-04 | MUST | 图片 | 有 `alt`（装饰图 `alt=""`）；首屏外图片 `loading="lazy"`；有固有尺寸防抖版 | 无 | 人工 |
| DC-FRM-01 | SHOULD | 输入 | 用正确的 `type`、`inputmode`、`autocomplete`；数字输入唤起数字键盘 | 无 | 人工 |
| DC-FRM-02 | MUST | 输入 | 不拦截粘贴 | 无 | 人工 |
| DC-FRM-03 | SHOULD | 校验 | 错误就近显示在字段旁，提交失败时聚焦第一个错误 | 无 | 人工 |
| DC-FRM-04 | MUST | 表单浮层 | 含未提交内容的 `AppDialog` 设 `closeOnScrim=false`，不因误触遮罩丢失输入 | 无 | 人工 |
| DC-FRM-05 | SHOULD | 表单页 | 有未保存内容时离开页面要提醒 | 无 | 人工 |
| DC-FRM-06 | SHOULD | 回车提交 | 处理回车的中文输入框避开输入法组合态，选词确认不触发提交 | 无 | 人工 |

每个组件都必须具备这些状态：`default / hover / focus-visible / active / disabled / loading`（适用的部分）。

- **焦点环统一：** `outline: var(--focus-outline); outline-offset: var(--focus-outline-offset);`（即 2px 实线强调色、偏移 2px），只在 `:focus-visible` 时显示。旧的 `--focus-ring` 是颜色值。

| 组件 | 变体 | 规则 |
|---|---|---|
| **Button** | `primary`（橙色填充）· `secondary`（描边）· `ghost`（无边框）· `danger` · 尺寸 sm/md/lg · 纯图标按钮 | 每个视图最多一个 `primary`。纯图标按钮必须有 `aria-label` 和 tooltip。加载时显示 spinner，同时保持按钮宽度不变 |
| **IconButton** | — | 图标 20px，点击区域遵守 §5 的最小尺寸 |
| **Input / Select / Textarea** | — | 标签放在控件上方（不能只靠 placeholder）；下方放说明文字和错误文字；错误态 = 边框用 `danger` + 图标 + 文字 |
| **SearchSelect** | 单选 / 多选 | 选型见 §7.1；选项超过 10 项时必须可搜索，例如名人堂的选车器 |
| **FileDrop** | 单文件 / 多文件 | 上传交互遵守以下键盘规则。原生 `<input type=file>` 视觉隐藏、**不进 Tab 顺序**（`tabindex="-1"` + `aria-hidden`），由可见的真实按钮 `click()` 触发它——**禁止只有鼠标可点的容器**：键盘用户必须能 Tab 到那个按钮，且按钮是唯一的 picker 触发点（hidden input 不得再进 Tab 顺序，避免同一动作出现两个焦点目标） |
| **SegmentedControl** | — | 页面内的视图切换，例如 汇总 / 单场、数据 / 2D / 3D / 射击 / AI。键盘：方向键循环、Home / End 跳首尾（radiogroup 模型）；`scrollable` 保持单行横向滚动；回放能力栏使用 `wrap`，空间不足时自然换行，手机上每行填满可用宽度、长标签完整显示。`presentation` 由调用方显式选择：`segmented`（默认）、`chips`（始终换行）、`tiles`（等宽平铺），只改呈现，不改语义与键盘 |
| **Tabs** | — | 页面级分区。和 SegmentedControl 的区别：Tabs 切换的是内容区域，SegmentedControl 切换的是同一内容的呈现方式 |
| **Chip** | 筛选 chip · 状态 chip | 已生效的筛选条件显示为可移除的 chip |
| **Badge** | 中性 / 状态 / 阵营 | 只放短文本（≤ 6 个字） |
| **Card** | 默认 / 可点击 | 可点击卡片整卡都是点击区，并且可用键盘聚焦 |
| **DataTable** | — | 数字右对齐 + 等宽数字；表头吸顶；首列可冻结（手机上只冻结一列）；可排序列用 `<button>` 并带 `aria-sort`；容器 < 560px 时自动切换成卡片列表 |
| **Stat** | — | 标签（caption）+ 数值（h2，等宽数字）+ 可选的变化量 |
| **Dialog** | 确认 / 表单 | 焦点陷阱，Esc 关闭，关闭后焦点回到触发元素，`aria-modal`；同时打开多个时按打开顺序叠放，后打开的在上层；手机上变为底部 sheet；**禁止 `window.confirm`**。交互机制由 `AppDialog`（内部 Reka Dialog）提供，页面只用 `AppDialog` |
| **Sheet** | 底部 / 侧边 | 手机上的筛选、详情、面板都用 `AppSheet`（内部 Reka Drawer，统一 `--z-sheet`、`--color-scrim`、安全区与下滑关闭）；吸附高度只在有产品场景时启用 |
| **Drawer** | — | 桌面上是常驻侧栏，平板上是推开式侧栏（不遮盖内容），手机上变成全屏 sheet |
| **Menu** | — | 下拉菜单，支持方向键导航和 Esc 关闭；由 `MenuButton`（内部 Reka DropdownMenu）提供 |
| **Tooltip** | — | icon-only 按钮必须有 `aria-label`，并用 `AppTooltip`（内部 Reka Tooltip，`--z-tooltip`）补充悬停 / 聚焦提示；触屏不依赖 tooltip 传达信息 |
| **Toast** | 成功 / 错误 / 信息 | 用于操作结果反馈；错误 toast 不会自动消失，并提供"重试" |
| **Banner** | 页面级 | 用于持续性状态，例如"迁移中""维护中" |
| **Skeleton / Spinner / Progress** | — | 预计超过 1s 用 skeleton；能算出进度的一律用 Progress |
| **EmptyState** | — | 插图（装饰插槽）+ 说明"为什么是空的" + 下一步操作按钮 |
| **PlaybackControls** | — | 2D 和 3D **共用**：时间统一为 `mm:ss / mm:ss`，倍速 0.5 / 1 / 2 / 4 / 8× |

### 7.1 选择控件（Selection Control Policy）

**依据：** 候选越少，平铺的点击成本越低；候选越多，搜索才有效率。控件由调用方显式选择，不做按选项数自动变身的超级选择器。

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-SEL-01 | MUST | 单选 | 按下表取默认控件；候选数按数据域的可能上限判断，不按当前条数；「请选择」「全部」这类空值项不算候选 | DC-SEL-04 | 人工 |
| DC-SEL-02 | MUST | 2 个互斥选项 | 不用下拉 | `selection-policy.test.ts` 的只减不增名单 | `src/shared/selection-policy.test.ts`（静态选项）+ 人工（`v-for` 选项） |
| DC-SEL-03 | MUST | 超过 10 个候选 | 必须可搜索 | 无 | 人工 |
| DC-SEL-04 | MAY | 固定有序域 | Tier I–X 这类固定、有序的集合直接平铺，即使有 10 项 | 无 | 人工 |
| DC-SEL-05 | MAY | 高信息熵集合 | 不到 10 项也可提前提供搜索，例如 `BattlePicker` 超过 6 项显示搜索 | 无 | 人工 |
| DC-SEL-06 | MUST | Switch | 只用于立即生效的布尔状态，不是「两选项」的通用组件；随表单提交用 Checkbox | 无 | 人工 |
| DC-SEL-07 | MUST | 响应式 | 窄屏可换呈现（平铺转 sheet），不改变单选 / 多选语义 | 无 | 人工 |
| DC-SEL-08 | MUST | 一致性 | 同一概念在各页面用同一种控件 | 无 | 人工 |

| 候选数 / 数据类型 | 默认控件 |
|---|---|
| 1 个有效选项 | 直接显示值 |
| 2 个互斥模式 | Radio / Segmented Choice |
| 3–4 个固定短候选 | Choice Group / Chips / Tiles |
| 5–10 个候选 | Select / Menu |
| 超过 10 个候选 | SearchSelect / Combobox，必须有搜索 |
| 已知自由标量 | typed input |
| 多选 | Checkbox Group / multi-choice / searchable multi-select |

单选 Choice Group 由 `SegmentedControl`（radiogroup 语义、方向键、Home / End）承载，呈现用 `presentation` 选择。级联筛选的固定候选域保持全部选项可见，上一级未选或当前无数据的选项置灰。

---

## 8. 图标

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-ICN-01 | MUST | 全站 | 图标只用 Lucide，不用 emoji 或 Unicode 符号当图标 | 游戏资产（车辆图、国旗、车种图标） | 人工 |

**依据：** 一个项目只用一套图标，风格才一致。emoji 在不同系统和 GeckoView 上渲染不一致，也无法控制颜色，不应该当图标用。

- 统一使用 **Lucide**（MIT 协议，支持按需引入，线性风格，1.5–2px 描边）。
- 尺寸：16（行内）· 20（按钮默认）· 24（导航、空状态）。颜色用 `currentColor`。
- **全面替换 emoji 和 Unicode 符号：** 🔍 🗑 ⬇ ☰ ✎ ✕ ⚠ ★ ✓ ↻ 等。
- 纯装饰图标加 `aria-hidden="true"`；承载含义的图标要配文字，或者加 `aria-label`。
- 游戏资产（车辆图、国旗、车种图标）不属于图标系统，单独作为"资产"管理。

---

## 9. 布局模式

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-ARC-01 | MUST | 页面 | 自上而下是 Showcase Hero（可选）+ 控制条 + 数据区；同一页不并存两套标题区 | 场景型工作台（2D / 3D、装甲查看器）、长文档页 | 人工 |
| DC-ARC-02 | MUST | 工作区 | `PageHeader` 只用 `compact`；kicker + h1 + 说明 + 标签块不得占掉首屏 | 满足 DC-THM-04 的 Showcase Hero | 人工 |
| DC-ARC-03 | MUST | 筛选 | expanded / medium 行内工具栏；compact 用「筛选」按钮 + sheet，已生效条件显示为 chip | 无 | `pnpm run test:browser-interaction`（`overlay-catalog-` / `overlay-hof-`） |
| DC-ARC-04 | MUST | 主导航 | 成员、分组、小屏 Tab 与栏目归属只由 `app/navigation.js` 定义，外壳组件和「更多」页不复制列表 | 无 | `src/app/navigation.test.js` |
| DC-ARC-07 | MUST | 主导航 | `PRIMARY_NAV` 的每个入口在大屏与小屏都能到达；小屏 Tab 不超过 5 项 | 首页在小屏由 Logo 进入 | `pnpm run test:browser-interaction shell-overlay` |
| DC-ARC-05 | SHOULD | 页面状态 | 筛选、Tab、分页写进 URL，可深链和前进后退 | 无 | `src/app/router.test.js` + 人工 |
| DC-ARC-06 | MUST | 表格 | 手机上复杂表格转卡片或关键列 + 容器内横向滚动，不撑破页面 | 无 | 人工 |

| 模式 | 规则 |
|---|---|
| **AppShell** | 平板 / 桌面：左侧边栏（`--z-header`，铺满视口高度），没有顶栏（`--header-h: 0`）。桌面默认展开（240px，图标 + 文字），可折叠成 72px 图标栏并记住偏好；平板固定为图标栏。侧边栏从上到下：品牌 · 首页 · 按战斗、资料、赛事、社区分组的主栏目（`group`，图标栏用分隔线代替分组名）· 管理组（按角色）；底部：更多（弹出面板，只放低频的显示设置与关于 / 支持）· 账户 · 折叠开关。手机 / App：48px 标题栏 + 底部 Tab 栏（56px + 安全区）。Tab 栏固定 5 项：回放、名人堂、百科、联赛、更多（`compactTab`），不横向滚动，标签限制在各自栏目内、最多两行，短标题保留完整辅助名称。科技树、地图、联赛直播回放和推荐是「更多」页顶部的快捷入口，推荐目录不可用时隐藏推荐；打开这些页面时点亮「更多」（`compactSection()`）。Logo 回默认落地页：主站回首页，APK / 本地回回放。手机横屏的回放工作台（2D / 3D，回放就绪）与装甲查看器（WebGL 可用）进入沉浸态：顶栏与 Tab 栏让出，`--header-h` / `--tabbar-h` 归零，转竖屏或离开页面即恢复。更多是整页。当前侧边栏宽度写入 `--sidebar-w`（手机为 0），顶栏高度写入 `--header-h`；布局偏移只读这两个值 |
| **PageHeader** | 只有 `compact`（工作区用：标题 + 右侧操作，一行，≤ 56px）。不提供 `hero` 变体；首页 hero 是 `HomePage.vue` 自己的整段落地页板块。**工作区禁止用 kicker + h1 + 说明 + 标签块占掉首屏** |
| **容器宽度** | `content` → `--layout-content-max`；`wide` → `--layout-wide-max`；`workspace` → `--layout-workspace-max`；长文阅读宽度 → `--reading-measure`。具体数值由 `frontend/src/styles/tokens/scale.css` 定义，布局原语见 [UI 系统](ui-system.md) |
| **Master–Detail** | expanded：列表 + 常驻详情。medium：列表 + 推开式详情。compact：列表 → 全屏详情（支持左右滑动切换）。回放工作台、射击分析、坦克百科都用这个模式 |
| **筛选** | expanded / medium：行内工具栏。compact：一个"筛选"按钮 → sheet，已生效的条件以 chip 显示在列表上方 |
| **主操作位置** | expanded：页面头部右侧。compact：底部固定操作栏（带安全区） |

---

## 10. 状态与反馈

新手引导通过独立中性遮罩与真实目标聚焦呈现；短卡、焦点范围和当前 fullscreen 宿主由 `OnboardingHost` 所有。它复用语义 token、Dialog 与 reduced-motion，不对工作区整体加滤镜，不克隆真实按钮。详见 [新手引导](../features/onboarding.md)。

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-STA-01 | MUST | 数据区 | 覆盖理想、加载、空、错误、无权限五态 | 不涉及对应状态的静态内容 | 人工 |
| DC-STA-02 | MUST | 失败 | 不静默失败，说明发生了什么与下一步 | 无 | 组件测试 + 人工 |
| DC-STA-03 | MUST | 状态真实 | 未知就显示未知：不把缺失数据画成 0、完成或成功，加载态不冒充结果 | 无 | 组件测试 + 人工 |
| DC-STA-04 | MUST | 破坏性操作 | 能撤销用 toast + 撤销，否则用 Dialog 确认；禁止 `window.confirm` | 无 | 人工 |
| DC-STA-05 | SHOULD | 数值稳定 | 数字更新、加载切换不引起布局跳动，按钮加载时保持宽度 | 无 | 人工 |
| DC-STA-06 | MUST | 长内容 | 长昵称、长车型名在容器内截断或换行，不撑宽布局（`min-width: 0`） | 无 | `pnpm run test:browser-layout` + 人工 |

**依据：** Nielsen 可用性原则第 1 条"系统状态可见"。任何等待超过 1s 的操作都要有反馈，任何失败都要有提示。

| 场景 | 必须做到 |
|---|---|
| 加载 | 超过 1s 显示 skeleton 或进度；超过 10s 显示"仍在处理"，并允许取消 |
| 失败 | **永远不能静默失败**。说明发生了什么 + 可能的原因 + 下一步操作（重试 / 返回 / 联系） |
| 空状态 | 说明为什么是空的 + 怎样才能有内容 + 主操作按钮 |
| 破坏性操作 | 能撤销的用 toast 加"撤销"；不能撤销的用 Dialog 确认，按钮写明具体动作，例如"清空 6 场结果" |
| 权限 | 未登录：AuthGate 说明登录后能做什么，再给登录按钮。无权限：说明原因，不能静默重定向 |
| 功能关闭 | 隐藏入口；如果必须保留，就显示 Banner 说明，不能留下死 Tab |

---

## 11. 文案与术语

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-CPY-01 | MUST | 全站 | 界面文字都走 i18n，三语齐全，枚举通过映射表翻译 | 无 | `src/locales/messages.test.js` |
| DC-CPY-02 | MUST | 全站 | 不出现下文禁用词，术语遵守术语表 | 无 | 人工 |
| DC-CPY-03 | SHOULD | 按钮与错误 | 按钮动词开头、写具体动作，错误文案带下一步 | 无 | 人工 |

**依据：** 同一个概念只用一个名字；使用用户的语言，不用实现层的术语。

- **禁止出现在界面上的词：** WebAssembly、WASM、资产源、静态资产包、滤波、位姿、eid、（Agent）、Keycloak、内部枚举值（如 `heavyTank`、`china`、`map_43`、`tank_6929`）。
- **术语表：** 下表是中文术语约定，三语运行时文案在 `frontend/src/locales/` 维护。

| 概念 | 中文 | 说明 |
|---|---|---|
| 主导航"回放" | 回放 | 替代"回放解析 / 回放工作台 / 回放数据提取 / 数据解析 / 批量解析" |
| 2D 回放 | 2D 回放 | 替代"战局重建 / 战局回放 / 战斗回放" |
| 3D 回放 | 3D 回放 | |
| 射击分析 | 射击分析 | 替代"射击复现" |
| 装甲查看器 | 装甲查看器 | 替代"3D 装甲检视器" |
| 评分 | Rating | 表格、抽屉、导出统一叫"Rating"，不混用"评级" |

- **语气：** 简洁、直接，对用户说话；按钮用动词开头（"导出 Excel""提交记录"）。
- **i18n：** 所有界面文字都走 `$t()`，**包括 3D 页面**；枚举值通过映射表翻译；复数用 vue-i18n 的复数语法。
- **数字和单位：** 数字和单位之间加空格（`255 mm`、`3.4 °/s`）；时间统一为 `mm:ss`；百分比保留 1 位小数。

---

## 12. 执行与守护

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-ACC-01 | MUST | 界面 PR | 说明涉及的规则 ID、影响的 Profile 与断点，以及哪些只能人工验证 | 无 | PR 审查 |
| DC-ACC-02 | MUST | 页面视觉 PR | 附大屏、小屏前后截图，两档 Profile 都看 | 3D 与回放画面由用户验收，截图不作验收证据 | PR 审查，用户验收 |
| DC-ACC-03 | MUST | 界面 PR | 受影响的 browser gate 通过，退步不靠放宽门禁解决 | 无 | PR CI |
| DC-ACC-04 | MUST | Android / WebView | 只有行为确实与浏览器不同的规则才要求真机验证；Chromium 设备仿真不替代真机 | 无 | 真机人工 |

1. **stylelint**（`pnpm run lint:css`，配置见 `frontend/stylelint.config.mjs`，CI 必过）：
   - `declaration-no-important`：禁止 `!important`。
   - `scale-unlimited/declaration-strict-value`：`*color`、`fill`、`stroke`、`z-index`、`font`、`font-size`、`line-height`、`border-radius`、`box-shadow` 只能用 `var(--*)` 或豁免值。豁免值（`TOKEN_EXEMPT_VALUES`）：`transparent`、`currentColor` / `currentcolor`（插件区分大小写）、`inherit`、`initial`、`unset`、`revert`、`none`、`0`、`auto`、`normal`。
   - `color-no-hex`、`color-named: never`、`function-disallowed-list: rgb/rgba/hsl/hsla`：组件里不出现色值；只有 `src/styles/tokens/**` 例外。需要半透明时用 `color-mix()`。
   - `media-feature-range-notation: context`、`media-feature-name-value-allowed-list: width → 768px / 1200px`、`media-feature-name-disallowed-list: min-width / max-width / device-width`：断点只有三档，且必须写 range 语法。
   - `declaration-property-unit-disallowed-list`：块方向尺寸（`height`、`block-size` 及其 min/max，`top`、`bottom`、`inset`、`inset-block*`）禁止 `vh`，用 `dvh` / `svh`；行方向尺寸（`width`、`inline-size` 及其 min/max）禁止 `vw`，用 `%`；`flex-basis` 两者都禁。
   - 旧文件列在 `frontend/stylelint.legacy.json` 忽略名单里（基线），新文件一律严格检查；移出名单的文件同样受严格检查。
2. **frontend/AGENTS.md** 引用本文件："改动 UI 前必须阅读 design-language.md；新增视觉值必须先加 token。"
3. **PR 自查清单：**
   - [ ] 只用了语义 token
   - [ ] 两套主题都截了图
   - [ ] 三档宽度都截了图
   - [ ] 键盘能走完整个流程
   - [ ] 新文案进了 i18n 和术语表
