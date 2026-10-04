# WotbTools 前端多端布局审计报告

> 日期：2026-09-30 · 基线：`main` @ `fe7e4e71`
> 方法：① 线上 wotbtools.com 实测（管理员账号，手机 375×812 触屏 / 平板 768×1024 与 ~790×914 / 桌面 1440×900，中文 + 俄语，已上传真实回放）；② 自动化运行时扫描 19 个视图（溢出、遮挡、裁切、触控尺寸、小字号）；③ 五路静态代码审计（壳层与全局样式 / 回放工作台 / 战局重建 / 其他页面 / 3D 功能）；④ 3D 功能实测（三维回放、坦克百科、装甲查看器、射击复现，均用真实回放）；⑤ 核心业务流程走查与可用性原则检查。
> 级别：**P0** 核心功能不可用 · **P1** 明显可见的 bug · **P2** 不一致 / 体验债 · **P3** 清理项。
> 端：**D** 桌面 ≥1200 · **T** 平板 768–1199 · **M** 手机 <768 · **App** Android WebView 壳。
> 标 🔬 的条目需真机确认。

---

## 0. 结论速览

| | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 壳层 / 全局样式 | 1 | 4 | 12 | 4 |
| 回放工作台 | 1 | 7 | 18 | 3 |
| 战局重建 | 1 | 6 | 8 | 4 |
| 其他页面 | 0 | 4 | 10 | 6 |
| 性能 | 0 | 2 | 1 | 0 |
| 三维新功能（§6） | 0 | 9 | 15 | 1 |
| 业务功能实测（§7.1a） | 1 | 5 | 13 | 0 |
| **合计 136** | **4** | **37** | **77** | **18** |

另有 **8 条业务流程问题**（§7.1，其中 P0 1 条、P1 5 条），以及可用性原则检查（§7.2）和命名统一建议（§7.3）。

**三个根因解释了大部分问题：**

1. **showcase 样式层"越权"。** `showcase*.css` 共 9 个文件、未按 profile 作用域、大量 `!important`，实际接管了布局行为，把 `app-shell.css` 里的响应式规则静默抵消（导航消失、顶部空白、460px 空块、安全区失效、表头不吸顶……）。Classic 只是在它上面再刷一层颜色。
2. **没有单一的断点 / 尺寸来源。** 文档说三档，代码里有 480 / 640 / 767 / 860 / 1080 / 1081 / 1199 / 1200；顶栏高度有 56 / 58 / 60 / 64 / 66 / 72 六种写死值；"手机"有两种定义（宽度 vs `pointer:coarse`）。
3. **导航模型缺位。** 只有一条顶栏；1080px 以下它坏了；约 8 个页面只能从用户菜单进入，另有 3 个只能靠深链接。手机 / App 没有为触屏设计的导航。

---

## 1. P0 — 立即修复

| ID | 问题 | 位置 | 端 | 现象 | 建议 |
|---|---|---|---|---|---|
| SH-01 | **1080px 以下主导航不可见** | `showcase.css:64-65,333` 强制 `.topbar{height:…!important}`，抵消 `app-shell.css:346-352` 的换行；`.topbar{overflow-x:auto}` 连带 `overflow-y:auto` 把第二行裁掉 | T M App | 实测顶栏 56px、内容 99px，导航在 y=52–91 被裁。用户菜单里没有"回放 / 名人堂 / 首页"，手机用户基本无法换页 | 短期：≤1199 时 `height:auto` + `.tb-content{padding-top:0}`；长期见 §8 底部 Tab |
| WS-01 🔬 | **Android App 内所有导出无反应** | `utils/exportReplayPng.js:105-135`、`api/replay.ts:53-64` 用 `blob:` 链接下载；`MainActivity.kt` 未设 DownloadListener，`NativeBridge.kt` 无存文件方法 | App | Excel / ZIP / PNG / 玩家卡片导出全部静默失败 | 桥接 `saveFile(name, base64/mime)` 或签名 URL 交给 DownloadManager |
| BZ-01 | **批量解析超时后静默失败** | `api/replay.ts:66-139` 同步 `POST /api/replay/processing-jobs`；网关超时 | 全部 | 实测：44 个文件（67.5MB）上传完成后，约 3 分钟返回 **504**，界面**没有任何报错**，直接退回到解析前的状态。6 个文件需要约 80 秒，期间轮询约 30 次 | 立即：捕获 504 / 网络错误并显示可重试的错误；根本：按 ROADMAP 迁到客户端 WASM 解析（见 BZ-02） |
| PB-01 | **战局地图在触屏上吞掉页面滚动且无高度上限** | `BattlePlayback.vue:2282` `touch-action:none`；`BattleMap.vue:327`；`playback-mobile.css` 无高度约束 | T M App | 手机横屏地图 ~800px 高、iPad 横屏 ~1100px；在地图上滑动只会平移地图，控制栏够不着 | 非全屏时按"剩余可用高度"约束舞台；未缩放时 `touch-action:pan-y`；加吸底迷你控制栏 |

---

## 2. 壳层与全局样式（SH）

