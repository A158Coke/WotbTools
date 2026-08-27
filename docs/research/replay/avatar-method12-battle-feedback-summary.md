# Avatar method12 — cumulative battle-feedback summary

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> This is the synchronized broad summary. Exact proof chains live in the dedicated method12 / settlement notes.

## Wire shape

Every current body is exactly 6 bytes:

```text
eventCode : u16 LE
count     : u16 LE
value     : u16 LE

baseType = eventCode & 0x00ff
tierRaw  = eventCode >> 8
```

Observed method12 records:

```text
total = 587
body length = 6 bytes in 587/587
```

`count` is normally a cumulative/ribbon progression dimension. `value` is used by numeric cumulative families and is zero for several event-count families. `tierRaw` is a feedback/presentation stage; exact private UI meaning remains PARTIAL.

## Current synchronized mapping

| baseType | Verdict | Current meaning |
|---:|---|---|
| 1 | PROVEN | cumulative damage dealt |
| 2 | PROVEN | cumulative enemies spotted |
| 3 | PROVEN | cumulative kills / enemies destroyed |
| 4 | UNKNOWN | zero-value count family; raw preserved |
| 5 | PROVEN | cumulative damage blocked |
| 6 | PROVEN current samples / limited-N | enemy ignition / set-on-fire count family |
| 8 | PARTIAL | critical/module result inflicted family |
| 12 | closed UNKNOWN exact semantic | same gameplay-stat family as settlement field118; old base-defense interpretation REJECTED |
| 15 | PROVEN | Destruction Assistance count/ribbon progression |
| 16 | PARTIAL | critical/device damage received family |
| 17 | PROVEN | cumulative total assist damage |

## baseType1 — damage dealt

Closed against Avatar prop10 and settlement damageDealt.

```text
method12 base1 value = recorder cumulative damageDealt
```

The method12 update is delayed relative to the lower-level HP/damage stream, so it is a feedback summary rather than the authoritative hit clock.

## baseType2 — enemies spotted

Dedicated current-corpus work closes the count against settlement PlayerResults field16 (`enemies spotted`) and recorder visibility/spotting facts.

```text
baseType2 count = cumulative enemies spotted
```

Verdict: **PROVEN current corpus**.

## baseType3 — kills

Final method12 count closes against settlement field18 in every applicable recorder sample.

```text
baseType3 count = cumulative kills / enemies destroyed
```

Verdict: **PROVEN**.

## baseType5 — damage blocked

Closed against Avatar prop11 and settlement field117.

```text
baseType5 value = cumulative damage blocked
```

Verdict: **PROVEN**.

## baseType6 — enemy ignition

Current sparse events align with independently proven fire-start evidence and recorder-caused ignition samples.

Verdict:

> baseType6 = **enemy ignition / set-on-fire feedback family — PROVEN on current observed samples, limited-N global confidence**.

Preserve the raw eventCode/tier because the corpus does not span every fire mechanic/version branch.

## baseType8 — critical/module inflicted

Current behavior associates baseType8 with outgoing critical/module result activity, but the exact private scoring/ribbon rule is not uniquely closed.

Verdict: **PARTIAL**. Do not convert it into a precise user-facing critical-count statistic without a controlled/schema closure.

## baseType12 ↔ settlement field118

Current author population:

```text
baseType12 present : 10 / 34
field118 present   : 10 / 34
presence mismatch  : 0
```

Every baseType12 event has:

```text
value = 0
count = 1..3
```

Author field118 values are:

```text
12,20,32,34,48,67,103,124,124,195
```

Therefore field118 is not a copy of count/value.

The old `base defended / droppedCapturePoints` interpretation is **REJECTED/SUPERSEDED** by mode/event controls.

Current status:

```text
same gameplay-stat family relationship = PROVEN
exact statistic name                    = CLOSED UNKNOWN
```

See `field118-basetype12-boundary.md`. Promotion requires a version-matched schema/client symbol or controlled/new samples; more correlation mining over the same 10 positives is non-authoritative.

## baseType15 — Destruction Assistance

Current behavior and settlement closure prove:

```text
final method12 base15 count == PlayerResults field119
```

including zero-by-absence across the canonical corpus.

Independent gameplay/event attribution separates this statistic from wrapper6 field3 majority-damage kill notification:

```text
baseType15 / field119
= cumulative Destruction Assistance

wrapper6.field3
= per-kill >50% prior-damage secondary notification assister
```

Verdict: **PROVEN current corpus**.

## baseType16 — critical/device received

Current samples associate this count family with incoming critical/device outcomes, but exact current symbolic rule remains PARTIAL.

Preserve raw values and do not expose a more specific user-facing label without new evidence.

## baseType17 — total assist damage

Avatar prop12 and prop13 are independently closed as two assist-damage subtype counters. method12 combines the retained current values:

```text
baseType17 value = prop12 + prop13
```

Verdict: **PROVEN relationship**.

The exact names of the two underlying assist subtypes remain version-sensitive unless separately closed.

## Safe model

```text
BattleFeedbackSummaryUpdate {
    baseType : u8
    tierRaw  : u8
    count    : u16
    value    : u16
    semantic
    confidence
}
```

Authoritative timing for damage/projectile/death still comes from lower-level event surfaces. method12 is a delayed cumulative feedback/ribbon surface.

## Rejected/superseded interpretations

```text
historical PC BATTLE_EVENT_TYPE numeric table == current Blitz method12 numbering  REJECTED
baseType12 == base defended / droppedCapturePoints                         REJECTED
baseType15 exact meaning UNKNOWN                                           SUPERSEDED; Destruction Assistance PROVEN
baseType2 exact meaning UNKNOWN                                            SUPERSEDED; enemies spotted PROVEN
```

Historical Wargaming battle-event tables are architectural context only; current Blitz numeric IDs are behaviorally decoded from current evidence.
