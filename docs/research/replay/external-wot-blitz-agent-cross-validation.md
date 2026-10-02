# WoT-Blitz-Agent replay evidence cross-validation

> Scope: external replay-protocol evidence observed in `fanypcd/WoT-Blitz-Agent` and compared with the WotbTools 11.19 research archive.
>
> Source repository: https://github.com/fanypcd/WoT-Blitz-Agent
>
> **Two immutable snapshots are used below and must not be conflated:**
>
> - **Released artifact snapshot** (what this repo actually consumes): tag **`v0.3.8`** = commit
>   `f35baa46ec4d069c8d68cfad66cafcd166e0a492`, pinned in `deploy/agent/source.json`.
> - **Research source snapshot** (documents quoted below): commit
>   `e37e6a7d9ce93adb289ba13d6b25aa5aa47fe7ed`
>   - `回放射击事件逆向分析.md` blob `eb838731730d09d8db3ae5a2b3e45a6925dc7613`
>   - `回放未解析数据清单.md` blob `e1427a482988a895233c1281e4cf5ab0938a40d8`
>   - `客户端弹道与命中位置逆向报告.md` blob `77fa549a5db938adc6a832d6086c9a852880019d`
>   - `WI射击参数与命中位置分析.md` blob `b0cd657e4e6963111a46b943e08649f5a6fbb4d0`
>     (byte-identical to the blob read in the original 2026-09-26 review)
>   - `docs/wotbtools-cross-reference.md` blob `7b5ed0085cfe7c6e453a3e1e8101a0ed4d7aab78`
>   - `游戏回放数据处理分析报告.md` blob `3ed75c33047745f011d0c003e2eb99dcd943a2d3`
>
> Original review snapshots (2026-09-26, **superseded**): `回放射击事件逆向分析.md` blob
> `2dca7b669ac91196885ee2f45fa8a58db6e60040`, `WI射击参数与命中位置分析.md` blob `b0cd657e…`.
>
> **2026-10-02 update:** the external project published `v0.3.2`–`v0.3.8` in the meantime and revised the
> documents reviewed above. This revision applies three kinds of change: **corrections** where the external
> project's own later statement retracts a reading recorded here (§6), **refreshed evidence** for candidates
> that remain open (§2–§4, §7), and **status notes** on the external project's rewrite of §5 and §10. Nothing
> here changes any grade held by this archive's own evidence: the external project is now the *producer* of
> the replay facets this repo consumes (`contracts/agent/replay-facets-v2.md`), which makes its claims
> convenient to cite, not authoritative to adopt.
>
> This is an independent factual synthesis written in WotBTools terminology. The external project is MIT-licensed; its implementation may be reused subject to the MIT license and required attribution. External-only protocol claims still require independent reproduction against the WotBTools corpus or controlled probes before promotion to WotbTools `PROVEN` evidence.
>
> **Authority rule:** this document is external corroboration, not a replacement for WotbTools controlled evidence. Grades held by this archive are unaffected by anything below:
>
> - historical / research-local documents use their own vocabulary — `PROVEN / VERY STRONG PARTIAL / PARTIAL / UNKNOWN / SUPERSEDED / REJECTED` (defined in `WOTB_REPLAY_PROTOCOL_11_19_COMPLETE_REFERENCE.md`);
> - the current top-level canonical reference uses only `AFFIRMED / GUESS / UNKNOWN` (`inventory.md` and the bilingual complete reference), and is the authority on current state;
> - `EXTERNAL_CANDIDATE` — used below — is **this document's own workflow label** for "reported by the external project, not yet reproduced here". It is not part of either vocabulary, and anything that closes here must be restated in the canonical vocabulary.

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

This independent implementation evidence increases confidence that the WotbTools canonical interpretation is not an artifact of one decoder or one analysis pipeline. It does **not** change the evidence state of facts already established by WotbTools.

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

External status (2026-10-02): unchanged in substance, but the external project now documents two
refinements that the local reproduction should account for.