| ID | 级别 | 问题 | 位置 | 端 | 建议 |
|---|---|---|---|---|---|
| SH-02 | P1 | ≤1080 顶部多出 56–70px 空白：顶栏变 sticky 后 showcase 仍 `!important` 补回 `padding-top` | `showcase.css:72,334` vs `app-shell.css:347-348` | T M | 统一顶栏模型（fixed + padding 或 sticky + 0） |
| SH-03 | P1 | showcase `background:` 简写 `!important` 抹掉语言下拉的箭头图标 | `showcase.css:91-95`、`classic-profile.css:122-124` | 全部 | 改 `background-color` |
| SH-04 | P1 | 用户菜单键盘不可达：Teleport 到 body 末尾，Tab 顺序错乱、打开不聚焦、Esc 不还焦点；`role=menu` 内容不合规 | `UserMenu.vue:31-33,53-60` | D T | 改 disclosure 模式 + 焦点管理 |
| SH-05 | P1 | 管理员用户表表头在手机上下移 56px 盖住首行（sticky 在滚动容器内） | `showcase.css:363/367` `.admin-table th{top:56px!important}` | M | `top:0` |
| SH-06 | P2 | showcase `padding:…!important` 覆盖 `env(safe-area-inset-top)`；≤1080 块也丢了安全区 | `showcase.css:66`、`app-shell.css:56,346` | App | targetSdk 35 强制 edge-to-edge 后顶栏会钻进状态栏 |
| SH-07 | P2 | 1080 成了未记录的第四档；1081–1199 单行固定顶栏右侧溢出被隐藏；多处用旧写法 `max-width:1199px` | `app-shell.css:346`、`showcase-regressions.css:48`、`showcase.css:318` 等 | T | 收敛到三档 range 语法 |
| SH-08 | P2 | 吸顶偏移写死 56/60/64/66/72/119，且 `--topbar-h` 在手机上从不更新 | `showcase.css:172`、`showcase-rankings.css:11,55,97`、`showcase-pages.css:99` 等 | 全部 | 一个 token，按档位或 ResizeObserver 更新 |
| SH-09 | P2 | 用户菜单位置只在打开时计算一次，旋转 / resize / 返回不关闭；无 max-height，管理员菜单（~430px）在横屏手机上溢出底部 | `UserMenu.vue:22-27`、`app-shell.css:119` | M App | 关闭于 resize/路由变化；`max-height:calc(100dvh - …)` |
| SH-10 | P2 | iOS 聚焦缩放兜底 `input{font-size:max(16px,1em)}` 被任何 class 规则击败（如 `.lang-select{13px}`） | `app-shell.css:315` | M | 在手机档对具体类设置 |
| SH-11 | P2 | 触控目标 <36px：`.user-menu-item` 34、`.ui-profile-option` 28、`.tabx` 18、`.chipx` 16；`.lang-select` 72px 宽，俄语被截断；hover 样式未包 `@media(hover:hover)` | `app-shell.css:99,135,154,179,223`、`showcase.css:84,339` | M App | 最小 44px；hover 媒体查询 |
| SH-12 | P2 | 首屏主题错配：`index.html` 内联 token 是蓝色 `#58a6ff` + `#0d1117`，运行时是橙色 + `#090d0f`；无 `theme-color`；App 的系统栏固定深色 | `index.html:10-13`、`themes.xml:5-6` | 全部 App | 内联与 tokens 对齐；加 `<meta name="theme-color">` |
| SH-13 | P2 | 全局错误提示渲染在页面最底部 | `AppShell.vue:44` | 全部 | 移到顶栏下 |
| SH-14 | P2 | 切换视图不重置滚动位置；无 `scroll-padding-top` | `router.js:7` 无 `scrollBehavior` | 全部 | 加 scrollBehavior |
| SH-15 | P2 | 页面可发现性差：个人中心 / 历史 / 技术演进 / 联系 / Android / 名人堂管理 / 用户管理只在用户菜单；赞助只在首页；rating-v2 / playback-qa / agent-armor 无入口；导航是 `<button>` 无 href、无 `aria-current`；logo 用绝对 href 整页刷新 | `UserMenu.vue:64-72`、`AppHeader.vue:47` | 全部 | 见 §8 信息架构 |
| SH-16 | P2 | 全局错误对话框无 `role=dialog`/焦点陷阱/Esc；z-index 200 低于用户菜单 220；`--z-*` token 几乎没人用 | `GlobalErrorDialog.vue`、`tokens.css:104-107` | 全部 | 统一 z-index 刻度 + AppDialog |
| SH-17 | P2 | 多层全屏 `position:fixed` 背景 + 大量 `backdrop-filter`，低端 WebView 滚动掉帧风险 🔬 | `showcase-backgrounds.css:34-95`、`showcase-cohesion.css` | App M | 手机档降级为纯色 / 单层 |
| SH-18 | P3 | `100vh` / `100vw` 替代 `dvh` / `%`（URL 栏、滚动条 1px 溢出） | `AppShell.vue:76`、`index.html:14`、`showcase.css:348` | M | `100dvh`、`100%` |
| SH-19 | P3 | 无 `prefers-reduced-motion`、无打印样式；`<html lang>` 与标题不随语言变化 | 全局 | 全部 | — |
| SH-20 | P3 | 大量死 CSS：`layout-full-workspace` 无人用；`.hof-page` 等 ~12 个类名出现在 ~40 个选择器中却无人使用；`.restoolbar`/`.lb-toolbar` sticky 被后续规则抵消；`.hof-admin` 宽度定义 3 次；`showcase-regressions.css` 注释说"最后加载"实际第 10 个 | 多处 | — | 重构时一并删除 |
| SH-21 | P3 | `app-shell.css:346-353` 与 `:357-373` 近乎重复 | — | — | 合并 |

---

## 3. 回放工作台（WS）

| ID | 级别 | 问题 | 位置 | 端 | 建议 |
|---|---|---|---|---|---|
| WS-02 | P1 | **手机上结果工具栏变成 522px 高的空块**：≤480 时 `.restoolbar` 改为纵向，`flex:1 1 460px` 的 basis 变成高度 | `app-shell.css:338` + `showcase-workspaces.css:113` | M | 纵向时 `flex:none` |
| WS-03 | P1 | 工具栏按钮被截断（"合并汇…"、"下载为…"），横向可滚但无任何提示 | `showcase.css:353` `nowrap!important`、`app-shell.css:178,341` | M | 合并为"导出 ▾"菜单 |
| WS-04 | P1 | 抽屉与列选择器离开数据 Tab 后仍然打开，盖住战局重建；抽屉宽度变量给工作区留下 ~388px 右内边距，甚至泄漏到其他页面；抽屉的 ←/→ 全局监听抢键 | `ReplayWorkspace.vue:307`、`PlayerDetailDrawer.vue:138-142,357-366,497`、`ReplayPage.vue:548` | 全部 | 传 `active`；deactivate 时关闭 |
| WS-05 | P1 | 切到 AI Tab 会销毁数据 / 战局视图（v-if）：丢失编辑的队名（导出会用）、排序、抽屉、播放进度；导出进度卡也消失 | `ReplayWorkspace.vue:222,268` | 全部 | 改 v-show |
| WS-06 | P1 | 同一错误显示两次 | `ReplayWorkspace.vue:296`、`ReplayPage.vue:478` | 全部 | 嵌入模式下隐藏一处 |
| WS-07 | P1 | "选择文件 / 文件夹"键盘不可达（`input{display:none}` + label） | `app-shell.css:230`、`FileUploader.vue:141-196` | D T | 视觉隐藏 input 或真按钮 |
| WS-08 | P1 | 上传错误在暗色主题下显示为亮粉色框（引用了不存在的 `--danger-*` 变量） | `FileUploader.vue:222` | 全部 | 改用 `--status-err-*` |
| WS-09 | P2 | 解析后上传卡仍占 ~450px；compact 模式下标题块不隐藏，`.compactbar` 无任何 CSS | `FileUploader.vue:110-119,188` | 全部 | 折叠为一行批次条 |
| WS-10 | P2 | "共 1 场"换行、当前回放下拉显示完整长文件名且不截断；桌面下拉 `min-width:240px` 无上限；点外部不关闭、无 Esc；100 场时无搜索 | `ReplaySourcePanel.vue:27,41,43,66,77,90` | 全部 | 用"地图 · 胜负 · 时间"代替文件名 + 搜索 |
| WS-11 | P2 | "共 N 场"计入失败 / 重复文件；en/ru 无复数（"1 battles"）；汇总视图仍显示"当前回放 #1" | `ReplaySourcePanel.vue:41`、`useReplaySession.ts:157` | 全部 | — |
| WS-12 | P2 | 手机表格滚动提示渐变被 showcase 覆盖；CW 表格固定昵称（≥126px）+ Rating，冻结 360px 屏幕约 60% | `app-shell.css:313` vs `showcase-workspaces.css:143,203` | M | 手机只冻结昵称；或改卡片视图 |
| WS-13 | P2 | 表头不吸顶（滚动容器无 max-height）；`.restoolbar` sticky 是死代码 | `showcase-workspaces.css:106,139` | D T | — |
| WS-14 | P2 | 768–1080 抽屉非模态、`top:8px`、模态级 z-index，盖住顶栏与表格右侧 380px；列选择器 `top:72/58/48px` + `100vh` | `PlayerDetailDrawer.vue:741-742`、`app-shell.css:266-270,310,333` | T M | 平板上抽屉改为"推开"式分栏 |
| WS-15 | P2 | 抽屉 resize 手柄用 `window.innerWidth`（含滚动条），Windows 上偏 ~15px 🔬 | `PlayerDetailDrawer.vue:100-101` | D | 用 `right:` 定位 |
| WS-16 | P2 | 抽屉：承诺的焦点归还未实现；表格行不可聚焦；手机模态无焦点陷阱 / 滚动锁；触控目标 22–30px | `PlayerDetailDrawer.vue:22,753-787`、`BattleTable.vue:221` | M D | AppDialog / BottomSheet |
| WS-17 | P2 | 导出卡 z-index 180 盖住抽屉（60） | `showcase-regressions.css:59` | D | z-index 刻度 |
| WS-18 | P2 | 关键信息只在 hover tooltip（列说明、雷达说明、禁用原因） | `BattleTable.vue:215`、`AggregateTable.vue:59`、`PlayerRatingRadar.vue:160,199` | M App | 点按展开 |
| WS-19 | P2 | 排序只能鼠标点 `<th>`：无 button / tabindex / `aria-sort` | 四个表格组件 | D | — |
| WS-20 | P2 | 列选择器无遮罩 / 点外部 / Esc 关闭；按钮用字母"v"当箭头 | `ColumnPicker.vue:44`、`ReplayPage.vue:546` | 全部 | — |
| WS-21 | P2 | compact 模式"添加 / 清空"直接抹掉已解析结果，无确认 | `FileUploader.vue:196-200` → `useProcessingJob.ts:234` | 全部 | 确认对话框 |
| WS-22 | P2 | 大批量时所有单场表格同时挂载（v-show），每张带 ResizeObserver | `ReplayPage.vue:593-602` | 全部 | 只渲染当前场 |
| WS-23 | P2 | 汇总 3 张指标卡放进 4 列网格，留一个空位 | `AggregateTable.vue:51`、`app-shell.css:183` | D T | — |
| WS-24 | P2 | 玩家卡片 PNG 混用主题色与写死的深色，Classic 下对比度差；失败只打 console | `PlayerDetailDrawer.vue:459,466,852-859` | 全部 | — |
| WS-25 | P2 | 两个 h1；kicker 只有英文；AI Tab 只有一行"维护中"、无引导，"清空"仍可用 | `ReplayWorkspaceHeader.vue:14-15`、`FileUploader.vue:112`、`ReplayWorkspace.vue:222-224` | 全部 | 空状态设计 |
| WS-26 | P2 | App 内显示"选择文件夹"，但 WebView 文件选择器无法选文件夹；`accept=".wotbreplay"` 可能在 Android 上把文件全部置灰 🔬 | `FileUploader.vue:145,177`、`MainActivity.kt:218` | App | App 内隐藏文件夹入口；走原生导入桥 |
| WS-27 | P3 | 大量写死深色靠 Classic `!important` 修补 | `ReplayProcessingPanel.vue:153-210`、`ReplayTaskCard.vue:121-167` | — | token 化 |
| WS-28 | P3 | 死代码：`AiReviewPanel`、`AnalysisResultPanel` 不可达；`ReplayPage` 非嵌入分支 | — | — | 删除 |
| WS-29 | P3 | 下载 URL 点击后立即 revoke（另一处等 150ms）；`RemoveConfirmModal` 无 dialog 语义；数字无千分位；非 CW 表格吸附"被拖到第一列"的任意列 | `api/replay.ts:63` 等 | — | — |

