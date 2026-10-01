# Assault Single-Base Realtime State

> **判据修正通告（2026-10-01）。** 本文档基于 **两场受控样本**（Neptune 完整占领 /
> Malinovka 无占领，均 `11.20.0_china_apple`）得出的两条结论，已被 **62 份真实回放**
> 复验推翻，生产实现（Java `AssaultBaseStateReconstructor` 与 Agent Rust Core 同批）
> 已按修正后的判据更新：
>
> 1. **`field1` 不是进度族判别子。** 受控样本里进度恰好全部由 `field1=2` 承载，但真实
>    回放中携带 `field3` 的族会在 `field1=1`/`field1=2` 之间切换——Yukon（重力模式，
>    两族交替，锁 `field1=2` 丢 16/24 事件）、Winter Malinovka（仅 2，无害）、
>    **Naval Frontier（遭遇战，仅 1）**、Hellas（评级战，13 条）。故 `field1` 是
>    *哪一方的*进度（owner/占领方，精确语义仍未闭合），进度只认
>    `field2==1 && field3 存在`。遭遇战（Encounter）与攻防战共用该载体。
> 2. **裸初始化对不能证明目标存在。** `1=1,2=1` + `1=2,2=1` 是**通用广播**：62 份样本里
>    Regular 的 Canal、TrainingRoom 的 Copperfield/Himmelsdorf、Any 的 Mayan Ruins 等
>    **8 份普通对局只发这一对**（各 2 个 subtype8 包、无任何其它字段），而真实单基地场次
>    发 182 个包（116 次 `field4=1` 标志流 + `field3` 进度）。故目标存在性要求目标族发出过
>    **裸初始化对以外的**字段（`field3` 或 `field4`）。
>
> 下方正文保留原始取证过程与受控样本数据；与上述两条冲突处以上述修正为准。

> Status: controlled protocol closure for the realtime capture-progress surface.
>
> Scope: two controlled Blitz `11.20.0_china_apple` Assault replays:
> `攻防.wotbreplay` on Neptune (full capture), and `攻防2.wotbreplay` on Malinovka (no capture).
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

The progress family is (见文首修正通告：`field1` 非判别子，原标题陈述已被推翻):

```text
nested field1 = 1 or 2   progress carrier side; exact private name UNKNOWN
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

## No-capture controlled sample / 无占领对照

`攻防2.wotbreplay`: version `11.20.0_china_apple`, map `malinovka`,
`arenaBonusType=2`, battle duration approximately 14.15s. Around raw clock
9.889s, wrapper8/root8 emits these initialization children:

```text
field1=2, field2=1  // field3 absent
field1=1, field2=1  // field3 absent
```

No field3 capture-progress sequence is emitted. Together with the full-capture
control this closes **objective existence independently of capture activity** for
these controlled samples. Initialization is objective-family evidence, not a
progress=0 broadcast. `arenaBonusType=2` indicates a training room and never
identifies Assault. The progress domain and field4 team semantics are unchanged.

The shared reconstructor exposes `hasObjective(events)`: exact raw wrapper8
field1=2 / field2=1 appears even when rawField3 is absent, **but the bare init pair is
emitted by ordinary battles too** — see the correction notice; production now requires
fields beyond that pair;
independently decoded Supremacy wrapper12 suppresses Assault identification.
The projector writes `assaultObjectivePresent=true` separately from `baseStates`.
With no field3, `baseStates=[]` remains correct: no synthetic progress event.

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
| nested field1 | varint | `rawField1` | 进度**所属方**（`1`/`2`）；**不是**进度族判别子——真实回放中携带 `field3` 的族在两值间切换。精确语义 UNKNOWN |
| nested field2 | varint | `rawField2` | Observed value `1`; production progress gate requires exactly `1`. Exact index/identifier semantics UNKNOWN; never interpreted as team |
| nested field3 | varint | `rawField3` | `field2==1` 且本字段存在即进度（0..100；不锁 `field1`） |
| nested field4 | varint | `rawField4` | Sibling family observed value `1`; exact meaning UNKNOWN. Never mapped to capturingTeam or ownerTeam |

Absent scalar fields remain `null` in `RawAssaultBaseUpdate`. Known fields 1..4,
when present, must each occur exactly once as a non-negative varint representable
by Java `Integer`; malformed protobuf, wrong scalar wire type, duplicate known
scalar fields or narrowing overflow reject that child. The decoder applies no 0..100 domain restriction to raw field3, including
other wrapper8 families; structural Integer bounds still apply. Unknown fields do not acquire
production semantics. A rejected child emits no Assault raw/canonical event;
the outer decoder preserves the packet as unknown when no recognized event was
decoded. This does not imply a separate raw diagnostic for every rejected child
of a mixed packet.

Capture-progress promotion requires **all** of:

1. Valid subtype48 envelope, wrapper8 and root field8 child framing.
2. `rawField1 == 2` and `rawField2 == 1`.
3. **Present** `rawField3` in 0..100, promoted here to `captureProgress`. Missing field3 never generates 0.
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
08 01 10 01 18 07  → field1=1, field2=1, field3=7   → canonical progress 7（遭遇战实际形态）
08 02 10 01 18 00  → explicit field3=0             → canonical progress 0
08 02 10 01        → absent field3                 → **裸初始化对：不构成目标证据**（普通对局同样发出）
08 01 10 01 20 01  → field1=1, field2=1, field4=1   → 目标系统活跃（超出裸初始化对）；team UNKNOWN
08 02 10 01 18 65  → field3=101                    → raw-only; reconstruction rejects progress
08 01 10 01 18 AC 02 → sibling field3=300           → raw-only; no progress domain applied
08 02 10 01 1A 00  → field3 length-delimited        → rejected scalar wire type
```

