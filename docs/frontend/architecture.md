# Frontend architecture

## Current foundation

The application root, [`frontend/src/App.vue`](../../frontend/src/App.vue), only renders Vue Router's outlet. Application concerns live in `frontend/src/app/`:

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

主导航的唯一数据源是 `app/navigation.js`：`PRIMARY_NAV`（首页 · 回放 · 名人堂 · 坦克百科 · 更多）、`ADMIN_NAV`（按角色显示的管理入口）与 `primarySection(view)`（视图归属哪个栏目）。外壳按 `useBreakpoint()`（`composables/useBreakpoint.js`，断点常量在 `shared/breakpoints.ts`）在两种形态间切换：平板 / 桌面渲染 `AppSidebar`（桌面可折叠，偏好由 `composables/useSidebar.js` 写到 `<html data-sidebar>`，`tokens/scale.css` 据此派生 `--sidebar-w`）；手机渲染 `AppTopBar` 标题栏 + `AppTabBar`。两者都用 `RouterLink` 渲染，并以 `aria-current` 标记当前栏目。账户（登录、个人中心、登出）进入 `?view=profile`（`ProfilePage.vue`，未登录时显示说明卡而不是自动跳转）：平板 / 桌面在侧边栏底部，手机在标题栏右侧。"更多"的内容只有一个来源 `composables/useMoreMenu.js`：平板 / 桌面是侧边栏底部的弹出面板（`app/MorePanel.vue`：显示设置 + 关于与支持；管理入口在侧边栏管理组），手机是 `?view=more` 整页（`components/MorePage.vue`，另含公开的回放工具与按角色显示的管理入口）。

`router.js` owns browser history, deep-link handling, redirects, and Back/Forward. Product URLs deliberately retain the compatible query contract: `?view=replay`, `?view=ai-review`, `?view=battle-playback`, `?view=agent-replay`, and `?view=agent-shots` all resolve to the same kept-alive Replay Workspace with a different initial capability（data / ai / playback / 3d / shots，见 `viewRegistry.js` 的 `replayInitialCapability`）. Legacy aliases (`leaderboard`, `extended`, `reconstruction`) redirect once to their canonical query values. `/download/android` and `/download/android/` resolve to the Android page; `/sponsor` is a first-class AppShell route that resolves through `ViewHost` to `SponsorPage`.

**视图私有 query 键**（`navigation.js: locationForView`）：名人堂筛选（tab/page/nation/type/tier/bt/nick/limit）、坦克百科筛选与详情（q/sort/tank/config…）、以及装甲查看器 / 射击复现场景参数（tank/shooter/config/scfg/shell/shot/world/heatmap + 相机与显示档 az/h/d/eqcal/eqenh/quality/move/rel/clean/debug）只属于各自的视图：导航到别的视图时整组丢掉（`locationForView` 三条清理规则），否则从场景切走会在 URL 里留下上一发的 `tank/shot/shooter/…`。留在同一视图内的导航保留全部参数。

3D 回放与射击分析是工作台能力（不再有独立页面）：`agent-replay` / `agent-shots` 深链与工作台 tab 都解析为同一个 kept-alive Replay Workspace 的 `3d` / `shots` pane，与 2D / AI 共用同一条 session（`props.file` 消费工作台已选回放，自身不再有上传入口），并保留工作台上层导航。五个能力永久对所有用户展示，导航不按 admin role 收敛 Agent 深链。3D / shots 在匿名状态显示 `ReplayCapabilityAuthGate`，只有登录后才加载 pane；AI 在现有投影边界前门控。`test:browser-interaction` 用真实输入验证普通用户与匿名路径以及 shots → armor 交接。

AI Review is mounted normally: the `?view=ai-review` deep link and workspace tab resolve to the same kept-alive Replay Workspace with the `ai` capability, and that pane mounts `AiReviewWorkspacePane.vue` / `AiReviewPanel.vue` behind the shared auth + local-projection gates (there is no frontend maintenance gate; the `ai_maintenance` locale strings have no consumer). Transport stays in `api/ai-review.ts`; AI inputs are the client canonical projection (`replay-local/ai`), and the backend is the Yecao ai-service (see `docs/operations/ai-service.md`). Replay parsing and Battle Playback remain available through their existing tabs.