---

## 4. 战局重建（PB）

> 历史快照：本节的「位置」列记录的是 2026-09-30 当时的文件与行号。`playback-tablet.css` /
> `playback-pc.css` / `playback-mobile-fullscreen.css` / `playback-fullscreen-form-contract.css`
> 与 `playbackSafeInsets.js` 已在 Playback UI 收敛 PR 中删除（规则合并进
> `playback-workspace.css` / `playback-mobile.css`），行号也不再对应；结论与建议仍然有效。

| ID | 级别 | 问题 | 位置 | 端 | 建议 |
|---|---|---|---|---|---|
| PB-02 | P1 | 平板（790×914 实测）：地图 ~720px 高，播放控制栏被挤出首屏；原因是 `(100dvh - 210px)` 假设回放从视口顶部开始，但上方还有 ~450px 的上传卡 | `playback-tablet.css:167-171`（已删）、`ReplayWorkspace.vue:278-296` | T | 按实际偏移测量；折叠上传卡 |
| PB-03 | P1 | 平板上玩家列表 / 事件面板不可见：左栏默认 `display:none`，只能通过控制栏里的 ☰ 打开，而 ☰ 又在首屏外 | `playback-shared.css:34` | T | 可见的侧栏或底部 sheet |
| PB-04 | P1 | 滚轮在地图上始终被捕获为缩放（`@wheel.prevent`），平板上地图占满视口时无法滚到控制栏 | `BattleMap.vue:194` | D T | Ctrl/⌘+滚轮或聚焦后才缩放 |
| PB-05 | P1 | 隐藏的回放仍响应快捷键：在数据 Tab 或其他路由按空格 / 方向键会切换 / 步进隐藏的回放并 `preventDefault`，页面无法用空格滚动；播放循环隐藏时仍在跑 | `BattlePlayback.vue:1237,1351-1362`；`active` prop 未下传 | 全部 | 传 `active`，onDeactivated 解绑 |
| PB-06 | P1 | 手机全屏拖动时间轴超过 2.5s 控制栏自动隐藏（只有 click 重置计时器） | `PlaybackMobileOverlay.vue:6,36-43`、`PlaybackTimeline.vue:15` | M App | pointer 按下 / 暂停时不隐藏 |
| PB-07 | P1 | 设备分类：任何 <1200 的触屏都算 mobile（iPad / Android 平板永远拿不到 tablet 形态）；≥1200 的触屏（iPad Pro 1366、触屏笔记本）拿 PC 形态，按钮 30px、分栏拖柄仅 hover 可见 | `BattlePlayback.vue:523-539,1223-1235`、`PlaybackMobileOverlay.vue:7` | T | 布局（宽度 / 容器）与输入（pointer）拆成两个维度 |
| PB-08 | P2 | 车辆标签在出生点重叠：只能纵向 4 道、最多 24px，从不隐藏 | `utils/labelLayout.js:12,32`、`playback-overlap-ux.css:1-3` | 全部 | 横向错位 + 引线；低缩放合并成"+N" |
| PB-09 | P2 | 标记尺寸三处冲突（CSS `!important` 30/24px、`BattleMap.vue` 25px、内联 renderBox），碰撞计算与实际渲染不一致 | `playback-overlap-ux.css:5-27`、`BattleMap.vue:375`、`BattlePlayback.vue:1574` | 全部 | 单一来源 |
| PB-10 | P2 | 每帧强制布局：computed 内 `querySelector`+`offsetWidth`；碰撞搜索每 tick 重跑 | `BattlePlayback.vue:1536,1829-1831` | 全部 | resize 时测量一次；节流 |
| PB-11 | P2 | 桌面拖出的侧栏宽度（≤560px）以内联样式覆盖平板 / 手机档宽度 | `BattlePlayback.vue:1942-1943` | T M | 按形态分别存储 |
| PB-12 | P2 | 2.5D 画布每次缩放都重建渲染缓冲（缩放 4× @ DPR2 分配巨大 backbuffer） | `BattlePlayback.vue:738-741`、`BattleMap3D.vue` | M App | 画布固定视口大小，缩放走相机 |
| PB-13 | P2 | App 全屏一律强制横屏，平板 / PC 形态也一样，竖屏兜底样式永远不生效；使用废弃的 `systemUiVisibility`；无 `webglcontextlost` 处理 | `MainActivity.kt:360` | App | 由网页通过桥请求方向 |
| PB-14 | P2 | 3D 管理页：只监听 window resize、DPR 不封顶 + `preserveDrawingBuffer`；`100vh - 67px` 写死；240px 队伍面板在手机上盖住场景；空格在按钮聚焦时触发两次 | `playbackScene.js:188,1336`、`tankViewer.js:3026`、`AgentReplay3D.vue:140,192,221`、`AgentArmorView.vue:135` | M | — |
| PB-15 | P2 | 侧栏 `position:fixed` 用 `--z-modal`(200)，与应用模态同级 | `playback-mobile.css:47-62,124-139` | M | 回放内部 z 刻度 |
| PB-16 | P3 | 游离断点：`max-width:767px`（文档禁止）、640、860 对；多个组件内 scoped `width<768` 与形态类打架 | `BattlePlaybackPanel.vue:407`、`AgentTankopedia.vue:333`、`playback-tablet.css:112,167`（已删） | — | — |
| PB-17 | P3 | 死 / 重复 CSS：`playback-mobile.css:27-62,79-110` 被 fullscreen 文件完全覆盖；PC 用 `100vh`、平板用 `100dvh` | — | — | — |
| PB-18 | P3 | 时间轴 `drag-start` 触发三次；原生 thumb 未放大；手机按钮 36px（建议 44–48） | `PlaybackTimeline.vue:16` | M | — |
| PB-19 | P3 | 键盘：按钮聚焦时方向键无效；无倍速 / 全屏 / Esc 快捷键；拖动中卸载会泄漏 window 监听 | `BattlePlayback.vue:246-248,1354` | D | — |

