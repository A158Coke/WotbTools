# Wrapper12 — Supremacy base capture state timeline

> **Superseded research note.** The authoritative evidence contract is
> [`supremacy-base-state.md`](supremacy-base-state.md). This file is retained as an
> index for older wrapper12 research and must not be used to assign production
> semantics to fields 5 or 6.

## Current wire boundary

Avatar method48 wrapper12 contains repeated root field11 child messages:

```text
field1 : protocol base index, protobuf default 0 when absent
field2 : owner team, 0 neutral / 1 / 2
field3 : capturing team, 0 none / 1 / 2
field4 : capture progress, 0..99
field5 : UNKNOWN
field6 : UNKNOWN
```

The decoder preserves field presence. In particular, an absent scalar is not the
same source fact as an explicitly encoded zero. Fields 5 and 6 may be retained as
raw diagnostics for research, but are not semantic evidence.

## Reconstruction boundary

The wire decoder emits `RawSupremacyBaseUpdate`. The backend then applies sparse
updates through `SupremacyBaseStateReconstructor`, retaining omitted owner,
capturing-team, and progress values from the previous state. Only the reconstructed
full state may be projected to playback:

```text
SupremacyBaseStateTransition {
    timeSec
    baseId              // A | B | C | D
    ownerTeam           // null / 1 / 2
    capturingTeam       // null / 1 / 2
    captureProgress     // null / 0..99
}
```

The backend alone maps protocol indices 0..3 to A..D. Frontend consumers must not
merge raw protobuf updates or infer lifecycle state from missing fields.

## Lifecycle rules

- explicit owner/capturing zero maps to canonical `null`;
- explicit capturing clear also clears capture progress;
- an ownership change while a capture is active clears capturing/progress;
- an omitted field retains its reconstructed value;
- field5/field6 never enter the canonical dataset, OpenAPI, generated frontend
  contract, or HUD.

For corpus evidence and the required regression scenarios, use
`supremacy-base-state.md` as the sole source of truth.
