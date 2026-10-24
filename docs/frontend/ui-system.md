# 前端 UI 系统（当前实现索引）

本文档是前端 UI 约定的 canonical 入口。具体 token 数值与页面规则以当前 CSS 和 `docs/DEVELOPER_GUIDE.md` 为准；本文件不复制页面级设计稿。

## 设计语言

- 设计规则（颜色、字号、间距、圆角、层级、组件、状态、文案）的 canonical 是 [`design-language.md`](design-language.md)；本文件只记录实现位置与不变量。
- 设计语言 token：`frontend/src/styles/tokens/scale.css`（刻度，并声明 `@layer` 顺序）与 `frontend/src/styles/tokens/color.css`（两套主题的语义色）。`data-theme` 由 profile 派生：`showcase → dark`、`classic → light`。
- `frontend/src/styles/tokens.css` 是 deprecated 的旧 token 与 layout class 层，仅为保持现有视觉；新代码不得引用其中的旧 token。`classic-profile.css` 是 Classic profile 的语义覆盖层。
- `npm run lint:css`（stylelint，CI 必过）强制执行设计语言；`frontend/stylelint.legacy.json` 是旧文件的忽略名单，只减不增。
- 设计语言组件（`frontend/src/components/`，均只用语义 token）：`AppButton`（Button）· `SegmentedControl` · `PageHeader` · `EmptyState` · `Banner` · `MenuButton`（Menu：方向键 / Esc / 外部点击关闭）· `BattlePicker`（SearchSelect 单选：超过 6 项显示搜索；手机为底部 sheet）· `StatStrip`（Stat）· `PlayerCardList`（DataTable 的手机卡片形态） · `FilterChips`（手机筛选入口：「筛选」按钮 + 已生效条件 chip，配合底部 sheet） · `AppDialog`（Dialog：焦点陷阱、Esc、关闭后焦点回到触发元素、手机底部 sheet；`keepMounted` 保留表单草稿）· `confirm()` + `ConfirmDialogHost`（应用内确认，禁止 `window.confirm`）· `MarkdownDocPage`（长文档：二级标题目录、吸顶 / 折叠目录、回到顶部）· `ReplayCapabilityTabs`（Tabs）。新界面优先复用它们，不新增一次性按钮 / 下拉样式。

## 界面档位（UI Profile）

- `frontend/src/composables/useUiProfile.js` 是 profile 的唯一 reactive owner，持久化 key 为 `wotb-ui-profile`。
- `showcase` 与 `classic` 只改变 Presentation 层；`data-theme` 从 profile 派生。两种 profile 共用组件、业务状态、API、spacing 和 layout。
- 用户偏好可以是 `showcase` / `classic` / `auto`（跟随系统 `prefers-color-scheme`，系统切换时实时跟随）。`uiProfile` 是实际生效的 profile，`uiProfilePreference` 是用户的选择；持久化存的是偏好。`<meta name="theme-color">` 随生效主题取两套 `--color-canvas`（`THEME_COLOR`），首屏脚本与运行时一致。
- 首屏投影在 `frontend/index.html`，运行时 token 与 profile 覆盖分别位于 `frontend/src/styles/tokens.css` 和 `frontend/src/styles/classic-profile.css`。

## 布局与响应式契约

