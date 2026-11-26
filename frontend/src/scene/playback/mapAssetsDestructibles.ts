import type { InstancedMesh } from 'three'
import { buildDestructibleIndex, foldDestructibleStates, fallStopAngle } from '../destructibles.js'
import type { DestructibleEvent, DestructibleInstance, DestructibleSlot } from '../destructibles.js'
import type { MapAssemblyContext, MapAssemblyWrites } from './mapAssets.js'
import type { BatchedEntry } from './mapAssets.js'


export interface DestructibleAssembly {
  destruct: MapAssemblyWrites['destruct']
  volatileBatches: Set<InstancedMesh>
}

export function assembleDestructibleSlots(
  DATA: NonNullable<MapAssemblyContext['DATA']>,
  destructDoc: { instances?: DestructibleInstance[] },
  findMeshes: (px: number, py: number, wantDestroyed: boolean, r?: number) => BatchedEntry[],
  ctx: Pick<MapAssemblyContext, 'heightField' | 'sampleHeight' | 'DEBUG'>,
): DestructibleAssembly {
  const areasByEid = new Map((DATA.destructible_areas || []).map((a) => [a.eid, a]));
  const index = buildDestructibleIndex(destructDoc);
  const states = foldDestructibleStates(DATA.destructible_events as DestructibleEvent[], areasByEid, index);
  const slotOf = (e: BatchedEntry): DestructibleSlot => ({ mesh: e.batch.mesh, idx: e.idx, base: e.matrix });
  for (const st of states) {
    const [px, py] = st.inst.pos;
    if (st.prop === 3) {
      const hits = findMeshes(px, py, false);
      if (!hits.length) continue;
      const pivotZ = hits[0].z;
      let heightM = 0;
      for (const h of hits) {
        const geo = h.node.geometry;
        if (!geo) continue;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (bb) heightM = Math.max(heightM, (bb.max.z ?? 0) + (h.z - pivotZ));
      }
      st.slots = hits.map(slotOf);
      st.heightM = heightM;
      st.pivotPos = { x: px, y: py, z: pivotZ };
      st.fallQuat = { w: 1 };
      st.upright = true;
      st.stopRad = ctx.heightField
        ? fallStopAngle(st.fallDir, st.pivotPos, heightM, (lx: number, ly: number) => ctx.sampleHeight(-lx, ly))
        : Math.PI / 2;
    } else {
      st.intactSlots = findMeshes(px, py, false).map(slotOf);
      st.deadSlots = findMeshes(px, py, true).map(slotOf);
    }
  }
  const destruct: NonNullable<MapAssemblyWrites['destruct']> = { states, ptr: 0, lastT: -1, animating: false };
  const volatileBatches = new Set<InstancedMesh>();
  for (const st of states) {
    for (const s of st.slots ?? []) volatileBatches.add(s.mesh);
    for (const s of st.intactSlots ?? []) volatileBatches.add(s.mesh);
    for (const s of st.deadSlots ?? []) volatileBatches.add(s.mesh);
  }
  for (const st of states) {
    if (st.prop !== 3 || !st.slots || !st.pivotPos) continue;
    for (const s of st.slots) {
      const sph = s.mesh.boundingSphere;
      if (!sph) continue;
      if (!s.mesh.geometry.boundingSphere) s.mesh.geometry.boundingSphere = sph.clone();
      const geo = s.mesh.geometry.boundingSphere;
      const e = s.base.elements;
      const cx = e[0] * geo.center.x + e[4] * geo.center.y + e[8] * geo.center.z + e[12];
      const cy = e[1] * geo.center.x + e[5] * geo.center.y + e[9] * geo.center.z + e[13];
      const cz = e[2] * geo.center.x + e[6] * geo.center.y + e[10] * geo.center.z + e[14];
      const sx = Math.hypot(e[0], e[1], e[2]);
      const sy = Math.hypot(e[4], e[5], e[6]);
      const sz = Math.hypot(e[8], e[9], e[10]);
      const r = geo.radius * Math.max(sx, sy, sz);
      const dGeo = Math.hypot(cx - st.pivotPos.x, cy - st.pivotPos.y, cz - st.pivotPos.z);
      const dCenter = Math.hypot(
        sph.center.x - st.pivotPos.x,
        sph.center.y - st.pivotPos.y,
        sph.center.z - st.pivotPos.z);
      const need = dCenter + dGeo + r + 2;
      if (need > sph.radius) sph.radius = need;
    }
  }
  return { destruct, volatileBatches };
}