### Playback field mapping / 输出映射

| Canonical/wire field | Source / rule |
|---|---|
| `sequence`, `timestamp`, `packetType`, `confidence` | Preserved from the decoded packet; structural exactness does not prove unknown field semantics |
| `assaultObjectivePresent` | 目标族发出裸初始化对**以外**的字段（field3/field4）——裸初始化对是通用广播，普通对局也发（2026-10-01 修正）；与 arenaBonusType 无关 |
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

## Authoritative geometry boundary

The global map generator contract and base-branch `mapBases.js` remain unchanged.
2D resolves Assault geometry generically by `mapCode` from the existing
`common/map-semantics/*.semantic.json` corpus. A verified document must supply a
unique `sceneEvidence.battlePoints` controlpoint with `confidence=EXACT_SCENE_DATA`.
No map name is special-cased and coordinates are not copied to another data file.
Docker copies the semantic corpus into `/common/map-semantics` before Vite build.

The rendering join is:

```text
assaultObjectivePresent=true
  → semantic controlpoint for mapCode (static BASE geometry)
  LEFT JOIN latest baseStates[baseId=BASE, timeSec<=currentTime]
  → circle always; progress/fill only if an explicit runtime value exists
```

`assaultObjectivePresent` is additive and optional for old artifacts; missing or
false means no proven Assault objective, never inferred from progress, static
geometry, or training-room metadata. Malinovka initialization with no progress
renders the static circle without fill. Neptune follows the same path and joins
its 0..100 progress. Ambiguous/missing semantic geometry does not select the first
candidate. Static scene team metadata never establishes runtime ownership;
missing radius uses the presentation fallback.

## Evidence grade

```text
wrapper8 init / objective existence          PROVEN two controlled samples
field2=1 + field3 progress（任一 field1）     PROVEN 62-sample（含遭遇战/评级战）
field1=2-only progress family                FALSIFIED（受控样本假象）
bare init pair ⇒ objective present            FALSIFIED（8/62 普通对局同样发出）
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
7. generic semantic geometry for Malinovka no-progress and Neptune full-capture;
8. initialization projects objective presence with zero transitions; training-room metadata alone does not;
9. global generated geometry unchanged, semantic corpus present in Docker build.