- 应用壳：`app/AppSidebar.vue`（平板图标栏 / 桌面可折叠侧栏）、`AppTopBar.vue` + `AppTabBar.vue`（手机标题栏 / 底部导航）。导航、账户及 Profile owner 不变；导航表面使用不透明语义色，当前栏目同时用背景、强调色和位置标识区分。
- 通用元素：`frontend/src/styles/app-shell.css` 负责页面底色、基础按钮、表格、提示、footer 与列选择器；`PageHeader.vue` 负责标题 / 说明 / 操作的对齐与分隔；两者只使用设计语言 token，并受 CSS lint 严格检查。列选择器手机布局把分类说明放到下一行，重排按钮保持 `--hit-min`，不与字段名称争抢横向空间。
- `tokens.css` 保留现有 layout class；它们从 `tokens/scale.css` 读取 `--layout-content-max` / `--layout-wide-max` / `--layout-workspace-max` 与 `--gutter`。当前最大宽度分别为 1420 / 1720 / 1760px；文本阅读区另用 `--reading-measure`，不限制表格宽度。
- Showcase 页面层位于 `showcase.css`、`showcase-pages.css`、`showcase-rankings.css`、`showcase-cohesion.css` 和 `showcase-regressions.css`；Profile / HoF 的局部装饰与 Classic 桥接也在这层。
- 页面底色由语义 token 提供，首页插图由首页组件的独立图片区域拥有；Home / Contact / 回放的通用按钮与表格由语义 token 提供，Classic 不另写一套覆盖。
- 首页（`HomePage.vue`，**纯展示页**）**不承担导航**：`AppSidebar.vue` 与 `AppTabBar.vue` + `MorePage` 已覆盖 `PRIMARY_NAV` 的全部入口，三档都在，首页再摆功能卡就是抄侧边栏。功能导航只有 Replay Workspace 一个。此外 Web 首页保留 Android 下载、Sponsor、Feedback 等非功能 / 转化入口；Android App 内不展示 Android 下载入口（整张 promo 卡不渲染，Sponsor 卡保持）。由 `HomePage.test.js` 按语义锁定，不写死「恰好 N 个链接」。分段为 ① 全出血 Hero ② 实时数据带 ③ 能力展示（**整节无任何链接**）④ 带走它 / 赞助 ⑤ 极简页脚。
  - 它是唯一启用 design-language §2 装饰插槽的页面：Hero 的 `--home-hero-decor` 背景（`assets/showcase/home/hero-v4.webp`，组件 import 后经内联 `--home-hero-image` 传入），在 Classic Profile 与 `width < 768px` 置 `none`，同时隐藏承载元素。插槽由首页自己按 `html[data-ui-profile="classic"]` 派生，`classic-profile.css` 不含任何首页类名（`classic-profile-css.test.js` 守卫）。文字落在 scrim 压出的纯色上，对比度不随图片内容变化。
  - **回放的五个 capability tab 不是独立目的地**：`viewRegistry.js` 的 `replay` / `battle-playback` / `ai-review` / `agent-replay` / `agent-shots` 全部落在同一个 `ReplayWorkspace`，只是初始 tab 不同。去重断言因此按 `VIEW_COMPONENTS` 的**组件对象引用**判定，不是 href 字符串（五个 href 指向同一个 workspace），也不是组件名（view 懒加载，全叫 `AsyncComponentWrapper`）。
  - ③ 的四张与 ④ 的 Android 手机图都是真实产品截图，来源与隐私边界见 [`frontend/src/assets/showcase/README.md`](../../frontend/src/assets/showcase/README.md)；只有第一张 `eager`，其余 `lazy` 且都带固有尺寸防抖版。动效默认关闭，只在 `prefers-reduced-motion: no-preference` 下启用；hover 位移 / 缩放同样如此。
  - 项目历史 / 技术演进 / 联系我只在 `useMoreMenu.js` 的「更多」组；Web 首页有自己的 Android 下载转化卡，Android App 内隐藏。`PageHeader.vue` 不提供 hero 变体。
