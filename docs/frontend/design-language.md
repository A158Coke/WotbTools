# WotbTools Design Contract v1（设计语言）

> 适用范围：`frontend/` 全部页面、Android GeckoView。
> 本文件是已批准生产界面的视觉与交互规则的唯一 owner。token 数值以 `frontend/src/styles/tokens/` 为准，实现位置与页面现状见 [ui-system.md](ui-system.md) 和 [replay-workspace.md](replay-workspace.md)。对已发布界面，事实描述错了就修文档，规则被违反就修代码；独立设计探索可提出有证据的规则修订，按 §0 的 `Contract Conflict` 流程处理，不因旧的审美条款直接阻止原型。

---

## 0. 五条总原则

1. **数据优先。** 这是一个分析工具：先让数字清楚、可比较，然后才考虑氛围。装饰永远不能降低数据的可读性。
2. **主题只换"皮"，不换"骨"。** 四季主题的布局、间距、字号、组件结构、交互完全一致，只替换语义 token 的值和装饰插槽。
3. **组件只认语义 token。** 组件里不出现色值、像素魔法数、`!important`、裸 z-index。
4. **可访问性是底线，不是加分项。** WCAG 2.2 AA：对比度、触控尺寸、键盘可达、减少动画。
5. **一个概念一个名字。** 术语、图标、组件都遵守这条：同一件事在所有页面上叫法一致、长相一致。

### 规则结构

每节开头的规则表是可判定的契约，表后的说明是它的细节。引用规则时写稳定 ID（如 `DC-SEL-03`），ID 不复用，规则废止时删除整行。

- **强度：** `MUST` 违反即不通过审查；`SHOULD` 默认遵守，偏离时在 PR 写明理由；`MAY` 明确允许的选择。
- **验证：** 优先写可运行的命令或测试。写「人工」表示没有自动判定，由 PR 审查或用户验收按规则核对；不得把人工项说成已被门禁覆盖。
- **存量：** `frontend/stylelint.legacy.json` 名单内的文件在迁移前不受静态校验，迁移时一并修复。
- **外部资料：** `.agents/references/design-methods/` 中的 Refactoring UI 与 Apple Design 是可版本化的参考方法，不是新 SSOT；应用方法与审计输出见 `.agents/playbooks/ui-design-review.md`。本文件对**已批准的生产实现**具有约束力，但设计探索可以挑战旧审美限制并明确标记 `Contract Conflict`；不得以旧样式规则拒绝制作受控原型。生产变更必须有证据、授权且在本文件完成对应修订。回放数据事实、安全和可访问性保障不因视觉探索而撤销。比例、弹簧参数等经验值不能未经验证变成 MUST。

---

## 1. Token 架构

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-TOK-01 | MUST | 全部组件 | 组件只用语义 token；需要新的视觉值时先加 token，不写字面量 | `src/styles/tokens/**` | `pnpm run lint:css` |
| DC-TOK-02 | MUST | `stylelint.legacy.json` | 名单只减不增，新文件不进名单 | 无 | `frontend/scripts/check-typescript-baseline.mjs`（CI base→head 单调门禁，与 `typescript.legacy.json` 同 gate） |

**依据：** W3C Design Tokens Community Group（DTCG）的分层模型。Material 3、Adobe Spectrum、GitHub Primer 都用这种三层结构。

```
Primitive（原始值）     --orange-500: #e0a02e     只在 tokens 文件内部使用
      ↓
Semantic（语义）        --color-accent: var(--orange-500)     组件只能用这一层
      ↓
Component（可选）       --button-primary-bg: var(--color-accent)     仅复杂组件需要
```

- **文件：** `src/styles/tokens/scale.css`（间距、字号、圆角、层级、控件尺寸、动效等与主题无关的量，并在文件顶部声明 `@layer` 顺序）· `src/styles/tokens/color.css`（原始色层、四季主题的语义映射与氛围插槽、层级阴影）。**原始层只收录被两个及以上语义 token 共用的颜色**（目前是 `--green-400/700`、`--red-400/700`，被 success / danger 与阵营色共用）；只被一个语义 token 使用的颜色直接写在语义映射里，等出现第二个引用方时再抽出。
- **主题切换：** `<html data-ui-profile="spring|summer|autumn|winter">`，`data-theme`（dark / light）由 profile 派生。主题文件只重新映射**语义层**与氛围插槽；原始层和 scale 层四套主题共用。
- **CSS 分层：** 目前 `scale.css` 顶部只有 `@layer tokens;`（全站只有这一处声明），只声明已经在用的层。
- **命名：** `--{类别}-{角色}-{变体}-{状态}`，例如 `--color-text-secondary`、`--color-surface-2`、`--color-border-focus`。
- **旧 token 迁移：** 与新刻度同名、同值的旧变量（`--space-1…4`、`--radius-sm/md/lg`）已迁入 `scale.css`，保持单一事实源；`--space-5/6` 的旧用法已改指取值相同的 `--space-6/8`。其余旧变量（颜色、`--z-*`、`--font-*`、`--friendly/--enemy` 等）保持原值、标注 deprecated，与新 token 并存。组件迁移时直接改用新 token；某个旧变量不再被任何地方引用时就删除。**不把旧变量整体改成指向新值的 alias**：新旧色值不同，整体 alias 会一次性改变全站视觉。

---

## 2. 主题

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-THM-01 | MUST | 四季主题 | 布局、组件结构、字号、交互完全一致，只替换语义 token 与氛围插槽；不按主题 fork 业务实现，组件不出现主题判断 | 无 | `src/ui-profile-fork-guard.test.js` |
| DC-THM-02 | MUST | 全站材质验收 | 背景图、装饰渐变与玻璃材质的生产使用必须通过真实叠合背景可读性、触摸可达、设备性能与降级验收；§2 的插槽与 §2.1 页面级玻璃只是当前实现基线，允许经证据验证的设计探索扩展材质到其他区域（包括数据区），不能因旧白名单而拒绝原型 | 不得弱化对比度与业务数据可读性 | 四主题真实背景取样 + 交互/设备验证 |
| DC-THM-03 | MAY | 工作区页面 | 在数据区之上放一个 Showcase Hero | 无 | 人工 |
| DC-THM-04 | MUST | Showcase Hero | 只放在数据区之上，不进入表格、筛选、表单、抽屉；expanded 档首屏必须能看到数据区 | 无 | 每页 PR 大屏截图，人工 |
| DC-THM-05 | MUST | Showcase Hero | 文字落在主题遮罩（`--theme-hero-scrim*`）压出的纯色区上，最差取样点满足 §3 对比度，四套主题都测 | 无 | 人工取样 |
| DC-THM-06 | MUST | Showcase Hero | `prefers-reduced-motion: reduce` 下无动效 | 无 | 人工；首页由 `pnpm run test:browser-home` 覆盖动效 |
| DC-THM-07 | MUST | 主题 token | 四套主题的文字 / UI 色在各自四层表面上的最差对比度达到 AA（正文 ≥ 4.5，UI ≥ 3，强调色上的文字 ≥ 4.5）；实际应用的玻璃表面还要按真实 wide / portrait 背景图与 `--theme-backdrop-scrim` 逐像素合成后取样 | 无 | `src/styles/tokens/color-contrast.test.ts` |
| DC-THM-08 | MUST | 场景外壳 | 2D / 3D 回放、装甲查看器、地图 3D 的根元素带 `data-scene-surface`，正常渲染态自铺不透明底，寒冬下仍是深色玻璃，不跟随浅色表面，也不叠页面环境光 | 装甲查看器 `is-unsupported` 无 WebGL 降级态（不渲染游戏画面，保留透明 fallback） | `color-contrast.test.ts` 的场景块断言 + 人工 |
| DC-THM-09 | MUST | 全站环境背景 | 全站只由 `AppShell.vue` 的 `.app-backdrop` 渲染环境背景层：`position: fixed; inset: 0; pointer-events: none`，层级低于内容；环境光、背景图、遮罩、位置全部读 `--theme-backdrop*` token；禁止在 `body` 上用 `background-attachment: fixed` | 无 | 人工；`pnpm run test:browser-home`、`test:browser-view-transition` |
| DC-THM-10 | MUST | 首屏与主题切换 | 环境背景先显示 `--color-canvas` 纯色，图片解码后淡入，不得阻塞首屏；`prefers-reduced-motion: reduce` 下直接显示、不做过渡；切换主题时背景随 token 同步切换 | 无 | 人工；`src/index-firstpaint.test.js` 保持通过 |
| DC-THM-11 | MUST | 生产内容表面 | 当前页面级卡片/面板采用 `--color-surface-{1,2,3}-glass`（表面色 82%–90% 不透明 + `backdrop-filter: blur(16px) saturate(1.2)`），当前表格、数据密集区、输入框、回放 HUD 采用纯色；这是实现事实而非未来设计禁令。任何扩展玻璃材质的生产变更必须先证明真实背景对比度、合成性能和不支持 `backdrop-filter` 时的纯色降级；场景根必须保持不透明（DC-THM-08） | 受控设计原型可先探索，生产需独立验收 | `color-contrast.test.ts` 的真实背景取样 + 浏览器/设备审查 |
| DC-THM-12 | MUST | 分区主视觉 | 每个导航分区用一张固定 key visual（与季节无关），由 `ShowcaseHero` 的 `section` prop 选择；图片经 `import` 由 Vite 生成 hash URL，只加载当前页面用到的一张；标题必须落在主题遮罩压出的可读区 | 首页继续使用季节主视觉 | 人工四主题 × 双视口截图；`ShowcaseHero.test.ts` |

