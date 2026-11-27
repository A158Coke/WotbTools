import * as THREE from 'three'
import {
  yprScene, cloneDetachedTurret,
} from '../glbRig.js'
import { collectGlbParts } from './glbParts.js'
import { resolveMountedConfig } from '../reloadBar.js'
import type { TankJsonLike } from '../reloadBar.js'
import {
  applyTankDestroyedVisual, destroyedVisualAmount, disposeTankDestroyedVisual, prepareTankDestroyedVisual,
} from '../tankDestroyedVisual.js'
import { sampleDetachedPose } from '../trackInterp.js'
import { sampleVehiclePoseGame } from '../../replay-local/pose/vehiclePose.js'
import { lastKnownPoseAt, replacedBySuccessorAt } from './lastKnown.js'
import type { VehiclePoseGame } from '../../replay-local/pose/vehiclePose.js'
import { measureShadowFootprint } from './tankContactShadows.js'
import { ASSET_CONCURRENCY, mapLimit } from './util.js'
import { createTrailState } from '../treadMarks.js'
import { createVehicleModelAssets } from './vehicleModelAssets.js'
import { createVehicleModelPose } from './vehicleModelPose.js'
import type {
  DetachedTurret, RuntimeVehicle,
  VehicleRuntimeDeps, VehicleRuntimeHandle,
} from './vehicleRuntimeTypes.js'
export type {
  DetachedTurret, DetachedTurretTrack, GlbCacheEntry, RuntimeVehicle, RuntimeVehicleDef,
  SuspensionJson, SuspensionParts, SuspensionSide, SuspensionTrackPart, SuspensionWheelPart,
  TickPose, TreadRuntimeParams, VehicleRuntimeData, VehicleRuntimeDeps, VehicleRuntimeHandle,
} from './vehicleRuntimeTypes.js'

const LAST_KNOWN_PROXY_Y = 0.42