**拆分建议**（`BattlePlayback.vue` 2435 行）：`usePlaybackClock` · `usePlaybackForm`（与 Overlay 共享）· `useMapCamera` · `useAnnotations` · 瞬时反馈 · 碰撞与标签 · 命中与选择 · 名单统计；模板拆为 `PlaybackRail` / `PlaybackStage` / `PlaybackDetails`。

---

## 5. 其他页面（PG）与性能（PF）

| ID | 级别 | 问题 | 位置 | 端 | 建议 |
|---|---|---|---|---|---|
| PG-01 | P1 | 首页"最高伤害记录"卡盖住"战局重建""下载 Android 版"两个按钮（实测按钮底 508/566px，卡片起于 466px） | `HomePage.vue:275` | M | 手机上卡片回到文档流 |
| PF-01 | P1 | **首页约 14 MB**：英雄图 2.2MB PNG；5 张卡片图各 1.4–2.2MB（1536–1672px，只显示 112–132px 高）；logo 739KB（显示 28–62px）；卡片 `<img>` 无 lazy / 尺寸 | `HomePage.vue:62-81`、`showcase-backgrounds-v3.css:40-117` | 全部，手机流量最痛 | WebP/AVIF ~800px + `srcset` + lazy；128px logo |
| PF-02 | P1 | **主包 1.3MB 同步加载**：所有页面静态 import（含管理页、markdown-it、DOMPurify、历史 .md）；实测 DOMContentLoaded 0.3s，应用挂载 ~3.1s | `app/viewRegistry.js:1-11` | 全部 | 非首页 `defineAsyncComponent` |
| PG-02 | P1 | 首页链接是普通 `<a href="/?view=…">`，每次点击整页重载并重跑 Keycloak check-sso | `HomePage.vue:38-41,61-73,87` | 全部 | RouterLink |
| PG-03 | P1 | 多处未登录直接跳 Keycloak、无任何说明（个人中心、Android 下载、名人堂管理、rating-v2、playback-qa、名人堂上传 / 下载）；首页"下载 Android"对匿名用户直接跳登录 | `ProfilePage.vue:50`、`AndroidDownloadPage.vue:47`、`HoFAdminPage.vue:177`、`HoFPage.vue:29` 等 6 处 | 全部 | 统一 AuthGate：说明卡 + 登录按钮 |
| PG-04 | P1 | 个人中心错误"重试"实际调用登录，已登录用户点了没反应或被重定向；加载要串行等 4 步，失败也显示"正在初始化登录…" | `ProfilePage.vue:40-73,245,434` | 全部 | 调 `loadProfile()`；分状态文案 |
| PG-05 | P2 | 名人堂手机端：筛选区 363px 占满首屏（表格起于 776/812px）；10 列 834px 宽表格；下载按钮在最右侧滚动区外；车型链接只有 15px 高；手机上约 390 个文字节点 <12px | `showcase-rankings.css:203-219`、`HoFPage.vue:1071,1488` | M | 筛选收进 sheet + chips；卡片列表 |
| PG-06 | P2 | 名人堂表头不吸顶（滚动容器无 max-height）；吸顶 Tab 用 `top:66/64px`；平板 / 桌面滚动时吸顶 Tab 盖住表格行 | `showcase-rankings.css:10,75,98,181` | D T | — |
| PG-07 | P2 | 名人堂翻页不回到表格顶部；加载时整表替换为一行文字导致跳动；手机默认 50 条 | `HoFPage.vue:157,1050` | 全部 | 保留旧行变暗；骨架屏 |
| PG-08 | P2 | 名人堂 Tab / 筛选 / 页码不进 URL，返回 / 分享 / 刷新全丢；百场 / 三环每次切 Tab 重新请求 | `HoFPage.vue:237-248` | 全部 | 同步到 query |
| PG-09 | P2 | 对话框：只有名人堂上传弹窗有 `role=dialog`；其余无 aria-modal / 焦点陷阱 / Esc；`max-height:85vh` 无 dvh / 安全区；使用 `window.confirm`（WebView 中样式简陋并显示域名） | `GlobalErrorDialog.vue`、`HoFPage.vue:431,572,1304,1379`、`ProfilePage.vue:191,222` | 全部 App | AppDialog |
| PG-10 | P2 | 管理页手机端：操作列（查看 / 删除）在横向滚动区外；复选框 13×13；名人堂管理 Tab 被裁；emoji 按钮无 `aria-label` | `AdminUsersPage`、`HoFAdminPage.vue:1107` | M | — |
| PG-11 | P2 | 表单：名人堂管理筛选只有 placeholder；个人中心 label 无 `for`；账号 ID 用 `type=number`（滚轮会改值） | `HoFAdminPage.vue:1004-1006`、`ProfilePage.vue:272` | 全部 | `inputmode=numeric` |
| PG-12 | P2 | 固定宽度绕开 gutter token：`calc(100vw - 40/28/16px)`（滚动条 1px 溢出）；赞助页手机 20px 边距与其他页 8px 不一致 | `HomePage.vue:109,262,272`、`SponsorPage.vue:161`、`showcase-regressions.css:7` | 全部 | `100%` + `padding-inline: var(--gutter)` |
| PG-13 | P2 | 名人堂 `accept=".wotbreplay"` 在 Android WebView 可能置灰全部文件 🔬 | `HoFPage.vue:981,1350,1437` | App | 同 WS-26 |
| PG-14 | P2 | 历史页手机端 21,500px（约 26 屏）、技术演进 11,800px，无目录 / 锚点 | 实测 | M | 目录 + 折叠；技术演进是否应公开 |
| PF-03 | P2 | 页面英雄背景图每张 1.7–2.2MB | `showcase-backgrounds*.css` | M App | 同 PF-01 |
| PG-15 | P3 | 首页"最近分析"对有历史的用户也永远显示空状态 | `HomePage.vue:84-88` | 全部 | 接数据或移除 |
| PG-16 | P3 | `<html lang>`、`document.title` 固定中文；历史 / 技术演进仅中文；个人中心暴露"Keycloak / auth.wotbtools.com" | `index.html:2,8`、`ProfilePage.vue:248,427` | 全部 | — |
| PG-17 | P3 | 语言下拉箭头对比度约 2:1；placeholder 对比度临界 | `app-shell.css` `.lang-select` | 全部 | — |
| PG-18 | P3 | hover-only 提示（车型名可点筛选）；App 内也显示 ICP 备案页脚 | `HoFPage.vue:1071` | M App | App 内隐藏页脚 |
| PG-19 | P3 | 名人堂上传按钮只有 30×26 等多处触控目标不足 | `HoFPage.vue:1488` 等 | M | — |
| PG-20 | P3 | 管理员角色判断在 4 处重复实现 | `useAuth`、`UserMenu.vue`、`RatingV2AdminPage.vue`、`PlaybackQaPage.vue` | — | 单一来源 |

---

## 6. 三维新功能（3D）

