# 前端架构

## 应用基础

产品使用遥测在 `AppShell` 中只有一个前台生命周期 owner（`useUsageTelemetry`）。它观测 canonical router view，包括工作台能力路由；仅查询参数层面的坦克/文件/筛选变化不会重新打开某个 feature。回放数据没有页面打开事件：`useLocalReplayAnalysis` 对每个已选文件记录一次开始和至多一次终态，批量部分完成通过 `parseReplayFiles.onFile` 记录。取消只结算尚未完成的文件。离开客户端的只有 attempt UUID、枚举化结果和安全的错误类别；文件名、内容与原始错误保留在本地。

已登录活动会在前台初始化/恢复、认证就绪时，以及处于前台且在线期间每五分钟发送一次。API transport 在发送前刷新 token，并重新检查账号 epoch/前台所有权；服务端校验 bearer 并推导账号身份。匿名 feature/parse 事件使用最多 100 条事件的内存队列、20 条事件一批、五秒 flush；上传失败即丢弃，不落盘、不自动重试。浏览器刷新/离线使用/进程终止可能丢失遥测。不引入持久匿名标识或精确的匿名用户计数。Android 打包同一 producer。

新手引导是 AppShell 的单一 `useOnboarding` owner，`OnboardingHost` 消费该 controller；跨层接入只用 shared typed `ONBOARDING_KEY`，Workspace 和各 pane 保留业务状态并注册明确 commands/readiness。指南无独立路由或第二个 replay renderer，见 [功能契约](../features/onboarding.md)。

`main.js` 在导入 router 或改写 localhost 预览 URL 之前，先拦截 Web OIDC 返回。当 query 或 fragment 同时包含 `state` 与 `code` 或 `error` 时，它会等待既有 `useAuth().initPromise` 的结算信号；由 keycloak-js 单独校验并消费 callback。只有在此之后，才用 adapter 产出的结果 URL 构造 `createWebHistory`，并规范化 legacy view alias。成功的 fragment callback 会在 router 记录 history 之前被消费。在入站 callback 初始化期间，provider 会保护 SDK 的公开 `login` 方法，并启用不带静默 redirect URI 的 `onLoad: 'check-sso'`。SDK 认定的合法 callback 会绕过 `onLoad`；因此匹配的 `prompt=none` / `error=login_required` 返回会正常以未认证状态结算。缺失事务则走受保护 fallback，并在任何新的 SSO 事务能够掩盖原始失败之前失败。被 SDK 拒绝或已过期的交互式 callback 同样需要显式恢复。init 结算后恢复原始 login 方法；普通访问保留其正常的 `check-sso` 配置。provider 使用 SDK 默认的 fragment 响应模式：识别看起来像 query 的 URL 只会延迟路由，并不会增加 query-mode 支持。该存在性检查从不授予认证。拒绝与 12 秒 Web watchdog 都会结算到既有的 failed-auth UI；仅结算并不保证每个畸形或超时 URL 都已被清理。普通访问在 `check-sso` 运行期间正常渲染；APK 启动仍归 Native 所有，不等待这条 Web callback 路径。legacy alias 重定向会保留无关的 query 值与 hash，包括普通页面锚点。

应用根组件 [`frontend/src/App.vue`](../../frontend/src/App.vue) 只渲染 Vue Router 的 outlet。应用层职责位于 `frontend/src/app/`：

```text
App.vue
  → app/router.js
  → app/AppShell.vue
      ├── AppSidebar.vue     # 平板 / 桌面（≥ 768）：左侧边栏主导航（含 MorePanel 弹出面板）
      ├── AppTopBar.vue      # compact（< 768）：标题栏
      ├── ViewHost.vue       # <main>，按 ?view= 渲染页面
      ├── AppTabBar.vue      # compact（< 768）：底部主导航
      └── GlobalErrorDialog.vue
```

主导航的唯一数据源是 `app/navigation.js`：`PRIMARY_NAV` 定义首页 · 回放 · 名人堂 · 坦克百科 · 联赛积分榜 · 联赛直播回放 · UP 推荐 · 更多，`primaryNavItems()` 再按 runtime/host 投影实际可见项——public Web home host 保留首页，Android APK 与本地 Web 不显示首页并以回放作为默认落地页；`ADMIN_NAV`（按角色显示的管理入口）与 `primarySection(view)`（视图归属哪个栏目）共享同一导航模型。外壳按 `useBreakpoint()`（`composables/useBreakpoint.js`，断点常量在 `shared/breakpoints.ts`）在两种形态间切换：平板 / 桌面渲染 `AppSidebar`（桌面可折叠，偏好由 `composables/useSidebar.js` 写到 `<html data-sidebar>`，`tokens/scale.css` 据此派生 `--sidebar-w`）；手机渲染 `AppTopBar` 标题栏 + `AppTabBar`。两者都用 `RouterLink` 渲染，并以 `aria-current` 标记当前栏目。直播入口的 `shortLabelKey` 仅用于底部栏和侧栏收起形态，完整名称仍为辅助技术提供；桌面展开形态与页面标题使用完整名称。账户（登录、个人中心、登出）进入 `?view=profile`（`ProfilePage.vue`，未登录时显示说明卡而不是自动跳转）：平板 / 桌面在侧边栏底部，手机在标题栏右侧。"更多"的内容只有一个来源 `composables/useMoreMenu.js`：平板 / 桌面是侧边栏底部的弹出面板（`app/MorePanel.vue`：显示设置 + 关于与支持；管理入口在侧边栏管理组），手机是 `?view=more` 整页（`components/MorePage.vue`，另含按角色显示的管理入口）。

