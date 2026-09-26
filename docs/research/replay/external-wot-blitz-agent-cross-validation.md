# WoT-Blitz-Agent replay evidence cross-validation

> Scope: external replay-protocol evidence observed in `fanypcd/WoT-Blitz-Agent` and compared with the WotbTools 11.19 research archive.
>
> Source repository: https://github.com/fanypcd/WoT-Blitz-Agent
>
> Source snapshots reviewed:
> - `回放射击事件逆向分析.md` blob `2dca7b669ac91196885ee2f45fa8a58db6e60040`
> - `WI射击参数与命中位置分析.md` blob `b0cd657e4e6963111a46b943e08649f5a6fbb4d0`
>
> This is a clean-room factual synthesis. It does not copy the source documents. The source repository had no root project license at review time, so its prose/code is not imported.
>
> **Authority rule:** this document is external corroboration, not a replacement for WotbTools controlled evidence. Existing WotbTools `PROVEN` facts remain authoritative. New external-only findings below stay `EXTERNAL_CANDIDATE` until reproduced against the WotbTools corpus or a controlled probe.

## 1. Independently corroborated protocol facts

The external project reaches the same operational conclusions as current WotbTools research on the following surfaces:

| Surface | WotbTools status | External observation | Result |
|---|---|---|---|
| Type10 | position + hull yaw/pitch/roll; ~10 Hz | same 49-byte transform layout consumed for playback | CORROBORATED |
| Type4 | leaves recorder-observed AoI, not death | treated as AoI/coverage boundary | CORROBORATED |
| Type7 prop3 | actual current HP + terminal sentinel family | positive HP / zero / `0xFFFD` decoding used by combat pipeline | CORROBORATED |
| Vehicle method1 | HP/state + source + cause | parsed as victim HP/source/cause and used for damage attribution | CORROBORATED |
| Avatar method29 | shooter + shotId + launch point + velocity | same fields used as projectile launch authority | CORROBORATED |
| Avatar method20 | shotId + terminal endpoint | paired with method29 by shotId | CORROBORATED |
| Avatar method38 | outgoing shot-result bitfield | same penetration/component result families consumed | CORROBORATED |
| raw packet clock | ordering/delivery surface, not exact projectile simulation time | same-clock launch/hit families observed; not treated as physical flight time | CORROBORATED |
| single-POV boundary | hidden/remote state can be absent | playback explicitly tracks AoI gaps and remote-shot degradation | CORROBORATED |

This independent implementation evidence increases confidence that the WotbTools canonical interpretation is not an artifact of one decoder or one analysis pipeline. It does **not** change the evidence grade of already-PROVEN facts.

## 2. Type7 prop2 packed gun-angle candidate

The external project reports a stronger structural interpretation of Vehicle Type7 prop2:

```text
u16 packed
high 10 bits -> turret yaw relative to hull
low   6 bits -> normalized gun-pitch fraction
```

Reported decode:

```text
turretYaw = high10 / 1024 * 2π - π
gunPitch  = elevationLimit - frac6 / 63 * (depressionLimit + elevationLimit)
```

The external evidence includes controlled elevation/depression-limit experiments and comparison against projectile geometry.

### WotbTools relation

WotbTools already proves the turret-yaw relationship and independently proves gun pitch on method36 / Type39 surfaces. The **low-six-bit prop2 gun-pitch interpretation is therefore a high-value cross-check candidate**:

```text
prop2.low6 decoded pitch
        ↕
method36.root.field2
        ↕
Type39 f6
        ↕
method29 launch vector at shot boundary
```

Status: **EXTERNAL_CANDIDATE — reproduce locally before promotion.**

Required closure:
1. decode prop2 low six bits across the canonical corpus;
2. join same-clock / nearest method36 and Type39 samples;
3. compare against version-matched vehicle depression/elevation limits;
4. run at least one controlled full-depression/full-elevation probe;
5. reject or version-gate vehicles with non-standard gun geometry.

## 3. Vehicle method8 hit-segment geometry candidate

The external project reports that Vehicle method8 direct-hit elements contain:

```text
shooter entity
victim entity
result
component index
six-byte quantized hit segment
```

The six-byte payload is interpreted as two quantized points inside the selected collision-part AABB. The reported decoder maps the bytes to local entry/exit points using `1/255` interpolation across the part bounds.

This is materially stronger than treating method8 only as a direct-hit notification.

### Potential canonical fact model

If reproduced locally, WotbTools should represent the result as provenance-bearing geometry rather than a synthetic exact hit point:

```text
HitSegment {
    targetEntityId
    shooterEntityId
    componentIndex
    localEntry
    localExit
    quantization = 1/255 AABB
    source = VEHICLE_METHOD8
}
```

The result must remain distinct from an exact world-space impact coordinate. Quantization, collision-model choice and component transforms can introduce reconstruction error.

Status: **EXTERNAL_CANDIDATE — high priority.**

## 4. method8 component-index candidate

The external project maps the method8 component selector as:

