---
name: frontend-architecture
description: Inspect, implement, or review Vue frontend architecture changes where feature ownership, reactive state ownership, routing, or API boundaries may change. Do not use for isolated visual-only fixes.
---

# Frontend Architecture

Use this skill for structural frontend work. Preserve product behavior and existing backend/replay contracts unless a verified defect requires a change.

## Workflow

1. **DISCOVER** — Read the applicable `AGENTS.md`, architecture docs, and the smallest relevant tests. Inspect real imports and runtime entry points before choosing a target structure.
2. **TRACE** — Follow each changed state, route, API call, and user transition to its authoritative owner. Include deep-link, Back/Forward, auth, and async completion paths when relevant.
3. **OWNERSHIP** — Identify one owner for every business state. Prefer derived `computed` values over refs synchronized by watchers. A watcher is valid only for a side effect or lifecycle bridge.
4. **BOUNDARY** — Keep dependencies directed `app → features → shared`. A feature may use another feature only through a small explicit public contract. `shared/` must remain feature-neutral. Cross app/feature injection contracts use typed `InjectionKey<T>` values from `shared/`; never introduce magic-string service locators.
5. **HTTP BOUNDARY** — Components own rendering and lifecycle, not endpoint/auth/error parsing. Replay capability transport belongs in `src/api/`; do not duplicate bearer refresh, `apiFetch`, endpoint strings, or runtime wire validation inside panels.
6. **VUE SMELL CHECK** — Check for God SFCs/composables, domain calculations in templates, duplicated API/auth/download code, and tests that hide unrelated responsibilities in one giant fixture.
7. **IMPLEMENT / REVIEW** — Make the smallest coherent extraction. Do not create empty folders, abstraction wrappers, global stores, or framework migrations merely to satisfy a structure diagram.
8. **VERIFY** — Run targeted tests for changed responsibility boundaries. Source guards may enforce dependency/API ownership only; browser layout/fullscreen/pointer behavior needs browser-level verification when changed. When routing, dependencies, or bundles change, run the required build validation.
9. **REPORT** — State the authoritative owner, preserved contracts, files changed, validation, and any deliberate temporary bridge with its removal condition.

## Hard constraints

- Vue Router owns browser navigation, deep links, redirects, and Back/Forward. Do not reintroduce manual `popstate` or history synchronization in components.
- Preserve `wotb-ui-profile` as the only presentation-profile persistence key. UI profiles never fork business state or components.
- Replay protocol facts and processing-dataset identity remain authoritative. Do not invent missing battle facts or recreate an upload/processing flow to simplify an architectural change.
- Feature components use feature APIs or explicit injected/public contracts; generic HTTP behavior belongs in shared infrastructure.
- `AiReviewPanel.vue` / `BattlePlaybackPanel.vue` must not own raw `/api/replay/*` transport; their transport boundary is `src/api/replay-capabilities.ts`.