`router.js` 拥有浏览器 history、深链处理、重定向与前进/后退。产品 URL 有意保留兼容的 query 契约：`?view=replay`、`?view=ai-review`、`?view=battle-playback`、`?view=agent-replay`、`?view=agent-shots` 都解析到同一个 kept-alive Replay Workspace，只是初始能力不同（data / ai / playback / 3d / shots，见 `viewRegistry.js` 的 `replayInitialCapability`）。Legacy alias（`leaderboard`、`extended`、`reconstruction`）会一次性重定向到其 canonical query 值。Android 还会把过期的 landing `?view=home` URL 规范化为 Replay 根 URL，同时保留无关的 query/hash 值；公开 Web 的 Home 深链仍然有效。`/download/android` 与 `/download/android/` 解析到 Android 页面；`/sponsor` 是 AppShell 的一等路由，经 `ViewHost` 解析到 `SponsorPage`。

**视图私有 query 键**（`navigation.js: locationForView`）：名人堂筛选（tab/page/nation/type/tier/bt/nick/limit）、坦克百科筛选与详情（q/sort/tank/config…）、以及装甲查看器 / 射击复现场景参数（tank/shooter/config/scfg/shell/shot/world/heatmap + 相机与显示档 az/h/d/eqcal/eqenh/quality/move/rel/clean/debug）只属于各自的视图：导航到别的视图时整组丢掉（`locationForView` 三条清理规则），否则从场景切走会在 URL 里留下上一发的 `tank/shot/shooter/…`。留在同一视图内的导航保留全部参数。

3D 回放与射击分析是工作台能力：`agent-replay` / `agent-shots` 深链与工作台 tab 都解析为同一个 kept-alive Replay Workspace 的 `3d` / `shots` pane，与 2D / AI 共用同一条 session（`props.file` 消费工作台已选回放，自身没有上传入口），并保留工作台上层导航。五个能力永久对所有用户展示，导航不按 admin role 收敛 Agent 深链。3D / shots 在匿名使用个人回放时显示 `ReplayCapabilityAuthGate`；登录或选择已验证的官方示例后才加载 pane；AI 在现有投影边界前门控。`test:browser-interaction` 用真实输入验证普通用户与匿名路径以及 shots → armor 交接。

AI Review 使用同一个 kept-alive Replay Workspace：`?view=ai-review` 深链与工作台 tab 都解析为 `ai` 能力，该 pane 在共享的 auth + local-projection 门控之后挂载 `AiReviewWorkspacePane.vue` / `AiReviewPanel.vue`。Transport 保留在 `api/ai-review.ts`；AI 输入是客户端 canonical projection（`replay-local/ai`），后端是 Yecao ai-service（见 `docs/operations/ai-service.md`）。

`app/viewRegistry.js` 是 view 名称的唯一事实源：`VIEW_COMPONENTS` 把受支持的 query view 与路径派生的 view（`android`、`sponsor`）映射到各自组件。`app/navigation.js` 在其上拥有深链契约，未知 view 回退到默认 view，因此 `ALLOWED_VIEWS` 必须始终等于已注册的 view 名称——`frontend/src/App.test.js` 锁定这一相等关系。新增或重命名 view 意味着同时更新 registry、allowlist 及其导航入口；只改一侧会静默退化为默认 view，而不是显式报错。只有 landing view（`HomePage`、`ReplayWorkspace`）是急切导入；其他每个 view 都是 `defineAsyncComponent` chunk，工作台内部的四个能力 pane（`BattlePlaybackPanel`、`Replay3DPane`、`ReplayShotsPane`、`AiReviewWorkspacePane`）走 `utils/lazyModule.ts` 的 `defineLazyModule` 失败边界，因此已确认的同源 `/assets/*` 过期 404 会走 `platform/preloadRecovery.js` 中受保护的一次性 fresh-bundle reload 路径（共享 60 秒冷却），而网络失败、5xx、未知状态、无 URL 的 dynamic-import 失败（无法安全关联）以及无法关联的失败，都保留既有的可见、用户可控的 `defineLazyModule` pane 内状态，而不是卸载工作台。mock 这些模块的测试必须返回 `__esModule: true`，并用 `vi.dynamicImportSettled()` 等待。`main.js` 保持 `<html lang>` 与 `document.title`（`<section> · WoTBTools`）与 locale 和路由同步。

`ViewHost.vue` 把扁平的页面组件映射到由路由派生的产品 view。不要给组件添加手动的 `history.pushState`、`replaceState` 或 `popstate` 监听器；应使用注入的导航命令，由它委托给 Vue Router。

应用导航由 `frontend/src/shared/navigation.ts` 中与 feature 无关的 typed `NAVIGATE_VIEW_KEY` 定义。`AppShell` 提供该命令；app 与 feature 消费者注入共享契约，不导入 router 内部实现或 `app/` 实现模块。生产代码不得引入魔法字符串 `inject('navigate')` / `provide('navigate')` 调用。

积分赛管理入口由 `useAuth.isTournamentAdmin` 所有（真实 token 中的 `tournament-admin`，全站管理员通过 Keycloak 复合角色继承），不复用全站 `isAdmin` 放大专属角色权限。公开「联赛积分榜」是主导航栏目，位于坦克百科之后；主导航、页面/浏览器标题与导出标题共用 `tournament.title`，公开入口不重复放到更多面板/页面中。公开积分页持有正式 standings，`utils/tournamentPointsExport.ts` 提供屏幕/Excel/打印文档共享的列投影；管理页的历史导入、预览和幂等提交状态仍归 `useTournamentPointsAdmin` 所有，JSON 文件只在文件边界转为 OpenAPI request，经 `api/tournament-points.ts` 发起请求。

## 依赖与状态规则

要求的依赖方向为：

```text
app → features → shared
```

源码树是扁平的（`app/`、`components/`、`composables/`、`utils/`、`shared/`，外加领域目录）；依赖方向适用于它们之间的 import。新工作不得制造跨 feature 的私有 import，也不得把 feature endpoint 知识放进 shared 代码。

