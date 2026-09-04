# 3D Battle Playback — Client Map Research

## Status

PR1 / Phase 0: **COMPLETE — EXTRACTION, VISIBILITY, AND REVIEW HARDENING PASS**.

This research establishes the renderer-neutral client-map contract needed before PR2 Map Geometry Core.

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

The exporter emits renderer-neutral local geometry plus preserved SC2 world transforms. It intentionally excludes raw client textures/material presentation, vegetation, and unproven gameplay collision/nav semantics.

---

# PR2 Map Geometry Core handoff

Input:

```text
SC2 + companion SCG + heightmap + existing map semantics
```

Output:

```text
deterministic renderer-neutral manifest
+ shared local static geometry buffers
+ initially-visible instance transforms
+ terrain representation
+ canonical world bounds / coordinate metadata
+ transformed world-AABB sanity report
```

Canal + Port Bay remain the dual-map contract gate.

Large environment/surroundings meshes may legitimately exceed playable bounds; PR2 must report transformed world AABBs but must not delete geometry by filename or size heuristics.

---

# Collision / nav boundary

Confirmed:

- `CollisionTypeComponent` metadata exists;
- independent gameplay collision geometry is not yet proven;
- `.mkm/.lka` are associated with TerrainData;
- navmesh/passability semantics are not proven.

These do not block visual 3D Playback. Spatial Analysis must continue this research separately before AI LOS/pathing consumes such data.

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
- [x] PR2 handoff