`app/viewRegistry.js` is the single source of truth for view names: `VIEW_COMPONENTS` maps supported query views and path-derived views (`android`, `sponsor`) to their components. `app/navigation.js` owns the deep-link contract on top of it, and an unknown view falls back to the default view, so `ALLOWED_VIEWS` must stay equal to the registered view names — `frontend/src/App.test.js` locks that equality. Adding or renaming a view means updating the registry, the allowlist, and its navigation entry points together; a one-sided change silently degrades to the default view instead of failing loudly. Only the landing views (`HomePage`, `ReplayWorkspace`) are imported eagerly; every other view is a `defineAsyncComponent` chunk, and inside the workspace the four capability panes (`BattlePlaybackPanel`, `Replay3DPane`, `ReplayShotsPane`, `AiReviewWorkspacePane`) go through the `defineLazyModule` failure boundary in `utils/lazyModule.ts`, so a stale hashed chunk 404 degrades to a visible, retryable in-pane state instead of unmounting the workspace. Tests that mock these modules must return `__esModule: true` and wait with `vi.dynamicImportSettled()`. `main.js` keeps `<html lang>` and `document.title` (`<section> · WoTBTools`) in sync with the locale and route.

`ViewHost.vue` maps the existing flat page components to a route-derived product view. The flat layout is the current implementation; do not treat another directory layout as already present. Do not add manual `history.pushState`, `replaceState`, or `popstate` listeners to a component; use the injected navigation command, which delegates to Vue Router.

Application navigation is defined by the feature-neutral typed `NAVIGATE_VIEW_KEY` in `frontend/src/shared/navigation.ts`. `AppShell` provides the command; app and feature consumers inject the shared contract without importing router internals or an `app/` implementation module. Production code must not introduce magic-string `inject('navigate')` / `provide('navigate')` calls.

## Dependency and state rules

The required dependency direction is:

```text
app → features → shared
```

The current source tree uses flat `components/`, `composables/`, and `utils/` directories; the dependency rule still applies conceptually without claiming feature folders that do not exist. New work should not create cross-feature private imports or place feature endpoint knowledge in shared code.

Each business state has one authoritative owner. Replay session state (selection, analysis state/results, workspace view state) is owned by `frontend/src/composables/useReplaySession.ts`; the local parse → batch-compute → client-export side effects are driven by `frontend/src/composables/useLocalReplayAnalysis.ts` (over `replay-local/parseReplays.ts` / `replay-local/analyzeReplays.ts`), while `useReplay.ts` and `useReplayWorkspace.ts` only expose that contract as facades to the orchestration SFC and capability panels. There is no Processing/Export job state (`useProcessingJob.ts` / `useExportJob.ts` are gone — the server has no replay parser). Derive values with `computed`; use `watch()` for real side effects or lifecycle bridges only, never to synchronize duplicate copies of the same state.

Core Replay/API/AI/Playback contracts live under `frontend/src/types/` and are validated at external JSON/SSE boundaries. JavaScript and TypeScript may coexist during the migration; a `.js` import specifier may resolve to its `.ts` implementation through the Vite/TypeScript resolver, but there must be only one implementation.

Replay HTTP ownership is centralized under `frontend/src/api/`. `replay-capabilities.ts` (name retained as a fossil) owns the shared Bearer/auth-session plumbing (`ReplayAuthSession`, `optionalBearer`, `authedReplayPost`) for the server calls that still exist; `ai-review.ts` owns AI Review SSE/HTTP transport; local parsing, batch compute, export and 2D playback have no HTTP transport (`replay-local/**`), and the locally produced Playback V2 dataset is validated at the boundary by `contract-runtime.ts` (`validateBattlePlaybackDataset`), not fetched. `AiReviewPanel.vue` and `BattlePlaybackPanel.vue` own run/view lifecycle only and must not recreate the `apiFetch` / `authedReplayPost` plumbing or hard-code transport calls.