1. **Only the high 10 bits may be used for yaw.** Decoding yaw from the whole `u16` mixes `frac6`
   variation into the yaw result (observed as ±0.3° phantom jumps), so the external project reads
   `u16 >> 6` and nothing else.
2. **The pitch fraction is anchored per sector, not per vehicle alone.** A controlled rotation
   experiment (T95E6 rotating a full turn) showed `frac` pinned at 63 while the physical depression
   limit differed by sector (≈ −0.5° rear vs ≈ −10° front). The external reading is therefore that the
   server packs `frac` against the limit **for the current turret direction**, i.e. the limit table
   must be sectorised (front/back) rather than a single pair per vehicle. Anchoring evidence reported:
   `frac = 63` ↔ depression limit and `frac = 0` ↔ elevation limit (controlled clamp), plus a ballistic
   anchor regression slope of 0.997.

Required closure:
1. decode prop2 low six bits across the canonical corpus;
2. join same-clock / nearest method36 and Type39 samples;
3. compare against version-matched vehicle depression/elevation limits **and their per-sector variants**;
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

External status (2026-10-02) — the external project has now **explicitly resolved its own earlier
contradiction** in the immutable research snapshot above. This resolves the external project's document
history; it does **not** promote the claim inside WotbTools.

At the pinned research snapshot, the upstream source set is internally consistent on the following distinction:

| Source (blob) | Current statement |
|---|---|
| `回放射击事件逆向分析.md` `eb838731…` §4.1 + §7 | terminal position: the six-byte payload is the client's `DecodeShotSegment` two-point AABB encoding (entry/exit); the earlier `[shell u16][yaw u16][pitch u16]` and "effect bytes" readings are explicitly retracted; the failed early 3D reconstruction is attributed to the wrong box source / axis order |
| `客户端弹道与命中位置逆向报告.md` `77fa549a…` supersede note + §2.4 | historical "fourth/sixth round" blockquotes are retained as research history but are now explicitly marked as superseded where they claimed that hash6 coordinate semantics were false; the report separately preserves the observation that the **visible in-game decal** is produced from the client tracer/model path, which is a rendering statement rather than a packet-byte interpretation |
| `WI射击参数与命中位置分析.md` `b0cd657e…` §5.1 | supports the same two-point AABB reading |

Therefore the two-point encoding is the external project's **stated conclusion at the pinned snapshot**, not a fact that
WotbTools has independently closed. The local reproduction in §10 item 2 remains mandatory before any
promotion to WotbTools canonical evidence.

The external project's reported byte mapping follows. Use it as the hypothesis to test, not as a
canonical fact model:

```text
P1 = (b2, b4, b3)     P2 = (b5, b7, b6)
axis order: x right <- b2/b5,  y forward <- b4/b7,  z up <- b3/b6
interpolation: 1/255 linear across the part AABB; b4 is always 255
```

The part AABB must come from the game's native collision boxes (`collision.*_bbox`) together with the
part pivot pose; the external project attributes its earlier failed reconstruction to using the armour
mesh instead of the client collision mesh.

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

External status (2026-10-02): the external project keeps this selector strictly separate from the
method38 device-token namespace (it is surfaced as a server-specified part constraint, not as a damaged
device), which agrees with the separation rule above. Reported evidence strengthened to a **vertical
height stratification** of hit points by component index — medians ≈ 0.70 m (0 chassis/tracks),
1.17 m (1 hull), 2.84 m (2 turret) above ground — plus a client-side range assertion
(`componentIndex < 4`). The same value is reported to reappear at Type32 26-byte byte 11
(62/62 agreement with the method8 element), which makes it a cross-validated field rather than a
method8-local one.

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

At the original 2026-09-26 review snapshot, it also reported multiple 26/27-byte variants and recorded an unresolved layout conflict for the tail bytes.

At that original snapshot, only the existence of a shell/result-bearing Type32 hit family could safely be imported as a research lead; the exact tail layout was **not closed**. The update below records the later external reclassification without retroactively turning it into WotbTools-local closure.

