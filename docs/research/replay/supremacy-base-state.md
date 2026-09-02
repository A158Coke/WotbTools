# Supremacy Base Realtime State

> Status: protocol research / documentation only.
>
> Scope: Blitz 11.19.0 China replay corpus, with additional validation against 34 tournament Supremacy replays supplied for base-state research.
>
> This document records only evidence-backed protocol facts and the required canonical architecture boundary. It does **not** authorize frontend protocol inference.

## Executive verdict

Realtime Supremacy base state is carried by the existing Type 8 / subtype 48 `updateArena2` wrapper family.

Current validated path:

```text
Type 8 EntityMethod
→ subtype 48 / updateArena2
→ wrapperFieldNumber = 12
→ root field 11
→ repeated base-state update
```

The following fields are promoted for the current corpus:

```text
field1 = base index       PROVEN
field2 = owner team       PROVEN
field3 = capturing team   PROVEN
field4 = capture progress PROVEN
field5 = UNKNOWN
field6 = UNKNOWN
```

Confirmed base identity mapping:

```text
0 = A
1 = B
2 = C
3 = D
```

The protocol can therefore support a permanent Battle Playback HUD showing the current state of A/B/C/D and, when present, the active capturing team and capture progress.

## Evidence corpus

The dedicated research set contains 34 tournament replays in Supremacy mode (`arenaBonusType = 2`) across multiple 3-base and 4-base maps.

The research requirement is cross-replay consistency, not a single timing coincidence. The current conclusion is based on all of the following:

- stable `subtype 48 → wrapper 12 → root field 11` structure;
- stable base-index value domain across 3-base and 4-base maps;
- initialization records matching the number of bases in the map;
- repeated progress updates during visible base capture windows;
- ownership commits immediately following high capture progress;
- recapture sequences where an already owned base is captured by the opposite team;
- consistency with the separately PROVEN realtime Supremacy score stream (`wrapper 13`), used only as secondary validation.

Supremacy points are **not** used to infer which base is owned. Base ownership comes directly from wrapper12/root11.

## Wire structure

The enclosing packet follows the existing Type 8 envelope documented in `entity-methods.md`:

```text
entityId : u32/i32 LE
subtype  : u32 LE
argLen   : u32 LE
args     : argLen bytes
```

For subtype48, the existing decoder extracts:

```text
wrapperFieldNumber
root protobuf
```

For realtime base state:

```text
wrapperFieldNumber = 12
root field          = 11
```

The value in root field11 is a nested protobuf base-state update.

## Base field mapping

### field1 — base index

Current verdict: **PROVEN**.

Value domain:

```text
0,1,2,3
```

Confirmed domain mapping:

```text
0 → A
1 → B
2 → C
3 → D
```

Protobuf default-value behavior means field1 may be absent when the base index is `0` (`A`). Consumers must not interpret an absent encoded field1 as “no base”. The raw decoder must apply protobuf default semantics before producing a domain base ID.

Three-base maps produce A/B/C. Four-base maps produce A/B/C/D.

### field2 — current owner team

Current verdict: **PROVEN**.

Observed semantic domain:

```text
1 = team 1
2 = team 2
```

The strongest validation is capture completion: high-progress updates for a capturing team are followed by an owner update to that same team, with no contradictory completion transition in the validated corpus.

Field2 represents **current ownership**, not merely “the team involved in the current capture”. Recapture samples show an existing owner while the opposite team is actively capturing, followed by an owner change when the capture completes.

Neutral ownership is represented canonically as `null`; do not introduce a duplicate `UNKNOWN`/`NEUTRAL` protocol enum unless later protocol evidence requires a distinct state.

### field3 — capturing team

Current verdict: **PROVEN**.

Observed semantic domain:

```text
1 = team 1
2 = team 2
```

When a base is being captured, field3 identifies the team performing the capture. Recapture samples demonstrate that `ownerTeam` and `capturingTeam` may be different at the same time.

### field4 — capture progress

Current verdict: **PROVEN**.

Observed behavior is a replay-broadcast progress value that increases during a capture window and approaches completion before the owner transition.

Example shape:

```text
3, 7, 10, 14, ... 92, 96, 99
```

The exact increment is not a frontend rule and must never be simulated or extrapolated by the client. The replay value is authoritative for the observed progress sample.

### field5 / field6

Current verdict: **UNKNOWN**.

These fields are observed in the base-state family but their exact semantics are not closed. They may correlate with capture lifecycle conditions, but no user-facing name is authorized.

Requirements:

- preserve them in research/raw diagnostics where useful;
- do not expose them as `contested`, `blocked`, `paused`, or any other semantic flag;
- do not make canonical state depend on a guessed meaning;
- promote only after independent replay evidence or a current-version schema closes the semantics.

## Raw update vs canonical state

The nested protobuf is an **update message**. It must not be treated as an already complete frontend snapshot.

This distinction is critical:

```text
field absent
!= automatically “canonical value becomes null”
```

The same architectural rule already applies elsewhere in playback sparse timelines: absence of a transition is different from an explicit invalidation.

Recommended internal separation:

```text
RawSupremacyBaseUpdate
        ↓
backend reconstruction
        ↓
SupremacyBaseStateTransition
```

The raw decoder is responsible for wire/protobuf interpretation. A backend reconstruction layer is responsible for the state lifecycle and for deciding when canonical `capturingTeam` / `captureProgress` are retained, changed, or cleared.

The frontend must never merge raw protobuf updates into state.

## Canonical domain model

Recommended canonical identity:

```java
enum SupremacyBaseId {
    A, B, C, D
}
```