每个业务状态只有一个权威 owner。Replay session 状态（选择、分析状态/结果、工作台视图状态）由 `frontend/src/composables/useReplaySession.ts` 拥有；本地 parse → batch-compute → client-export 副作用由 `frontend/src/composables/useLocalReplayAnalysis.ts` 驱动（基于 `replay-local/parseReplays.ts` / `replay-local/analyzeReplays.ts`），而 `useReplay.ts` 以 facade 形式暴露该契约，`useReplayWorkspace.ts` 额外拥有 2D、3D 与 Details 共享、并交给编排 SFC 与能力面板使用的惰性 Playback session 结果。解析、批量计算与导出都在本地运行；服务端没有 replay parser，也不存在 Processing/Export job 状态。用 `computed` 派生值；`watch()` 只用于真实副作用或生命周期桥接，绝不用于同步同一状态的重复副本。

核心 Replay/API/AI/Playback 契约位于 `frontend/src/types/`，并在外部 JSON/SSE 边界处校验。JavaScript 与 TypeScript 共存；`.js` import specifier 可能经 Vite/TypeScript resolver 解析到其 `.ts` 实现，但只能有一个实现。

Replay 的 HTTP 所有权集中在 `frontend/src/api/` 下。`replay-capabilities.ts` 拥有服务端调用共享的 Bearer/auth-session 管线（`ReplayAuthSession`、`optionalBearer`、`authedReplayPost`）；`ai-review.ts` 拥有 AI Review 的 SSE/HTTP transport；本地解析、批量计算、导出与 2D 回放没有 HTTP transport（`replay-local/**`），本地产出的 Playback V2 dataset 由 `contract-runtime.ts`（`validateBattlePlaybackDataset`）在边界处校验，而不是从服务端获取。`AiReviewPanel.vue` 与 `BattlePlaybackPanel.vue` 只拥有 run/view 生命周期，不得重建 `apiFetch` / `authedReplayPost` 管线，也不得硬编码 transport 调用。

Replay Workspace 的表现层拆分为专注的子组件（`PageHeader.vue`、`ReplayCapabilityTabs.vue`、`FileDrop.vue`——全站唯一的文件投放面——以及用于单场战斗能力的 `BattlePicker.vue`；状态与门控使用 `EmptyState.vue` / `Banner.vue`）。一个工作台承载全部五种能力（`data` / `playback` / `3d` / `shots` / `ai`）：`ReplayWorkspace.vue` 是唯一的能力编排者，并在首次激活时惰性挂载 `BattlePlaybackPanel.vue`、`Replay3DPane.vue`、`ReplayShotsPane.vue` 与 `AiReviewWorkspacePane.vue`（`composables/useMountedWhenActive.js`），当能力切换离开时保持每个 pane 的 session 存活。三个单场战斗 pane 与 3D pane 共享同一套 `file` / `active` / `blockedReason` prop 契约；它们都不拥有文件选择器或第二个 session。`ReplayPage.vue` 内的 Data 结果工具栏使用 `SegmentedControl.vue`、`BattlePicker.vue` 与 `MenuButton.vue`；`SeriesOverview.vue` 渲染由 `utils/replaySeries.js` 派生的系列比分。选择 / 分析状态 / 当前战斗仍归 `useReplayWorkspace()` / Replay session 所有（本地解析 + 批量计算副作用经 `useLocalReplayAnalysis` 运行）。直接父子依赖是显式的：`ReplayWorkspace.vue` 把权威 replay session 与工作台表现状态作为 props 传给 `ReplayPage.vue`，而不是藏在 `provide('replay')` / `provide('replayWorkspace')` 后面。认证从 `useAuth()` 单例消费，而不是由 `AppShell` 通过字符串 service-locator key 再导出。

装甲查看器（`agent-armor`）可匿名使用；个人回放射击在 Replay Workspace 中仍受门控，而已验证的官方示例射击同样可匿名使用。浏览器登录会保留完整场景 query；普通已登录用户无需 admin role 即可使用射击复现。它是独立页面：归属 Tankopedia 一侧，并保留自己的 URL 契约（`?tank= &shooter= &config= &shell= &shot= &world=1`）。Replay 工作台复用的是它的*引擎*（穿深计算、坦克资产、`scene/tankViewer.js` 标记调色板），而不是其页面导航模型——射击检查器通过既有本地 handoff 通道交出射击数据，并请求 router 打开该目的地。

装甲厚度是**按配置（config）作用域**的：查看器从所选 `tank/{id}.json` 的 config 读取 `configs[].turret_plates`、`configs[].gun_plates` 与 `configs[].gun_thickness`。`armor_model` 仅保留为顶层 config 的摘要，不是 fallback 来源；缺少 per-config plate 时会 fail closed 为 0 mm。配置变化时，查看器会刷新装甲板缓存、可视炮管模块缓存、间隙装甲分类与当前碰撞材质颜色；热力图重建与点击判定随后读取这些刷新后的缓存。没有新的资产形状契约，不得把 `armor_model` 恢复为 fallback。

穿深衰减（`penetration_far`，客户端 0x719740）的交战距离依模式而定：**射击回放使用服务端解码的弹道路径长度**（`scene/agentData.js` 中的 `shotBallisticLength`：`ball_a → via… → ball_b` 折线总长，包含跳弹段——即炮弹实际飞行的距离），而**静态装甲检视使用相机 → 首个命中装甲板的距离**。两者喂给同一判定与穿深图 uniform；结果卡显示实际使用的值。装甲查看器中的相机点击判定只对到达**主装甲**（`scene/penetration.js` 中的 `isPrimary`：车体 / 炮塔 / 火炮防盾板）的射线开火——与 BlitzKit 装甲检查器相同的触发面，其 `shoot()` 只绑定主装甲 mesh。只穿过间隙装甲屏或外部模块（履带、炮管）的射线**不会**产生判定，尽管判定本身会对纯间隙层堆叠报告击穿（其最后一层规则）；点击路径在判定前会过滤这类堆叠，并清除上一判定而不是显示过期结果。瞄准/拖拽交互门（`scripts/browser-armor-aiming.mjs`）用一个固定屏幕装甲板夹具锁定这一点。

