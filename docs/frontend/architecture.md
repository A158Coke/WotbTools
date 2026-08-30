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

`ViewHost.vue` is a temporary page host during the incremental migration: `viewRegistry.js` maps the existing flat page components to a route-derived product view. Later PRs move feature pages without changing the URL contract. Do not add manual `history.pushState`, `replaceState`, or `popstate` listeners to a component; use the injected `navigate(view)` command, which delegates to Vue Router.

## Dependency and state rules

The intended dependency direction is:

```text
app → features → shared
```

The flat `components/`, `composables/`, and `utils/` directories remain transitional until their owning feature PRs. New work should not create cross-feature private imports or place feature endpoint knowledge in shared code.

Each business state has one authoritative owner. Derive values with `computed`; use `watch()` for real side effects or lifecycle bridges only, never to synchronize duplicate copies of the same state.

The UI profile remains presentation-only: `wotb-ui-profile` is the single persistence key, and its derived `data-theme` does not create a separate theme state. Showcase and Classic must use the same components, APIs, and business state.

## Verification expectations

Architecture work starts with `.agents/skills/frontend-architecture/SKILL.md`. Cover the changed boundary with focused tests. Routing work must cover legacy/deep links, Back/Forward, authentication destinations when affected, and the Android route. Dependency or router changes require `npm run build`; full frontend CI remains the final repository-wide gate.