- `PlaybackRoster.vue` 的三层 grid 显式使用 `minmax(0, 1fr)` 横向轨道，连续长昵称 / 车型可以在行内收缩，不撑宽车道、不裁掉血条。既有 2D 浏览器夹具包含长中文 / 英文压力名称，并断言车道无横滚、整行与血条矩形完整落在车道内。
- 层级与遮挡（`design-language.md` §5）的实现位置：局部层叠上下文在 `playback-workspace.css` 的 `.playback-workspace` 与 `BattleMap.vue` 的 `.pb-map`（两处 `isolation: isolate`），局部刻度 token 在 `tokens/scale.css`（`--pb-z-canvas/hud/scrim/controls/transient/modal`）。遮挡与可达由浏览器门禁强制：共享探针在 `frontend/scripts/browser-occlusion.mjs`，几何档接在 `npm run test:browser-layout`（含故意盖住主内容的负向场景，以及可达性探针自测：部分裁剪、部分覆盖、`pointer-events` 穿透必须判失败，可滚动触达与逃出 overflow 的 fixed 元素必须判通过），真实命中与状态组合接在 `npm run test:browser-interaction`（含把常驻控制条提到瞬态面之上的负向对照，以及"至少有一次重叠真的被判定过"的空跑守卫）。探针的判定常量与 `design-language.md` §5 双向校验（`assertDocumentedLimits()`），任一侧漂移即失败。
- 回放结果表格的滚动 / sticky 接线由 `showcase-workspaces.css` 提供，容器建立局部隔离层叠；表头、首列及交叉角使用 `--table-z-*`，背景保持不透明，阵营底色与非 sticky 单元格使用同一表达式。
- 复用 `layout-content`、`layout-wide`、`layout-data-workspace`、`layout-full-workspace` 等已有 primitive；宽表优先保持信息密度，横向滚动只能是字段过多时的明确 fallback。
- 当前支持 Desktop `>=1200px`、Tablet `768–1199px`、Mobile `<768px` 三档。窄屏保留任务语义，不能整体缩放页面来规避 overflow。
- Mobile 档断点统一写作 `@media (width < 768px)`（range 语法，无 1px 缝隙/重叠），JS 判断统一 `window.innerWidth < 768`；禁止引入 `max-width: 767/768px` 或 640/560/520 等新散值。
- Mobile 档交互约定：`input/select/textarea` 字号 ≥16px（防 iOS 聚焦缩放，`app-shell.css` 全局兜底）；共享主要控件在 coarse pointer 下用 `--control-h-md` / `--hit-min`，目标 ≥44px；modal 遮罩使用 `--color-scrim`，禁止由文字颜色混合得到（showcase 下会语义反转成亮纱）。
- `index.html` viewport 已带 `viewport-fit=cover`；topbar、底部 sheet、drawer 预留 `env(safe-area-inset-*)`（当前非 edge-to-edge 解析为 0），新增贴顶/贴底固定元素时同步加 inset。
- 装甲查看器（`AgentArmorView.vue` 的样式 + `scene/tankViewer.js` 的常驻 UI）Mobile 档：顶栏一行（车名 + 等级/类型/国籍 + 「参数」开关），底栏弹种一行 + 视图开关（碰撞 / 热力图）一行——弹种文案是「弹种 穿深mm / 伤害dmg」，下拉不限宽、禁止截断；装备 / 射击方 / 目标 / 配置收进默认收起的参数面板（`.armor-stage.is-tools-open`），炮塔 / 炮管角度条贴顶栏下方；`?clean=1` 时顶栏一并让位。瞄准不是按钮：左键在炮管上拖 = yaw+俯仰、炮塔壳上拖 = 只 yaw、车体上拖 = 相机轨道，短按（无拖动）= 装甲判定。DOM 契约不变（内核按固定 ID 查找，守卫 `src/components/AgentArmorView.dom-contract.test.js`），几何 / 触控目标 / 真实触摸接线由 `npm run test:browser-armor-mobile` 锁定，瞄准 / 指针交互由 `npm run test:browser-armor-aiming` 锁定（自带确定性夹具资产包，无真实资产也真实执行）。
- 装甲查看器 Desktop / Tablet（`>=768px`）：车名、等级/类型/国籍与设置字段合并为左上角**同一张卡**；「参数」开关位于该卡首行，装备 / 射击方 / 目标 / 配置默认收起，点击后在卡内展开（`.armor-stage.is-tools-open`），不得恢复成常驻的独立设置卡；炮塔 / 炮管角度条固定在左下角。桌面 / 平板的收起、真实点击展开/收起、设置面板必须位于信息卡内部，由 `npm run test:browser-armor-mobile` 的桌面 / 平板场景锁定。
- 装甲页的射击模式包含独立车型对照、记录结果与逐发导航栏；参数分组与技术证据渐进展开，手机保持场景空间和 44px 触控。场景监听自身容器尺寸，因此标题换行也会更新画布比例。`AgentArmorView.vue` 使用语义 token 与三档响应式规则。
- 装甲查看器 / 射击复现的 3D 画布使用透明背景，直接继承页面 `--color-canvas`；场景不绘制地面网格，半球光底面跟随 `--color-surface-2`，Showcase / Classic 两套 profile 下都与网页外壳一致。相机按 Armor Inspector 实测的 product 参考曲线缩放，远距车体更小：显示 profile 为 +0.028/m、封顶 3.8，再整体乘 1.1（30 m 比 15 m 小约 14%，100/500 m 小约 35%；15 m 实际 FOV ≈20.59°，车体比 18.75° 参考小约 9%）。热力图概率色带固定红→橙→黄→绿，与判定卡的红/黄/绿语义一致，不改为主题顺序色板。判定结果卡按画布的实际 `getBoundingClientRect()` 投影并在可见画布内钳制，页面/容器滚动或窗口缩放时随场景一起移动（`#traj-info` 是视口 fixed，不能按 `window.innerWidth/innerHeight` 定位）；`browser-armor-aiming` 用真实滚动夹具锁定了这条行为。
- 选车菜单与坦克百科列表共用 `components/TankCatalogMenu.vue` 的同一实现：模糊搜索 + 搜索别名、tier/nation/type 筛选、name/tier/hp/pen 排序、手机 chips + 筛选 sheet、增量卡片网格与空/加载/错误态一致。装甲页弹窗只保留外壳与 `tankViewer` 的 `onTankList` / `onTankSelection` / `selectTank` 接线。选车网格按卡片内容确定行高，图片、车型名、等级/类型/国家信息不能被视口高度压缩裁切；大名册在弹窗内部纵向滚动，滚到边界不带动外层页面，分批加载（首屏 48，哨兵/滚轮续页）。`npm run test:browser-armor-mobile` 以真实名册响应覆盖共 121 张卡片，在 Showcase / Classic 和手机 / 平板 / 桌面三档（含 4K、筛选、筛选 sheet 与视口扩大）检查内容边界、首末车型名命中区域与无横向溢出。
- 视觉回归至少检查对比度、overflow、sticky、hover/focus、loading/empty/error；页面级验收细节见 [`docs/DEVELOPER_GUIDE.md`](../DEVELOPER_GUIDE.md)。