动能弹（AP/APCR）的层语义遵循 BlitzKit `shoot()`：**每个非外部层都用自身厚度与入射角独立应用炮弹转正与 2× 口径增强转正**；转正不从第一块装甲板继承。外部模块是扁平消耗层，不消耗转正，但会递增命中索引，使后续层无法发生跳弹。`overmatch` 标记只报告真实的 3× 口径规则；跳弹只在首个命中层检查（`index > 0` 或 `allowRicochet=false` 时抑制），点击判定、热力图与跳弹延续共享该规则。增强转正要求装甲板厚度为正：合法的 0 mm 装甲板保持 0 mm 有效厚度，而不是除以零（点击判定与延续 GLSL/JS 共享该保护）。热力图累加每层归一化有效厚度：`SPACED_FRAG` 写入每块间隙装甲板的 `finalThickness/penetration`，外部模块写入其扁平厚度，主装甲即使前方有间隙装甲也应用自身转正（不做最近层差值修正）。RT1 携带最近装甲板的跳弹/延续状态；主装甲深度遮罩防止主装甲后方的板泄漏状态，且 `SPACED_FRAG` 不写 per-plate 跳弹门：较晚的陡峭间隙板是有效厚度层，不是新的首层跳弹。由于 RT0 是加性混合，主装甲在自身层 CDF 之后，对累计间隙有效厚度应用一个聚合高斯 CDF（单间隙层时精确；多个边缘间隙层叠加时按同方向近似）；外部模块保持扁平（`RT0.B`）。热力图 fragment shader 从 `normalize(vNormal)` 推导入射角。装甲模型在加载时转换为 non-indexed geometry 并运行 `computeVertexNormals()`，因此每个三角形的三个顶点携带相同的几何面法线，与点击判定的 `hit.face.normal` 一致。Shader 以 `mediump` 运行（许多移动 GPU 上为 fp16），逐像素 view-position 导数在此会量化并产生错乱热力图；因此入射角来自几何法线，而不是 `dFdx/dFdy(vViewPos)` 路径。视空间位置 varying（`vViewPos`）、视线方向、角度与最终厚度为 `highp`：在 500 m dolly-zoom 极限下，`mediump` 的 `length(vViewPos)` 可能在分量平方时溢出，即使距离本身可表示，否则会把入射角变成 90°/NaN。只有单位法线保持 `mediump`。在 8-bit fallback 上，饱和的 `RT0.R` 意味着真实累计覆盖未知，因此按 blocked（fail-closed）处理，而不是读成恰好一次击穿；HE 的间隙/模块覆盖耗尽标称穿深时停留在 splash/blocked 分支，绝不进入通用穿深 CDF，而 HEAT（无 splash）只要区间上界仍存在，就仍应用其间隙衰减与 CDF——只有上界耗尽或 8-bit 守卫会强制为 0。热力图概率色带保持固定的红→橙→黄→绿刻度，使其低/中/高端与结果卡的 blocked/uncertain/penetration 语义一致；它不由主题的 sequential-palette token 派生。

装甲击穿概率采用 Armor Inspector 机制（`scene/armorInspectorChance.js`）：穿深掷骰范围被视为正态分布的 ±3σ（Blitz ±5% → σ=P/60；PC ±25% 已参数化，但本查看器仅支持 Blitz）。概率路径从命中开始重建，直到并包含首个 Primary（`penetration.js` 的 `probability_layers`），而不是从确定性的 `layers` 数组重建——后者在首个未击穿层停止。它不包含首个 Primary 之后的远侧车体/履带命中：这些隐藏层不是概率链中的独立装甲层，纳入它们会使结果卡与确定性判定及热力图不一致。每个实际装甲层先评估高斯 CDF，然后把区间**两端**同时平移**一个**有效厚度，因此 σ 保持为段起始值；外部模块是扁平平移（不是 CDF 层），区间耗尽则结果为 0；跳弹不参与概率。延续段在其首个 `seg=1` 层初始化一次，并在该段余下部分保持累计区间。该概率模型与确定性 `penetration.js`（BlitzKit 移植）使用相同的 **1×、逐层归一化**有效厚度。对 AP/APCR/HEAT，结果卡把完整概率链当作唯一的层链：每个层点使用累计概率（0% 红、1–99% 黄、100% 绿），标题根据总概率显示 BLOCKED / “May penetrate p%” / PENETRATION；任何非零概率都显示炮弹满伤害，即使确定性均值已被 blocked（<1% 显示为 `<1%`，不四舍五入为 0；99.5% 起、未满 100% 的部分概率显示为 `>99%`，绝不显示 `100%`）。累计概率在首个 Primary 之前就降到 0 的链仍完整输出，剩余层概率为 0，因此结果卡行、层点与弹道终点不会消失。HE 只有在其首个表面是 Primary 时才使用同一概率卡：HE 在那里有穿深掷骰，因此标题/层点/伤害使用概率链（任何非零概率都按 HE 满伤害）。如果首个表面是非 Primary 的间隙/模块（HE 不击穿它）或穿深概率为 0，则保留确定性的首表面 SPLASH/BLOCKED 分支。概率模式还要求 Primary 厚度为正（`penetration.js` 的 `hasPositivePrimary`）：终止于外部模块（履带/炮管）或 0 mm 装甲板的射线保持确定性，因此模块的扁平消耗不会被误读为确定击穿并造成满伤害。跳弹/延续保留确定性分支；对这些特殊路径，确定性结果仍是标称终点/伤害的权威，并为概率链提供几何引擎。概率层收集会丢弃同一装甲板的重合命中（射线穿过四边形对角线时会在同一点报告两个三角形），使一个物理层不被重复计数；同一装甲板的非重合重复命中按出现次数（`matchHitsByOccurrence`）与弹道点匹配，而不是按首次 part-name 匹配。主装甲热力图 shader（`tankViewer.js` 的 `aiNormalCdf`）消费相同的 1× 有效厚度（RT0.R 是逐层归一化有效厚度之和加上模块扁平消耗）与区间宽度；跳弹延续 GLSL/JS（`armorCollisionPack.js`）传播相同的 1× 区间，并像点击链一样在首个 Primary 停止（补充概率为零时保持确定性绿色）；标称延续块若补充概率为 1–99%，则编码为该概率带而不是硬红，与结果卡的 “May penetrate p%” 标题一致（0%/100% 仍是确定性红色）；这包括位于首个 Primary **之前**的间隙/模块层的 block（GPU/JS 仍会累计穿过该 Primary 的概率，例如 spaced100→hull1 在剩余 100mm 时两者约为 13.7%）。固定的 `#traj-info` 卡片由画布 `getBoundingClientRect()` 定位，并钳制在可见画布内；`browser-armor-aiming` 会滚动真实布局夹具并断言卡片垂直位移跟随画布，因为源码 regex 守卫无法证明定位路径实际执行。HE splash 伤害使用 BlitzKit 公式（`0.5·D·(1−d/R) − 1.1·(last-layer effective + min(total spaced effective, penetration))`），而不是 Armor Inspector 的首表面 3× 规则；HE 相机 / R-limited splash-domain 实验不属于已发布查看器，证据见 `docs/research/armor-inspector-he-damage.md`。