Replay Workspace presentation is split into focused children (`PageHeader.vue`, `ReplayCapabilityTabs.vue`, `FileDrop.vue` — the single site-wide file surface — and `BattlePicker.vue` for the single-battle capabilities; status and gates use `EmptyState.vue` / `Banner.vue`). One workplace hosts all five capabilities (`data` / `playback` / `3d` / `shots` / `ai`): `ReplayWorkspace.vue` is the only capability orchestrator and lazy-mounts `BattlePlaybackPanel.vue`, `Replay3DPane.vue`, `ReplayShotsPane.vue` and `AiReviewWorkspacePane.vue` on first activation (`composables/useMountedWhenActive.js`), keeping each pane's session alive when the capability is switched away. The three single-battle panes and the 3D pane share one `file` / `active` / `blockedReason` prop contract; none of them owns a file picker or a second session. The Data result toolbar inside `ReplayPage.vue` uses `SegmentedControl.vue`, `BattlePicker.vue` and `MenuButton.vue`; `SeriesOverview.vue` renders the series score derived by `utils/replaySeries.js`. Selection / analysis state / current battle remain owned by `useReplayWorkspace()` / the Replay session (local parse + batch compute side effects run through `useLocalReplayAnalysis`). Direct parent-child dependencies are explicit: `ReplayWorkspace.vue` passes the authoritative replay session and workspace presentation state to `ReplayPage.vue` as props instead of hiding them behind `provide('replay')` / `provide('replayWorkspace')`. Authentication is consumed from the existing `useAuth()` singleton rather than re-exported by `AppShell` through string service-locator keys.

The armor viewer (`agent-armor`) requires authentication, with its gate in `ViewHost` before lazy-loading the page. Browser login preserves the complete scene query; ordinary signed-in users can consume shot reconstruction without an admin role. It stays a separate page: it belongs to the Tankopedia side and keeps its own URL contract (`?tank= &shooter= &config= &shell= &shot= &world=1`). The Replay workplace reuses its *engine* (penetration math, tank assets, `scene/tankViewer.js` marker palette), not its page navigation model — the shot inspector hands the shot data over through the existing local handoff channel and asks the router to open that destination.

`app/viewRegistry.js` is the single view → capability map: `replay` → `data`, `battle-playback` → `playback`, `agent-replay` → `3d`, `agent-shots` → `shots`, `ai-review` → `ai`. All five capabilities are publicly discoverable. Data and 2D Playback are usable anonymously; 3D Playback, Shot Analysis / Reconstruction and AI Review require authentication. `wotbtools-admin` does not alter Replay Workspace capabilities.

Battle Playback follows the same presentation boundary: `BattlePlayback.vue` remains the orchestration root, while `BattlePlaybackHud.vue`, `BattleMap.vue`, `PlaybackControls.vue`, `PlaybackTimeline.vue`, `PlaybackSidePanel.vue`, `AnnotationToolbar.vue`, and `VehicleDetailsPanel.vue` own HUD, map, controls, timeline, panel, annotation, and selected-vehicle presentation respectively. `PlaybackMobileOverlay.vue` owns only transient mobile controls visibility. Pure playback projection and clock helpers live in `utils/playbackVehicleState.ts` and `utils/playbackClock.ts`; canonical V2 query semantics and tank-marker assets remain unchanged.

Persisted Playback presentation state is owned by `composables/usePlaybackPreferences.ts`: player/tank labels, HP HUD visibility, recent trails, pane widths, and rail collapse all retain their historical storage keys/defaults but no longer implement independent localStorage readers/watchers inside `BattlePlayback.vue`. The root consumes these reactive preferences and keeps domain projection/rendering independent from persistence policy.

Playback tests follow those ownership boundaries: map/marker/gesture contracts live in `BattleMap.test.js`, control contracts in `PlaybackControls.test.js`, timeline contracts in `PlaybackTimeline.test.js`, HUD/mobile/panel contracts in their focused component suites, detail-panel contracts in `VehicleDetailsPanel.test.js`, and pure projection/clock contracts in `utils/playbackVehicleState.test.js` / `utils/playbackClock.test.js`. Shared playback fixtures live in the testing-only `playbackTestHarness.js`. `BattlePlayback.test.js` and the remaining `BattlePlayback.integration.test.js` cases are reserved for cross-component/domain regressions; presentation cases are not duplicated there.

