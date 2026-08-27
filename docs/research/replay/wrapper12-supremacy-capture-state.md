# Wrapper12 — Supremacy base capture state timeline

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: Avatar method48 wrapperId=12 only. This note supersedes the earlier assumption in `capture-probe.md` that no replay-level capture timeline exists.

## Executive verdict

Wrapper12 carries the **realtime Supremacy base capture state machine** for the current corpus.

Current child protobuf shape:

```text
field1 : baseIndex        // uint, protobuf default 0 omitted
field2 : ownerTeam        // 0 neutral / 1 / 2
field3 : capturingTeam    // 0 none / 1 / 2
field4 : captureProgress  // 0..99; default 0 omitted
field5 : boolean-like auxiliary capture state, PARTIAL
field6 : recorder-local participation/friendly-capture auxiliary state, STRONG PARTIAL
```

The first four fields are behaviorally closed strongly enough for protocol consumers to reconstruct base ownership and capture progress over time.

## Wire shape

Avatar method48 remains the arena-update wrapper container. Wrapper12 bodies in the current version have the form:

```text
0c <wrapperLength> 5a <childLength> <child protobuf>
```

Example:

```text
0c 08 5a 06 08 02 18 01 20 03
```

The nested child decodes as:

```text
field1 = 2
field3 = 1
field4 = 3
```

which is one progress update for base index 2 being captured by team 1 at progress 3.

## Corpus coverage

Across the canonical 34 arenas:

```text
wrapper12 records : 5,013
arenas             : 34 / 34
records with field3: 4,550
records with field4: 4,516
records with field1: 3,461  // index 0 is omitted by protobuf defaulting
records with field2: 2,218
records with field5:    60
records with field6:   322
```

Observed values:

```text
field1 explicit : 1,2,3
field1 implicit : 0
field2          : 1,2
field3          : 1,2
field4          : 3..99 in active progress samples
field5          : 1 when present
field6          : 1 when present
```

## `field1` = base index

`field1` is a zero-based base slot. Because protobuf omits scalar default zero, base index 0 appears as a missing field1.

Map-level coverage supports this interpretation:

- maps with three Supremacy points expose indices `0,1,2`;
- maps with four Supremacy points expose indices `0,1,2,3`.

In the 18 distinct maps represented by the canonical corpus, examples include:

```text
canal / faust / idle / plant -> 0,1,2,3
desert_train / erlenberg / forgecity / holland / italy / ... -> 0,1,2
```

Verdict:

> `field1 = zero-based Supremacy base index` — **PROVEN behavioral identity**.

The presentation mapping `0=A, 1=B, 2=C, 3=D` is the natural UI mapping, but production should still keep the raw index and apply map/version gating.

## `field3` + `field4` = active capturing team and progress

During active capture, a base emits roughly 0.5-second updates such as:

```text
base 2, team 1:
3 -> 8 -> 13 -> 18 -> 23 -> 28 -> ... -> 96
```

or:

```text
base 1, team 2:
3 -> 7 -> 10 -> 14 -> 17 -> 21 -> ... -> 99
```

`field3` remains the same team throughout one capture episode while `field4` rises toward completion. Progress may drop or reset when the capture is disrupted.

Verdict:

> `field3 = capturing team` — **PROVEN**.
>
> `field4 = base capture progress` — **PROVEN**.

The stream preserves actual observed progress rather than requiring a synthetic timer.

## `field2` = current owner team

After an active capture reaches the high-90s, wrapper12 switches the same base to an owner-state record carrying `field2` equal to the previously capturing team.

Across the canonical corpus, 113 independent ownership transitions were closed this way:

```text
previous capture progress before owner transition:
95..99 in 113 / 113 closures

most common final observed value:
99

median delay from final high-progress sample to owner state:
~0.50 s
```

Representative sequence:

```text
base B, capturingTeam=1, progress=96
base B, capturingTeam=1, progress=99
~0.5 s
base B, ownerTeam=1
```

The same relationship occurs for team 2.

Verdict:

> `field2 = current base owner team` — **PROVEN behavioral identity**.

A missing field2 is the protobuf default zero and is therefore consistent with neutral/unowned state in this schema.

## Capture interruption is observable

The progress stream can fall or reset within the same base/capturing-team episode. Representative shapes include:

```text
35 -> 3
21 -> 3
10 -> 0
84 -> 0
56 -> 12
```