**已知的热力图近似。** 点击卡把逐层 CDF 与 prefix-shifted 区间相乘：`∏ Φ((P - M - S_i)/σ) × Φ((P - M - A - T)/σ)`，其中 `S_i` 是第 i 层之前的累计间隙/模块厚度。RT0 无法复现该乘积：加性混合只存储 `Σ spaced effective`（`R`）、模块扁平值（`B`），在半浮点路径中还存储间隙层数（`G`）；每层 CDF 依赖**有序前缀和**，单 pass fragment 无法读取（同目标 feedback；核心 WebGL2 没有可移植的 framebuffer fetch），而总和/计数无法重建顺序。具体地，`P=100` 且间隙 99 mm + 1 mm + 主装甲 0.5 mm 时，按 99→1→0.5 顺序为 13.9%，按 1→99→0.5 顺序为 19.1%，而 RT0 存储相同的 `A=100`。因此主装甲 shader 在 `A` 处乘一个聚合间隙 CDF；它对**零个或一个间隙层**是精确的，包括完全位于该层前方的外部模块（RT1 的 `moduleInFront` 把间隙 CDF 基底平移 `moduleFlat`；基底保持符号而不在 0 处 clamp，因此比穿深更厚的模块仍保留正尾部——P199/chassis200/spaced1/hull1 两者均为 5.0%）。对两个及以上间隙层，以及间隙堆叠两侧都有模块的情况（RT0 只存储模块扁平总量），它是近似，当较早的间隙层本身处于边缘时会出现偏差。HEAT 的层间 gap decay 也有同样限制：`spacedArmorDepth` 只存储最近的覆盖深度，因此 shader 应用单一总距离因子 `1−0.5·Σd`；结果卡乘的是 `∏(1−0.5·d_i)`，在多个 gap 时严格更小。结果卡是权威；精确的 per-gap 衰减需要同样有序的逐层深度 trace/peeling。条件性的 packed-grid per-pixel trace 或 depth peeling 可以精确，但出于移动端成本未实现；点击卡 / `penetrationChance()` 仍是权威，`?armordebug=1` 暴露两条链供比较。

单坦克装甲相机与单坦克射击回放使用实测的 Armor Inspector 参考（15 m / 18.75°、最大 FOV 40°、远景 fallback 0.5°；低于 15 m 时 FOV 展宽，使车体保持其 15 m 屏幕尺寸），并带有一个夸张的显示 profile：FOV 乘积（`tan(fov/2)×d`）按 +0.028/m 上升到 3.8 封顶，并乘以 `ARMOR_PRODUCT_SCALE=1.1`，因此 30 m 比 15 m 约小 14%，100 m/500 m 约小 35%（实测 +0.0128/m → 2.8 的 Armor Inspector 漂移是参考曲线，不是实际发布的显示 profile）。18.75° 定义参考曲线；由于显示乘积乘了 1.1，15 m 默认 FOV 实际约为 20.59°，坦克比 18.75° 参考取景约小 9%。40° 近端封顶在缩放之后应用，因此近距离取景不受影响。`near=0.05d`，`far=d+30`。默认相机正对坦克（-Z）并保持水平，瞄准装甲模型包围盒中心，距离 15 m（包围盒为空时回退到炮线），因此坦克在 18.75° 参考取景下垂直居中；相机预设使用各自的 `ty`（炮线或顶视高度）作为目标高度。实测的 6.5–30 m 是 FOV 标定参考，不是硬性缩放钳制。双坦克世界总览保持原生 50° 取景。记录为**命中**的射击以弹着点视角打开（15 m / 18.75°，弹着点按钮按下），切换“Overview”恢复 50°；**未命中**没有弹着点，以世界总览 50° 打开，弹着点按钮禁用。相机预设使用 `?camview=front|top|...`；SPA 路由键 `view=agent-armor` 从不被当作相机预设，因此不能覆盖默认 15 m 取景。横屏触屏手机与粗指针横屏平板使用平板/桌面浮动卡片布局（竖屏移动规则仅限竖屏或细指针窄窗口），带一行紧凑信息行；420 px 竖屏最小高度在横屏不适用。装甲查看器监听 `webglcontextlost`/`webglcontextrestored`，阻止默认行为，报告带 GPU 标签的错误，并通过完整重建 renderer 走重试；这是针对真实 GPU reset 的 UX，并不会让 `glGetGraphicsResetStatusKHR` 未实现的 translation layer 变得可渲染。重试保留选择器当前的 shooter/target（选择器变化不重写路由）；非保留式同 view 路由重建会在替换的查看器加载前清除这些 ref，因此在新 URL 派生选择发布之前发生的 context loss 无法恢复上一条路由的坦克。

