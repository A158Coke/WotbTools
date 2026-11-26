import * as THREE from 'three'
import type { Camera, Intersection, Mesh, Object3D, Raycaster, Scene } from 'three'
import { nameChainOf, nearestInstance, chainVisible, meshOwnerKey, stateVisualLabel, formatPickReport } from '../pickDebug.js'
import type { PickReport } from '../pickDebug.js'
import type { DestructibleFoldState, DestructibleInstance } from '../destructibles.js'
import type { MeshOwnerValue } from '../pickDebug.js'
import type { HudFeedVehicleDef } from './hudFeed.js'

export interface PickReporterCtx {
  clock: number
  vehicles: Array<{ def?: HudFeedVehicleDef | null; group: Object3D }>
  scenery: Object3D | null
  terrainMesh: Object3D | null
  groundMesh: Object3D | null
  destruct: { states: DestructibleFoldState[] } | null
  destructPickList: DestructibleInstance[] | null
  meshOwner: Map<string, MeshOwnerValue> | null
  heightField: Float32Array | null
  heightMeta: { size?: number } | null
  camera: Camera
  raycaster: Raycaster
  container: HTMLElement
  scene: Scene
  terrainSpan: number
}

export function createPickReporter() {
  let pickMarker: THREE.Mesh | null = null;
  let pickPanel: HTMLPreElement | null = null;
  function reportPick(e: PointerEvent, ctx: PickReporterCtx): void {
    try {
      const r = ctx.container.getBoundingClientRect();
      const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ctx.raycaster.setFromCamera(nd, ctx.camera);
      const roots = [ctx.scenery, ctx.terrainMesh, ctx.groundMesh, ...ctx.vehicles.map((v) => v.group)]
        .filter((root): root is Object3D => !!root);
      const hits = roots.length ? ctx.raycaster.intersectObjects(roots, true) : [];
      const hit = hits.find((h) => chainVisible(h.object)) || null;
      const rep = buildPickReport(hit, ctx);
      const text = formatPickReport(rep);
      console.log(text);
      try { window.__pbPick = rep; window.__pbPickText = text; } catch (_) {}
      try { window.__pbPickMesh = hit ? hit.object : null; } catch (_) {}
      showPickPanel(text, ctx.container);
      if (hit) movePickMarker(hit.point, ctx.scene);
    } catch (err) {
      console.warn('[scene-pick] failed:', err);
      const errObj = err as { stack?: string; message?: string }
      try { showPickPanel(`[scene-pick] failed: ${(errObj.stack || errObj.message) || String(err)}`, ctx.container); } catch (_) {}
    }
  }
  function buildPickReport(hit: Intersection | null, ctx: PickReporterCtx): PickReport {
    if (!hit) return { clock: ctx.clock, kind: 'empty', err: 'no hit（天空/空处）' };
    let o: Object3D | null = hit.object, eid = 0;
    while (o) { if (o.userData && o.userData.eid) { eid = o.userData.eid as number; break; } o = o.parent; }
    if (eid) {
      const v = ctx.vehicles.find((x) => x.def?.eid === eid);
      return { clock: ctx.clock, kind: 'vehicle', vehicle: v?.def ?? { eid } };
    }
    const onTerrain = (() => {
      let n: Object3D | null = hit.object;
      while (n) { if (n === ctx.terrainMesh || n === ctx.groundMesh) return true; n = n.parent; }
      return false;
    })();
    if (onTerrain) return { clock: ctx.clock, kind: 'terrain', node: hit.object.name || 'terrain' };
    let scenePt = null;
    if (ctx.scenery) {
      try { scenePt = ctx.scenery.worldToLocal(hit.point.clone()).toArray(); } catch (_) {}
    }
    const chain = nameChainOf(hit.object, ctx.scenery || null);
    const mat = (hit.object as Mesh).material;
    const matName = Array.isArray(mat) ? mat.map((m) => m?.name || '?').join('|') : (mat?.name || '');
    const owner = (ctx.meshOwner && hit.instanceId != null)
      ? ctx.meshOwner.get(meshOwnerKey(hit.object, hit.instanceId)) ?? null : null;  // eslint-disable-line @typescript-eslint/no-unnecessary-condition
    const inst = (owner && owner.inst)
      || (scenePt ? nearestInstance(ctx.destructPickList, scenePt[0], scenePt[1], 3) : null);
    const st = inst ? (ctx.destruct?.states || []).find((x) => x.inst === inst) || null : null;
    let terrain = null;
    let render = null;
    if (ctx.heightField && ctx.heightMeta) {
      try {
        const n = ctx.heightMeta.size || 512;
        const span = ctx.terrainSpan;
        const fx = (hit.point.x / span + 0.5) * n;
        const fz = (hit.point.z / span + 0.5) * n;
        const j0 = Math.min(Math.max(Math.floor(fx), 0), n - 1), j1 = Math.min(j0 + 1, n - 1);
        const i0 = Math.min(Math.max(Math.floor(fz), 0), n - 1), i1 = Math.min(i0 + 1, n - 1);
        const tx = Math.min(Math.max(fx - j0, 0), 1), tz = Math.min(Math.max(fz - i0, 0), 1);
        const heightField = ctx.heightField
        const H = (i: number, j: number): number => heightField![Math.min(i, n - 1) * n + Math.min(j, n - 1)];
        const truth = (H(i0, j0) * (1 - tx) + H(i0, j1) * tx) * (1 - tz)
                    + (H(i1, j0) * (1 - tx) + H(i1, j1) * tx) * tz;
        const jj = Math.min(Math.max(Math.round(fx), 0), n - 1);
        const ii = Math.min(Math.max(Math.round(fz), 0), n - 1);
        let meshH = null;
        if (ctx.terrainMesh) {
          const rc = new THREE.Raycaster(
            new THREE.Vector3(hit.point.x, 600, hit.point.z), new THREE.Vector3(0, -1, 0));
          const th = rc.intersectObject(ctx.terrainMesh as Object3D, false);
          if (th.length) meshH = th[0].point.y;
        }
        const build = (ctx.terrainMesh as Mesh | null)?.geometry?.userData?.terrainBuild || null;
        terrain = {
          truth,
          meshH,
          sizeAt: build ? build.sizeAt[ii * n + jj] : null,
          morph: build ? build.morphRaw[ii * n + jj] : null,
          quads: build ? build.quads : null,
          overBudget: build ? build.overBudget : null,
        };
      } catch (_) { terrain = null; }
    }
    try {
      const o = hit.object as Mesh;
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      const worldPos = new THREE.Vector3();
      o.getWorldPosition(worldPos);
      let instScale: number[] | null = null;
      const imNode = o as Mesh & { isInstancedMesh?: boolean; getMatrixAt(index: number, matrix: THREE.Matrix4): void }
      if (imNode.isInstancedMesh && hit.instanceId != null) {
        const im = new THREE.Matrix4();
        imNode.getMatrixAt(hit.instanceId, im);
        instScale = new THREE.Vector3().setFromMatrixScale(im).toArray();
      }
      render = {
        type: o.type,
        name: o.name || null,
        matName: mats.map((x) => x.name || '?').join('|') || null,
        matType: mats.map((x) => x.type).join('|') || null,
        matVisible: mats.map((x) => x.visible).join(',') || null,
        transparent: mats.map((x) => x.transparent).join(',') || null,
        opacity: mats.map((x) => Number(x.opacity != null ? x.opacity : 1)).join(',') || null,
        alphaTest: mats.map((x) => x.alphaTest || 0).join(',') || null,
        depthWrite: mats.map((x) => x.depthWrite).join(',') || null,
        objVisible: o.visible,
        frustumCulled: o.frustumCulled,
        instanceId: hit.instanceId != null ? hit.instanceId : null,
        instScale,
        world: [worldPos.x, worldPos.y, worldPos.z].map((v) => Number(v.toFixed(1))),
        sphere: o.geometry && o.geometry.boundingSphere ? {
          c: [o.geometry.boundingSphere.center.x, o.geometry.boundingSphere.center.y,
            o.geometry.boundingSphere.center.z].map((v) => Number(v.toFixed(1))),
          r: Number(o.geometry.boundingSphere.radius.toFixed(1)),
        } : null,
      };
    } catch (_) { render = null; }
    return {
      clock: ctx.clock,
      kind: 'scenery',
      node: owner?.name || chain[0] || hit.object.name || hit.object.type,
      chain: chain.length > 1 ? chain : undefined,
      world: hit.point.toArray(),
      scene: scenePt || undefined,
      material: matName || undefined,
      inst: inst || null,
      serverIdKnown: !!(inst && inst.serverId),
      vis: st ? stateVisualLabel(st) : null,
      terrain,
      render,
    };
  }
  function showPickPanel(text: string, container: HTMLElement): void {
    if (!pickPanel) {
      pickPanel = document.createElement('pre');
      pickPanel.style.cssText = 'position:absolute;top:8px;left:8px;z-index:30;max-width:52ch;'
        + 'padding:8px 10px;margin:0;background:rgba(10,12,16,.86);color:#cfe3ff;'
        + 'font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;'
        + 'border:1px solid rgba(120,160,255,.35);border-radius:6px;pointer-events:none;';
      container.appendChild(pickPanel);
    }
    pickPanel.textContent = text;
  }
  function movePickMarker(p: THREE.Vector3, scene: Scene): void {
    if (!pickMarker) {
      pickMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xff8a00, depthTest: false, transparent: true, opacity: 0.9,
                                      toneMapped: false }),
      );
      pickMarker.renderOrder = 999;
    }
    pickMarker.position.copy(p);
    scene.add(pickMarker);
  }
  function dispose({ scene, disposeObject3D }: { scene: Scene; disposeObject3D: (root: Object3D, shared?: unknown) => void }): void {
    if (pickMarker) { scene.remove(pickMarker); disposeObject3D(pickMarker); pickMarker = null; }
    if (pickPanel) { pickPanel.remove(); pickPanel = null; }
  }
  return { reportPick, dispose };
}