| | **春 · 青山** `spring` | **夏 · 盛夏** `summer`（默认） | **秋 · 金秋** `autumn` | **冬 · 寒冬** `winter` |
|---|---|---|---|---|
| 深浅色 | 深色 | 深色 | 深色 | 浅色（白 7 蓝 3） |
| 底色 / 强调色 | `#08140f` / `#f2b450` | `#191304` / `#f7bd3c` | `#160f08` / `#ef8434` | `#eef3f8` / `#1f6fd1` |
| 底纹 `--theme-pattern` | 等高线 | 战术网格 | 斜纹 | 雷达环 |
| 环境光 `--theme-backdrop` | 右上青绿柔光 + 左下淡金光晕 | 右上金色日光 + 底部暖橙渐暗 | 斜向橙红暮光 + 双角暗化 | 顶部冷白蓝高光 + 底部淡蓝雾 |
| 布局 / 组件 / 字号 / 密度 | **完全相同** | **完全相同** | **完全相同** | **完全相同** |

完整取值只在 `frontend/src/styles/tokens/color.css`（每套主题一个语义映射块）；`<meta name="theme-color">` 取当前主题底色（`useUiProfile.THEME_COLOR`），`color-scheme` 随深浅色。

**氛围插槽**（主题 token，只能用在装饰插槽里）：`--theme-hero-image`（横版约 2.5:1）、`--theme-hero-image-portrait`（竖版约 4:5）、`--theme-hero-scrim`（横版遮罩，左侧压出文字区）、`--theme-hero-scrim-portrait`（竖版遮罩，自下而上）、`--theme-hero-section-scrim` / `--theme-hero-section-scrim-portrait`（仅寒冬的分区主视觉遮罩，见 §2.2）、`--theme-glass`（叠在主视觉上的按钮底）、`--theme-pattern`（页面底纹）、`--theme-backdrop`（页面环境光，多层静态 `radial-gradient` / `linear-gradient`，固定视口、无动画）、`--theme-backdrop-image` / `--theme-backdrop-image-portrait`（全站环境背景横 / 竖版）、`--theme-backdrop-scrim`（环境背景遮罩）、`--theme-backdrop-position` / `--theme-backdrop-position-portrait`（横 / 竖版焦点位置）。页面静态底色按 `--theme-pattern` → `--theme-backdrop` → `--color-canvas` 合成；环境光集中在页面边缘与角落，正文所在的中部保持接近 `--color-canvas` 的纯色区。环境光在页面底边渐隐回 `--color-canvas`，页脚（`.app-footer`）另有 canvas 渐隐托底，避免底纹的 1px 线穿过页脚小字、拉低对比度。页头等无底色文字所在的最亮处也必须按 §3 取样，至少覆盖 1024 宽的桌面视口；环境光峰值不得压过文字对比度。主视觉素材在 `frontend/src/assets/theme/theme-<季节>-{wide,portrait}.webp`；环境背景产物在 `frontend/src/assets/theme/backdrop-<季节>-{wide,portrait}.webp`，与 `--theme-backdrop` 的环境光层一起由 `.app-backdrop` 渲染（§2.1）。主题选择器的缩略图与色点读 `--theme-preview-<季节>-*`。

**现有装饰插槽**（背景图/环境装饰的实现清单，不是后续材质设计的排他白名单）：

1. 首页英雄区（`HomePage.vue` 自己拥有整屏主视觉；`ShowcaseHero` 的 `section` 变体只负责导航分区的页头，不改变首页）
2. 工作区 Showcase Hero（规则见 DC-THM-03 至 DC-THM-06）
3. 空状态插图
4. 登录页
5. 全站环境背景层（`.app-backdrop`，§2.1）：当前以固定主题底纹、环境光、季节背景图和 canvas 遮罩叠在 `--color-canvas` 上；按「`--theme-pattern` → `--theme-backdrop` → `--theme-backdrop-scrim` → `--theme-backdrop-image` → `--color-canvas`」合成（CSS 中前面的层在上）。当前环境光使用静态渐变；未来的动画或滚动联动不是默认禁令，但必须先采集 CPU/GPU 帧性能、可读性与 Reduced Motion 证据。页脚 `.app-footer` 的 canvas 渐隐托底属于同一层页面底色合成，用于保证页脚小字对比度

**数据区材质**：当前表格、回放数据区、筛选结果、表单控件和抽屉以纯色为默认；页面级卡片/面板（包括筛选面板容器，非输入框）使用 §2.1 的玻璃表面。这是当前实现的**事实描述**，不是未来设计禁令。允许在经过专项验证后提议扩展玻璃/半透明到数据区域：对四套主题、wide/portrait 真实背景、滚动状态和复杂内容逐像素采样文字/UI 对比度，证明触摸可达和设备性能，并提供不透明降级。未经验证不得将现有数据表面直接替换。

### 2.1 全站环境背景层

**定义：** 每个页面共享的一层 fixed 装饰背景，由 `AppShell.vue` 根部的 `.app-backdrop` 唯一渲染。它不是页面内容的一部分，只负责氛围：按「`--theme-pattern` → `--theme-backdrop` 环境光 → `--theme-backdrop-scrim` → 季节图 → `--color-canvas`」合成（CSS 中前面的层在上），`pointer-events: none`，层级用 `--z-backdrop`（低于所有内容）。使用 `position: fixed` 而不是 `body { background-attachment: fixed }`，因为 iOS Safari 不支持后者。

**构图与遮罩：** 横版图里车队在中部到右侧、左侧较干净；竖版里车队在中上部、下半部较干净。wide 用 `--theme-backdrop-position: center 40%`，portrait 用 `center 30%`，让车队避开顶栏。深色三季的 `--theme-backdrop-scrim` 用各自 canvas 色从约 85% 渐到 55%：干净侧更实，坦克与天空侧更透；寒冬用 canvas 白色雾化遮罩。竖屏手机（`orientation: portrait` 且 `width < 768px`）切换到 `--theme-backdrop-image-portrait` 与对应 position。

**首屏性能：** 首帧只画 canvas 纯色（`html` / 首屏内联样式负责，图片层此时 `opacity: 0`）；`.app-backdrop` 的图片由 JS 在 mount 后预解码，完成后才加 `.is-ready` 淡入，背景图不进入首屏关键路径。`prefers-reduced-motion: reduce` 下不做透明度过渡。主题切换时重新等待对应季节图，CSS token 已同步换图，不保留上一主题的图。