export function createVehicleRuntime(deps: VehicleRuntimeDeps): VehicleRuntimeHandle {
  let V: RuntimeVehicle[] = [];
  let glbOn = false;
  const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  const poseOf = (v: RuntimeVehicle, t: number) => sampleVehiclePoseGame(
    v.def, deps.poseGrid, t, _poseOut, deps.visByEid().get(v.def.eid) ?? v.def.coverage,
  );
  const _poseOut: VehiclePoseGame = {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, turretRel: 0, gunPitch: 0,
  };
  function poseStash(v: RuntimeVehicle, t: number) {
    const s = v.tickPose || (v.tickPose = { t: NaN, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, gunPitch: 0 });
    if (s.t !== t) {
      const p = poseOf(v, t);
      s.t = t;
      s.x = p.x; s.y = p.y; s.z = p.z;
      s.yaw = p.yaw; s.pitch = p.pitch; s.roll = p.roll;
      s.turretAbs = p.turretAbs; s.gunPitch = p.gunPitch;
    }
    return s;
  }
  function posAt(v: RuntimeVehicle, t: number, out: THREE.Vector3) {
    const p = poseStash(v, t);
    out.set(-p.x, p.y, p.z);
    return out;
  }
  function yawAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).yaw; }
  function hullPitchAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).pitch; }
  function turretAbsAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).turretAbs; }
  function gunPitchAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).gunPitch; }
  const rollAt = (v: RuntimeVehicle, t: number) => poseStash(v, t).roll;

  function buildVehicles() {
    const data = deps.getData();
    if (!data) return;
    const scene = deps.getScene();
    if (!scene) return;
    const hullProfile = new THREE.Shape();
    hullProfile.moveTo(-1.6, -3.1);
    hullProfile.lineTo(1.6, -3.1);
    hullProfile.lineTo(1.6, 1.15);
    hullProfile.lineTo(0, 3.1);
    hullProfile.lineTo(-1.6, 1.15);
    hullProfile.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(hullProfile, { depth: 1.05, bevelEnabled: false });
    hullGeo.rotateX(Math.PI / 2);
    hullGeo.translate(0, 1.45, 0);
    const trackGeo = new THREE.BoxGeometry(3.6, 0.75, 6.5);
    const turretGeo = new THREE.BoxGeometry(2.35, 0.85, 3.3);
    const gunGeo = new THREE.CylinderGeometry(0.14, 0.18, 5.4, 8);
    const grilleGeo = new THREE.BoxGeometry(2.0, 0.4, 0.5);
    for (const def of data.vehicles) {
      const color = deps.teamColor({ def });
      const g = new THREE.Group(); g.userData.eid = def.eid;
      const hull = new THREE.Mesh(hullGeo, new THREE.MeshLambertMaterial({ color }));
      const tracks = new THREE.Mesh(trackGeo, new THREE.MeshLambertMaterial({ color: 0x333a44 })); tracks.position.y = 0.42;
      const grille = new THREE.Mesh(grilleGeo, new THREE.MeshLambertMaterial({ color: 0x272e38 })); grille.position.set(0, 1.62, -2.8);
      const turretG = new THREE.Group(); turretG.position.y = 1.85;
      const turret = new THREE.Mesh(turretGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(1.15) }));
      turret.position.z = -0.25;
      const gunPivot = new THREE.Group(); gunPivot.position.set(0, 0.05, 1.5);
      const gun = new THREE.Mesh(gunGeo, new THREE.MeshLambertMaterial({ color: 0x59636f }));
      gun.rotation.x = Math.PI / 2; gun.position.z = 2.4;
      gunPivot.add(gun); turretG.add(turret); turretG.add(gunPivot);
      const hullG = new THREE.Group(); hullG.name = '__hullGroup';
      hullG.add(hull); hullG.add(grille); hullG.add(turretG);
      g.add(tracks); g.add(hullG);
      if (def.is_author) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.3, 32),
          new THREE.MeshBasicMaterial({ color: 0xe8b23c, side: THREE.DoubleSide, transparent: true,
                                        opacity: .85, toneMapped: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
        ring.userData.keepWithGlb = true;
        g.add(ring);
      }
      const lastKnownProxy = new THREE.Mesh(trackGeo, new THREE.MeshLambertMaterial({
        color, transparent: true, opacity: 0.35, depthWrite: false,
      }));
      lastKnownProxy.visible = false;
      scene.add(lastKnownProxy);
      const v: RuntimeVehicle = { def, group: g, turretG, gunPivot, meshHull: hull, hullGroup: hullG,
        detachedTurrets: [], proxyVisual: null, glbVisual: null,
        labelAnchor: new THREE.Vector3(), lastKnownPose: null, lastKnownAt: NaN, lastReplaced: false, lastKnownProxy,
        trail: null, tread: null, treadMesh: null };
      v.detachedTurrets = (data.detached_turrets || []).filter(track => track.vehicle_eid === def.eid).map(track => {
        const root = new THREE.Group(); root.userData.eid = def.eid;
        const proxy = turretG.clone();
        proxy.position.set(0, 0, 0); proxy.quaternion.identity();
        proxy.children[1].rotation.x = -gunPitchAt(v, track.pose_kf.t[0]);
        root.add(proxy); root.visible = false; scene.add(root);
        return { track, root, proxy, proxyVisual: prepareTankDestroyedVisual(proxy), glb: null, glbVisual: null };
      });
      v.proxyVisual = prepareTankDestroyedVisual(g, { cloneMaterials: false });
      v.labelAnchor = new THREE.Vector3();
      v.trail = { L: createTrailState(), R: createTrailState(), builtT: -Infinity };
      v.tread = null; v.treadMesh = null;
      if (deps.quality().treadMarks) deps.treadAttachVehicle(v);
      scene.add(g);
      V.push(v);
      setLowPoly(v, true);
    }
  }

  const { loadGlb, disposeCache } = createVehicleModelAssets(deps)
  const { collectSuspensionParts, poseGlb, poseGlbRig, glbGunWorld, frameTiming, markSeekSnap, clearSnap } = createVehicleModelPose(deps, { yawAt, hullPitchAt, turretAbsAt, gunPitchAt, rollAt, wrapPi })

  async function applyGlbToggle(on: boolean) {
    const gen = deps.sessionGen();
    glbOn = on;
    deps.store.glbOn = on;
    const scene = deps.getScene();
    if (on) {
      if (!scene) return;
      await mapLimit(V.filter(v => v.def.tank_id > 0), ASSET_CONCURRENCY, async (v) => {
        if (!v.glb) {
          const loaded = await loadGlb(v.def.tank_id);
          if (gen !== deps.sessionGen()) return;
          if (loaded && glbOn && !v.glb) {
            const inst = loaded.template.clone();
            inst.scale.setScalar(1);
            const mounted = loaded.sd ? resolveMountedConfig(v.def, loaded.sd as TankJsonLike) : null;
            const parts = collectGlbParts(inst, loaded.sd, mounted
              ? { turret_index: (mounted as { turret_index?: number | null }).turret_index ?? null, gun_index: (mounted as { gun_index?: number | null }).gun_index ?? null }
              : { turret_index: v.def.turret_index ?? null, gun_index: v.def.gun_index ?? null });
            if (!parts) {
              console.warn('[playback] GLB 部位不全，保留代理车 tank_id=' + v.def.tank_id)
              return
            }
            v.glb = inst;
            v.glbParts = parts;
            deps.contactShadows()?.setFootprint(v, measureShadowFootprint(inst));
            deps.contactShadows()?.attachModel(v, inst);
            v.tankData = loaded.sd;
            v.suspParts = collectSuspensionParts(inst, loaded.susp, v.def.tank_id);
            v.def.suspReaction = loaded.susp ? loaded.susp.wheels_reaction_speed ?? null : null;
            v.glb.visible = v.group.visible && !deps.classIconsVisible();
            scene.add(v.glb);
            for (const head of v.detachedTurrets) {
              head.glb = cloneDetachedTurret(inst, parts, gunPitchAt(v, head.track.pose_kf.t[0]));
              head.glbVisual = prepareTankDestroyedVisual(head.glb);
              head.root.add(head.glb);
            }
            v.glbVisual = prepareTankDestroyedVisual(v.glb);
            applyPose(v);
            deps.onModelChanged?.(v.def.eid)
            deps.invalidate();
          }
        }
        if (v.glb) setLowPoly(v, false);
      });
    } else {
      for (const v of V) {
        const hadGlb = !!v.glb;
        if (v.glb) {
          for (const head of v.detachedTurrets) {
            if (head.glb) head.root.remove(head.glb);
            disposeTankDestroyedVisual(head.glbVisual);
            head.glb = null; head.glbVisual = null;
          }
          scene?.remove(v.glb);
          disposeTankDestroyedVisual(v.glbVisual);
          v.glbVisual = null;
          if (v.suspParts && v.suspParts.disposables) {
            for (const g of v.suspParts.disposables) g.dispose();
          }
          v.glb = null; v.glbParts = null; v.suspParts = null;
        }
        setLowPoly(v, true);
        applyDetachedTurrets(v);
        if (hadGlb) deps.onModelChanged?.(v.def.eid);
      }
    }
  }
  function setLowPoly(v: RuntimeVehicle, show: boolean) {
    for (const c of v.group.children) {
      c.visible = c.userData.keepWithGlb ? deps.showMarkerStatus() : show && !deps.classIconsVisible();
    }
    if (v.meshHull) v.meshHull.visible = show && !deps.classIconsVisible();
  }

  const detachedPose: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number } = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  function detachmentAppliesNow(v: RuntimeVehicle, head: DetachedTurret) {
    const T = deps.getT();
    const startRaw = head.track.pose_kf.t[0];
    if (!(T >= startRaw)) return false;
    for (const r of v.def.resurrection_times || []) {
      if (r > startRaw && r <= T + 1e-6) return false;
    }
    return true;
  }
  function applyDetachedTurrets(v: RuntimeVehicle) {
    const T = deps.getT();
    let separated = false;
    for (const head of v.detachedTurrets) {
      const known = T >= head.track.pose_kf.t[0];
      separated ||= known && detachmentAppliesNow(v, head);
      head.root.visible = known && !deps.classIconsVisible() && sampleDetachedPose(head.track, T, detachedPose);
      if (head.root.visible) {
        head.root.position.set(detachedPose.x, detachedPose.y, detachedPose.z);
        yprScene(detachedPose.yaw, detachedPose.pitch, detachedPose.roll, head.root.quaternion);
      }
      head.proxy.visible = !head.glb;
      if (head.glb) head.glb.visible = true;
      const amount = destroyedVisualAmount({ lifeState: 'DESTROYED', destroyedKnownAtSec: head.track.pose_kf.t[0] }, T);
      applyTankDestroyedVisual(head.proxyVisual, amount);
      applyTankDestroyedVisual(head.glbVisual, amount);
    }
    v.turretG.visible = !separated;
    if (v.glbParts) {
      if (v.glbParts.turretNode) v.glbParts.turretNode.visible = !separated;
      for (const node of v.glbParts.gunNodes) node.visible = !separated;
    }
  }

  const tmpV = new THREE.Vector3();

  function applyPose(v: RuntimeVehicle) {
    const perf = deps.perfAdd
    const poseStarted = perf ? performance.now() : 0
    applyDetachedTurrets(v);
    const T = deps.getT();
    const life = deps.sceneLifeAt(v, T);
    const dead = life?.lifeState === 'DESTROYED';
    const amount = destroyedVisualAmount(life, T);
    applyTankDestroyedVisual(v.proxyVisual, amount);
    applyTankDestroyedVisual(v.glbVisual, amount);
    const vis = deps.visibleAt(v, T) || dead;
    v.group.visible = vis;
    if (v.glb) v.glb.visible = vis && !deps.classIconsVisible();
    if (!vis) {
      const spansOfForIdentity = (eid: number) => deps.visByEid().get(eid)
        ?? deps.getData()?.vehicles.find((o) => o.eid === eid)?.coverage;
      const successorStarted = perf ? performance.now() : 0;
      const replacedNow = deps.replacedAt
        ? deps.replacedAt(v.def.eid, T) === true
        : deps.getData()
          ? replacedBySuccessorAt(deps.getData()!.vehicles, spansOfForIdentity, v.def.eid, T)
          : false;
      if (perf) deps.perfAdd!('vehicleSuccessorCheckMs', performance.now() - successorStarted, 1);
      if (v.lastKnownAt !== T || v.lastReplaced !== replacedNow) {
        const resolveStarted = perf ? performance.now() : 0;
        v.lastKnownAt = T;
        v.lastReplaced = replacedNow;
        v.lastKnownPose = replacedNow
          ? null
          : lastKnownPoseAt(
            deps.visByEid().get(v.def.eid) ?? v.def.coverage, T, v.def.pos, deps.poseGrid.tStart);
        if (perf) deps.perfAdd!('vehicleLastKnownResolveMs', performance.now() - resolveStarted, 1);
      }
      const ghostStarted = perf ? performance.now() : 0;
      const ghost = v.lastKnownProxy;
      if (ghost) {
        const lk = v.lastKnownPose;
        if (lk) deps.perfAdd?.('ghostCandidates', 0, 1);
        ghost.visible = deps.store.lastKnownOn && lk != null;
        if (ghost.visible && lk) {
          deps.perfAdd?.('ghostVisible', 0, 1);
          ghost.position.set(-lk.pos[0], lk.pos[1] + LAST_KNOWN_PROXY_Y, lk.pos[2]);
        }
      }
      if (perf) deps.perfAdd!('vehicleGhostPresentMs', performance.now() - ghostStarted, 1);
      syncContactShadow(v);
      if (v.suspParts) {
        for (const k of ['L', 'R'] as const) if (v.suspParts.sides[k]) v.suspParts.sides[k]!.prev = null;
      }
      if (perf) deps.perfAdd!('vehiclePoseMs', performance.now() - poseStarted, 1);
      return;
    }
    v.lastKnownPose = null;
    v.lastKnownAt = T;
    if (v.lastKnownProxy) v.lastKnownProxy.visible = false;
    posAt(v, T, tmpV);
    v.group.position.copy(tmpV);
    if (v.glb) poseGlb(v);
    v.group.rotation.order = 'YXZ';
    v.group.rotation.y = -yawAt(v, T);
    v.group.rotation.x = hullPitchAt(v, T);
    v.group.rotation.z = -rollAt(v, T);
    if (v.hullGroup) {
      v.hullGroup.quaternion.identity();
      v.hullGroup.position.set(0, 0, 0);
    }
    const rel = wrapPi(turretAbsAt(v, T) - yawAt(v, T));
    v.turretG.rotation.y = -rel;
    v.gunPivot.rotation.x = -gunPitchAt(v, T);
    syncContactShadow(v);
    if (perf) deps.perfAdd!('vehiclePoseMs', performance.now() - poseStarted, 1);
  }

  function syncContactShadow(v: RuntimeVehicle) {
    const shadows = deps.contactShadows();
    if (!shadows) return;
    const p = v.group.position;
    shadows.update(v, p.x, p.z, v.group.rotation.y,
      v.group.visible && !deps.classIconsVisible() && v.def.eid !== deps.scopedHiddenEid());
  }

  function vehicleByEid(eid: number) { return V.find((x) => x.def.eid === eid); }

  function dispose() {
    const scene = deps.getScene();
    for (const v of V) {
      for (const head of v.detachedTurrets) {
        scene?.remove(head.root);
        disposeTankDestroyedVisual(head.proxyVisual);
        disposeTankDestroyedVisual(head.glbVisual);
      }
      if (v.glb) scene?.remove(v.glb);
      disposeTankDestroyedVisual(v.glbVisual);
      v.glbVisual = null;
      if (v.lastKnownProxy) {
        scene?.remove(v.lastKnownProxy);
        deps.disposeObject3D(v.lastKnownProxy);
        v.lastKnownProxy = null;
      }
      if (v.suspParts && v.suspParts.disposables) {
        for (const g of v.suspParts.disposables) g.dispose();
      }
      v.suspParts = null;
      if (v.group) { scene?.remove(v.group); deps.disposeObject3D(v.group); }
    }
    V = [];
    disposeCache();
  }

  return {
    getVehicles: () => V,
    buildVehicles,
    syncContactShadow,
    loadGlb,
    applyGlbToggle,
    glbOn: () => glbOn,
    setLowPoly,
    applyPose,
    applyDetachedTurrets,
    poseGlbRig,
    glbGunWorld,
    posAt, yawAt, hullPitchAt, turretAbsAt, gunPitchAt, rollAt,
    vehicleByEid,
    frameTiming, markSeekSnap, clearSnap,
    dispose,
  };
}
