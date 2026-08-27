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
field5 : captureSuspended / blocked state
field6 : recorder-local capture participation flag, STRONG PARTIAL
```

The first five fields are now behaviorally closed strongly enough for version-gated protocol consumers to reconstruct ownership, active capture, progress and capture-suspended windows.

## Wire shape

Avatar method48 is the arena-update wrapper container. Wrapper12 bodies have the form:

```text
0c <wrapperLength> 5a <childLength> <child protobuf>
```

Example:

```text
0c 08 5a 06 08 02 18 01 20 03
```

decodes to:

```text
field1 = 2
field3 = 1
field4 = 3
```

which is a progress update for base index 2 being captured by team 1 at progress 3.

## Corpus coverage

Across the canonical 34 arenas:

```text
wrapper12 records : 5,013
arenas             : 34 / 34
records with field3: 4,550
records with field4: 4,516
records with field1: 3,461  // index 0 omitted by protobuf default
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
field4          : 3..99 in active-progress samples
field5          : 1 when present
field6          : 1 when present
```

## `field1` = base index

`field1` is a zero-based base slot. Because protobuf omits scalar default zero, base index 0 appears as a missing field1.

Map-level coverage supports this interpretation: three-base maps expose indices `0,1,2`; four-base maps expose `0,1,2,3`.

Verdict:

> `field1 = zero-based Supremacy base index` — **PROVEN behavioral identity**.

The natural presentation is `0=A, 1=B, 2=C, 3=D`, while production should retain the raw index and version/map gating.

## `field3` + `field4` = active capturing team and progress

During active capture, a base emits roughly 0.5-second progress updates such as:

```text
3 -> 8 -> 13 -> 18 -> 23 -> 28 -> ... -> 96
```

or:

```text
3 -> 7 -> 10 -> 14 -> 17 -> 21 -> ... -> 99
```

`field3` remains the same team during one capture episode while `field4` rises toward completion. Progress can drop/reset when capture contribution is disrupted.

Verdict:

> `field3 = capturing team` — **PROVEN**.
>
> `field4 = base capture progress` — **PROVEN**.

## `field2` = current owner team

After active progress reaches the high 90s, wrapper12 switches the same base to an owner-state record carrying `field2` equal to the previous capturing team.

Across the canonical corpus:

```text
independent ownership transitions closed : 113
last observed progress before transition : 95..99 in 113 / 113
median transition delay                  : ~0.50 s
```

Verdict:

> `field2 = current base owner team` — **PROVEN behavioral identity**.

Missing field2 is protobuf default zero, consistent with neutral/unowned state.

## `field5` = capture suspended / blocked

`field5=1` occurs 60 times. The corpus now provides a strong timing discriminator against ordinary active capture.

For normal active-capture states, the next same-base progress/state change occurs at approximately the regular update cadence:

```text
normal active samples checked : 4,480
median time to next change     : ~0.500 s
p90                             : ~0.516 s
```

For closable `field5=1` samples:

```text
field5 samples with later same-base state change : 58
median time to next change                       : ~3.50 s
>0.75 s                                           : 53 / 58
>1.00 s                                           : 51 / 58
>2.00 s                                           : 41 / 58
```

Some blocked windows persist for roughly 15–46 seconds while the base progress stays frozen. `field5` occurs both on neutral bases and on already-owned bases being challenged, so it is not an ownership-specific flag.

Many sequences show the same visible progress repeated before/at `field5=1`, followed by a long gap before progress resumes or another state transition occurs. Other sequences include a contribution reset followed by a blocked zero-progress state; this is compatible with damage/reset and contest occurring in the same local episode.

Current Wargaming Blitz gameplay rules independently state that if vehicles from both teams are simultaneously inside a capture circle, capture is suspended. They separately state that damaging a capturing vehicle resets/reduces that vehicle's personal capture contribution. These are different mechanics and must not be conflated.

The replay behavior therefore supports:

> `field5 = capture suspended / blocked base state` — **PROVEN behavioral identity** for the current corpus.

The strongest gameplay cause is the standard contested-circle condition (both teams present), but wrapper12 does not carry the occupying vehicle IDs. Therefore the narrower producer label `bothTeamsInsideCircle` remains a rule-consistent interpretation rather than a directly encoded entity-level proof.

Safe use:

- mark the capture bar as suspended/blocked;
- distinguish a frozen capture episode from normal ~0.5 s progress accumulation;
- do not infer which exact vehicles are contesting from field5 alone.

## Capture interruption and damage-reset are distinct

The progress stream can fall/reset inside an active capture episode, e.g.:

```text
35 -> 3
21 -> 3
10 -> 0
84 -> 0
56 -> 12
```

Current Blitz rules explain one source: a capturing vehicle that takes qualifying damage loses its personal capture contribution. With multiple capturers, only that vehicle's contribution is removed while others can continue adding progress.

Therefore:

```text
progress drop/reset != field5 by definition
field5             = capture suspended/blocked state
```

A combat reset can occur immediately before or during a contested period, so both signals may appear in one episode.

## `field6` — recorder-local capture participation family

Joining wrapper1 recorder-team identity to wrapper12 gives:

```text
field6=1 records : 322
capturingTeam == recorderTeam : 322 / 322
```

Many friendly capture updates do not carry field6, so it is not merely `isFriendlyCapture`.

### Port / Harbor Town single-capturer control sample

Replay:

```text
20260822_1237__CHRD-A158布丁_Maus_1161443361459633110
mapName = port
vehicle = Maus
```

The replay owner independently confirmed that the recorder Maus was the **sole vehicle capturing B** during the initial B capture.

The wrapper12 sequence is:

```text
~140.317 s  B, capturingTeam=recorderTeam, progress=3, field6=1
...         progress 7,10,14,17,...,96,99 with field6=1
~154.314 s  ownerTeam=recorderTeam, capturingTeam=0, progress=0, field6 absent
```

Thus in a known single-capturer episode, `field6=1` continuously marks the recorder's own capture episode and disappears when ownership completes.

Verdict:

> `field6 = recorder-local capture participation / recorder-is-capturing family` — **STRONG PARTIAL, near-PROVEN behavioral identity**.

It remains below exact PROVEN because the current evidence does not distinguish the producer condition among `inside circle`, `actively contributing points`, and an equivalent local-player capture UI state.

## Important correction to earlier capture research

`capture-probe.md` correctly showed that Type31 and the tested Type7 properties were not the capture timeline. Its broader conclusion that replay data lacked realtime capture state is **SUPERSEDED**.

Current hierarchy:

```text
wrapper12            = realtime per-base ownership/capture/blocked state
wrapper13            = realtime team Supremacy score
settlement #32/#33   = authoritative final per-player victory-point totals
```

## Safe reconstruction model

```text
SupremacyBaseStateEvent {
    rawClockSec
    baseIndex
    ownerTeam
    capturingTeam
    captureProgress
    captureSuspended
    recorderCaptureFlag6
}
```

Safe uses after version gating:

- battle playback: A/B/C/D ownership, live capture bar, capture-suspended state;
- AI Review: capture starts, contested/blocked periods, resets, ownership changes and retakes;
- tactical analysis: join wrapper12 with wrapper13 score changes;
- recorder-local analysis: use field6 as strong evidence of personal capture participation.

Do not infer all occupying/capturing vehicles from wrapper12 alone.

## Relationship to method12 baseType12 / settlement field118

Wrapper12 provides a direct capture-timeline control for field118 research. The Port replay additionally supplies a clean defense-reset chain documented in `method12-spotted-and-assist-counters.md`.

Current best field118 interpretation remains base-defense / dropped-capture-points family, with exact symbolic identity separately evidence-graded.