```text
0 chassis / tracks
1 hull
2 turret
3 gun
```

The claimed evidence combines vertical hit distribution, client decoding behavior and collision-part reconstruction.

WotbTools already has component/device namespaces from method38, but this candidate describes a **collision-part selector**, not the method38 damageable-device token namespace. These namespaces must not be merged.

Status: **EXTERNAL_CANDIDATE.**

Closure should join method8 events to:
- method38;
- controlled hull/turret/gun shots;
- target collision model;
- known track-side probes.

## 5. Type32 shell/result segment candidate

The external project reports a Type32 hit-notification family carrying a compact segment that can expose:
- hit-result class;
- shell global ID;
- component/segment-related bytes.

It also reports multiple 26/27-byte variants and explicitly records an unresolved layout conflict for the tail bytes.

Therefore only the existence of a shell/result-bearing Type32 hit family should be imported as a research lead; the exact tail layout is **not closed**.

Status: **EXTERNAL_CANDIDATE / PARTIAL.**

Do not promote a fixed byte layout until variants are separated by version/method/length and independently closed.

## 6. Avatar method27 terrain-impact candidate

The external project reports an Avatar method27 / `0x1b` family keyed by `shotId`, containing:
- shell global ID;
- material byte;
- terminal/impact point;
- segment-start point.

It reports that this surface is globally observable for terrain impacts and can therefore recover shell identity for some non-recorder shots when joined to method29 by shotId.

This could close an important WotbTools limitation: shell identity outside recorder-owned ammunition state.

Status: **EXTERNAL_CANDIDATE — high priority.**

Required closure:
1. enumerate method27 payload shapes across the canonical corpus;
2. pair by shotId to method29/method20;
3. verify endpoint equality where claimed;
4. compare shell IDs against recorder method17/Type28 on recorder-owned shots;
5. determine AoI/global-observation limits before describing it as globally complete.

## 7. updateArena / actual vehicle loadout candidate

The external project reports that an arena-info protobuf snapshot contains per-player vehicle composition sufficient to distinguish actual:
- vehicle;
- chassis;
- engine;
- turret;
- gun.

If reproduced, this is preferable to deriving a top configuration from `tank_id` for geometry-sensitive reconstruction.

This matters for:
- gun depression/elevation limits;
- turret/gun collision geometry;
- shell catalog;
- muzzle origin;
- armor/penetration reconstruction.

Status: **EXTERNAL_CANDIDATE — high priority for 3D reconstruction.**

The candidate should be cross-checked against known alternate-gun/turret controlled replays before use as canonical loadout authority.

## 8. Render-state versus server-state distinction

The external project explicitly separates:
- server/network transform observations used for hit/reconstruction anchors;
- client-filtered render transforms used to reproduce what the player saw.

This is compatible with WotbTools' existing distinction between protocol truth and presentation fallback.

Recommended invariant:

```text
ObservedServerState != ReconstructedRenderState
```

A filtered/interpolated playback pose must carry derived/render provenance and must never overwrite raw Type10 observations.

Status: **CORROBORATED architectural rule.**

## 9. Findings not imported as canonical truth

The following external conclusions are intentionally **not** promoted here:

- exact Type32 tail layout where the external document itself records conflicting variants;
- exact private names for unresolved method8 tail bytes;
- exact WI simulation ray formula where the external investigation records residual uncertainty;
- any claim that a locally reconstructed hit coordinate is the exact server collision coordinate;
- any death model based solely on `HP == 0` or one Type7 subtype.

WotbTools' current death model remains authoritative: explicit terminal state/event first, live corroborating surfaces next, settlement-second fallback when single-POV observation is absent. Controlled drowning proves that positive-HP terminal death exists.

## 10. Verification queue

Priority order for local WotbTools closure:

1. **P0 — prop2 low6 gun pitch** against method36 / Type39 / launch geometry.
2. **P0 — method8 six-byte hit segment + component selector** using controlled collision targets.
3. **P1 — updateArena actual gun/turret loadout** using alternate-module vehicles.
4. **P1 — method27 terrain impact shell ID** against recorder-known shell descriptors.
5. **P1 — Type32 shell/result variants** separated by payload shape.
6. **P2 — client render-filter reproduction**, kept strictly outside protocol truth.

Promotion rule: once a candidate is independently reproduced, add a focused closure document and synchronize the bilingual complete reference + `inventory.md`, following the archive maintenance rule.

## Provenance

External repository reviewed: `fanypcd/WoT-Blitz-Agent`.

Relevant source documents at review time:
- `回放射击事件逆向分析.md`
- `WI射击参数与命中位置分析.md`
- `客户端弹道与命中位置逆向报告.md`
- `游戏回放数据处理分析报告.md`

Relevant external implementation surfaces:
- `src/replay/combat.rs`
- `src/replay/playback.rs`
- `src/replay/filter.rs`

The external repository is evidence/provenance only. WotbTools evidence grades remain governed by this archive's controlled-replay rules.