装甲查看器的坦克选择器与坦克百科列表是同一套菜单实现（`components/TankCatalogMenu.vue`），基于同一个名册 view model（`normalizeTankCache` + `selectTanks`）：带搜索别名的模糊搜索、tier/nation/type 筛选、name/tier/hp/pen 排序、紧凑 chips + filter sheet、增量卡片，以及 loading/empty/error 状态都完全相同。`AgentTankopedia` 只保留 URL 状态与详情视图；`AgentArmorView` 保留对话框外壳并转发查看器回调（`onTankList`、`onTankSelection`、`selectTank`）。名册变化或搜索/筛选契约变化必须落在共享组件中，而不是任一页面。

Auth 状态只有一个 owner：`useAuth()` 单例 refs（`authenticated` / `tokenParsed` / `authInitState`）。每个消费者都从这些 refs（或 `computed` 派生）渲染，因此登录返回、Android `authChanged` 推送或登出都会翻转整个 SPA，而无需 reload 或 remount。`initPromise` *仅*是 bootstrap 结算信号，不携带 session 真值（它 resolve 为 `undefined`）：它是模块级一次性 init 事务，`logout()` 只重新投影 refs——从不重建该事务，因此从中读出的任何值都是首次 init 的过期快照。需要 remount 的页面必须 await 它，然后根据 `isAuthenticated()` / `authenticated` 分支，绝不根据 promise 的值分支。登出是 local-first：refs 在任何网络调用之前清空，浏览器 end-session 是 best effort（仅在连接状态*已知*离线时跳过——`unknown` 仍会尝试，unknown ≠ offline），落地目的地是运行时默认值（公开生产 Web → Home；Android APK 与本地 Web → Replay），绝不是登出前的 view。刷新被拒绝本身不是登出：浏览器扣留其 API token 并保留已投影身份以备稍后重试，包括在线时。Android 重新读取 Native 状态；瞬时失败保留其缓存，而永久性 Native token 拒绝可以清除该 session。Reload/check-sso 与显式登出仍是权威。生命周期超出一次 UI turn 的业务请求（profile / records / hundred status）携带发起时捕获的 `authEpoch()`，并且必须在发布前重新检查所有权——迟到的 A 账号响应绝不能落在切换到 B 之后。

`app/viewRegistry.js` 是唯一的 view → capability 映射：`replay` → `data`，`battle-playback` → `playback`，`agent-replay` → `3d`，`agent-shots` → `shots`，`ai-review` → `ai`。五个能力都对所有用户公开可发现。Data 与 2D Playback 可匿名使用。个人回放在 3D Playback 与 Shot Analysis / Reconstruction 中要求认证；已验证的官方示例文件也允许匿名访问这两个能力。AI Review 始终要求认证，包括 demo。`wotbtools-admin` 不改变 Replay Workspace 能力。

Battle Playback 遵循同样的表现边界：`BattlePlayback.vue` 仍是编排根，而 `BattlePlaybackHud.vue`、`BattleMap.vue`、`PlaybackControls.vue`、`PlaybackTransport.vue`、`PlaybackTimeline.vue`、`PlaybackDisplaySurface.vue`、`AnnotationToolbar.vue` 与 `VehicleDetailsPanel.vue` 分别拥有 HUD、地图、控件、共享主合成、时间线、Gear 锚定的 Display 面、标注与选中车辆表现。`PlaybackMobileOverlay.vue` 只拥有移动端控件的瞬时可见性。纯 playback 投影与时钟 helper 位于 `utils/playbackVehicleState.ts` 与 `utils/playbackClock.ts`；canonical V2 query 语义与坦克标记资产保持不变。
持久化的 Playback 表现状态在 `composables/usePlaybackPreferences.ts` 中只有一个模块级 reactive owner：玩家/坦克标签、战场标签 reload 开关、HP HUD 可见性、最近轨迹与战场 UI 分块开关（`uiPrefs`：顶栏 / 名册 / kill feed / 基地状态）保留既有的 `wotb.pb.*` 存储 key 与归一化默认值。每个活跃消费者收到同一批对象；kept-alive 的 2D 与 3D pane 中的变化彼此立即可见，持久化不能写入过期的独立副本。两个根都保持领域投影/渲染独立于持久化策略。

`PlaybackVehicleLabel.vue` 为两条路径拥有玩家/坦克名称、HP 数字/百分比/可视化、装填分段，以及 destroyed/last-known 表现。`VehicleMarker.vue` 提供地图定位的 2D 状态与碰撞放置；`PlaybackVehicleLabels3D.vue` 提供屏幕定位的 3D 锚点。场景通过相机投影车辆世界坐标，并只通过一个隔离的命令式桥在渲染速度下更新锚点的 DOM transform/可见性。标签内容以 HUD 节奏（约 10Hz）发布给专用子组件，seek 时立即更新；`Replay3DPane` 的 reactive 树不会以原始渲染 FPS 更新。位于相机后方、屏幕外与不可见的车辆会隐藏，既有遮挡语义保留，HTML overlay 不拦截场景指针输入。车辆标签没有 CanvasTexture/Sprite renderer；浮动伤害 sprite 仍是独立的 Three.js 反馈。