**内容表面边界（当前实现）**：页面级卡片/面板（首页卡片、文档正文、坦克详情区块、筛选面板、空状态上传区、管理后台提示条等）使用 `--color-surface-{1,2,3}-glass`（对应表面色 82%–90% 不透明）加 `backdrop-filter: blur(16px) saturate(1.2)`，让背景隐约透出。当前表格、数据密集区、输入框、回放 HUD 使用纯色 `--color-surface-*`；2D/3D 回放、装甲查看器和地图 3D 场景根保持不透明底色，非全屏时场景外围的页面区域可透出环境背景。这是已实施状态，不排除未来经过验证的材料调整。浏览器不支持 `backdrop-filter` 时玻璃表面回退为对应纯色。实际应用玻璃表面必须先按真实 wide/portrait 背景图逐像素叠加 `--theme-backdrop-scrim`，再与玻璃 alpha 合成，取亮度最小/最大像素进入 §3 最差值计算；不能只用 canvas 等效色替代。

**素材来源：** 四季原图为 AI 生成画面与真实 WoTB 十级车型参考融合，写实电影风格；原图保留在 `frontend/art-source/backdrops/backdrop-<季节>-{wide,portrait}.webp`，不得修改。发布产物由 `frontend/scripts/build-theme-backdrops.mjs`（`pnpm run assets:backdrops`）生成：wide Lanczos 放大到 2560 宽、portrait 到 1080 宽，轻度锐化，WebP 初始 quality 80；单张超过 300KB 时脚本按预算自适应下调 quality（产物实测约 q29–q80，均 ≤ 300KB）。

**场景排除：** 带 `data-scene-surface` 的 2D / 3D 回放、装甲查看器、地图 3D 场景根在正常渲染态必须自铺不透明底色（通常 `var(--color-canvas)` 或 `var(--color-surface-1)`），页面环境光不得透进游戏画面。场景子树的**文字色必须在场景根落定**（场景根声明 `color: var(--color-text-primary)`）：变量换成场景值不会改变继承链——后代继承的是页面层的 computed color，寒冬浅色页面下缺这行会让未显式设置 color 的文本以深蓝落在暗色场景表面上（2026-11-10 Display 面板实测 1.03:1）。唯一例外是装甲查看器的 `is-unsupported` 无 WebGL 降级态：它不渲染游戏画面，保留既有的透明 fallback。

**选择逻辑：**
- 默认盛夏；用户在「更多」→ 主题里选择（`ThemePicker`：`SegmentedControl` tiles，每项是主视觉缩略图 + 强调色点 + 名称），选择后记住。
- 持久化 key 只有 `wotb-ui-profile`，值为 `spring` / `summer` / `autumn` / `winter`；读取边界把旧值 `showcase` / `classic` / `auto` 映射为 `summer` 并写回。没有独立的 theme 状态或存储 key。
- 在首次绘制之前，由 `index.html` 里的内联脚本投影 `data-ui-profile` / `data-theme` / `theme-color`，避免闪烁（`src/index-firstpaint.test.js` 真实执行该脚本）。

**验收标准：** 任何组件在四套主题下都必须通过 §3 的对比度要求。

### 2.2 分区主视觉（section key visual）

**定义：** 导航分区的固定主视觉。和四季主视觉不同，每张图不随主题/季节换图，只换压在图上的主题遮罩；一张图对应一个导航分区，同一分区的所有页面复用同一张。季节只影响氛围，不改变页面身份。

**素材与产物：** 原图在 `frontend/art-source/heroes/hero-<分区>.webp`（1672×941，16:9，不得修改），由 `frontend/scripts/build-section-heroes.mjs`（`pnpm run assets:heroes`）输出到 `frontend/src/assets/theme/hero-<分区>.webp`：Lanczos 放大到 2400 宽、轻度锐化、WebP q≈80 且单张 ≤ 250KB。运行时通过 `src/shared/sectionHeroes.ts` 的 `import` 拿到 Vite hash URL，不复制到每套主题，也不在 CSS 里写死路径。

**唯一映射表：** 代码里的 `SECTION_HEROES` 是唯一事实源，本表是它的文档镜像。`--hero-pos` / `--hero-pos-mobile` 是 `background-position` 的焦点，用来保证坦克主体不被左侧标题压住：桌面横幅很宽，横向焦点恒为 `center`，只调纵向；手机竖版把主体推到右侧。

| 分区 `section` | 使用页面 | 原图 | 桌面焦点 | 手机焦点 |
|---|---|---|---|---|
| `hof` | `HoFPage` 单场 / 百场 tab | `hero-hof.webp` | `center 45%` | `22% center` |
| `mark3` | `HoFPage` 三环 tab | `hero-mark3.webp` | `center 45%` | `18% center` |
| `replay` | `ReplayWorkspace`、`BattleTable` league 概览 | `hero-replay.webp` | `center 48%` | `45% center` |
| `tankopedia` | `AgentTankopedia` 列表 / 详情 | `hero-tankopedia.webp` | `center 45%` | `18% center` |
| `techtree` | `AgentTechTree` | `hero-techtree.webp` | `center 45%` | `42% center` |
| `maps` | `MapPreviewPage` 选择态 | `hero-maps.webp` | `center 45%` | `22% center` |
| `events` | `TournamentPointsPage`、`LeagueBroadcastsPage` | `hero-events.webp` | `center 45%` | `40% center` |
| `community` | `CreatorsPage`、`ContactPage`、`MorePage`、`AndroidDownloadPage`、`SponsorPage` | `hero-community.webp` | `center 45%` | `45% center` |
| `profile` | `ProfilePage` | `hero-profile.webp` | `center 45%` | `45% center` |
| `docs` | `HistoryPage`、`TechnicalEvolutionPage`、`RatingDocsPage` | `hero-docs.webp` | `center 45%` | `42% center` |
| `admin` | 全部后台页（用户、战斗数据、反馈、名人堂、赛事积分、创作者配置） | `hero-admin.webp` | `center 45%` | `40% center` |

**遮罩与可读性：** 分区图默认仍用 `--theme-hero-scrim`（手机 `--theme-hero-scrim-portrait`）压出纯色文字区，因此 DC-THM-05 的四主题对比度要求不变。寒冬是浅色主题，白色遮罩会把图洗淡，所以只在寒冬定义更轻的分区遮罩：`--theme-hero-section-scrim`（横版，左侧 94% → 78% → 12%）和 `--theme-hero-section-scrim-portrait`（竖版，自上而下 15% → 0%，几乎全撤，画面完整透出；标题可读性改由白色文字 + 深色描边承担——只在手机断点生效，桌面左侧仍有 90° 白色遮罩，深色标题保持原样）。其它主题不定义这两个 token，组件用 `var(--theme-hero-section-scrim, var(--theme-hero-scrim))` 回退。验收时坦克主体必须仍可辨认，标题区域取样点满足 §3。

**紧凑档（compact）：** 工具页与后台使用紧凑档，默认桌面 132px / 手机 96px，横幅里只保留 kicker + 标题；操作（能力切换、搜索、刷新等）放在横幅下方独立的工具条里，不挤压下方操作区。Replay 是唯一例外：约 12:1 的 132px 窄条在 cover 下只剩 ~12% 可见带（可见占比 = 容器高宽比 × 原图宽高比，与源图无关），坦克被裁成炮管残片，因此桌面放宽到 clamp(132px, 20vw, 384px)（~43% 可见带容纳坦克整体），矮桌面窗口（height < 700px，flex scrollport 会被压缩）与手机（可见带已近一半）回退默认密度。完整档保留说明、关键数字与操作。标题复用页面原有 i18n 文案；如果横幅已经承担页面标题，就删除原独立页头，避免同屏两个一级标题。