External status (2026-10-02): the external project has since **split the family by payload length** and
the split accounts for the earlier "layout conflict" — it was a comparison across different families.
Current external reading (all figures below are the external project's own, from the snapshot cited at the
top; a `2,359/2,359` figure attributed to *this* archive appears in the external project's adjudication
record, but no corresponding probe/closure could be located here, so it is deliberately **not** reproduced):

| Family | External reading | Open part |
|---|---|---|
| 26/27-byte (`b4 = 1`) | hit notification; the external project reports the 6-byte token byte-identical to the method8 element of the same event (86/86 on its own corpus), making its pairing token-exact rather than time-window; trailing 8 bytes = `[result u8][shell_global_id u24 LE][0x00][X][Y][Z]`, with the final byte read as a server armour-plate id | bytes 5–6 as a signed quantised pair (reference frame undetermined); 27-byte byte 10/11 |
| 24/25-byte (`b4 = 0`) | **re-classified by the external project**: consumable lifecycle stream, not module-damage percentages — `[wireCode u8][state u8][f64 clock][f32 param]`, state 1/2/3/255 = registered/active/cooldown-started/removed, param = effective or cooldown seconds | none claimed; the old "module damage %" reading is retracted |
| 11–16-byte | short broadcast; structure parsed, semantics not | whole family |

The `result` byte is reported to share the method8 result domain. Per this document's rule, the 26/27-byte
byte layout still needs local reproduction before promotion; the family split and the retraction in row 2
are corrections of external-only claims, not changes to any WotbTools fact.

Status: **EXTERNAL_CANDIDATE — partial external decoding, not locally closed.**

Do not promote a fixed byte layout until variants are separated by version/method/length and independently closed.

## 6. Avatar method27 terrain-impact candidate

The external project reports an Avatar method27 / `0x1b` family keyed by `shotId`, containing:
- shell global ID;
- material byte;
- terminal/impact point;
- **terminal-segment velocity direction vector** (弹道末段速度方向向量) — the field recorded as a
  "segment-start point" in the original review.

It reports that this surface is globally observable for terrain impacts and can therefore recover shell identity for some non-recorder shots when joined to method29 by shotId.

This could close an important WotbTools limitation: shell identity outside recorder-owned ammunition state.

### Correction (2026-10-02): the "segment-start point" reading is falsified

The external project's own controlled adjudication (2026-09-28, 5 replays / 92 packets / 79 pairs)
contradicts the reading recorded above, and its document set was revised to match:

| Test | Result |
|---|---|
| position hypothesis: `\|segment − launchPoint\| < 0.5 m` | **0/79** |
| direction hypothesis: `cos(segment, launch velocity) > 0.99` | **79/79**, median 1.000000 |
| magnitude of the 3-vector | 0.229..248.7 (vector-scale, not a position) |

Therefore args\[21..33) is the **terminal-segment velocity direction vector** (the external project's
stable wording: 弹道末段速度方向向量), not a point. "Outgoing" is deliberately not used here: the term
could be read as the post-impact exit/ricochet direction, which the source material does not claim. Any
WotbTools closure attempt that treats the field as a position will not converge; the closure should instead
test it as a direction, and the "endpoint equality" check should use the separate impact-point field, which
the external project reports equal to the method20 terminal endpoint (84/92 within 1 cm).

Two further details for the closure:

- **The shell-id mask is 24 bits, not 16.** The external project re-adjudicated this on 2026-09-30:
  the byte above the low 16 bits carries the high bits of the module-local id (observed AP ids reach
  ≈ `0x08250a`), so a `& 0xFFFF` mask truncates those ids and the shell lookup misses. Use
  `& 0xFFFFFF`; the top byte is noise.
- The packet fires only when a shell hits **terrain** (static props such as rocks and buildings emit
  nothing), so terrain-impact coverage is partial by construction — roughly two thirds of terrain shots
  in the external corpus.

Status: **EXTERNAL_CANDIDATE — high priority.**