> 范围：三维回放 `agent-replay`、坦克百科 `agent-tankopedia`、装甲查看器 `agent-armor`、射击复现 `agent-shots`、战局重建里的 2.5D 地图鸟瞰、`playback-qa`。
> 目前全部**仅管理员可见**（`navigation.js:25-27`），尚无公开计划，但代码注释写着"先小范围放量"。
> 以下问题都已在线上实测（真实回放 `20260822_1446_…Maus`），并结合代码核对。

### 6.1 数据与业务正确性（上线前必须解决）

| ID | 级别 | 问题 | 现象（实测） | 位置 / 建议 |
|---|---|---|---|---|
| 3D-01 | P1 | **三维回放名单缺人、名字未解析** | 队伍 1 共 10 人，8 人显示"Unknown"，录像者本人（★）也是；队伍 2 只列出 4 人；车辆显示 `tank_6929`，地图显示 `map_43` | Agent 契约里 `parsePlayback` 的 `vehicles[]` 和 `parseResult` 的 `players[]` 都带花名册（昵称、tank_id、队伍），先核实是消费侧没有联表还是上游缺失；车名、地图名按 `tank_id` / `map_id` 走 `common/` 的 tankopedia 与 map_names。**不引入服务端名册**（解析权威为上游 Agent，见 #410） |
| 3D-02 | P1 | **射击复现整队玩家显示为 `eid:280151379`** | 一队 7 人全部显示 entity id，射击者下拉框里也一样 | 同 3D-01 |
| 3D-03 | P1 | **射击统计口径错误** | "穿透率 192%（102/53）"：击穿数比命中数还多；"跳弹 / HE 0 / 0" 可疑 | `AgentShots.vue` 统计计算；分母应为命中数，并核对击穿、未穿、跳弹的分类 |
| 3D-04 | P1 | 三维回放比分不更新 | 播到 128s 时已有多次击穿和击杀，比分仍是 0 : 0 | `playbackScene.js` 比分来源 |
| 3D-05 | P2 | 大多数射击没有目标，因此无法进入 3D 复现 | 目标列多数显示"—"，只有少数行有"3D"按钮 | 命中归属算法；没有目标时应说明原因 |
| 3D-06 | P2 | 作者回退弹种显示为"##3" | — | `AgentShots.vue:286,438` 重复加了 `#` |
| 3D-07 | P2 | 装甲详情缺少数据 | 坦克百科详情里前进、倒车极速显示"- km/h" | 数据源字段映射 |

### 6.2 流程与导航

| ID | 级别 | 问题 | 位置 | 建议 |
|---|---|---|---|---|
| 3D-08 | P1 | **同一场回放要上传三次**：工作台（数据 / 2D）、三维回放、射击复现各自选一次本地文件，彼此不共享、也没有互相跳转 | `scene/replaySource.js`、`ReplayWorkspace.vue` | 做成"回放中心"：上传一次，同一会话里切换 数据 / 2D / 3D / 射击 |
| 3D-09 | P1 | **射击复现和坦克百科都用 `window.open` 弹出小窗**：弹窗被拦截时静默无反应（实测）；Android WebView 里新窗口行为不可控；打开后没有返回路径 | `AgentShots.vue:340-350`、`AgentTankopedia.vue:116` | 在当前页用路由打开，保留返回；或做成页内分栏 |
| 3D-10 | P2 | 射击数据存在 localStorage，30 分钟过期；过期或分享出去的链接只显示"数据缺失"，没有返回入口 | `scene/agentData.js:107-146` | 死路页面给出"重新选择回放"按钮 |
| 3D-11 | P2 | 装甲查看器里切换坦克不会更新 URL；直接打开 `?view=agent-armor` 默认显示 T-34 | `AgentArmorView.vue:18` | 同步 URL |
| 3D-12 | P2 | 非管理员访问 `?view=agent-*` 被静默重定向，没有任何提示 | `navigation.js:66` | 显示无权限说明 |
| 3D-13 | P2 | 2.5D 地图鸟瞰的资源被生产构建排除，线上永远只有 2D；资源缺失或出错时什么都不显示 | `vite.config.js:26-32`、`BattleMap3D.vue:375-377` | 明确功能开关与降级提示 |

### 6.3 界面与交互

| ID | 级别 | 问题 | 位置 | 端 | 建议 |
|---|---|---|---|---|---|
| 3D-14 | P1 | **装甲查看器完全没有响应式**（没有任何 media query，`<style>` 也没有 scoped）；**右键拖动转炮塔在触屏上做不到** | `AgentArmorView.vue:97`、`tankViewer.js:3147` | T M App | 触屏用双指或专用滑杆；面板改为可收起 |
| 3D-15 | P1 | 三维回放在手机上：两块 240px 名单面板互相重叠，几乎盖住整个场景 | `AgentReplay3D.vue:221` | M | 名单收进 sheet，只保留比分和击杀流 |
| 3D-16 | P1 | **中英混杂、直接显示原始值**：装甲查看器（Equip / Shooter / Target / Shell / Show Collision / PENETRATION / Eff / Pen / Remain，"TypeheavyTank"、"china"）；坦克百科（China、Heavy、Tier 1）；选车弹窗（"Target — Select Tank"、"european" 与列表里的"EU"不一致）；"击穿KILL" | `AgentArmorView.vue`、`scene/tankMeta.js:42-47`、`tankViewer.js` | 全部 | 统一接入 i18n，枚举值做翻译映射 |
| 3D-17 | P2 | 页面标题都带内部后缀"（Agent）"；同一功能在不同地方叫法不同："3D 装甲检视器"与"装甲查看器"；"三维回放"与"战局回放"与"战斗回放" | 各页面标题、`zh.json` | 全部 | 见 §7.3 命名表 |
| 3D-18 | P2 | 坦克百科：735 辆车全部渲染，没有虚拟滚动或分页，手机上页面约 **167,000px** 高；筛选只能单选；卡片不能用键盘聚焦 | `AgentTankopedia.vue:246-250,277` | M | 虚拟列表；多选 chips |
| 3D-19 | P2 | 选车弹窗按 Esc 关不掉；手机上"×"被挤到第二行 | `AgentArmorView.vue` | M D | AppDialog |
| 3D-20 | P2 | 装甲查看器默认视角正对炮口，看不到车体装甲；热力图没有图例；射击距离固定 4m，没有调节控件；打开热力图后页面跳回顶部 | `tankViewer.js` | 全部 | 默认斜 30° 视角；加图例和距离滑杆 |
| 3D-21 | P2 | 射击复现的世界模式：目标车只有很小一个点，默认镜头没有对准；结果卡片盖住弹道；只有网格没有地图；不显示射击者、时间和目标；没有上一发 / 下一发；调试按钮（"调试标注"）暴露在界面上 | `tankViewer.js:2406` 等 | 全部 | 自动对准命中点；加射击导航 |
| 3D-22 | P2 | 时间显示两套格式：顶部是倒计时 `06:57`，进度条是 `13.0s / 278.0s`；倍速档位和 2D 不一致（0.5–16x 与 0.5–4x）；三维回放没有方向键快进 | `AgentReplay3D.vue:129-160` | 全部 | 统一播放控件组件 |
| 3D-23 | P2 | 加载只有一行文字，没有进度；不提前检测 WebGL，失败时显示原始英文报错；中途改画质会弹原生 `confirm()` 并刷新整页 | `AgentReplay3D.vue:89,169`、`playbackScene.js:1445,1453` | 全部 | 进度条 + WebGL 预检 + 无刷新切换 |
| 3D-24 | P2 | 渲染开销：DPR 不设上限并开启 `preserveDrawingBuffer`；只监听 window resize；同一页面创建两个 WebGL 上下文 | `tankViewer.js:3026`、`playbackScene.js:188` | M App | DPR 上限 2；改用 ResizeObserver |
| 3D-25 | P3 | 射击复现的 ⚠ 质量说明只有 hover 提示；表格行不能用键盘聚焦；最右侧"3D"按钮被截断 | `AgentShots.vue:430` | M | — |