**验收：** 每个分区至少一个页面，四套主题 × 1440×900 / 390×844 截图人工确认：坦克主体可见、未被标题压住、标题可读、无横向滚动；`ShowcaseHero.test.ts` 覆盖 `section` 映射与紧凑档结构。

---

## 3. 颜色

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-CLR-01 | MUST | 全站 | 正文 ≥ 4.5:1，大字与 UI 图形 ≥ 3:1，四套主题都成立 | 无 | token 由 `src/styles/tokens/color-contrast.test.ts` 断言；组件组合人工 |
| DC-CLR-02 | MUST | 单个视图 | 只保留一个强调色填充主操作 | 无 | 人工 |
| DC-CLR-03 | MUST | 阵营表达 | 不能只靠红绿区分，必须再用位置、文字或形状表达一次 | 无 | 人工 |
| DC-CLR-04 | MUST | 物理队伍色 | Team 1 / Team 2 颜色不随录像者交换 | 无 | 人工 |

**依据：** WCAG 2.2 AA。正文 ≥ 4.5:1；大字（≥ 24px，或 ≥ 18.66px 且加粗）≥ 3:1；UI 组件和图形 ≥ 3:1（1.4.11）。
下表每个值都已用脚本验证：在该主题的**全部纯色表面与实际应用的玻璃表面**上取最差的一层，结果仍然达标。当前页面级实现只应用 `surface-1-glass`；它按真实 wide / portrait 背景图逐像素叠加 `--theme-backdrop-scrim` 后再与玻璃 alpha 合成，取亮度最小 / 最大像素参与比较。`surface-2/3-glass` 是保留档位，仍校验 alpha 与 canvas 混合；新增使用处时必须把该档位加入真实背景取样。

### 3.1 表面与文字

| 语义 token | 春 spring | 夏 summer | 秋 autumn | 冬 winter | 用途 |
|---|---|---|---|---|---|
| `--color-canvas` | `#08140f` | `#191304` | `#160f08` | `#eef3f8` | 页面底色 |
| `--color-surface-1` | `#0e1d17` | `#231a09` | `#20160c` | `#ffffff` | 卡片、面板 |
| `--color-surface-2` | `#14271f` | `#2f2311` | `#2a1d10` | `#f5f8fc` | 表头、嵌套区域、hover |
| `--color-surface-3` | `#1b3228` | `#3e2f18` | `#362516` | `#e2ebf5` | 选中行、按下、输入框底 |
| `--color-text-primary` | `#e7f1ea` | `#f8efd9` | `#f6ead6` | `#0f2236` | 正文、数字 |
| `--color-text-secondary` | `#a6bdb0` | `#d9c7a0` | `#d0bb9a` | `#3b5470` | 标签、说明 |
| `--color-text-tertiary` | `#869d90` | `#b8a277` | `#ad9576` | `#4a6380` | 辅助信息、占位符。**这是最浅的一级文字色** |
| `--color-border-subtle` | `#1f3a2e` | `#4b3a1d` | `#3d2c19` | `#cbd8e6` | 分隔线（装饰性，不承担信息） |
| `--color-border-strong` | `#5f8072` | `#a28a5a` | `#937a55` | `#6f849b` | 输入框、复选框等控件边框（需 ≥3:1） |
| `--color-surface-1/2/3-glass` | 对应表面色 + 88% / 86% / 84% alpha | 同左 | 同左 | 同左 | 页面级卡片的磨砂表面；实际应用档位纳入真实背景图最差对比度 |

> 玻璃表面只减不增：当前页面级实现使用 `surface-1-glass` 作为主卡片 / 面板；`surface-2-glass` 与 `surface-3-glass` 是保留档位，尚未落到元素上。数据区一律用上面的纯色行；新增玻璃档位使用处时必须同步把它加入 `color-contrast.test.ts` 的真实背景取样列表。

**深色主题的层级靠亮度区分，不靠阴影。** 表面越亮，离用户越近。依据：Material Design 的暗色主题指南。浅色主题（寒冬）则用阴影。

### 3.2 强调色与状态色

| 语义 token | 春 | 夏 | 秋 | 冬 | 规则 |
|---|---|---|---|---|---|
| `--color-accent` | `#f2b450` | `#f7bd3c` | `#ef8434` | `#1f6fd1` | 主按钮底色、选中态、焦点环、进度条 |
| `--color-on-accent` | `#1a1206` | `#1a1204` | `#1a0d04` | `#ffffff` | 强调色底上的文字 |
| `--color-accent-text` | `#f8c56e` | `#ffd166` | `#ffa15c` | `#1d63b8` | **强调色文字只能用这个 token**，如链接、强调数字 |
| `--color-success` | `#66d48f` | `#5cc280` | `#6cc08a` | `#11703f` | 成功、胜利 |
| `--color-danger` | `#f2786d` | `#f2786d` | `#ff8070` | `#b8322a` | 错误、删除、失败 |
| `--color-warning` | `#f5ca76` | `#f5ca76` | `#f5ca76` | `#855600` | 警告 |
| `--color-info` | `#6db3ec` | `#6db3ec` | `#6db3ec` | `#1a64a8` | 提示、链接（非品牌链接） |

- 遮罩：`--color-scrim` 深色主题为 `rgb(0 0 0 / .6)`、寒冬为 `rgb(15 34 54 / .35)`，所有弹窗、sheet 共用；组件不各自定义遮罩色。
- 状态色的背景版本（`--color-danger-bg` 等）统一用 `color-mix(in oklab, var(--color-danger) 14%, var(--color-surface-1))`，不单独定义色值。
- **强调色要克制**：每个视图只保留一个主操作用强调色填充。其余按钮用 secondary 或 ghost（§7）。

### 3.3 领域色：阵营

**两套概念，不得互相替代**：

| 概念 | token | 用途 |
|---|---|---|
| **物理队伍**（回放 Team 1 / Team 2，固定身份色） | `--color-team-1` / `--color-team-2` | 需要「队伍 1 就是队伍 1」的身份表达；不决定名册左右位置 |
| **记录者视角**（我方 / 敌方） | `--color-team-ally` / `--color-team-enemy` | 2D / 3D 名册、顶栏双方总血量与比分、基地归属、胜负横幅 |
| 未知 / 中立 | `--color-team-neutral` | 未识别阵营、无主基地 |

| token | 春 / 夏 / 秋 | 冬 | 色盲替代色 |
|---|---|---|---|
| `--color-team-1` | `#66d48f` / `#5cc280` / `#6cc08a` | `#11703f` | 不变 |
| `--color-team-2` | `#f2786d` / `#f2786d` / `#ff8070` | `#b8322a` | 改用 `--color-team-enemy-cb`（深色 `#c38bf0` / 寒冬 `#7b3fb3`，紫色） |
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

- 分类色板：8 色，对色盲友好（参考 Okabe–Ito），深色三季共用一份、寒冬一份，都要在 `surface-1` 上 ≥ 3:1。
- 顺序色板（热力图、穿透率等）：单色相，从浅到深；在亮色主题里方向反转。
- 图表**一律带图例**，关键数值直接标在图上，不能只靠颜色读值。
- **Battle Data 出生侧胜率分段条**（`BattleDataAdminPage.vue` `.spawn-bar`）是本节唯一约束到具体组件的例外，颜色表达**物理出生侧**（不是 Team 1 / Team 2，也不是胜负），四季固定：
  - 先手侧（NORTH / WEST）胜场 → `--color-danger`（红）；后手侧（SOUTH / EAST）胜场 → `--color-info`（蓝）；平局 → `--color-border-strong`（中性灰），是独立第三段，不并入任一侧。
  - track（底轨）用 `--color-surface-3`，整体加 1px `--color-border-strong` 实边框，条高 `var(--space-3)`（12px），颜色一律不透明。
  - 门禁（`color-contrast.test.ts`）：每个 fill 对 track ≥ 3:1，1px 边界对行底色（`surface-1`）≥ 3:1，并断言组件 CSS 三段精确使用上述 token；四季主题都必须通过，改 token 时不能静默退化。

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
| DC-TYP-03 | MUST | 展示字阶 | 超过 `--type-display-hero` 的字号只能用于 Showcase Hero 的标题和关键数字，上限 104px，由 `scale.css` 的 `--type-display-showcase`（`clamp(44px, 7vw, 104px)`）提供；数据区不得使用 | 无 | `pnpm run lint:css` + 人工 |
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
| `--type-body`（场景短视口横屏紧凑档） | 14 / 18 | 400 | 只在 `[data-scene-surface]` 的短视口横屏档内生效；见 §5 |
| `--type-caption`（场景短视口横屏紧凑档） | 12 / 14 | 400 / 600 | 同上；字号仍守住 12px 下限 |