装填解释由 `scene/reloadBar.js#createReloadStateResolver` 拥有：两个 pane 查询同一套纯 state-at-time 语义。`parseLocalPlayback` 把权威 Playback 装填遥测与 canonical 2D dataset 一起携带，而不是把它加到通用 `ReplayFacts` 中。无遥测、未知关系和敌方关系都不产生装填表现；暂停/seek 绝不积分独立倒计时。

3D Hide All UI 是 pane 的瞬时状态。其唯一的 `setUiHidden()` 转换在进入时关闭 Display，并一起门控 HUD、名册、kill feed、基地、标签、控件、display panel 与结果横幅；只有恢复入口保留。按钮与 H 快捷键使用该转换，交互式键盘目标被排除。

Playback 手机形态通过 `usePlaybackPhoneForm()` 与 `PLAYBACK_MOBILE_QUERY` 由两个 renderer 共享。Vue 渲染与 3D `.phone-form` 根类使用这一语义判定；仅宽度的 CSS 不能把 844×390 粗指针手机变成平板布局。紧凑速度/transport、次级控件与安全区遵循同一手机形态；portrait-flow 与 landscape side lanes 是另一个独立决策，通过 `usePlaybackPortraitViewport()` 共享。平板高度视口的触屏平板保持平板表现。`usePlaybackFullscreen()` 以 `document.fullscreenElement === target()` 跟踪所有权；并发挂载的 pane 绝不报告他人的全屏。只有手机进入自己的全屏时才尝试横屏方向。

名册表现有一份响应式契约。非竖屏布局，包括手机横屏/全屏与短视口，保持常驻侧栏，录像者友军在左、敌人在右；正常 7v7 行无需 team/lane 滚动条即可容纳。竖屏布局使用自然文档流：HUD / 方形 Stage / Transport / Display（打开时）/ 内联 Details / 友军 / 敌军，页面滚动而不是各队伍盒单独滚动。不存在按需的瞬时名册面。`uiPrefs.showRoster` 只移除名册表现；数据、选择、跟随目标、相机与回放保持不变。renderer 在侧栏隐藏时保持其 Stage 契约：2D 保持方形，3D 在横屏填满可用中心、在竖屏保持方形。

`Replay3DPane` 拥有选中车辆状态。Three.js raycast 通过场景 callback 报告选择意图；它从不拥有 Vue 选择。场景选择打开共享的 `VehicleDetailsPanel.vue`；3D 名册行点击会显式跟随该车辆。Follow 是显式相机命令，Free/Top 保留选择。详情面板接受通用身份/HP/时间，以及可选的 portrait、last-known/摧毁时间、stats、track inspector 与 damage log；2D 与 3D 消费工作台拥有的 canonical dataset 作为该证据。3D 从场景身份/HP 状态开始，并在 canonical 数据到达时增强已打开面板；不可用区块被省略，canonical 失败不阻塞场景。同一 Details 组件在非竖屏布局（包括手机横屏/短视口）中可拖拽并浮动于工作台，竖屏中位于 Transport/Display 之后的 inline 位置。Details 可见性不会重置/重新解析 playback 或重新加载资产。

物理队伍身份与录像者视角表现保持区分。2D 与 3D 名册侧栏都通过 `scene/rosterState.js#rosterLanesFor` 把录像者友军放在左侧、敌人在右侧；未知玩家仍是独立分组。`PlaybackRoster` 接收 `friendlyTeam` 并派生友军/敌军标题与 `--color-team-ally` / `--color-team-enemy` 颜色。物理 `team1` / `team2` key 在数据中保持不变；没有已知录像者队伍时，侧栏顺序回退为 Team 1 左 / Team 2 右，行颜色保持中性。`scene/rosterState.js` 拥有名册的 state-at-time 投影（身份行构建一次，`hp` / `dead` 按 `t` 重新投影）；标签表现使用共享 Vue 组件与语义 CSS token。

Playback 测试遵循这些所有权边界：地图/标记/手势契约位于 `BattleMap.test.js`，控件契约位于 `PlaybackControls.test.js`，时间线契约位于 `PlaybackTimeline.test.js`，HUD/移动/面板契约位于各自专注的组件测试套件，详情面板契约位于 `VehicleDetailsPanel.test.js`，纯投影/时钟契约位于 `utils/playbackVehicleState.test.js` / `utils/playbackClock.test.js`。共享 playback 夹具位于仅测试用的 `playbackTestHarness.js`。`BattlePlayback.test.js` 与剩余的 `BattlePlayback.integration.test.js` 用例保留给跨组件/领域回归；表现层用例不在那里重复。

源码级 CSS 守卫对所有权不变量仍有价值，但最终布局行为不能从 CSS 文本推断。`npm run test:browser-layout` 会启动 CI runner 上可用的 Chrome/Chromium，加载实际的 shared/PC/tablet/mobile Playback 样式表，并对 1600×900 PC、1024×768 平板、390×844 手机以及一个跨形态隔离用例检查真实 computed style / geometry。该门在 frontend CI 中、生产构建之前运行。CSS 文本同样无法展示*交互*真相，因此 `npm run test:browser-interaction` 覆盖互补的另一半：它加载真实应用（router / AppShell / ReplayWorkspace / 所有样式表，只 stub Keycloak 边界），模拟设备指标与粗指针，驱动**真实输入管线**（原始 touch / mouse 事件，绝不用合成 `click()`），并通过页内事件记录证明真实点击目标**就是**预期控件。它覆盖 375×812 / 390×844 竖屏粗指针、740×360 横屏粗指针、1024×768 平板、1600×900 桌面、能力切换、未认证登录失败的可见性 + 可重试性、`duration <= 0` transport 不可用，以及竖屏→横屏旋转。其 `roster-geometry-*` 场景还会驱动真实 3D pane：注入 roster/kill-feed 夹具、录像者视角侧栏几何、逐行 HP 数字或 fallback 百分比位于血条内且不被截断、display popover 始终位于可见 pane 内且避开场景中心、逐块开关确实移除对应块，以及 hide-all-UI 可恢复。这些面板交互使用 `clickElement()`，它把 scroll-into-view、`elementFromPoint` 遮挡检查与 `el.click()` 融合为一次页内求值；命中测试针对真实浏览器布局运行，因此透明 overlay 与遮挡仍然会让它失败。

