# Assault Single-Base Realtime State

> Status: controlled protocol closure for the realtime capture-progress surface.
>
> Scope: controlled Blitz `11.20.0_china_apple` Assault replay on `neptune`
> (`攻防.wotbreplay`), where team 1 captured the single base to 100 and won.
>
> This document separates closed protocol facts from still-unknown wrapper8 fields.
> Unknown fields remain raw-preserved and must not be assigned attacker/defender/team
> semantics in production code.

## Executive verdict

Assault does **not** reuse the Supremacy wrapper12 base-state stream.

Observed Assault path:

```text
Type 8 EntityMethod
→ subtype 48 / updateArena2
→ wrapperFieldNumber = 8
→ root field 8
→ repeated single-base update
```

The controlled replay contains:

```text
wrapper8  = 296 packets
wrapper12 = 0 packets
```

The progress family is:

```text
nested field1 = 2        raw discriminator; exact private name UNKNOWN
nested field2 = 1        raw single-objective index; exact private name UNKNOWN
nested field3 = progress PROVEN for this controlled Assault surface
nested field4            absent on this family
```

During uninterrupted capture, field3 advances through the real replay stream:

```text
1, 2, 3, ... 50, ... 96, 97, 98, 99, 100
```

Therefore Assault capture progress is an inclusive **0..100** canonical domain.
The value 100 is a real replay broadcast, not a frontend completion inference.

## Controlled sample

Replay facts:

```text
version          11.20.0_china_apple
mapCode          neptune
recorder         CHRD-A158布丁
recorder team    1
battle start     raw clock 9.287s
progress 100     raw clock 131.688s
round finished   raw clock 137.783s
winnerTeam       1
finishReasonRaw  2
```

The user-controlled ground truth for this replay is that team 1 was the attacking
side and completed the base capture at 100.

That closes the relationship:

```text
wrapper8/root8 field3 -> realtime Assault capture progress
100                   -> full progress value present on wire
```

`finishReasonRaw=2` correlates with Assault base-capture victory in this controlled
sample, but one positive sample is not enough to promote the enum name globally.
It remains a strong candidate and stays `UNKNOWN` in production `RoundFinishedEvent`
until an independent control confirms it.

## Sibling wrapper8 family

The same capture window repeatedly contains:

```text
field1 = 1
field2 = 1
field4 = 1
```

It starts when capture activity begins and persists around the progress stream.
Because the recorder/team/capturing side are all team 1 in this single controlled
sample, field4 strongly correlates with a team/capture-state value.

That is **not sufficient** to assign a production name.

Requirements:

- retain field1/field2/field4 as raw diagnostics;
- do not expose field4 as `capturingTeam`, `attackingTeam`, or `ownerTeam` yet;
- obtain an independent control (preferably team 2 capturing, or a reset/contest case)
  before promotion.

## Canonical architecture

Wire protocols stay separate:

```text
wrapper8  → RawAssaultBaseUpdate
wrapper12 → RawSupremacyBaseUpdate
```

Canonical playback may share the transport surface:

```text
AssaultBaseStateTransition
  captureProgress 0..100
        ↓
BattlePlaybackDataset.baseStates[]
  baseId = "BASE"
  ownerTeam = null
  capturingTeam = null
  captureProgress = replay value
```

Supremacy keeps `baseId=A|B|C|D` and its existing ownership/capturing-team
semantics. The frontend must never merge sparse wrapper messages itself.

## Static geometry

For `neptune`, the active client-scene control point is:

```text
x = 49.5339
y = 8.5291
radius = absent in scene
team = 1 (raw scene metadata; semantic UNKNOWN)
```

SC2 uses X/Y as the map plane and Z as elevation. Replay Type10 uses X/Z as the
map plane and Y as elevation, so SC2 `(x,y)` maps directly to playback `(x,z)`.

The frontend uses a 20 m presentation fallback only when the scene omits
`radius`. This display policy is not inferred from vehicle distance and is not
promoted as a protocol or client-resource fact.

The SC2 `controlpoint.team` field must **not** be documented as "defending team":
in this controlled sample it is 1 while team 1 is the user-confirmed attacking and
capturing side. Its exact scene meaning remains unresolved.

## Variant filtering

Map scenes can carry multiple labelled battle-layout variants. Base extraction must
select the active variant before emitting `mapBases.js`; otherwise mutually
exclusive control points can be merged into one map.

The base extractor now follows the same label-frequency variant selection used by
`map-semanticizer`. For the controlled Neptune layout this produces one active
Assault control point instead of three mixed-variant candidates.

## Evidence grade

```text
wrapper8 / root field8 Assault family        PROVEN controlled sample
field1=2 + field2=1 + field3 progress        PROVEN controlled sample
progress reaches protocol value 100          PROVEN controlled sample
field1=1 + field2=1 + field4=1 semantics     UNKNOWN / strong correlation only
finishReasonRaw=2 exact enum name             UNKNOWN / strong candidate
controlpoint.team attacker/defender meaning  UNKNOWN
```

## Regression requirements

Production support must retain tests for:

1. wrapper8/root8 decoding of progress value 100;
2. explicit wire progress 0 is retained; absent field3 remains raw-only;
3. canonical progress sequence accepting 100;
4. transport `baseId=BASE` and `captureProgress<=100`;
5. frontend single-base rendering at 100;
6. no guessed capturing-team/ownership semantics;
7. map extraction variant filtering.