---

## 7. 业务流程与 UI/UX 审计

> 方法：按用户任务走通核心流程（实测），对照可用性原则：可见性、一致性、反馈、防错、识别优于回忆、信息层级。

### 7.1 核心任务流程

| # | 任务 | 当前流程与卡点 | 严重度 | 建议 |
|---|---|---|---|---|
| F1 | **新访客第一次使用** | 首页 → 点"回放解析" → **直接跳到 Keycloak 登录页，没有任何说明**（PG-03）→ 登录后回到空工作台。首页"最近分析"永远是空的（PG-15）。首页不说明为什么要登录，也不说明登录后能得到什么 | P1 | 允许匿名解析（文件本来就在本地解析），需要保存或提交时再登录；否则用 AuthGate 说明原因 |
| F2 | **上传并看懂一场战斗** | 上传 → 解析 → 结果区。上传卡不会折叠（WS-09）；工具栏把 7 个同等权重的按钮排在一起（汇总、单场、算法说明、选择列、合并汇总、每场导出、下载 PNG），没有主次；首屏显示"争霸占点：占点得分 Earned 30% + 占领分 Seized 70%（实验性口径…）"这类实现细节 | P1 | 结果页首屏回答三个问题：谁赢了、谁打得最好、我打得怎么样。算法口径收进"ⓘ" |
| F3 | **看自己打得怎么样** | 需要在 14 人的表格里自己找名字；录像者没有高亮也没有置顶；个人中心的"绑定游戏账号"和解析结果没有关联 | P1 | 绑定账号后自动高亮"我"，并提供"我的表现"卡片 |
| F4 | **批量分析一个赛事（如 23 场冠军赛）** | 场次选择器列的是文件名；没有按对手、地图、胜负分组；汇总表不能按场次或地图筛选；"共 N 场"把失败的文件也算进去 | P2 | 场次列表显示"地图 · 胜负 · 时间"，支持筛选和对手分组 |
| F5 | **回看战局** | 同一需求有三个入口、三种控件、三次上传（3D-08）；从数据表不能跳到"这个玩家在 2D/3D 里的这一刻"；从射击复现不能跳回回放的对应时刻 | P1 | 回放中心：一次上传，数据 ⇄ 2D ⇄ 3D ⇄ 射击通过时间和玩家互相联动 |
| F6 | **上名人堂** | 必须登录（跳转没有说明）；上传弹窗和工作台的上传是两套；提交后"我的记录"只能去名人堂里搜，个人中心看不到 | P2 | 工作台结果页直接显示"此场可提交名人堂"；个人中心加"我的记录" |
| F7 | **导出和分享** | App 里所有导出都失败（WS-01）；Web 上 3 种导出按钮平铺；没有"分享链接" | P1 | 统一"导出 ▾"；分享图片走系统分享面板 |
| F8 | **手机和 App 日常使用** | 导航不可见（SH-01）→ 只能靠首页卡片跳转；每次点击都整页刷新（PG-02）；首页 14MB（PF-01） | P0 | 底部 Tab + 路由内跳转 + 轻量首页 |

### 7.1a 业务功能实测记录（BZ）

> 管理员账号，平板宽度约 790px 为主；赛果解析用 6 场 CHRD 对 -TOP- 的真实系列赛。

**解析架构 / 旧代码**

| ID | 级别 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| BZ-02 | P1 | **解析迁移只完成了一半**：只有 3D 功能（`scene/replaySource.js`）走本地 WASM；主工作台还在上传文件到 `/api/replay/processing-jobs` 并轮询，2D 回放调 `/api/replay/battle-playback-v2`、`/map-overview`，导出调 `/api/replay/export-jobs`。同一场回放在前端存在两套解析结果，这就是 3D-01/02 的名称缺失与 2D 不一致的根源 | `api/replay.ts`、`api/replay-capabilities.ts`；`docs/ROADMAP.md:7` 写的是"客户端 parity 全部通过前服务端链路继续服务生产" | **已决策（2026-10-01）：解析权威为上游 Agent Rust Core**（见 #410）。按能力逐项迁移：先证明 parity，再把工作台 / 战局回放 / 导出 / HoF 切到 `parseResult` / `parsePlayback`，随后退役 `processing-jobs`、`export-jobs`、上传进度、`useProcessingJob.ts` 及对应 OpenAPI 契约 |
| BZ-03 | P2 | "本页不保存回放文件"让用户以为是纯本地处理，实际上会把全部文件（包括重复的）上传到服务器 | 实测 67.5MB 上传 | 迁移完成前如实说明；上传前先去重 |
| BZ-04 | P2 | 重复文件既不在选择时去重也不提示：选了两次文件夹后显示"共 44 场"，其实只有 23 场 | 实测 | 选择时按内容哈希去重 |
| BZ-05 | P2 | 每次页面加载都会 `PUT /api/users/profile`（本次会话 5 次以上）；首页记录卡片重复请求 `/api/hof?size=1` | 网络面板 | 登录同步只在 token 变化时执行 |

**赛果解析**

| ID | 级别 | 问题 | 建议 |
|---|---|---|---|
| BZ-06 | P1 | **赛事结果缺失**：6 场 CHRD 对 -TOP- 的系列赛（4:2），页面上没有系列赛比分，也没有战队汇总；15 名选手不分队伍混在一张表里 | 汇总页顶部显示"系列赛比分 + 每场胜负条"，下面是两队对比，然后才是选手表（按队分组） |
| BZ-07 | P2 | 汇总表 20 列，很多值是"231 / 365 · 63.3%"三段式；"观察均值 / 换血效率平均 / 格挡评分平均 / 存活/互换平均"等列没有解释；默认按场均伤害排序，而视觉重点是第二列"总 Rating" | 默认显示 6–8 个核心列，其余收进"更多指标"；列头加 ⓘ；按 Rating 排序 |
| BZ-08 | P2 | 同一指标多个名字：表格叫"总 Rating"，抽屉叫"评级"，还有"League Rating 汇总"；雷达图上的"RC"没有解释；"全局平均 = 75"和"超过 100 = 显著高于"两个基准并列 | 术语表统一 |
| BZ-09 | P2 | 汇总视图下仍显示"当前回放：…#1"；在战局回放 Tab 里，上传卡片的标签写着"单文件"，实际加载了 6 个文件；"合并汇总"按钮的激活 / 禁用状态看不出来 | — |
| BZ-10 | P2 | 玩家抽屉里看不到逐场明细（哪一场打得好或差），也无法从抽屉跳到该玩家在回放中的片段 | 抽屉加"逐场"标签页和"在回放中查看" |

**2D 战局回放**

| ID | 级别 | 问题 | 建议 |
|---|---|---|---|
| BZ-11 | P1 | 在平板上，地图从 y≈790 才开始，第一屏看不到地图 | 回放 Tab 下折叠上传卡片（WS-09） |
| BZ-12 | P2 | ☰ 打开的工具栏里又有一份"全屏 / 重置视图"，和底部控制栏重复 | 一个操作只放一处 |
| BZ-13 | P2 | 队伍阵容 / 事件面板在地图**上方**展开：左侧约 220px 的空盒子里只有"← 返回"；"本方 / 敌方"被挤成竖排；"伤害"两个字折成两行；事件列表只能显示 5 条 | 面板放到地图侧边（桌面 / 平板横屏）或底部 sheet（竖屏） |
| ✅ | — | 点击事件可以跳到对应时间点（01:58 → 02:15）；车辆名称显示正常 | 保留，并推广到 3D |

