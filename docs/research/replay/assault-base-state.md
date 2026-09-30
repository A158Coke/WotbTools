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

### Field decoding contract / 字段解析契约

The wrapper selector and protobuf field numbers belong to different layers.
`wrapperFieldNumber=8` is the subtype48 envelope selector; root field8 is a
repeated length-delimited child message. Neither number identifies the objective
or a team. The envelope retains the existing subtype48 framing and length checks.

| Wire location | Wire type | Raw event field | Proven meaning / 证据边界 |
|---|---|---|---|
| nested field1 | varint | `rawField1` | `2` selects the observed progress family; `1` occurs in the sibling family. Exact private enum name UNKNOWN |
| nested field2 | varint | `rawField2` | Observed value `1`; production progress gate requires exactly `1`. Exact index/identifier semantics UNKNOWN; never interpreted as team |
| nested field3 | varint | `captureProgress` | For field1=2 + field2=1, realtime capture progress; 1..100 observed in the controlled sample |
| nested field4 | varint | `rawField4` | Sibling family observed value `1`; exact meaning UNKNOWN. Never mapped to capturingTeam or ownerTeam |

Absent scalar fields remain `null` in `RawAssaultBaseUpdate`. Known fields 1..4,
when present, must each occur exactly once as a non-negative varint representable
by Java `Integer`; malformed protobuf, wrong scalar wire type, duplicate known
scalar fields or narrowing overflow reject that child. Present field3 must be
within 0..100, including on raw-only families. Unknown fields do not acquire
production semantics. A rejected child emits no Assault raw/canonical event;
the outer decoder preserves the packet as unknown when no recognized event was
decoded. This does not imply a separate raw diagnostic for every rejected child
of a mixed packet.

Canonical promotion requires **all** of:

1. Valid subtype48 envelope, wrapper8 and root field8 child framing.
2. `rawField1 == 2` and `rawField2 == 1`.
3. **Present** `captureProgress` in 0..100. Missing field3 never generates 0.
4. No independently decoded `RawSupremacyBaseUpdate` in the reconstruction input;
   the current mode guard suppresses Assault projection when wrapper12 is present.

Explicit field3=0 is accepted and preserved by the implementation; it is not
claimed as an independently observed zero/init message in the supplied sample.
The sample proves the positive 1..100 sequence, including 100. Ordering follows
raw clock then packet sequence; reconstruction creates no intermediate values
and imposes no monotonicity rule, so an explicit decrease/reset is preserved.

### Minimal protobuf examples / 最小字段示例

These bytes illustrate **nested children**, not complete captured packets:

```text
08 02 10 01 18 01  → field1=2, field2=1, field3=1   → canonical progress 1
08 02 10 01 18 64  → field1=2, field2=1, field3=100 → canonical progress 100
08 02 10 01 18 00  → explicit field3=0             → canonical progress 0
08 02 10 01        → absent field3                 → raw-only; no synthetic zero
08 01 10 01 20 01  → field1=1, field2=1, field4=1   → raw-only; team UNKNOWN
08 02 10 01 18 65  → field3=101                    → rejected
08 02 10 01 1A 00  → field3 length-delimited        → rejected scalar wire type
```

### Playback field mapping / 输出映射

| Canonical/wire field | Source / rule |
|---|---|
| `sequence`, `timestamp`, `packetType`, `confidence` | Preserved from the decoded packet; structural exactness does not prove unknown field semantics |
| `baseStates[].timeSec` | Existing projector battle-relative clock: raw clock minus resolved battle start |
| `baseStates[].baseId` | Literal `BASE` for Assault; no breaking rename of `baseStates` |
| `baseStates[].captureProgress` | Explicit decoded field3, unchanged; 100 is accepted |
| `baseStates[].ownerTeam` | `null`; no proven ownership field |
| `baseStates[].capturingTeam` | `null`; field4 and static SC2 team are not authorities |

In the controlled example, `131.688 - 9.287 = 122.401s` is the playback time
of progress 100. The 2D consumer takes the latest state at or before the seek
time, with no smoothing or future-state lookup. 3D Playback remains experimental;
its future objective consumer must use this same dataset, without decoding wrapper8.

### Implementation and regression references

- Decoder: `java/wotb-core/.../replay/decoder/EntityMethodDecoder.java`
  (`parseRawAssaultBaseUpdates`); tests: `EntityMethodDecoderTest`.
- Reconstruction: `java/wotb-core/.../replay/reconstruction/AssaultBaseStateReconstructor.java`;
  tests: `AssaultBaseStateReconstructorTest`.
- Projection: `java/wotb-playback/.../replay/ai/BattlePlaybackProjector.java`;
  tests: `java/wotb-web/.../replay/ai/BattlePlaybackProjectorTest.java`.
- Wire authority: `contracts/http/openapi.yaml`, `BaseStateTransition`;
  runtime boundary tests: `frontend/src/api/contract-runtime.test.ts`.
- 2D rendering and seek: `frontend/src/components/BattlePlayback.vue` and
  `BattlePlayback.integration.test.js`.

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