- 工作区只用 7 级字阶；`display-hero` 与 DC-TYP-03 的展示字阶只属于装饰插槽。
- **token 形态：** 每一级有两个原子 token `--font-size-{级}`、`--line-height-{级}`，以及一个组合 token `--type-{级}`（字重 + 字号 / 行高 + 字体，用于 `font` 简写）。`font-size` / `line-height` 只能引用原子 token，`font` 只能引用组合 token；常规触控档只覆盖 `--font-size-body` / `--line-height-body`，组合 token 自动跟随。场景短视口横屏紧凑档同时收紧 body / caption，并在同一作用域重定义组合 token。长文阅读另有 `--line-height-prose`（1.7，只用于文档类页面的正文）。
- 字重只用 400 / 600 / 700。
- 大写字母 + 字间距的 "kicker" 标签（如 `WOTBTOOLS · REPLAY WORKSPACE`）只能出现在装饰插槽里，工作区不用。

---

## 5. 间距、尺寸、圆角、阴影、层级

| ID | 强度 | 范围 | 规则 | 例外 | 验证 |
|---|---|---|---|---|---|
| DC-SIZ-01 | MUST | 触控档 | 可交互元素命中区 ≥ 44×44；场景短视口横屏紧凑档 ≥ 40×40（见 §5「场景短视口横屏紧凑档」）；装甲短横屏 38px 胶囊的 36px 分段开关为 PR #932 的显式例外 | 页脚备案链接等法定文字 | `pnpm run test:browser-interaction`、`pnpm run test:browser-armor-mobile` |
| DC-SIZ-02 | MUST | 层级 | z-index 只用 token，不靠大数值收尾 | 场景型工作台内部用局部 1–9 | `pnpm run lint:css` |
| DC-MOT-01 | MUST | 动效参数的 ownership | 动效参数仍有唯一权威入口：现有 duration/ease 从 CSS token 经 `motionPolicy.ts` 读取；允许在同一 ownership 下扩展 spring、velocity、interruptibility 等参数，不得每个组件自建互不兼容的第二套 motion policy | 新模型在实现前明确其 token/owner | `motionPolicy.test.ts` + 相关交互测试 |
| DC-MOT-02 | MUST | 降低动效 | 遵守 `prefers-reduced-motion: reduce`，移除可能引起不适的空间位移、弹性/视差效果，允许保留必要的静态/淡入反馈；当前实现的 duration 归零是合规降级之一而非所有未来动效的唯一方案 | 无 | `motionPolicy.test.ts`、`pnpm run test:browser-home` + 实际渲染审查 |
| DC-MOT-03 | MUST | 回放与 UI 动效边界 | 回放时间、事件、HP、镜头事实的来源与时间轴语义必须准确；允许在 2D/3D、HUD、timeline、HP、camera 加入可中断的**表现层**动效，但不得让视觉状态冒充错误的战斗事实或造成输入延迟；先测帧性能并进行回放 seek/暂停/反向验证 | 不对原始事件或回放时钟造假 | 相关回放测试 + 录屏/帧性能/真实回放语料 |
| DC-MOT-04 | MUST | 动效 | 禁止 `transition: all`，列出具体属性 | 无 | 人工 |
| DC-MOT-05 | SHOULD | 动效 | 优先动画 `transform` / `opacity`；动画可被用户操作打断 | 选中指示器等 shared layout | 人工 |

**依据：** 4pt 网格（Material、Apple HIG、多数设计系统的做法），以及有限的离散刻度。场景短视口横屏紧凑档是唯一例外，取 0.75× 刻度（见下文）。

**间距**：`--space-{0,1,2,3,4,5,6,8,10,12}` = `0, 4, 8, 12, 16, 20, 24, 32, 40, 48px`；场景紧凑档为 `0, 3, 6, 9, 12, 15, 18, 24, 30, 36px`

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
| 最小点击区域 | 24×24 | **44×44**（场景短视口横屏紧凑档 40×40；装甲短横屏胶囊 36/38 例外） | WCAG 2.5.8 最低 24；Apple HIG 44pt；Material 48dp |

**场景短视口横屏紧凑档**：条件为 `@media (pointer: coarse) and (orientation: landscape) and (height <= 520px)`，只作用于场景根 `[data-scene-surface]`（2D / 3D 回放、装甲查看器 / 射击复现、地图 3D）。普通内容页、桌面和竖屏手机不命中。

| token | 常规触控 | 场景紧凑档 | 用途 |
|---|---|---|---|
| `--control-h-sm` | 44 | 32 | 次要行内操作；视觉不足 40 时用透明命中区补足 |
| `--control-h-md` | 44 | 36 | 回放传输条按钮；视觉 36，命中区补到 40 |
| `--control-h-lg` | 48 | 40 | 主操作 |
| `--row-h` | 48 | 40 | 名册 / 列表行 |
| `--hit-min` | 44 | 40 | 最小命中区 |
| `--hit-min-comfortable` | 44 | 40 | 舒适命中区；本档不得低于 40 |
| `--scene-hit` | 44 | 40 | 场景按钮保底尺寸（默认值等于 44） |
| `--scene-control-h-lg` | 48 | 40 | 装甲查看器底栏等 48px 主操作（默认值等于 48） |

- 间距取常规刻度的 0.75×：`3 / 6 / 9 / 12 / 15 / 18 / 24 / 30 / 36px`。这是本档唯一的 4pt 网格例外，且只作用于场景根，不改变全站间距。
- 回放 Display 面在本档把内边距从 `--space-3`（9px）收到 `--space-2`（6px）：9px 时 375px 高的横屏会让最后一排 40px 选项行被滚动口裁掉 2px；收到 6px 后 667×375、740×360、844×390 均可完整可达。
- 字号：`--type-body` 14/18、`--type-caption` 12/14；必须在同一作用域重定义组合 token `--type-body` / `--type-caption`，否则子元素只改原子 token 不会重算 `font` 简写。
- **命中区**：`--hit-min-comfortable` 不得低于 40px。视觉高度需要更小时（例如传输条 36px），用透明伪元素或 padding 把可点范围补到 40×40；唯一的视觉尺寸例外是装甲 `height <= 500px` 的 38px 胶囊 / 36px 分段开关（PR #932），由 `browser-armor-mobile` 单独锁定；扩展区不得压住相邻控件的命中区（传输条把 gap 固定为 6px，按钮外框 36px、含 1px 边框的 padding box 为 34px，伪元素 `inset: -3px` 补到 40×40；相对视觉外框向 gap 各伸 2px，命中区之间仍留 2px，不重叠）。
- 3D 回放的「恢复 UI」按钮在本档把顶偏移改为 `--space-2 + --hit-min-comfortable + --space-2`（6 + 40 + 6 = 52px），让出右上角 40px 全屏按钮（top 6、bottom 46）；常规档仍用 `--control-h-sm`。
- 倍速菜单的档位按钮在本档保持 `--hit-min + --space-4` = 52px 宽、40px 高；回归测试按 40×40 有效命中区校验，不把视觉外框直接当成命中区。
- 竖屏手机、桌面与普通内容页沿用上面的常规触控档；场景紧凑档的值不能写到 `:root` 或普通页面的作用域。