Required closure:
1. enumerate method27 payload shapes across the canonical corpus;
2. pair by shotId to method29/method20;
3. verify endpoint equality against the **impact-point** field, and test args\[21..33) as a direction;
4. compare shell IDs against recorder method17/Type28 on recorder-owned shots, with the 24-bit mask;
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

External status (2026-10-02): the external project reports the blob as **cracked**, not merely plausible.
Reported layout (15-byte composition blob inside the arena-info player entry):

```text
[tank_id u16][chassis_local u16][engine_local u16][204 u32][turret_local u16][gun_local u16][00]
local = module_id >> 8   (item-defs local id)
```

Reported method of proof: a differential experiment on one vehicle (gun swapped) to fix the field offsets.

**Tiering matters here — only the first tier is deterministic** (this is the external project's own code
path, described in `src/wargaming/tank_configs.rs` / `playback_viewer.rs`):

| Tier | Input | Nature |
|---|---|---|
| 1 | composition blob (`turret_local` + `gun_local` exact match) | **deterministic evidence** |
| 2 | filters — fired shell ids ⊆ the config's shell catalog, and/or initial HP = hull + turret health (× improved-durability multiplier, ±2 tolerance) | **fallback evidence** |
| 3 | unresolved multi-match | **heuristic**: the code takes the *last* matching candidate, i.e. a top-tier preference, and the playback viewer comment states outright "弹种证据缺失（未开炮）时按血量；再缺失取顶级配置" |