Source-level CSS guards remain useful for ownership invariants, but final layout behavior is not inferred from CSS text. `npm run test:browser-layout` launches the Chrome/Chromium available on the CI runner, loads the actual shared/PC/tablet/mobile Playback stylesheets, and checks real computed styles / geometry for 1600×900 PC, 1024×768 tablet, 390×844 mobile, plus a cross-form isolation case. This gate runs in the frontend CI before the production build. CSS text cannot show *interaction* truth either, so `npm run test:browser-interaction` covers the complementary half: it loads the real app (router / AppShell / ReplayWorkspace / every stylesheet, with only the Keycloak boundary stubbed), emulates device metrics plus coarse pointer, drives the **real input pipeline** (raw touch / mouse events, never synthetic `click()`), and proves via in-page event records that the real click target **is** the intended control. It covers 375×812 / 390×844 portrait coarse, 740×360 landscape coarse, 1024×768 tablet, 1600×900 desktop, capability switching, unauthenticated login failure visibility + retryability, `duration <= 0` transport unavailability, and portrait→landscape rotation.

The UI profile remains presentation-only: `wotb-ui-profile` is the single persistence key, and its derived `data-theme` does not create a separate theme state. Showcase and Classic must use the same components, APIs, and business state.

## Single-PR consolidation scope

The architecture cleanup is intentionally completed inside one PR so `main` never contains half-migrated boundaries. The consolidated boundary is complete when these layers are reviewed together:

- [x] feature-neutral typed application navigation contract;
- [x] Dataset-only AI Review / Map Overview / Battle Playback API ownership moved out of panels;
- [x] Replay Workspace string service-locator dependencies replaced with direct auth consumption and explicit parent-child replay/workspace props;
- [x] high-value Battle Playback persistence ownership extracted from the orchestration root;
- [x] architecture guards for removed service-locator keys and replay capability transport ownership;
- [x] real-browser Playback geometry / form-isolation gate added to frontend CI;
- [x] final architecture/code-smell pass removed stale navigation/auth/replay injection bridges and duplicate Playback persistence ownership.

Directory-only rewrites, Pinia adoption without a demonstrated ownership need, broad visual redesign, and unrelated product changes are explicitly outside this PR. The existing `?view=` compatibility contract remains in place because deleting that compatibility layer is a product URL migration, not a prerequisite for fixing the ownership problems above.

## Canonical feature references

- Replay Workspace ownership and capability boundaries: [`replay-workspace.md`](replay-workspace.md)
- UI Profile, tokens and responsive constraints: [`ui-system.md`](ui-system.md)
- Replay/AI/Playback product and API contracts: [`../architecture/ai-review.md`](../architecture/ai-review.md), [`../features/team-ai-review.md`](../features/team-ai-review.md), [`../features/battle-playback.md`](../features/battle-playback.md)

## Verification expectations

Architecture work starts with `.agents/skills/frontend-architecture/SKILL.md`. Cover the changed boundary with focused tests. Routing work must cover legacy/deep links, Back/Forward, authentication destinations when affected, and the Android route. Playback layout changes must keep `npm run test:browser-layout` green, and Playback / Replay Workspace **interaction** changes (hit targets, pointer-events, capability switching, auth gating, transport controls) must keep `npm run test:browser-interaction` green, in addition to focused Vitest suites. Dependency or router changes require `npm run build`; full frontend CI remains the final repository-wide gate.

## Android local-first runtime and capability ownership

Android starts the same Vue application from `https://appassets.androidplatform.net/index.html`; the APK contains its chunks, commit-addressed Rust/WASM parser, 2D assets and local shooting inputs. Native owns lifecycle/update, AppAuth PKCE/token state, external file ingress and connectivity; Vue owns routing/product UI/capability gates. Web preserves same-origin transport; Android remote business transport resolves to `https://wotbtools.com` and uses Native-provided Bearer tokens. Exact-origin CORS is owned by the production gateway. Bundled frontend and deployed Web frontend are independent release artifacts.

`ReplayWorkspace` retains one selection/session owner and the existing five capability/view mappings. LOCAL data/Rating/2D/shooting inspection remain usable without Internet. ONLINE_REQUIRED 3D/AI/HoF/Profile are still discoverable and gate before mount, auth or request; the reason comes from the shared capability model rather than a network timeout. Disconnect preserves local state and cached Native auth; existing 3D session generations and AI AbortController stop remote work. Reconnect updates availability immediately, resumes a connectivity-blocked 3D/HoF/Profile once, and never automatically submits AI. The full matrix and snapshot source/update boundary live in [`replay-workspace.md`](replay-workspace.md).