`0..3` is the protocol representation. `A..D` is the domain representation and is what the HTTP/playback contract should expose.

Recommended sparse full-state transition:

```text
SupremacyBaseStateTransition {
    timeSec
    baseId
    ownerTeam
    capturingTeam
    captureProgress
}
```

Semantics:

```text
baseId          = A | B | C | D
ownerTeam       = 1 | 2 | null
capturingTeam   = 1 | 2 | null
captureProgress = replay value | null
```

Each canonical transition should contain the complete state required by the renderer at that time. The frontend should not need to retain previous protocol fields to reconstruct the current state.

## Time domain

Raw packet `rawClockSec` is not the final playback time exposed to the frontend.

Base transitions must use the same battle-relative time domain as the rest of `BattlePlaybackDataset`, anchored by the existing arena-period BATTLE transition (`subtype48 wrapper3`).

Required chain:

```text
raw replay clock
→ existing battle-relative projection
→ SupremacyBaseStateTransition.timeSec
```

This guarantees that seeking to a playback time yields the same time reference for vehicles, HP, damage, Supremacy points, and base state.

## Backend / frontend responsibility boundary

The established architecture remains:

```text
Backend = replay/domain engine
Frontend = renderer
```

### Backend owns

- Type8/subtype48 decoding;
- wrapper12/root11 identification;
- protobuf field semantics;
- protobuf default handling (`field1` absent → index 0/A where structurally valid);
- base index → A/B/C/D mapping;
- raw-update merge/reconstruction;
- owner/capture lifecycle;
- explicit clearing/invalidation semantics;
- battle-relative timestamp projection;
- canonical sparse base-state timeline.

### Frontend may own

- `lastAtOrBefore` / query-at-current-time over canonical tracks;
- mapping team 1/2 to friendly/enemy presentation using the already supplied playback perspective;
- formatting and localization;
- CSS/animation;
- permanent Base HUD rendering.

### Frontend must not own

- wrapper/root/protobuf knowledge;
- base index decoding;
- missing-field interpretation;
- capture lifecycle inference;
- progress extrapolation;
- Supremacy-points-based base inference;
- field5/field6 semantic guesses.

## Battle Playback product requirement

The map images are manually maintained assets and already contain the static A/B/C/D base graphics. The first implementation must **not** add a second set of dynamically positioned base circles.

Instead, Battle Playback should permanently display a base-state HUD whenever canonical Supremacy base tracks are present.

Conceptual states:

```text
A  friendly
B  neutral
C  enemy
D  enemy → friendly 57%
```

Requirements:

- permanently visible while Playback is shown;
- updates when playback time changes, including seek/pause/play;
- 3-base maps render A/B/C only;
- 4-base maps render A/B/C/D;
- neutral/owner/capturing/progress come only from backend canonical state;
- no tooltip, toast, coach mark, tutorial, or modal;
- no frontend inference from the baked map image;
- no dynamic base-coordinate metadata is required for this first version.

## HTTP/OpenAPI boundary

When implementation begins, the FE↔BE wire SSOT remains `contracts/http/openapi.yaml`.

The implementation order must be:

```text
backend canonical model
→ OpenAPI contract
→ generated frontend types/schema
→ frontend renderer
```

Generated frontend contract files must not be hand-edited.

A conceptual HTTP shape is:

```text
SupremacyBaseStateTransition {
    timeSec: number
    baseId: A | B | C | D
    ownerTeam: integer | null
    capturingTeam: integer | null
    captureProgress: integer | null
}
```

The exact container shape (`baseStates[]` vs per-base tracks) may be chosen during implementation, but it must remain canonical and must not expose raw protocol fields.

## Required regression coverage before production promotion

A research probe alone is not sufficient once the feature enters production.

Production regression coverage should include at least:

```text
neutral → capturing → captured

owned by team2
→ team1 capturing
→ capture cancelled / cleared

owned by team2
→ team1 capturing
→ owner becomes team1

3-base initialization
4-base initialization

base index 0 / A protobuf-default case

wrong wrapper / malformed root
→ no canonical base event
```

The implementation must also verify that field5/field6 remain non-semantic until separately proven.

## Evidence and promotion rules

1. Current Blitz corpus evidence wins over historical PC/Wargaming numeric labels when they conflict.
2. Supremacy points may corroborate base ownership but may not be used to derive it.
3. Wire structure and semantic meaning are separate promotion steps.
4. Unknown fields are preserved/fail-closed rather than guessed.
5. Protocol representation (`0..3`) must not leak into the frontend when a stable domain representation (`A..D`) exists.
6. Canonical state is backend-owned; the frontend renders current-time truth only.
7. Future protocol versions must be revalidated if subtype/wrapper schemas drift.

## Current verdict table

| Item | Verdict |
|---|---|
| Type8 subtype48 as wrapped arena-update family | PROVEN |
| wrapper12 | PROVEN base realtime-state family |
| root field11 | PROVEN base-state payload |
| field1 | PROVEN base index |
| `0=A, 1=B, 2=C, 3=D` | CONFIRMED domain mapping |
| field2 | PROVEN current owner team |
| field3 | PROVEN capturing team |
| field4 | PROVEN capture progress |
| field5 | UNKNOWN |
| field6 | UNKNOWN |
| realtime Supremacy points (`wrapper13`) | PROVEN, secondary validation only |
| frontend protocol/state inference | FORBIDDEN |

## Implementation status

This document records the protocol and architecture decision only.

At the time of this documentation change, it does not claim that production code already emits `SupremacyBaseStateTransition` or that Battle Playback already renders the permanent Base HUD. Those are follow-up implementation tasks and must be reviewed against this evidence contract.