UI profile 仍然只用于表现层：`wotb-ui-profile` 是唯一持久化 key，由其派生的 `data-theme` 不会创建独立的主题状态。Showcase 与 Classic 必须使用相同的组件、API 与业务状态。

## Canonical 文档索引

- Replay Workspace 所有权与能力边界：[`replay-workspace.md`](replay-workspace.md)
- UI Profile、token 与响应式约束：[`ui-system.md`](ui-system.md)
- Replay/AI/Playback 产品与 API 契约：[`../architecture/ai-review.md`](../architecture/ai-review.md)、[`../features/team-ai-review.md`](../features/team-ai-review.md)、[`../features/battle-playback.md`](../features/battle-playback.md)

## 验证要求

架构工作从 `.agents/skills/frontend-architecture/SKILL.md` 开始。用聚焦测试覆盖变更的边界。路由工作必须覆盖 legacy/深链、前进/后退、受影响的认证目的地，以及 Android 路由。Playback 布局变更必须保持 `npm run test:browser-layout` 通过，Playback / Replay Workspace 的**交互**变更（命中目标、pointer-events、能力切换、auth 门控、transport 控件）必须保持 `npm run test:browser-interaction` 通过，此外还要有专注的 Vitest 套件。依赖或 router 变更要求 `npm run build`；完整前端 CI 仍是仓库级最终门。

## Android 本地优先运行时与能力所有权

Android 从 `http://127.0.0.1:21653/index.html` 启动同一个 Vue 应用（APK 内置 GeckoView 运行在 Native LocalRuntimeServer 的 loopback origin 上）；APK 包含其 chunks、commit 寻址的 Rust/WASM parser、2D 资产与本地射击输入。Native 拥有生命周期/更新、AppAuth PKCE/token 状态、外部文件入口与连接性；Vue 拥有路由/产品 UI/能力门控。Web 保留同源 transport；Android 把服务端拥有的路径——业务 API 与 Android 下载面——解析到 `https://wotbtools.com`，并使用 Native 提供的 Bearer token，而资产面读取（3D 资产）停留在本地 `/agent-assets` 路径，由原生 `AgentAssetProxy` 直接转发到对象存储。Sponsor 运行时内容不是资产面读取：它在构建时从固定的 Release asset 注入并打包进 bundle，因此 Web 与 APK 各自从自己的 release artifact 同源提供。Exact-origin CORS 由生产网关拥有，`deploy/tx/Caddyfile` 中的 Android-Origin 路径列表必须保持同步（`deploy/tx/validate-caddy-config.sh` 断言精确列表）。打包的前端与部署的 Web 前端是相互独立的 release artifact。

`ReplayWorkspace` 保留一个选择/session owner 与既有的五个 capability/view 映射。LOCAL 数据/评分/2D/射击检视在无互联网时仍可用。ONLINE_REQUIRED 的 3D/AI/HoF/Profile 仍可发现，并在 mount、auth 或 request 之前门控；原因来自共享 capability model，而不是网络超时。断线保留本地状态与缓存的 Native auth；既有 3D session generation 与 AI AbortController 停止远程工作。重连立即更新可用性，对被连接性阻塞的 3D/HoF/Profile 恢复一次，且绝不自动提交 AI。完整矩阵与快照来源/更新边界见 [`replay-workspace.md`](replay-workspace.md)。

### 推荐目录的接口与所有权

AppShell 中的 useCreatorAvailability 提供唯一的健康能力与公开分类快照，按 UP/VIDEO 派生类型卡片、列表与总入口可见性。仅 recommendations-v1 启用现行推荐 API，一次公开分类快照包含两个类型的非空分类；仅有作品时总入口也可见。没有该能力时公开及管理入口均不可用，显示可重试提示，不请求旧 UP-only 接口。真实 content-admin 保留技术可用类型的空目录和管理入口；tournament-admin 不拥有内容域，也不显示内容管理入口；完整管理字典不回流公开快照。

RecommendationsPage 是类型入口，CreatorsPage 以 type prop 复用 UP 和作品列表；creators 深链直达 UP，recommended-videos 打开作品，两者属于同一导航栏目。CreatorsConfigPage 用 recommendationType query 选择同一表单/类别管理，VIDEO 不展示实力等级。Vue Router 拥有类型与分类历史，切换前由路由 guard 确认放弃脏草稿/图片；保存中阻止切换。useCreators/useCreatorManagement 将 type 纳入请求所有权，过期 metadata/list/editor 响应不得污染新类型。api/creators.ts 只消费 /api/recommendations 和 /api/admin/recommendations 的现行 wire；等级管理使用后者的 /levels，现行图片引用 /api/creators/avatars/{id} 保留，组件不处理 endpoint 或旧格式适配。

初次加载、恢复联网、窗口焦点、显式刷新及管理写入ACK触发共享读取；ACK会作废写前请求。失败保留最近成功快照，不伪造空目录或清掉已保存/正在编辑的草稿。公开分类失效后router.replace回全部，保留其他query/hash；管理员空分类不回退。该状态不替代useFeatureGate的网络判断，不轮询、不保存到localStorage，不承诺跨会话实时更新。