**圆角**：`--radius-sm: 6px`（标签、小徽章、小控件）· `--radius-md: 8px`（按钮、输入框、卡片）· `--radius-lg: 12px`（弹窗、sheet、抽屉）· `--radius-full: 999px`（胶囊、头像）

**超椭圆（squircle）圆角 · 渐进增强**：`scale.css` 在 `@supports (corner-shape: squircle)` 里集中启用，组件不逐个处理。
- 开关是 `--corner-shape`（支持时为 `squircle`），并由一条 `*, ::before, ::after { corner-shape: var(--corner-shape) }` 全局规则应用。`corner-shape` 不继承，没有圆角的元素不受影响。不支持的引擎（截至核实：iOS Safari、Firefox / GeckoView 的稳定版）整段被忽略，照常退回普通 `border-radius`，页面无需任何分支。
- 同半径下 squircle 的曲线更靠近角点、视觉更方，所以同一个 `@supports` 内把 `--radius-sm / md / lg` 从 6 / 8 / 12px 放大到 8 / 10 / 16px（约 1.25–1.33 倍）。基准值（不支持的平台）不变；组件仍只引用 token，不要自己写 `calc()` 补偿。
- **`--radius-full` 例外**：胶囊、圆形（头像、圆形图标按钮、赞助胶囊、开关、进度条）不放大、不变形。凡是写 `border-radius: var(--radius-full)`（或 `50%`）的规则，必须紧跟一条 `corner-shape: round`（需要继承父级圆角时用 `corner-shape: inherit`）。未分层的组件规则优先于 `@layer tokens`，所以这条声明能覆盖全局规则。`src/styles/corner-shape.test.js` 会检查这条约定。
- 新增圆形 / 胶囊元素时同样要带 `corner-shape: round`；普通圆角矩形什么都不用写。

**阴影 / 层级**：

| token | 用途 | 暗色 | 亮色 |
|---|---|---|---|
| `--elevation-1` | 卡片 | 无阴影，用 `surface-1` + `border-subtle` | 轻阴影 `0 1px 2px rgb(0 0 0 / .06)` |
| `--elevation-2` | 下拉菜单、吸顶栏 | `surface-2` + `0 4px 12px rgb(0 0 0 / .4)` | `0 4px 12px rgb(0 0 0 / .10)` |
| `--elevation-3` | 弹窗、sheet | `surface-2` + `0 12px 32px rgb(0 0 0 / .5)` | `0 12px 32px rgb(0 0 0 / .16)` |

**Z-index**（**只能用 token**）：

`--z-base: 0` · `--z-sticky: 100` · `--z-header: 200` · `--z-drawer: 300` · `--z-sheet: 400` · `--z-menu: 500` · `--z-dialog: 600` · `--z-tooltip: 650` · `--z-toast: 700`

**当前动效实现基线**：`--duration-fast: 120ms`、`--duration-base: 200ms`、`--duration-slow: 300ms`、`--ease-standard: cubic-bezier(.2, 0, 0, 1)`。`prefers-reduced-motion: reduce` 目前令三个时长归零，JS 侧（motion-v）通过 `shared/motion/motionPolicy.ts` 读取这些 token；overlay 进出场沿用现有 CSS keyframes。这描述**已实现行为**，不再禁止未来有证据支持的 Spring Physics、手势中断、velocity handoff 或回放表现层动效。扩展时必须沿用单一 motion ownership，并以真实设备、回放事实一致性及性能回归作为 Outside Judge。

场景型工作台（2D / 3D 回放、装甲查看器）内部的叠放用 `isolation: isolate` 建立局部层叠上下文，内部只用 1–9，不参与全局竞争。**隔离必须真的写出来**：`position: relative` 与 `overflow: hidden` 都不建立层叠上下文，少了 `isolation: isolate` 时局部的 1–9 会和页面里任何裸 z-index 在外壳的上下文里裸比大小，"局部刻度"只是错觉。当前隔离点：`.playback-workspace`（工作台根）与 `.pb-map`（2D 场景）。

局部阶梯按下面的概念层序排列，token 见 `tokens/scale.css`：`--pb-z-canvas: 1` → `--pb-z-hud: 5` → `--pb-z-scrim: 6` → `--pb-z-controls: 7` → `--pb-z-transient: 8` → `--pb-z-modal: 9`。

需要越过该局部上下文的顶级浮层（手机底部 sheet、dialog、从工作台内部打开的菜单）必须 Teleport 到 `body`；提高 z-index 不会离开局部层叠上下文，仍会被根层顶栏 / 抽屉 / 侧栏盖住。Teleport 出去的浮层不继承父级的 `display: none` / KeepAlive 停用，父级必须在 capability 隐藏或 `onDeactivated()` 时主动关闭。

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

2D 的地图不是这种形态：它的常驻控件归控制条，地图盒里不放常驻 UI（2026-11 名册浮层化后，2D
横屏展开的名册是用户经传输条 roster 入口显式展开的**瞬态浮层**、贴 Stage 左右边缘，默认收纳，
不占常驻 §5 预算；收纳态的常驻覆盖仍由 `ws2d-*` 遮挡门禁把关）。

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
- 触控档最小命中区见上表：常规 44×44，场景短视口横屏紧凑档 40×40。

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
- **输入方式：** `@media (pointer: coarse)` 只用来切换密度 token（§5），**不用来改布局**；场景短视口横屏紧凑档是密度 token 的补充条件，同样不改布局。JS 使用 `usePointer()`。
- **组件级适配**用容器查询 `@container`，例如：表格在容器 < 560px 时切换成卡片。组件不应该知道视口有多大。
- **视口单位：** 用 `dvh` / `svh`，不用 `100vh`；宽度用 `100%`，不用 `100vw`。
- **安全区：** 顶栏、导航抽屉、底部操作栏、全屏回放都要加 `env(safe-area-inset-*)`（§9 L4）。
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
| DC-A11-05 | MUST | 可见标签 | 可访问名称包含可见文字（WCAG 2.5.3），短标题写成「短标题: 完整名称」，让语音输入能匹配 | 无 | `pnpm run test:browser-interaction shell-overlay`、`pnpm run test:browser-broadcasts`（导航项可访问名称包含可见文字） |
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
| DC-ARC-02 | MUST | 工作区 / 工具页 | 页头用 `ShowcaseHero` 的 `compact` 档：横幅只保留 kicker + h1（桌面 132px / 手机 96px；replay 桌面放宽到 clamp(132px, 20vw, 384px)，矮窗口回退默认），操作放横幅下方工具条；kicker + h1 + 说明 + 标签块不得占掉首屏 | 内容型页面用完整档 Showcase Hero | 人工；`ShowcaseHero.test.ts` |
| DC-ARC-03 | MUST | 筛选 | expanded / medium 行内工具栏；compact 用「筛选」按钮 + sheet，已生效条件显示为 chip | 无 | `pnpm run test:browser-interaction`（`overlay-catalog-` / `overlay-hof-`） |
| DC-ARC-04 | MUST | 主导航 | 成员、分组与栏目归属只由 `app/navigation.js` 定义；侧边栏与手机抽屉渲染同一份分组，「更多」页不复制导航列表 | 无 | `src/app/navigation.test.js` |
| DC-ARC-07 | MUST | 主导航 | `PRIMARY_NAV` 的每个入口在大屏（侧边栏）与小屏（菜单 → 左侧抽屉）都能经真实点击到达；没有底部常驻导航 | 无 | `pnpm run test:browser-interaction shell-overlay`；主站 Logo 回首页由 `test:browser-creators`（`production-`，小屏）与 `test:browser-broadcasts`（`-desktop`，大屏）验证 |
| DC-ARC-08 | MUST | 小屏外壳 | 满足下方「小屏布局契约」L1–L6 | 无 | `pnpm run test:browser-interaction mobile-pages`（L4 / L6）、`shell-overlay`（L1 / L3）、`src/app/navigation.test.js`（L5 例外清单） |
| DC-ARC-05 | SHOULD | 页面状态 | 筛选、Tab、分页写进 URL，可深链和前进后退 | 无 | `src/app/router.test.js` + 人工 |
| DC-ARC-06 | MUST | 表格 | 手机上复杂表格转卡片或关键列 + 容器内横向滚动，不撑破页面 | 无 | 人工 |

