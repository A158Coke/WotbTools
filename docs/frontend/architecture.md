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

`ViewHost.vue` maps the existing flat page components to a route-derived product view. The flat layout is the current implementation; do not treat another directory layout as already present. Do not add manual `history.pushState`, `replaceState`, or `popstate` listeners to a component; use the injected `navigate(view)` command, which delegates to Vue Router.

## Dependency and state rules

The required dependency direction is:

```text
app → features → shared
```

The current source tree uses flat `components/`, `composables/`, and `utils/` directories; the dependency rule still applies conceptually without claiming feature folders that do not exist. New work should not create cross-feature private imports or place feature endpoint knowledge in shared code.

Each business state has one authoritative owner. Derive values with `computed`; use `watch()` for real side effects or lifecycle bridges only, never to synchronize duplicate copies of the same state.

The UI profile remains presentation-only: `wotb-ui-profile` is the single persistence key, and its derived `data-theme` does not create a separate theme state. Showcase and Classic must use the same components, APIs, and business state.

## Canonical feature references

- Replay Workspace ownership and capability boundaries: [`replay-workspace.md`](replay-workspace.md)
- UI Profile, tokens and responsive constraints: [`ui-system.md`](ui-system.md)
- Replay/AI/Playback product and API contracts: [`../architecture/ai-review.md`](../architecture/ai-review.md), [`../features/team-ai-review.md`](../features/team-ai-review.md), [`../features/battle-playback.md`](../features/battle-playback.md)

## Verification expectations

Architecture work starts with `.agents/skills/frontend-architecture/SKILL.md`. Cover the changed boundary with focused tests. Routing work must cover legacy/deep links, Back/Forward, authentication destinations when affected, and the Android route. Dependency or router changes require `npm run build`; full frontend CI remains the final repository-wide gate.