**名人堂**

| ID | 级别 | 问题 | 建议 |
|---|---|---|---|
| BZ-14 | P1 | 平板上第一屏一行数据都没有：Tab 栏、标题卡、提交按钮和 7 个筛选项占满了整屏 | 见 §8.5 |
| BZ-15 | P2 | 百场、三环两个榜都是空的（"暂无认证…纪录"），却和单场榜同样显眼；空状态没有告诉用户怎样才能上榜 | 空状态写明"如何上榜"并放提交按钮；或者等有数据后再露出这两个 Tab |
| BZ-16 | P2 | 三个 Tab 用了三种提交入口和三种上传样式：单场是顶部橙色按钮加拖放框；百场、三环是筛选区里的灰色按钮，弹窗里用原生英文"Choose File / No file chosen"；同一个提交弹窗在页面里渲染了两份 | 统一 Uploader 组件；按钮位置一致 |
| BZ-17 | P2 | 选车下拉框：109 项原生 select 不能搜索，还有一项显示为 `#4657`；版本列显示原始值（`10.6.0_apple`、`11.20.0_china`）；下载列有的是按钮、有的是"—"，不说明原因；翻页只有"上一页 / 下一页"，看不到总数和页码 | 可搜索的选车器；版本做格式化；显示总数 |
| BZ-18 | P2 | 提交弹窗没有说明上榜规则（例如只统计录像者本人的伤害）；百场表单提示"须高于当前记录"，但当前根本没有记录 | 在弹窗里写明规则和当前门槛 |

**AI 复盘**

| ID | 级别 | 问题 | 建议 |
|---|---|---|---|
| BZ-19 | P1 | **前端写死关闭**：只要切到 AI Tab 就直接渲染"维护中"（`ReplayWorkspace.vue:222`），没有功能开关，也不区分管理员；`AiReviewPanel.vue` 不可达，后端 `/api/ai/reviews` 依然存在。线上无法测试，也无法灰度 | 加功能开关（管理员先开）；维护期间隐藏这个 Tab，或做成带说明的空状态，而不是保留一个死 Tab |

### 7.2 可用性原则逐项检查

| 原则 | 问题 | 示例 |
|---|---|---|
| **系统状态可见** | 大量静默失败：弹窗被拦截、App 导出、2.5D 资源缺失、PNG 导出失败只打 console、非管理员被静默重定向 | 3D-09、WS-01、3D-13、WS-24、3D-12 |
| **一致性** | 同一实体有多种显示方式：2D 显示玩家昵称，3D 显示 `Unknown`，射击复现显示 `eid:…`；车辆有时是名称，有时是 `tank_6929`；国籍有 EU、european、china、China 四种写法 | 3D-01/02/16 |
| **一致性（组件）** | 两套坦克卡片、两套播放控件（倍速和时间格式不同）、约 10 种临时弹窗、四套表格样式 | 3D-19/22、PG-09 |
| **识别优于回忆** | 场次用文件名区分；右键拖动、滚轮缩放这些操作只有一行英文提示；热力图颜色没有图例 | WS-10、3D-14/20 |
| **防错** | "添加 / 清空"会直接抹掉已解析的结果；中途改画质会刷新整页；长按拖动时间轴控件会消失 | WS-21、3D-23、PB-06 |
| **信息层级** | 每页开头都有 kicker + h1 + 说明 + 标签块（工作台约 230px），真正的结果被推到首屏以外；高密度数据叠在装饰性背景图上，可读性变差 | WS-09、SH-17 |
| **术语** | 首屏直接出现实现细节："WebAssembly""滤波渲染位姿""配置的资产源（静态资产包）""Earned 30% + Seized 70%""（Agent）" | 各页面说明文案 |
| **可达性** | 键盘几乎走不通：用户菜单、文件选择、表格排序、表格行、坦克卡片、弹窗焦点都有问题 | SH-04、WS-07/16/19、3D-18 |

### 7.3 命名统一建议

| 现在的叫法（出现位置） | 建议统一为 |
|---|---|
| 回放解析（导航）/ 回放工作台（页面标题）/ 回放数据提取（卡片）/ 数据解析（Tab）/ 批量解析（kicker） | **回放**（导航）· **数据**（Tab） |
| 战局重建（首页）/ 战局回放（Tab）/ 战斗回放（子 Tab）/ 地图鸟瞰 | **2D 回放** |
| 三维回放 / 三维回放（Agent） | **3D 回放**（与 2D 同属"回放"下的一个模式） |
| 射击复现 / 射击复现（Agent） | **射击分析** |
| 3D 装甲检视器 / 装甲查看器 | **装甲查看器** |
| 坦克百科（Agent） | **坦克百科** |
| 名人堂（kicker）+ 名人堂（h1） | 只保留 h1 |

---

## 8. 新布局方案（不受现有布局约束）

### 8.1 信息架构

```
主导航（4 个）
├─ 首页        仅 Web；App 内启动直接进「回放」
├─ 回放        回放中心：上传一次，同一会话切换
│              数据 · 2D 回放 · 3D 回放* · 射击分析* · AI 复盘
├─ 名人堂      单场 / 百场 / 三环
└─ 我的        账号与绑定、我的表现、我的名人堂记录、语言、界面风格、
               Android 下载(仅 Web)、赞助、联系、反馈、关于(历史 / 技术演进)
               ├─ 工具：坦克百科* → 装甲查看器*
               └─ 管理（按角色显示）：用户管理、名人堂管理、Rating V2、
                  Playback QA、Rating 文档
* = 目前仅管理员可见，按功能开关逐步开放；未开放时不显示入口
```

- 3D 回放和射击分析不再是独立页面，而是回放中心里的**模式**，和 2D 共用同一份解析结果与播放控件。
- 坦克百科 → 装甲查看器在同一窗口内用路由打开，不再弹出新窗口。
- 所有导航改为真正的 `RouterLink`，带 `aria-current`。

### 8.2 每档的应用外壳

| | 桌面 ≥1200 | 平板 768–1199 | 手机 <768 / App |
|---|---|---|---|
| 顶栏 | 单行 56px：logo · 4 个主导航 · 右侧头像菜单（语言 / 风格收进去） | 单行 56px：logo · 主导航（图标+文字）· 头像 | 48px 页面标题栏：返回 / 标题 / 1–2 个上下文操作 |
| 主导航 | 顶栏 | 顶栏 | **底部 Tab 栏** 4 项，含 `safe-area-inset-bottom` |
| 二级导航 | 页内分段控件 | 页内分段控件 | 标题栏下方分段控件（可横滑） |
| 详情 | 右侧常驻分栏 | 右侧可收起分栏（推开内容，不覆盖） | 全屏页或底部 sheet |
| 筛选 | 行内工具栏 | 行内工具栏（可折叠） | "筛选"按钮 → sheet，已选项显示为 chips |

顶栏高度只有一个来源：`--topbar-h`，每档一个值。所有吸顶偏移、背景 `top`、内容区 padding 都读取它。

### 8.3 回放工作台

**三种状态**

1. **空**：完整上传区。
2. **处理中**：进度面板。
3. **就绪**：上传区折叠成一行批次条（`23 场已解析 · 1 失败 · 添加 · 清空`），剩下的空间全部给结果。

**顶部控件**

- 用一个分段控件切换 `汇总 | 单场`。
- 只有在"单场"模式下才出现场次选择器。它是可搜索的列表，每项显示"地图 · 胜负 · 时间"，而不是文件名。

**各端布局**