| 模式 | 规则 |
|---|---|
| **AppShell** | 平板 / 桌面：左侧边栏（`--z-header`，铺满视口高度），没有顶栏（`--header-h: 0`）。桌面默认展开（240px，图标 + 文字），可折叠成 72px 图标栏并记住偏好；平板固定为图标栏。侧边栏从上到下：品牌 · 数据版本 · 首页 · 按战斗、资料、赛事、社区分组的主栏目（`group`，图标栏用分隔线代替分组名）· 管理组（按角色）；底部：更多（弹出面板，只放低频的显示设置与关于 / 支持）· 账户 · 折叠开关。手机竖屏与手机横屏（抽屉外壳，见下方 L1 / L3）：48px 顶栏（菜单 · Logo · 当前栏目名 · 账户）+ 左侧抽屉（`AppNavDrawer`，内容是侧边栏的同一份分组、管理组与数据版本，底部「更多」整页链接与账户）。Logo 回默认落地页：主站回首页，APK / 本地回回放。手机横屏的回放工作台（2D / 3D，回放就绪）与装甲查看器（WebGL 可用）进入沉浸态：顶栏让出，`--header-block` / `--header-h` 归零，转竖屏或离开页面即恢复。当前侧边栏宽度写入 `--sidebar-w`（抽屉外壳为 0）；顶栏为内容让出的固定空间是 `--header-block`，吸顶偏移与高度预算读 `--header-h` |
| **Showcase Hero** | `components/ShowcaseHero.vue`：页面数据区之上的主视觉（DC-THM-03…06、DC-THM-12）。不传 `section` 时用当前主题的季节主视觉；传 `section` 时用该导航分区的固定 key visual（§2.2），四套主题只换遮罩。`compact` 档只保留 kicker + 标题，操作在横幅下方工具条 |
| **控制条** | `app-shell.css` 的 `.control-bar`：数据区之上的筛选 / 排序 / 搜索一行，窄屏换行，`.control-bar-end` 推到行尾，`.is-sticky` 吸顶读 `--header-h` |
| **紧凑页头** | 工作区、工具页与后台用 `ShowcaseHero` 的 `compact` 档：横幅只显示 kicker + h1，操作 / 搜索 / 刷新放在下方工具条。原 `PageHeader.vue` 已由本档取代并删除；首页 hero 是 `HomePage.vue` 自己的整段落地页板块。**工作区禁止用 kicker + h1 + 说明 + 标签块占掉首屏** |
| **容器宽度** | `content` → `--layout-content-max`；`wide` → `--layout-wide-max`；`workspace` → `--layout-workspace-max`；长文阅读宽度 → `--reading-measure`。具体数值由 `frontend/src/styles/tokens/scale.css` 定义，布局原语见 [UI 系统](ui-system.md) |
| **Master–Detail** | expanded：列表 + 常驻详情。medium：列表 + 推开式详情。compact：列表 → 全屏详情（支持左右滑动切换）。回放工作台、射击分析、坦克百科都用这个模式 |
| **筛选** | expanded / medium：行内工具栏。compact：一个"筛选"按钮 → sheet，已生效的条件以 chip 显示在列表上方 |
| **主操作位置** | expanded：页面头部右侧。compact：底部固定操作栏（带安全区） |

### 小屏布局契约（L1–L6）

抽屉外壳的判定：宽 < 768，或触屏、横向、高 ≤ 520（不论宽度，iPhone 横屏 844×340 也在内）。JS 侧唯一来源是 `shared/breakpoints.ts` 的 `SHELL_DRAWER_QUERY`（`useBreakpoint().isDrawerShell`），CSS 侧是 `styles/tokens/scale.css` 的同一条件。

| 规则 | 内容 |
|---|---|
| **L1 导航收进左侧抽屉** | 没有底部 Tab 栏；顶栏左上菜单按钮打开左侧抽屉（`AppSheet side="start"`：焦点陷阱、Esc、遮罩、左滑关闭、四边安全区），路由变化即关闭，焦点回到菜单按钮。不做左边缘滑动打开，避免与 iOS Safari 返回手势冲突。底部只留给工作台自己的操作栏 |
| **L2 高度来自真实可视区** | 工作台高度 = 可视高度 − 顶栏 − 工作台操作栏 − 安全区，用 `dvh` 或 `visualViewport` 度量（`usePaneFillHeight` 扣底部安全区），不写固定像素或 `100vh` |
| **L3 横屏不用侧栏** | 手机横屏与竖屏同一个顶栏菜单与抽屉；数据版本在抽屉里 |
| **L4 四边让出安全区** | 固定外壳四边加 `env(safe-area-inset-*)`；可点控件不得落进安全区 |
| **L5 顶栏随滚动收起** | 普通页面向下滚动收起顶栏（`html[data-topbar="hidden"]` 让 `--header-h` 归零，吸顶元素贴顶；`--header-block` 不变，内容不跳动），向上滚动或焦点进入时恢复。工作台不收起：回放工作台各能力、装甲查看器 / 射击复现、地图预览、科技树（`navigation.js` 的 `isWorkspaceView`） |
| **L6 五视口进门禁** | Android 360×740 / 412×839（底部手势条 24）、iPhone Safari 390×664（顶 47 / 底 34）/ 375×553（顶 20）、iPhone 横屏 844×340（左右 47 / 底 21）。逐页滚动扫查：完整可见的交互控件 5 点命中自身、不落进安全区、页面无横向溢出；fixed / sticky 面里的控件无条件参与判定（`measureViewportSafety`） |

### 强制横屏与场景 HUD

