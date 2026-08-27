# Avatar method4 — round finished

> Corpus: 34 unique Blitz 11.19.0 China arenas.
>
> Verdict: **PROVEN current behavioral identity** for complete end-of-round streams.

## Wire shape

On the current Avatar entity, method4 has a two-byte argument body:

```text
winnerTeam   : u8
finishReason : u8
```

30/34 replays contain this method. The four missing cases are stream-completeness/end-tail boundaries and are not evidence for a different schema.

## Exact AFTERBATTLE clock closure

For all 30 method4 observations:

```text
method4.rawClock == subtype48 wrapper3 ARENA_PERIOD.AFTERBATTLE rawClock
30 / 30
```

The first argument equals wrapper3's winner-team field and the second argument equals wrapper3's finish-reason field for every observation.

The first byte also agrees with battle-results root winner team.

## finishReason behavior in the current corpus

Only values `1` and `6` occur.

### reason = 1 — enemy team eliminated

11/11 reason-1 battles satisfy:

```text
all 7 settled combatants on the losing team were killed before round finish
```

The winning team still has one or more settled combatants alive.

Safe current meaning:

> finishReason 1 = **battle ended by elimination / losing combat team destroyed — PROVEN behavioral**.

### reason = 6 — Supremacy score cap

19/19 reason-6 battles satisfy:

```text
winning team's realtime subtype48 wrapper13 Supremacy points == 1000
```

This includes battles where the losing side still has surviving combatants, so the event is not an elimination alias.

Safe current meaning:

> finishReason 6 = **battle ended by reaching the 1000-point Supremacy cap — PROVEN behavioral**.

## Historical cross-version support

Historical Wargaming `Avatar.def` exposes replay-visible:

```text
onRoundFinished(INT8, UINT8, PYTHON)
```

The current Blitz 11.19 method4 two-byte payload matches the first two semantic arguments exactly. The historical trailing Python argument is not present in the current observed wire body, so it must not be transplanted into the Blitz decoder.

Therefore the symbolic family `onRoundFinished` is independently supported, while the current two-byte body remains the authoritative version-specific schema.

## Production-safe model

```text
RoundFinished {
  winnerTeam: 1 | 2
  finishReasonRaw: u8
  finishCause:
    ELIMINATION        // raw 1, current corpus
    SUPREMACY_1000     // raw 6, current corpus
    UNKNOWN(raw)       // preserve future values
}
```

Do not infer a missing method4 when the replay stream is truncated near the physical/end-of-recording boundary; battle-results may still contain a complete settlement.