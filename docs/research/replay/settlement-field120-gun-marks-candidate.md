# Settlement field120 — Gun Marks count candidate

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas, 476 settled PlayerResults records.
>
> Verdict: **STRONG PARTIAL**. The current corpus and current Blitz product behavior align tightly, but no current-version symbolic protobuf schema has yet been found that names tag 120 directly.

## Current wire/domain facts

PlayerResults info field120 is a protobuf varint with current values:

```text
0 : 371 records
1 :   3 records
2 :   4 records
3 :  98 records
```

No value outside `0..3` appears in the canonical corpus.

## It is not a single-battle performance outcome

Earlier corpus controls already showed that field120 does not behave like damage, XP, kills, survival, mastery earned in this battle, or another battle-result score.

In particular:

- high field120 values occur in low-XP as well as high-XP battles;
- the XP distribution for field120=3 is not materially higher than field120=0;
- the same player/tank combinations tend to preserve the same value across multiple battles;
- the value therefore behaves as a persistent player×vehicle state copied into the result record.

This rejects interpreting field120 as the battle's newly earned mastery badge/class.

## Current Blitz Gun Marks are an exact behavioral-shape candidate

Current official World of Tanks Blitz documentation defines Gun Marks as a persistent per-vehicle achievement with exactly four possible counts:

```text
0 marks
1 mark
2 marks
3 marks
```

The product rules state that:

- Gun Marks measure player excellence on a specific tank;
- each tank can have at most three marks;
- once earned, a mark is not downgraded;
- marks are visible in battle-result UI/team surfaces;
- the system is based on rolling Gun Mark XP rather than the current battle alone.

Those properties independently match all currently observed field120 behavior:

```text
field120 domain                  : 0..3
scope suggested by corpus        : player × tank
cross-battle persistence         : yes
single-battle-performance signal : no
result-screen relevance          : shape-compatible
```

Therefore:

> `field120 = current Gun Marks count` is the strongest current semantic candidate.

## Why this is not yet PROVEN

The current public `eigenein/wotbreplay-parser` battle-results model names many PlayerResults fields, including tag117 `damage_blocked`, but does not currently define tags 118, 119 or 120.

No current Blitz 11.19 symbolic protobuf producer/schema has yet been recovered that explicitly states:

```text
field 120 -> gunMarks / marksOnGun / equivalent current symbol
```

The corpus also does not contain an independent UI screenshot/API response for the same `(account, vehicle, battle)` pairs that can be joined directly to the observed field120 values.

Thus exact naming remains one evidence step short of PROVEN.

## Rejected alternative: current-battle mastery badge

Mastery/class badges have a superficially similar small enum, but their semantics are battle-dependent. Field120's player×tank persistence and weak relationship to current-battle XP reject that interpretation for the current corpus.

## Safe current model

```text
PlayerVehiclePersistentMarkState {
    rawField120 : u32  // observed 0..3
    semanticCandidate : GUN_MARK_COUNT
    confidence : STRONG_PARTIAL
}
```

Until the final symbolic/UI/API closure exists, production code should preserve the raw value and should not expose a user-facing `Gun Marks` label as an exact protocol guarantee.

## Closure paths

Any one of the following would materially strengthen or close the identity:

1. current Blitz protobuf/schema with tag120 symbolic name;
2. same-account/same-tank official API result exposing Gun Marks and matching field120;
3. controlled replay where the recorder's visible Gun Mark count is known independently before recording;
4. current Blitz client code joining PlayerResults tag120 to Battle Results Gun Marks UI.