- **适用设备只有两类**（`platform/screenForm.ts`，判定只看设备、不看视口）：Android 手机上的 App（Native Bridge 可选能力 `screen-form` 报告 phone）与 iPhone 上的 Safari（UA 含 iPhone 且不是 iPad）。桌面（含缩窄窗口）、所有平板、Android 手机浏览器都不受影响，竖屏照常用小屏布局。
- **适用页面**：2D 回放、3D 回放、装甲查看器、射击复现、地图预览 3D。科技树、直播与推荐视频、比赛截图、AI 复盘、名人堂、管理页不强制。
- **行为**（`useForcedLandscape`）：Android 手机 App 进入场景页时原生锁横屏，离开 / KeepAlive 停用即释放；iPhone Safari 竖屏时整块显示 `RotatePrompt`（场景保持挂载，横过来即继续），提示里给出退出动作：2D / 3D 回到「看赛后数据」，装甲查看器回到坦克百科 / 射击分析，地图 3D 切到 2D。HTML 全屏在 Android App 里也只在手机上锁横屏。
- **横屏沉浸**：没有顶栏，菜单入口仍在：2D / 3D 回放由传输条第一项承载（`PlaybackTransport` 经 `shellChrome.hostNav` 声明，7 人名册车道保持不滚动；控制条被 `v-show` 收起、能力切走或 KeepAlive 停用时经 `navEligible` / 生命周期交还，外壳重新画悬浮菜单）；其余场景（装甲查看器、射击复现）由外壳在左上放悬浮菜单按钮（`AppShell` 的 `.immersive-nav`），场景用 `--immersive-nav-reserve`（沉浸态 44 + 8，其余为 0）让出：返回键与信息卡右移。该 reserve 由场景外的外壳菜单按钮决定，场景短视口横屏紧凑档不把它改成 40 + 6，否则返回键会压住仍是 44px 的菜单按钮。两者打开同一个抽屉。
- **验收**：`pnpm run test:browser-interaction forced-landscape`（iPhone 竖屏出提示并能回到赛后数据；iPad 竖屏与缩窄的桌面浏览器不出提示；iPhone 横屏 844×340 沉浸且菜单可打开抽屉；装甲查看器 `armor-forced-landscape-*`：iPhone 竖屏出提示并带返回动作，iPhone 横屏、iPad 竖屏与缩窄的桌面浏览器不出）。
- **短视口紧凑档**：手机横屏高度 ≤ 520px 时，上述场景改用 §5 的场景紧凑档 token（控件 32/36/40、命中区 40、间距 0.75×、正文 14/18），让传输条、底栏和 HUD 不再按 44/48px 撑高；竖屏与桌面完全沿用常规触控档。装甲查看器在 `height <= 500px` 的短横屏胶囊（下方一条）另有 36/38px 视觉尺寸，是本档 40px 命中区的唯一显式例外，由 `browser-armor-mobile` 单独锁定。
- **场景 HUD（装甲查看器、射击复现）**：手机横屏时常驻控件只在四角——左上返回 + 车名 / 参数，右下拇指区是射击快捷项（弹种、距离、厚度 / 击穿），左下是姿态与角度；完整设置是右侧参数面板（约 19rem + 安全区），打开时场景仍在左侧可见。短横屏（`height <= 500px`）再启用紧凑档：左上收成 38px 胶囊（返回图标 + 可截断车名 + 参数图标），右下射击卡片收到 15rem × ≤45dvh 并把距离滑条与穿深数值并排，左下姿态压成两行，参数面板头部提供 sticky 的 40px 关闭按钮（紧凑档命中区）。单发分析页（shot=）的右下由 armor-bottom-controls 统一接管：射击参数卡片在上、「查看弹着点 / 查看双方位置」视角切换排在下方，同一列共享右下空间且锚点带左右 safe-area。该列与左上胶囊同为 HUD 层（--pb-z-hud）；参数抽屉展开时其所属上下文提升到 --z-dialog（高于射击复现顶栏的 --z-sticky+1），保证抽屉绘制在 HUD 与顶栏之上、抽屉内控件触摸不被拦截；触摸验收以 elementFromPoint 命中归属为准（bounding box 不证明绘制/命中顺序）。
- **点选结果**（厚度 `#click-info`、击穿 `#traj-info`）：固定停靠在场景顶部，不跟随命中点、不压车体；宽屏 / 竖屏在顶部居中；短横屏 ≥768px 紧贴左上胶囊右侧并与其垂直对齐，<768px 落到胶囊下方第二行；小屏收起态只显示最终判定一行（胶囊），点开看逐层明细。

### 射击分析与科技树（小屏）

- **射击分析**（窗格 < 600px）：射击者先给「我的射击 / 全部玩家」两项分段，按玩家筛选保留在下拉里；四项统计固定一行；时间线每行一发，点一发直接进入射击复现（新手教程引导中保留检视面板，教程步骤仍有目标）。
- **科技树**（竖屏手机）：国家页签单行横滑 + 车种分段在列表之上；按等级从高到低、每级一行横向卡片（卡片压缩到 92×48、图标盒等比缩小、行距收紧，一行可容 3 张、整树近一屏可见）；不渲染等级标尺与连线。手机横屏、平板、桌面保持客户端网格。
- **科技树卡片名字带**：名字横贯卡片下缘、正压在坦克贴图下半上（客户端 TankNode 布局），名字自带一层卡片表面色 → 透明的雾化 scrim（`.tt-card-name` 的 background）——文字永远落在自家表面色上，浅色主题（冬）的近黑文字不与深色车体贴图混色。

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

### 反馈：toast、通知、按钮状态、触感与音效

同一事件同一种反馈；视觉反馈始终存在，触感与音效只是加强。

| 元素 | 规则 |
|---|---|
| **Toast**（`composables/useToast.ts` 状态源，`app/AppToast.vue` 唯一渲染出口） | 成功 / 提示 `role=status`，4 秒后消失，悬停、按住或焦点进入时暂停计时；警告 / 错误 `role=alert`，不自动消失，带关闭与可选的下一步操作。大屏在右下、最多 3 条；抽屉外壳（手机）在顶栏下方，不压工作台底部操作栏；横屏沉浸时只显示警告 / 错误。连通性提示（`useConnectivityNotice`）复用它（warning，固定 id）。 |
| **通知中心**（`composables/useNotifications.ts`，`app/NotificationPanel.vue`） | 只存本机最近 20 条（`wotb-notifications`）：回放解析完成、AI 复盘完成、新版本可用、名人堂提交结果；文案存 i18n key。入口是顶栏铃铛（抽屉外壳）或侧边栏底部「通知」（平板 / 桌面），带未读数；面板复用 `AppSheet`。不做服务端推送。 |
| **按钮状态**（`AppButton`） | 按下缩到 97% 并加深；`loading` 保持宽度、显示转圈并 `aria-busy`；`confirmed` 显示确认态（如「已复制」2 秒后恢复）。 |
| **触感**（`useHaptics`） | 事件映射：选择（分段 / 开关）10ms、主操作 20ms、成功双击、错误长振、拖到端点 8ms。Android App 走 Native Bridge 可选能力 `haptics`（系统触感常量），Android 浏览器用 `navigator.vibrate`，iPhone Safari 不触感。 |
| **音效**（`useSound`） | 点击、成功、错误、提示四种 WebAudio 短音，默认关闭；`prefers-reduced-motion: reduce` 时不播放；iOS 随静音开关。 |
| **设置**（`useFeedbackPrefs`，`wotb-feedback`） | 「更多」→ 反馈与提示：按键震动（默认开）、按键音效（默认关），开关用 `AppSwitch`。 |

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
| DC-ACC-02 | MUST | 页面视觉 PR | 附大屏、小屏前后截图，盛夏与寒冬（深 / 浅各一）都看 | 3D 与回放画面由用户验收，截图不作验收证据 | PR 审查，用户验收 |
| DC-ACC-03 | MUST | 界面 PR | 受影响的 browser gate 通过，退步不靠放宽门禁解决 | 无 | PR CI |
| DC-ACC-04 | MUST | Android / WebView | 只有行为确实与浏览器不同的规则才要求真机验证；Chromium 设备仿真不替代真机 | 无 | 真机人工 |

1. **stylelint**（`pnpm run lint:css`，配置见 `frontend/stylelint.config.mjs`，CI 必过）：
   - `declaration-no-important`：禁止 `!important`。
   - `scale-unlimited/declaration-strict-value`：`*color`、`fill`、`stroke`、`z-index`、`font`、`font-size`、`line-height`、`border-radius`、`box-shadow` 只能用 `var(--*)` 或豁免值。豁免值（`TOKEN_EXEMPT_VALUES`）：`transparent`、`currentColor` / `currentcolor`（插件区分大小写）、`inherit`、`initial`、`unset`、`revert`、`none`、`0`、`auto`、`normal`。
   - `color-no-hex`、`color-named: never`、`function-disallowed-list: rgb/rgba/hsl/hsla`：组件里不出现色值；只有 `src/styles/tokens/**` 例外。需要半透明时用 `color-mix()`。
   - `media-feature-range-notation: context`、`media-feature-name-value-allowed-list: width → 768px / 1200px`、`media-feature-name-disallowed-list: min-width / max-width / device-width`：断点只有三档，且必须写 range 语法。
   - `declaration-property-unit-disallowed-list`：块方向尺寸（`height`、`block-size` 及其 min/max，`top`、`bottom`、`inset`、`inset-block*`）禁止 `vh`，用 `dvh` / `svh`；行方向尺寸（`width`、`inline-size` 及其 min/max）禁止 `vw`，用 `%`；`flex-basis` 两者都禁。
   - 旧文件列在 `frontend/stylelint.legacy.json` 忽略名单里（基线），新文件一律严格检查；移出名单的文件同样受严格检查。
2. **PR 自查清单：**
   - [ ] 只用了语义 token
   - [ ] 盛夏与寒冬都截了图
   - [ ] 三档宽度都截了图
   - [ ] 键盘能走完整个流程
   - [ ] 新文案进了 i18n 和术语表