- **桌面**：三栏布局。左侧场次列表（可收起）· 中间表格 · 右侧玩家详情常驻。
- **平板**：两栏布局。表格 + 可收起的详情栏，场次列表放进下拉。
- **手机**：
  - 默认显示**玩家卡片列表**：排名、昵称、Rating、2–3 个关键数据。
  - 点卡片进入全屏详情，左右滑动切换玩家。
  - 需要完整表格时切到"表格模式"，只冻结昵称列。

**导出**

- 合并成一个 `导出 ▾` 菜单。
- 手机上放在吸底操作栏，导出进度也在操作栏里显示，不再浮动。

**浮层**

- 抽屉、列选择器、弹窗都绑定到当前 Tab。
- 切换 Tab 或离开页面时自动关闭。
- 使用统一的 z-index 刻度。

### 8.4 战局重建

**尺寸与方向规则**

- **地图优先**：舞台高度 = 视口高度 − 实际起始偏移 − 控制栏高度，并设上限。
- **按空间而不是设备判断形态**：
  - 舞台尺寸用容器查询决定。
  - 输入方式单独判断：`pointer:coarse` 的设备使用 44px 按钮。

**各端布局**

| 形态 | 布局 |
|---|---|
| 桌面 | 左栏（名单 / 事件）· 地图 · 右栏（车辆详情） |
| 平板横屏 | 地图 + 可收起的右栏；左栏改为图标轨 |
| 平板竖屏 / 手机竖屏 | 地图 + 吸底控制栏 + 底部 sheet（Tab：玩家 / 事件 / 显示 / 车辆，三个吸附高度） |
| 手机横屏 / App | 沉浸模式：地图铺满，HUD 贴边；点击显示控制栏，按住期间不自动隐藏；面板从右侧滑出 |

**交互策略**

- 在用户明确触摸或点击地图之前，页面滚动优先。
- 滚轮只在按住修饰键，或地图获得焦点后才缩放。

**标签分级**

- 低缩放时，扎堆的车辆合并成"+N"。
- 选中、悬停或放大时才显示完整名字和血量。

**方向控制**：是否锁定方向由网页通过原生桥请求，Android Activity 不再一律强制横屏。

### 8.4a 回放中心：数据 · 2D · 3D · 射击联动

**一次上传，一个会话。** WASM 本地解析和服务端解析的结果合并成同一个 `ReplaySession`，统一由它提供玩家名册（昵称、车辆名、地图名）。3D 和射击分析不再各自解析出 `Unknown`、`eid:…` 这类占位名称。

**统一播放骨架**：2D 和 3D 共用同一个 `PlaybackShell`，包括：
- 播放控件：时间格式统一，倍速档位 0.5 / 1 / 2 / 4 / 8×。
- 名单和事件面板。
- 键盘快捷键。
- 各端布局（见 §8.4）。

2D 和 3D 只是舞台（Stage）不同。

**跨视图联动**：

| 从 | 操作 | 到 |
|---|---|---|
| 数据表 · 玩家行 | "在回放中查看" | 2D / 3D，跟随该玩家 |
| 射击分析 · 某一发 | "跳到这一刻" | 2D / 3D，定位到该时间点 |
| 射击分析 · 某一发 | "装甲分析" | 装甲查看器（页内分栏，保留返回） |
| 2D / 3D · 时间轴 | 击杀或命中标记 | 射击分析里的对应条目 |

**射击分析的布局**：
- 桌面：左侧射击列表（可按射击者、目标、结果筛选）+ 右侧装甲查看器分栏。点一行，右侧就切换过去；上一发 / 下一发用 ↑ ↓。
- 手机：先显示列表，点一行打开全屏装甲视图，底部固定一条"上一发 · 下一发 · 跳到回放"操作栏。

**装甲查看器**：
- 右侧属性面板在平板和手机上收进底部 sheet。
- 触屏上转炮塔用双指旋转，或者用底部的"炮塔 / 炮管"滑杆。
- 默认斜 30° 视角。
- 热力图配图例，射击距离可以用滑杆调节。

### 8.5 名人堂

- **筛选**
  - 桌面上筛选是一行工具栏。
  - 手机上只露出"筛选"按钮，点开是 sheet，已选条件显示为 chips。
  - 最常用的"车辆等级"和"模式"做成快捷 chips，直接露在外面。
- **列表**
  - 桌面 / 平板用表格，表头吸顶（表格容器设定高度，或改为页面级 sticky）。
  - 手机用卡片列表：排名 · 玩家 · 车辆 · 伤害，点开看详情。
- **URL 状态**：Tab、筛选条件、页码同步到 URL query。
- **加载**：翻页时保留旧行变暗，并滚回列表顶部。

### 8.6 首页

- **Web**
  - 英雄区变轻，记录卡在手机上回到文档流。
  - 功能卡改用小尺寸 WebP。
  - "最近分析"接入真实数据，接不上就移除。
- **App**：不显示首页，底部 Tab 默认进入"回放"。

### 8.7 基础设施（让以上方案可维护）

1. **CSS 分层**：`@layer tokens, base, shell, layout, components, profile, page`。
   - 布局规则不再使用 `!important`。
   - showcase / classic 只负责"外观"：放进 `[data-ui-profile]` 作用域，只改颜色、阴影、背景。
2. **单一断点来源**
   - CSS 只允许写三档 range 写法，用 stylelint 规则强制。
   - JS 侧提供 `useBreakpoint()`（`mobile | tablet | desktop`）和 `usePointer()`（`coarse | fine`），与 CSS 使用同一份常量。
3. **共享组件**
   - `AppShell`（顶栏 / 底部 Tab / 安全区）
   - `BottomSheet`
   - `AppDialog`（焦点陷阱、Esc、dvh、安全区），替换约 10 个临时弹窗和 `confirm()`
   - `AuthGate`，替换 6 处直接跳转登录的实现
   - `DataTable`，<768 时自动切换为卡片列表
   - `ExportMenu`
4. **z-index 刻度**：`base < sticky < drawer < sheet < menu < dialog < toast`，全部使用 token。
5. **性能**
   - 非首页路由改为异步加载。
   - 图片管线：WebP/AVIF + `srcset` + lazy。
   - 手机档关闭多层 `backdrop-filter`。
6. **Android 桥**：新增 `saveFile`、`requestOrientation`、原生导入入口；App 内隐藏"选择文件夹"。

---

## 9. 路线图建议

| 阶段 | 内容 | 预估 | 风险 |
|---|---|---|---|
| **0 · 热修** | BZ-01（解析失败要有报错）、SH-01/02、WS-02/03、PG-01、PB-05、SH-05、WS-04/05；WS-01 需桥接改动 | 1–2 天 | 低；每条三档截图对比 + `test:browser-layout` |
| **1 · 地基** | CSS `@layer` 分层、断点 / 顶栏 token、`useBreakpoint`/`usePointer`、z 刻度、AppDialog / BottomSheet / AuthGate | 3–5 天 | 中；主要是 showcase 去 `!important` 的回归 |
| **2 · 新外壳** | 信息架构 + 桌面 / 平板顶栏 + 手机 / App 底部 Tab + "我的"页 | 2–3 天 | 中 |
| **3 · 逐页** | 回放工作台 → 战局重建 → 名人堂 → 首页 / 其他 | 每页 2–4 天 | 战局重建最高 |
| **3b · 3D 开放前** | 名册解析（3D-01/02）、统计口径（3D-03/04）、i18n（3D-16）、取消弹窗改路由（3D-09）、回放中心合并（3D-08）、装甲查看器触屏和响应式（3D-14） | 5–8 天 | 名册合并需要确认 WASM 与服务端的数据契约 |
| **4 · 性能与无障碍** | 图片、分包、焦点 / 键盘、`reduced-motion` | 2–3 天 | 低 |

建议从 **阶段 0** 开始：导航不可见（SH-01）现在就在影响所有手机和 App 用户，而且改动极小。
