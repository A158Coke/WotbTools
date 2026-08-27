# Avatar method12 — cumulative battle-feedback summary

> Corpus: 34 unique-arena Blitz 11.19.0 China replays.
>
> Scope: current Avatar-targeted method12 6-byte body. Exact current Blitz symbolic event names are only assigned where independent replay facts close them.

## Verdict

Avatar method12 is a **PROVEN cumulative battle-feedback / combat-summary surface**.

Every observed body is exactly 6 bytes:

```text
eventCode : u16 LE
count     : u16 LE
value     : u16 LE
```

Observed events:

```text
method12 total = 587
body length     = 6 bytes in 587/587
```

`eventCode` has a stable low-byte family plus a high-byte stage/tier component:

```text
baseType = eventCode & 0x00ff
tierRaw  = eventCode >> 8
```

Examples for the same cumulative damage family:

```text
0x0001 -> count 1..5
0x0101 -> later count values
0x0201 / 0x0301 -> higher stages in some arenas
```

The exact UI meaning of `tierRaw` is not yet proven and must remain raw.

## baseType 1 — cumulative damage dealt

This family is independently closed against Avatar Type7 `prop10`, already proven to mirror recorder cumulative settlement `damageDealt`.

Example sequence:

```text
prop10 clock/value      method12 clock/code/count/value
64.202 / 376            64.902 / 0x0001 / 1 / 376
75.198 / 436            75.907 / 0x0001 / 2 / 436
83.201 / 821            83.944 / 0x0001 / 3 / 821
92.189 / 1321           92.905 / 0x0001 / 4 / 1321
101.193 / 1693          101.901 / 0x0001 / 5 / 1693
110.196 / 2105          110.913 / 0x0101 / 6 / 2105
...
153.206 / 3708          153.898 / 0x0101 / 10 / 3708
```

Thus:

```text
baseType 1 value = recorder cumulative damageDealt
```

The method12 update is normally delayed by roughly UI/feedback latency relative to the authoritative live counter; it is a summary surface, not the earliest damage clock.

Verdict: **PROVEN**.

## baseType 5 — cumulative damage blocked

Non-zero baseType-5 `value` tracks Avatar `prop11`, independently proven as cumulative damage blocked.

Across current event-level joins, the value relationship is clean; final replay values also match settlement field117 (`damageBlocked`) except known replay-stream truncation boundaries.

Examples:

```text
300 -> 710 -> 1120
340 -> 680
340 -> 680 -> ... -> 2380
```

Verdict:

```text
baseType 5 value = cumulative damage blocked
```

**PROVEN current corpus**.

## baseType 17 — total cumulative assist damage

Avatar `prop12` and `prop13` are two independently proven assist-damage subtype counters, although their exact subtype labels remain unresolved.

method12 baseType17 combines them into one UI/feedback value:

```text
method12.value = prop12 + prop13
```

Observed non-zero baseType17 events: 25.

23/25 match the sum using a narrow preceding-update window directly. The remaining two are also exact once the already-existing value from the other assist subtype is retained instead of resetting an absent recent update to zero:

```text
arena 8958401623634049:
prop13 = 588
later prop12 = 124
method12 = 712

arena 8965453959931566:
prop13 = 386
later prop12 = 133
method12 = 519
```

Therefore:

```text
baseType 17 value = cumulative total assist damage
                  = assistSubtypeA + assistSubtypeB
```

Verdict: **PROVEN relationship**.

## baseType 3 — kill/destroy count

For every replay where baseType3 appears, the final method12 `count` equals recorder settlement field18 (`enemiesDestroyed` / kills):

```text
15 / 15 replay-level exact
```

Observed examples include cumulative counts 1, 2, 3 and 4.

Verdict:

```text
baseType 3 count = cumulative kills / enemies destroyed
```

**PROVEN current corpus**.

## baseType 15 ↔ settlement field119

A new independent relationship was discovered for the previously unresolved settlement field119.

For every replay where method12 baseType15 appears:

```text
final method12 baseType15 count == settlement field119
20 / 20 arenas
```

Both surfaces use small cumulative values in the observed range 1..3.

This proves that field119 is the settlement form of the same battle-feedback fact represented by method12 baseType15.

However, the gameplay meaning of baseType15 itself is not yet behaviorally closed. It must remain:

```text
baseType15 / settlement field119 = PROVEN same semantic fact
exact symbolic gameplay name     = UNKNOWN/PARTIAL
```

Do not name it `spotted`, `capture`, `critical`, etc. until an independent event/control experiment closes it.

## Other observed base types

Current low-byte base types are exactly:

```text
1, 2, 3, 4, 5, 6, 8, 12, 15, 16, 17
```

Current status:

| baseType | Current meaning | Status |
|---:|---|---|
| 1 | cumulative damage dealt | PROVEN |
| 3 | cumulative kills | PROVEN |
| 5 | cumulative damage blocked | PROVEN |
| 17 | cumulative total assist damage | PROVEN relationship |
| 15 | same fact as settlement field119 | PROVEN relationship / UNKNOWN symbolic name |
| 2 | unresolved zero-value count event | UNKNOWN |
| 4 | unresolved zero-value count event | UNKNOWN |
| 6 | unresolved rare zero-value count event | UNKNOWN |
| 8 | unresolved zero-value count event | UNKNOWN |
| 12 | unresolved zero-value count event | UNKNOWN |
| 16 | unresolved zero-value count event | UNKNOWN |

## Safe model

```text
BattleFeedbackSummaryUpdate {
    baseType : u8
    tierRaw  : u8
    count    : u16
    value    : u16
}
```

This surface is useful for UI/AI facts, but authoritative event timing should still come from the lower-level HP/projectile/damage/property streams because method12 behaves like a delayed cumulative feedback update.

## Historical cross-version note

Historical Wargaming clients define battle feedback and battle-event summary structures, but their numeric `BATTLE_EVENT_TYPE` assignments do **not** match the current Blitz method12 base codes. For example, historical PC event type 1 is radio assist while current method12 baseType1 is behaviorally proven cumulative damage dealt.

Therefore historical event-number tables must not be transplanted into Blitz 11.19.