## Canonical 文档索引

- 联赛积分管理两页使用 `tournament-admin` 局部样式，选择区、赛事摘要与表单分区沿用
  公开榜单语义 token。`TournamentPointsTable` 的 `grouped` 只启用分组表头与表格样式；
  `publicView` 继续拥有公开摘要，管理草稿与导入预览不因此获得“已发布”语义。

- Replay / Reconstruction workspace 样式归属：[`docs/frontend/replay-workspace.md`](replay-workspace.md)
- 地图与 Playback 视觉/数据契约：[`docs/features/battle-playback.md`](../features/battle-playback.md)
- tank marker 资产与 overlay 规则：[`frontend/src/assets/tank-icons/README.md`](../../frontend/src/assets/tank-icons/README.md)
- Tier X 车型资产生成与校验：[`docs/assets/tier-x-models/README.md`](../assets/tier-x-models/README.md)

单发装甲检视底部仅呈现「查看弹着点 / 查看双方位置」分段按钮。命中上下文就绪后直接进入弹着点视角；选中状态由 `aria-pressed` 和强调色表达，反复点击当前选项不覆盖已保存的双方视角。缺失弹道时禁用弹着点选项。此切换仅更新相机，不改变记录或判定。击穿结果与装甲层信息直接展示；开发诊断仅通过 `?debug=1` 显式开启。

中弹结果面板的装甲层名称与判定结果在 `scene/tankMeta.js` 做纯显示翻译：履带左右侧、车体/炮塔/炮盾装甲板、炮管、装甲间隙及击穿/跳弹等。原始 `part_name` 和结果枚举保留用于层匹配与计算；未知名称原样保留，不根据板号推测正面、底板等几何部位。

单发页面的操作说明由 Vue 按主要输入方式派生，独立置于页面顶栏下方、场景上方：鼠标显示左键拖动旋转、滚轮缩放、右键拖动平移；触屏显示单指拖动、双指捏合、双指拖动。说明区参与页面布局，不覆盖画布，由 Vue 拥有。手机参数栏与单发操作栏纵向排列，展开弹种/视图参数时不相互遮挡。

2D 回放的 Display 提供「血量显示方式」横条 / 环形切换：环形绕车模或类型标识，
以绿色 / 红色的剩余弧长呈现已知血量，最后已知状态变灰，未知比例使用灰色虚线。
环形模式自动抑制装填条；2D 一键防遮显示车型名、类型图标和血量环，关闭恢复完整偏好。
分段选项复用 `SegmentedControl`，与显示血量开关独立；3D 使用血条及一键防遮呈现。

标记模式的「选择」工具在优先选择计划标记后，允许点击真实车辆查看其当前状态。
拖动画图、移动计划标记和双指操作不会误打开车辆详情；详情摘要与完整检查器都读取当前回放时间的血量。
