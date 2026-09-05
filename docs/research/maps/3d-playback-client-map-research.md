# 3D Battle Playback — Client Map Research

## Status

PR1 / Phase 0: **COMPLETE — EXTRACTION, VISIBILITY, AND REVIEW HARDENING PASS**.

This research establishes the renderer-neutral client-map contract needed before PR2 Map Geometry Core.

---

# Product boundary after the research prototype

The SC2/SCG work below remains useful research evidence, but **Battle Playback no longer consumes exported static client geometry**.

After visual validation of the first browser prototype, the product direction was deliberately narrowed to a fixed top-down **2.5D tactical relief view**:

```text
existing 2D tactical map
+ proven Z height samples
+ fixed 90° orthographic camera
+ renderer-owned hillshade
+ existing BattlePlayback SVG/DOM overlays
```

The following are explicitly outside the current Playback renderer:

- SCG building / bridge / ship / obstacle meshes;
- reconstructed client static-scene geometry;
- client textures, materials, shaders or water meshes;
- free perspective/orbit camera;
- 3D tank models.

Existing `VehicleMarker` hull/turret top-view layers remain the vehicle presentation authority. The 2.5D renderer is only a background relief layer, so replay time, markers, HP, bases, tracers and annotations continue to use the existing Battle Playback state.

## Distribution / copyright-risk boundary

The heightfield prototype is **local research / QA only**, not a production asset-distribution design.

Engineering policy:

- user supplies their own local `Maps.zip`;
- raw client resources are never committed;
- generated `common/assets/map-3d-local/` output is gitignored;
- the local exporter emits height samples only; `containsClientDerivedGeometry=false`;
- the frontend production build fails closed if `map-3d-local` exists, preventing Vite `publicDir` from copying local derived files into `dist`;
- no client map meshes, textures, materials or shaders are exported;
- optional water handling is limited to numeric horizontal Z facts; no water geometry is exported;
- production redistribution of client-derived height data remains out of scope until a separate licensing/legal decision.

This is an engineering risk-control policy, not a statement that any particular use is legally authorized.

---

# Static geometry extraction — PASS

Proven chain:

```text
SC2 Entity
  -> RenderComponent
  -> Mesh
  -> RenderObject initial visibility
  -> RenderBatch
  -> rb.datasource
  -> companion SCG
  -> unique PolygonGroup #id
  -> vertices / indices
```

## Canal / 18_canal_cn

```text
recursive entities                 2725
PolygonGroups                       237
matched datasource ids          237/237
unmatched / unreferenced            0/0
schema v3 geometry groups             70
Mesh instances                       590
positions                           85028
indices                            156543
invisible RenderObjects skipped       363
selected diagnostic State 0           347
selected diagnostic State 1             0
mutually-exclusive overlap              0
```

## Port Bay / 14_port_pt

```text
recursive entities                 3890
PolygonGroups                       217
matched datasource ids          217/217
unmatched / unreferenced            0/0
schema v3 geometry groups             80
Mesh instances                      1326
positions                           65291
indices                            123054
invisible RenderObjects skipped       713
selected diagnostic State 0           596
selected diagnostic State 1             0
mutually-exclusive overlap              0
```

---

# DAVA RenderBatch selection — PASS

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

`-1` is shared/wildcard.

---

# Initial RenderObject visibility — PASS

DAVA contract:

```text
VISIBLE = 1 << 0
explicit ro.flags -> require bit 0
missing ro.flags  -> visible by RenderObject::Load default
```

Canal and Port Bay both prove that the serialized visibility bit, not `State 0/State 1` naming, determines the initial visual branch.

Production selection does not use filename heuristics.

---

# PolygonGroup identity — PASS / hardened after review

SC2 `rb.datasource` resolves against SCG PolygonGroup `#id` by exact integer equality.

A duplicate PolygonGroup id would make that mapping ambiguous, so the shared `wotb_scg.read_scg()` parser now rejects duplicate decoded `#id` values before any inspector or exporter can consume the SCG.

`export_map_geometry_poc.py` uses the same validated `polygon_groups_by_id()` helper instead of a dict comprehension that could silently retain the last duplicate.

This makes duplicate ids an explicit parser blocker rather than a misleading successful geometry contract.

---

# Scene inspector contract — PASS / hardened after review

`inspect_map_scene.py` now has the same two format/traversal guarantees used by the other research tools:

1. `.sc2.dvpl` is DVPL-decoded; raw `.sc2` is passed through unchanged to the SC2 parser.
2. Entity/component/render statistics recursively traverse nested `#hierarchy` entities.

The scene-inspection report is schema v3 and records:

```text
sceneTraversal.mode = recursive #hierarchy
```

Target component samples also include the recursive `entityPath`.

Regression tests cover raw `.sc2`, `.sc2.dvpl`, and nested Render/Collision components.

---

# Geometry exporter schema v3

```text
RenderComponent
  -> Mesh
  -> RenderObject::VISIBLE
  -> exclude shadow-only
  -> active LOD/switch rule
  -> rb.datasource
  -> unique SCG PolygonGroup
```

The research exporter emits renderer-neutral local geometry plus preserved SC2 world transforms. It intentionally excludes raw client textures/material presentation, vegetation, and unproven gameplay collision/nav semantics.

**Current product note:** this geometry exporter is not used by the 2.5D Battle Playback renderer.

---

# PR2 Map Geometry Core research handoff

Input:

```text
SC2 + companion SCG + heightmap + existing map semantics
```

Research output:

```text
deterministic renderer-neutral manifest
+ shared local static geometry buffers
+ initially-visible instance transforms
+ terrain representation
+ canonical world bounds / coordinate metadata
+ transformed world-AABB sanity report
```

Canal + Port Bay remain the dual-map research contract gate.

Large environment/surroundings meshes may legitimately exceed playable bounds; research tooling must report transformed world AABBs but must not delete geometry by filename or size heuristics.

---

# Collision / nav boundary

Confirmed:

- `CollisionTypeComponent` metadata exists;
- independent gameplay collision geometry is not yet proven;
- `.mkm/.lka` are associated with TerrainData;
- navmesh/passability semantics are not proven.

These facts are not consumed by the 2.5D visual renderer. Spatial Analysis must continue this research separately before AI LOS/pathing consumes such data.

---

# PR1 DoD

- [x] Maps.zip inventory
- [x] terrain + coordinate baseline
- [x] SCPG / PolygonGroup parser
- [x] recursive SC2 datasource ↔ SCG exact link
- [x] vertex/index decoder
- [x] duplicate PolygonGroup id fail-fast
- [x] DAVA RenderBatch shared `-1` contract
- [x] DAVA initial visibility contract
- [x] raw `.sc2` / `.sc2.dvpl` loading
- [x] recursive scene inspector
- [x] state-switcher diagnostic tooling
- [x] Canal schema v3 final gate
- [x] Port Bay schema v3 final gate
- [x] PR247 review findings closure
- [x] PR2 research handoff