So the chain is **not** fail-closed and does not "mark cannot-know instead of guessing" — an earlier draft
of this update said that, and it was wrong. Consumers must treat tier-3 results as heuristic (the external
project's own config selection offers no provenance grade distinguishing tier 1 from tier 3), which is
precisely why §10 item 3 stays open. The pitch limit table is likewise keyed to the *selected* gun and is
**sectorised** (front/back) — see §2.

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

- exact Type32 tail layout: the "conflicting variants" of the original review are explained by the family split (§5), but the residual bytes (26/27-byte bytes 5–6, 27-byte byte 10/11) stay unnamed;
- **any promotion of the two-point hit-segment encoding solely because the external project now states it consistently** (§3): the upstream supersede chain is resolved, but WotbTools still has not independently reproduced the encoding on its own corpus / controlled probe;
- any loadout selection produced by the external project's tier 2/3 path (shell / HP filters, top-tier preference) as if it were deterministic evidence — only the composition-blob match is deterministic (§7);
- any reading of method27 args\[21..33) as a **position** — the external project's own controlled test falsified it (§6);
- exact private names for unresolved method8 tail bytes;
- exact WI simulation ray formula where the external investigation records residual uncertainty;
- any claim that a locally reconstructed hit coordinate is the exact server collision coordinate;
- any death model based solely on `HP == 0` or one Type7 subtype.

WotbTools' current death model remains authoritative: explicit terminal state/event first, live corroborating surfaces next, settlement-second fallback when single-POV observation is absent. Controlled drowning proves that positive-HP terminal death exists.

## 10. Verification queue

Priority order for local WotbTools closure (annotated 2026-10-02 with what the external project has since
changed; **the annotation is external progress, not local closure** — every item still requires
reproduction against the WotbTools corpus or a controlled probe):

1. **P0 — prop2 low6 gun pitch** against method36 / Type39 / launch geometry.
   *External:* decode unchanged, but read yaw from the high 10 bits only, and use a **sectorised** pitch
   limit table (§2), otherwise the comparison will disagree by design.
2. **P0 — method8 six-byte hit segment + component selector** using controlled collision targets.
   *External:* at the pinned research snapshot, the external project's source set consistently states the two-point AABB
   quantisation with a fixed byte/axis mapping (§3), after explicitly marking its earlier contrary blockquotes
   as superseded. That resolves the upstream documentation history, **not** WotbTools evidence. The component
   selector has height-stratification evidence and reappears at Type32 byte 11 (§4). Highest value of the
   queue — the mapping is specific enough to reproduce directly against the WotbTools corpus / controlled probe.
3. **P1 — updateArena actual gun/turret loadout** using alternate-module vehicles.
   *External:* blob layout reported cracked; note the external project's chain is **tiered** and only the
   composition-blob tier is deterministic — tier 2 (shell/HP) is fallback evidence and tier 3 is a
   top-tier heuristic, not fail-closed (§7). The closure should therefore ask whether the blob tier alone
   is sufficient, and must not inherit the heuristic as if it were canonical.
4. **P1 — method27 terrain impact shell ID** against recorder-known shell descriptors.
   *External:* re-scope the test — args\[21..33) is a **terminal-segment velocity direction vector**, not a
   position, and the shell-id mask is 24-bit (§6); the packet does not fire for static-prop impacts.
5. **P1 — Type32 shell/result variants** separated by payload shape.
   *External:* family split proposed, which also retracts the old "module damage %" reading of the
   24/25-byte family (§5).
6. **P2 — client render-filter reproduction**, kept strictly outside protocol truth.
   *External:* supports keeping the two apart, and reports the filtered grid diverging from raw Type10
   after AoI re-entry (up to ≈ 276 m on the first frames, ≈ 5 s to converge), which is a measured reason
   the render grid must never be used as position evidence.

Promotion rule: once a candidate is independently reproduced, add a focused closure document and synchronize the bilingual complete reference + `inventory.md`, following the archive maintenance rule.

## Provenance

External repository reviewed: `fanypcd/WoT-Blitz-Agent`.

Snapshots (immutable, as declared at the top of this document):

| Role | Identifier |
|---|---|
| released artifact consumed by this repo | tag `v0.3.8` = `f35baa46ec4d069c8d68cfad66cafcd166e0a492` (older: this repo previously pinned `v0.3.1` = `b64bfd13…`), pinned in `deploy/agent/source.json` |
| research source quoted below | commit `e37e6a7d9ce93adb289ba13d6b25aa5aa47fe7ed`; doc blobs listed at the top |
| original 2026-09-26 review | `回放射击事件逆向分析.md` blob `2dca7b66…`; `WI射击参数与命中位置分析.md` blob `b0cd657e…` (this one is still current) |

Relevant source documents (research snapshot):
- `回放射击事件逆向分析.md` — the project's authoritative packet-segment reference (§4.1 hash6, §7 retraction list)
- `回放未解析数据清单.md` — one-page status table for every packet segment
- `客户端弹道与命中位置逆向报告.md` — client-binary report; its 2026-10-02 supersede note explicitly marks the old §2.4 coordinate-semantics rejection as historical/retracted while preserving the visible-decal rendering observation
- `WI射击参数与命中位置分析.md` — WI-side simulation analysis (§5.1 supports the two-point reading)
- `游戏回放数据处理分析报告.md` — historical report (reviewed originally, unchanged relevance)

Added by the external project after the review:
- its adjudication record of the diffs against this archive's conclusions;
- `docs/replay-contract-v2-supremacy-type39.md` (supremacy base state / real-time points / Type39 aim frames);
- its local-export feasibility reports (client-side `tanks.pb` / `models.pb` / GLB extraction).

Relevant external implementation surfaces (paths moved into a core crate since the review; the
configuration-selection tiering in §7 lives in the same crate's server-side glue):
- `crates/replay-core/src/replay/combat/` (event/collection layers)
- `crates/replay-core/src/replay/playback.rs`
- `crates/replay-core/src/replay/filter.rs`
- `src/wargaming/tank_configs.rs`, `src/wargaming/playback_viewer.rs` (loadout selection tiers, §7)

Note on the pinned artifact: the facet additions cited in §10 (`HitNotice` / `Health` events, raw poses
and turret observations, unclamped HP, `roster_complete`) landed in `v0.3.5`–`v0.3.8`, so they **are**
part of the currently pinned `v0.3.8` artifact — but this document's candidates still require *local*
reproduction, and nothing here is promoted by that release.

The external repository is evidence/provenance only. WotbTools evidence grades remain governed by this archive's controlled-replay rules.
