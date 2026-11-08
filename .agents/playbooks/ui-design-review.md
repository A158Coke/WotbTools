# UI Design Craft — Refactoring UI + Apple Design

> Domain playbook for the existing Designer → Executor → Review lifecycle. **Not a new top-level skill.**
> The upstream texts are vendored at `.agents/references/design-methods/`; the WotBTools design SSOT is `docs/frontend/design-language.md`.

## When to load

Designer loads this on visual redesign, layout, typography, color, glass/material, UI motion, navigation interaction, mobile UI or design-audit tasks. Executor loads it only when the approved plan changes UI. Review loads it when evaluating these changes. For routine backend tasks, do not load.

Read `../references/design-methods/refactoring-ui/SKILL.md` and `../references/design-methods/apple-design/SKILL.md` on demand. Load only relevant Refactoring UI chapters; do **not** reflexively execute its token-generation workflow: WotBTools already has a design system.

## Preflight (Designer)

1. Inspect current Vue components, `docs/frontend/design-language.md`, `docs/frontend/ui-system.md`, semantic tokens, motion ownership and relevant tests.
2. Capture rendered baseline at fixed commit: actual screenshots at desktop, touch portrait and touch landscape; relevant four-season theme states, open overlays, typography extremes and reduced-motion. Include Android/GeckoView where behavior differs.
3. Diagnose in Refactoring UI order: hierarchy → spacing/layout → typography → color → depth/material → imagery → details. Record exact screenshot/location, finding, applicable upstream principle, conflicting `DC-*` rule (if any), severity and uncertainty.
4. Audit interaction with Apple Design: immediate press feedback, direct manipulation, interruptibility/velocity handoff, spatial continuity, semantic materials, reduced motion and frame/performance behavior. Do not claim smoothness without a running interaction or measured frames.
5. Challenge pre-existing aesthetic rules when justified. The contract is **editable**, not infallible; write the design decision back to its existing owner after independent validation. Neither upstream skill supersedes project semantics automatically.
6. Propose smallest useful, reversible prototype(s) before expanding to all pages. A generated alternative is a hypothesis, not evidence of improvement.

## Implementation (Executor)

- Make a before/after prototype and attach screenshots or video showing unchanged business information and route behavior.
- Reuse Vue shared components, existing `motion-v`, semantic tokens and `motionPolicy.ts`. A new spring/gesture model may extend the single policy only if needed; **do not** install a second animation library by default.
- Translucency/glass is allowed as a design choice, even in data areas, **if** contrast across dynamic backgrounds, text legibility, fallbacks and device performance are demonstrated. Do not make everything glass for effect.
- Presentation-layer animations in playback/HUD/camera/timeline may be proposed, but event timestamps, frame seek, displayed HP and replay facts must remain correct. Verify rapid interruption, pause, seek and reverse; measure GPU/CPU rendering cost.
- Changes to aesthetics do not authorize API/domain/auth changes, full-site rewrites or theme-specific business forks.

## Independent review (Outside Judge)

- Verify identical scenario screenshots before/after across breakpoints and four themes; inspect computed contrast on actual composite backgrounds rather than only token pairings.
- Run applicable `frontend/` checks: `pnpm run lint:css`, `pnpm run typecheck`, affected Vitest and browser interaction/occlusion tests.
- For motion, capture interactive screen recordings and frame timing on a representative device; first measure the existing baseline. Respect `prefers-reduced-motion` and accessibility.
- Confirm no duplicate tokens/state, unnecessary dependency, broken pointer/keyboard reachability or gameplay semantic drift.
- Classify each proposed finding as Confirmed / Unverified / Contract Conflict / Already Compliant. Report limitations. No assertion of universal improvement based on style preference alone.

This playbook borrows methods, not a branded aesthetic. Do not automatically generate Apple-look pages or Tailwind token systems.
