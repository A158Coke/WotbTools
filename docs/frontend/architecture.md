# Frontend architecture

## Current foundation (PR 1)

The application root, [`frontend/src/App.vue`](../../frontend/src/App.vue), only renders Vue Router's outlet. Application concerns live in `frontend/src/app/`:

```text
App.vue
  → app/router.js
  → app/AppShell.vue
      ├── AppHeader.vue
      │   └── UserMenu.vue
      ├── ViewHost.vue
      └── GlobalErrorDialog.vue
```

`router.js` owns browser history, deep-link handling, redirects, and Back/Forward. Product URLs deliberately retain the compatible query contract: `?view=replay`, `?view=ai-review`, and `?view=battle-playback` all resolve to the same kept-alive Replay Workspace with a different initial capability. Legacy aliases (`leaderboard`, `extended`, `reconstruction`) redirect once to their canonical query values. `/download/android` and `/download/android/` resolve to the Android page.

`ViewHost.vue` maps the existing flat page components to a route-derived product view. The flat layout is the current implementation; do not treat another directory layout as already present. Do not add manual `history.pushState`, `replaceState`, or `popstate` listeners to a component; use the injected navigation command, which delegates to Vue Router.

Application navigation is defined by the feature-neutral typed `NAVIGATE_VIEW_KEY` in `frontend/src/shared/navigation.ts`. `AppShell` provides the command; app and feature consumers inject the shared contract without importing router internals or an `app/` implementation module. Production code must not introduce magic-string `inject('navigate')` / `provide('navigate')` calls.

## Dependency and state rules

The required dependency direction is:

```text
app → features → shared
```

The current source tree uses flat `components/`, `composables/`, and `utils/` directories; the dependency rule still applies conceptually without claiming feature folders that do not exist. New work should not create cross-feature private imports or place feature endpoint knowledge in shared code.

Each business state has one authoritative owner. Replay state is owned by `frontend/src/composables/useReplaySession.ts`; `useProcessingJob.ts`, `useReplay.ts`, `useExportJob.ts`, and capability panels consume its refs and commands. Derive values with `computed`; use `watch()` for real side effects or lifecycle bridges only, never to synchronize duplicate copies of the same state.

Core Replay/API/AI/Playback contracts live under `frontend/src/types/` and are validated at external JSON/SSE boundaries. JavaScript and TypeScript may coexist during the migration; a `.js` import specifier may resolve to its `.ts` implementation through the Vite/TypeScript resolver, but there must be only one implementation.

Replay Workspace presentation is split into focused children (`ReplayWorkspaceHeader.vue`, `ReplayCapabilityTabs.vue`, and `ReplaySourcePanel.vue`). They receive derived state and emit commands; selection, capability, authentication, upload, and Processing ownership remains in the Workspace/session orchestration layer.

Battle Playback follows the same presentation boundary: `BattlePlayback.vue` remains the orchestration root, while `BattlePlaybackHud.vue`, `BattleMap.vue`, `PlaybackControls.vue`, `PlaybackTimeline.vue`, `PlaybackSidePanel.vue`, `AnnotationToolbar.vue`, and `VehicleDetailsPanel.vue` own HUD, map, controls, timeline, panel, annotation, and selected-vehicle presentation respectively. `PlaybackMobileOverlay.vue` owns only transient mobile controls visibility. Pure playback projection and clock helpers live in `utils/playbackVehicleState.ts` and `utils/playbackClock.ts`; canonical V2 query semantics and tank-marker assets remain unchanged.

Playback tests follow those ownership boundaries: map/marker/gesture contracts live in `BattleMap.test.js`, control contracts in `PlaybackControls.test.js`, timeline contracts in `PlaybackTimeline.test.js`, HUD/mobile/panel contracts in their focused component suites, detail-panel contracts in `VehicleDetailsPanel.test.js`, and pure projection/clock contracts in `utils/playbackVehicleState.test.js` / `utils/playbackClock.test.js`. Shared playback fixtures live in the testing-only `playbackTestHarness.js`. `BattlePlayback.test.js` and the remaining `BattlePlayback.integration.test.js` cases are reserved for cross-component/domain regressions; presentation cases are not duplicated there.

The UI profile remains presentation-only: `wotb-ui-profile` is the single persistence key, and its derived `data-theme` does not create a separate theme state. Showcase and Classic must use the same components, APIs, and business state.

## Canonical feature references

- Replay Workspace ownership and capability boundaries: [`replay-workspace.md`](replay-workspace.md)
- UI Profile, tokens and responsive constraints: [`ui-system.md`](ui-system.md)
- Replay/AI/Playback product and API contracts: [`../architecture/ai-review.md`](../architecture/ai-review.md), [`../features/team-ai-review.md`](../features/team-ai-review.md), [`../features/battle-playback.md`](../features/battle-playback.md)

## Verification expectations

Architecture work starts with `.agents/skills/frontend-architecture/SKILL.md`. Cover the changed boundary with focused tests. Routing work must cover legacy/deep links, Back/Forward, authentication destinations when affected, and the Android route. Dependency or router changes require `npm run build`; full frontend CI remains the final repository-wide gate.