This is consistent with live Supremacy capture disruption and means a consumer can reconstruct more than merely final ownership.

The official Blitz capture rules independently state that capture can be suspended when opposing teams are simultaneously in a capture circle and that damage to a capturing vehicle can reduce/reset capture contribution. Wrapper12 exposes the resulting state changes, but the packet alone does not yet distinguish every physical cause of a progress reduction.

Reference:

- Wargaming Support, `Gameplay: Victory Conditions`, World of Tanks Blitz.

## `field6` — recorder-local capture participation family

Wrapper1 provides an independent recorder account/team mapping. Joining this to wrapper12 gives a strong invariant:

```text
field6=1 records : 322
capturingTeam == recorderTeam : 322 / 322
```

However, many friendly capture updates do **not** carry field6, so it is not merely a redundant `isFriendlyCapture` bit.

This strongly suggests a recorder-local role such as:

- recorder is personally participating in this capture;
- recorder is inside / contributing to the relevant capture zone;
- another equivalent local-player capture participation state.

Current verdict:

> `field6 = recorder-local friendly capture participation/state family` — **STRONG PARTIAL**.

Do not expose the exact label `recorderInCaptureCircle` until it is closed against recorder Type10 position and map base geometry or an independent current-version producer schema.

## `field5` — contested / blocked candidate, not yet closed

`field5=1` occurs only 60 times. It is heavily concentrated in states where one team owns a base while the opposite team is trying to capture it, and it frequently accompanies a progress pause or reduction.

This makes a contested/blocked/interruption state plausible, but the current packet-only evidence cannot distinguish:

- both teams simultaneously occupying the circle;
- progress blocked for another rule reason;
- a local UI state related to capture interruption;
- another auxiliary base-state flag.

Verdict:

> `field5` — **PARTIAL / contested-or-interruption candidate**.

It must remain raw in production-facing protocol models until controlled geometry or current schema closes the exact condition.

## Important correction to earlier capture research

`capture-probe.md` correctly proved that Type31 and the tested Type7 properties were not the capture timeline. Its broader conclusion that replay data lacked a realtime capture timeline is now **SUPERSEDED**.

The missing surface was Avatar method48 wrapper12.

Current corrected hierarchy:

```text
wrapper12            = realtime per-base ownership/capture progress
wrapper13            = realtime team Supremacy score
settlement #32/#33   = authoritative final per-player victory-points totals
```

These are complementary rather than competing sources.

## Safe reconstruction model

```text
SupremacyBaseStateEvent {
    rawClockSec
    baseIndex
    ownerTeam          // 0/1/2
    capturingTeam      // 0/1/2
    captureProgress    // 0..99 observed; 0 may be omitted on wire
    auxiliaryFlag5     // nullable / PARTIAL
    localCaptureFlag6  // nullable / STRONG PARTIAL
}
```

Safe immediate uses after version gating:

- battle playback: show A/B/C/D ownership and live capture bars;
- AI Review: identify when a base started being taken, changed owner, was interrupted, or was retaken;
- tactical analysis: join wrapper12 with wrapper13 to explain score swings;
- post-battle evidence: compare objective pressure against settlement victory-point totals.

Do not infer the exact vehicle(s) causing a capture-progress delta unless player-position/base-geometry evidence is independently available.

## Relationship to method12 baseType12 / settlement field118

The newly decoded timeline provides a much better control surface for field118 research, but current evidence does **not** close field118 yet.

In particular, Avatar method12 baseType12 events do not consistently occur at wrapper12 capture completion and do not consistently coincide with field6 participation windows. Therefore these shortcuts are currently rejected:

```text
baseType12 == base captured count
baseType12 == recorder entered capture circle
field118 == simple wrapper12 progress total
```

Some baseType12 events do occur near capture progress reductions, while others occur during unrelated ongoing progress or with no nearby wrapper12 change. The exact method12/field118 statistic therefore remains `PARTIAL` and requires another discriminator.

## Remaining work

1. close field6 against recorder Type10 position and known map base centers;
2. close field5 with controlled contested/base-reset scenarios;
3. derive explicit capture episodes and interruption causes from the state machine;
4. join wrapper12 episodes to wrapper13 score accrual and settlement #32/#33;
5. continue field118/baseType12 research without forcing the old `droppedCapturePoints` hypothesis;
6. validate wrapper12 numeric field stability outside Blitz 11.19 China before production reuse.
