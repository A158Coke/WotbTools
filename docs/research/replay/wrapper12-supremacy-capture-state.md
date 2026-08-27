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
field6 : recorder-local capture participation flag, STRONG PARTIAL
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

## `field2` = current owner team

After an active capture reaches the high-90s, wrapper12 switches the same base to an owner-state record carrying `field2` equal to the previously capturing team.

Across the canonical corpus, 113 independent ownership transitions were closed this way:

```text
previous capture progress before owner transition:
95..99 in 113 / 113 closures
median delay from final high-progress sample to owner state: ~0.50 s
```

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

## `field6` — recorder-local capture participation family

Wrapper1 provides an independent recorder account/team mapping. Joining this to wrapper12 gives a strict invariant:

```text
field6=1 records : 322
capturingTeam == recorderTeam : 322 / 322
```

Many friendly capture updates do not carry field6, so it is not merely a redundant `isFriendlyCapture` bit.

### Port / Harbor Town single-capturer control sample

Replay:

```text
20260822_1237__CHRD-A158布丁_Maus_1161443361459633110
mapName = port
vehicle = Maus
```

The replay owner independently confirmed that the recorder Maus was **the sole vehicle capturing B** during the initial B capture.

The wrapper12 sequence is:

```text
rawClock ~140.317 s
baseIndex=1 (B), capturingTeam=recorderTeam, progress=3,  field6=1
...
progress 7,10,14,17,...,96,99 with field6=1 throughout
rawClock ~154.314 s
ownerTeam=recorderTeam, capturingTeam=0, progress=0, field6 absent
```

Thus in a known single-capturer episode, `field6=1` continuously marks the recorder's own capture episode and disappears when ownership completes.

Combined with the 322/322 team invariant, this materially strengthens the semantic family:

> `field6 = recorder-local capture participation / recorder-is-capturing flag` — **STRONG PARTIAL, near-PROVEN behavioral identity**.

It is still kept below exact `PROVEN` because one controlled single-capturer confirmation does not yet distinguish the exact producer condition among "inside circle", "actively contributing points", and an equivalent local capture-participation UI state.

## `field5` — contested / blocked candidate, not yet closed

`field5=1` occurs only 60 times. It is heavily concentrated in states where one team owns a base while the opposite team is trying to capture it, and it frequently accompanies a progress pause or reduction.

Verdict:

> `field5` — **PARTIAL / contested-or-interruption candidate**.

## Important correction to earlier capture research

`capture-probe.md` correctly proved that Type31 and the tested Type7 properties were not the capture timeline. Its broader conclusion that replay data lacked a realtime capture timeline is now **SUPERSEDED**.

Current corrected hierarchy:

```text
wrapper12            = realtime per-base ownership/capture progress
wrapper13            = realtime team Supremacy score
settlement #32/#33   = authoritative final per-player victory-points totals
```

## Safe reconstruction model

```text
SupremacyBaseStateEvent {
    rawClockSec
    baseIndex
    ownerTeam
    capturingTeam
    captureProgress
    auxiliaryFlag5
    recorderCaptureFlag6
}
```

Safe immediate uses after version gating:

- battle playback: show A/B/C/D ownership and live capture bars;
- AI Review: identify capture starts, ownership changes, interruptions and retakes;
- tactical analysis: join wrapper12 with wrapper13 score accrual;
- recorder-local analysis: use field6 as strong evidence that the recorder is personally participating in the capture, while retaining its evidence grade.

Do not infer all capturing vehicles from wrapper12 alone.

## Relationship to method12 baseType12 / settlement field118

The newly decoded timeline provides a much better control surface for field118 research. The Port sample additionally supplies a clean defense-reset episode documented in `method12-spotted-and-assist-counters.md`.

The current best hypothesis is now the base-defense / dropped-capture-points family, but exact field-level symbolic identity remains separately evidence-graded.
