import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import { clampTravel, rateLimitTravel, spinStep, treadScrollStep, groundDropLocal,
  attachChainToWheels, chainSpanBoundaries, solveChain, vertexChainParams, applyChainToVertices, chainChanged, chainDrift, sideTravel,
  parseWheelNodeName, parseTrackNodeName, wheelRadiusFromExtents,
  applyWheelSpin, measureBeltUvSlope, chainBottomRunDir, writeUvOffsetV } from '../suspension.js'
import { markPickBoundsStale } from './armorHighlight.js'
import type { GlbParts } from './glbParts.js'
import type { RuntimeVehicle, SuspensionJson, SuspensionParts, SuspensionSide, SuspensionTrackPart, SuspensionWheelPart, VehicleRuntimeDeps } from './vehicleRuntimeTypes.js'

export function createVehicleModelPose(deps: VehicleRuntimeDeps, pose: {
  yawAt: (v: RuntimeVehicle, t: number) => number; hullPitchAt: (v: RuntimeVehicle, t: number) => number
  turretAbsAt: (v: RuntimeVehicle, t: number) => number; gunPitchAt: (v: RuntimeVehicle, t: number) => number
  rollAt: (v: RuntimeVehicle, t: number) => number; wrapPi: (angle: number) => number
}) {
  const { yawAt, hullPitchAt, turretAbsAt, gunPitchAt, rollAt, wrapPi } = pose
  let suspDt = 0, suspSnap = false
  const SUSP_AXIS = new THREE.Vector3(0, 0, 1);
  const SUSP_SPIN_AXIS = new THREE.Vector3(1, 0, 0);
  const _spQ = new THREE.Quaternion(), _spQ2 = new THREE.Quaternion();
  const _spV = new THREE.Vector3(), _spP = new THREE.Vector3(), _spC = new THREE.Vector3();
  const _spUp = new THREE.Vector3(), _spFwd = new THREE.Vector3();
  const _spUpW = new THREE.Vector3(), _spBox = new THREE.Box3(), _spBox2 = new THREE.Box3();

  function collectSuspensionParts(root: THREE.Object3D, susp: SuspensionJson | null, tankId: number): SuspensionParts | null {
    if (!susp || !Array.isArray(susp.wheels) || !susp.chains) return null;
    const chainsBySide = { L: susp.chains.left, R: susp.chains.right };
    if (!Array.isArray(chainsBySide.L) || !Array.isArray(chainsBySide.R)) return null;
    root.updateMatrixWorld(true);
    const disposables: Array<{ dispose(): void }> = [];
    const sides: Partial<Record<'L' | 'R', SuspensionSide>> = {};
    for (const side of ['L', 'R'] as const) {
      const wheelNodes: Array<[number, THREE.Object3D]> = [];
      const trackNodes: Array<[number, THREE.Object3D]> = [];
      root.traverse((n) => {
        const wp = parseWheelNodeName(n.name);
        if (wp && wp.side === side) wheelNodes.push([wp.index, n]);
        const tp = parseTrackNodeName(n.name);
        if (tp && tp.side === side) trackNodes.push([tp.segment, n]);
      });
      wheelNodes.sort((a, b) => a[0] - b[0]);
      trackNodes.sort((a, b) => a[0] - b[0]);
      const chains = chainsBySide[side];
      if (!wheelNodes.length || wheelNodes.length !== susp.wheels.length) return null;
      if (!trackNodes.length || trackNodes.length !== chains.length) return null;
      const wheels: SuspensionWheelPart[] = [];
      for (const [idx, node] of wheelNodes) {
        const rec = susp.wheels[idx - 1];
        if (!Array.isArray(rec) || rec.length < 3) return null;
        const flag = rec[0], up = rec[1], down = rec[2];
        _spBox.makeEmpty();
        node.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!(mesh as THREE.Mesh).isMesh || !mesh.geometry) return;
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            _spBox.union(_spBox2.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
          }
        });
        if (_spBox.isEmpty()) return null;
        const ctr = _spBox.getCenter(new THREE.Vector3());
        const size = _spBox.getSize(new THREE.Vector3());
        const radius = wheelRadiusFromExtents(size.y, size.z);
        const travelAxis = SUSP_AXIS.clone().applyQuaternion(node.quaternion.clone().invert());
        const upHull = SUSP_AXIS.clone().applyQuaternion(node.quaternion);
        const pivot = node.parent ? node.parent.worldToLocal(ctr.clone()) : ctr.clone();
        const restPivotRot = pivot.clone().applyQuaternion(node.quaternion);
        wheels.push({
          node, flag,
          up: flag ? up : 0, down: flag ? down : 0,
          radius, centerHull: ctr, travelAxis, upHull, pivot, restPivotRot,
          restPos: node.position.clone(), restQuat: node.quaternion.clone(),
          travel: 0, spin: 0,
        });
      }
      const tracks: SuspensionTrackPart[] = [];
      for (let ti = 0; ti < trackNodes.length; ti++) {
        const node = trackNodes[ti][1];
        const chain = chains[ti];
        if (!Array.isArray(chain) || chain.length < 4) return null;
        _spBox.makeEmpty();
        const meshes: THREE.Mesh[] = [];
        node.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh || !mesh.geometry) return;
          meshes.push(mesh);
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            _spBox.union(_spBox2.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
          }
        });
        if (!meshes.length || _spBox.isEmpty()) return null;
        const lateral = _spBox.getCenter(new THREE.Vector3()).x;
        const beltW = _spBox.getSize(new THREE.Vector3()).x;
        const chain2: Array<[number, number]> = chain.map((pt): [number, number] => [pt[0], pt[1]]);
        const restZ = chain.map((pt) => pt[1]);
        const segArc: number[] = [];
        const cumArc = [0];
        for (let i = 0; i + 1 < chain2.length; i++) {
          segArc.push(Math.hypot(chain2[i + 1][0] - chain2[i][0], chain2[i + 1][1] - chain2[i][1]));
          cumArc.push(cumArc[cumArc.length - 1] + segArc[i]);
        }
        const uvSamples: Array<[number, number]> = [];
        const wheelCfg = wheels.map((w) => ({
          longitudinal: w.centerHull.y, centerZ: w.centerHull.z, radius: w.radius,
        }));
        const attach = attachChainToWheels(chain2, wheelCfg);
        const spans = chainSpanBoundaries(attach,
          chain.some((pt) => Number.isFinite(pt[2])) ? chain.map((pt) => Number(pt[2])) : null);
        const parts: SuspensionTrackPart['parts'] = [];
        for (const mesh of meshes) {
          mesh.geometry = mesh.geometry.clone();
          disposables.push(mesh.geometry);
          const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | null;
          if (!posAttr) continue;
          const basePos = new Float32Array(posAttr.array);
          const nv = basePos.length / 3;
          const rootPos = new Float32Array(basePos.length);
          const m = mesh.matrixWorld;
          for (let vi = 0; vi < nv; vi++) {
            _spV.set(basePos[vi * 3], basePos[vi * 3 + 1], basePos[vi * 3 + 2]).applyMatrix4(m);
            rootPos[vi * 3] = _spV.x; rootPos[vi * 3 + 1] = _spV.y; rootPos[vi * 3 + 2] = _spV.z;
          }
          const params = vertexChainParams(rootPos, chain2);
          const localAxis = SUSP_AXIS.clone().applyQuaternion(mesh.quaternion.clone().invert());
          const uvAttr = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute | null;
          const uvBase = uvAttr ? new Float32Array(uvAttr.array) : null;
          if (uvAttr) {
            for (let vi = 0; vi < nv; vi++) {
              const sg = params.seg[vi];
              const arc = cumArc[sg] + params.t[vi] * segArc[sg];
              uvSamples.push([arc, uvAttr.array[vi * 2 + 1]]);
            }
          }
          parts.push({ mesh, posAttr, basePos, params, axis3: [localAxis.x, localAxis.y, localAxis.z],
                       uvAttr, uvBase, appliedUv: 0 });
        }
        if (!parts.length) return null;
        const uvFit = measureBeltUvSlope(uvSamples);
        const dvPerM = uvFit.ok ? chainBottomRunDir(chain2) * uvFit.slope : 0;
        if (!uvFit.ok) {
          console.warn('[playback] 履带 UV 沿带斜率不可测（花纹停滚）tank=' + (tankId || '?')
            + ' pairs=' + uvFit.pairs);
        }
        tracks.push({
          node, parts, chain: chain2, restZ, attach, spans, wheelCfg, lateral, beltW,
          groundDrop: new Float64Array(chain2.length),
          chainZ: new Float64Array(chain2.length),
          appliedChainZ: null,
          normalChainZ: null,
          dvPerM, uv: 0,
        });
      }
      let sum = 0, wsum = 0;
      for (const tg of tracks) { sum += Math.abs(tg.lateral); wsum += tg.beltW || 0; }
      sides[side] = {
        wheels, tracks, wheelDelta: new Float64Array(wheels.length),
        halfW: tracks.length ? sum / tracks.length : 0,
        beltW: tracks.length ? wsum / tracks.length : 0, prev: null,
      };
    }
    return {
      sides, disposables, bend: susp.track_bending || null,
    };
  }

  function suspensionStep(v: RuntimeVehicle) {
    const sp = v.suspParts;
    if (!sp || !v.glb) return;
    _spQ.copy(v.glb.quaternion);
    _spUp.set(0, 0, 1).applyQuaternion(_spQ);
    const upY = _spUp.y;
    _spFwd.set(0, 1, 0).applyQuaternion(_spQ);
    const snap = suspSnap;
    const dt = suspDt;
    const reaction = Number.isFinite(v.def && v.def.suspReaction) ? v.def.suspReaction! : 1.0;
    for (const key of ['L', 'R'] as const) {
      const side = sp.sides[key];
      if (!side) continue;
      _spP.set(key === 'L' ? -side.halfW : side.halfW, 0, 0).applyQuaternion(_spQ).add(v.glb.position);
      let dS = 0;
      if (side.prev && !snap) {
        dS = sideTravel(side.prev.x, side.prev.z, _spP.x, _spP.z, _spFwd.x, _spFwd.z);
      }
      if (!side.prev) side.prev = new THREE.Vector3();
      side.prev.copy(_spP);
      for (let wi = 0; wi < side.wheels.length; wi++) {
        const w = side.wheels[wi];
        if (w.flag) {
          _spC.copy(w.centerHull).applyQuaternion(_spQ).add(v.glb.position);
          const terr = deps.sampleHeight(_spC.x, _spC.z);
          _spUpW.copy(w.upHull).applyQuaternion(_spQ);
          const upw = Math.abs(_spUpW.y) > 0.25 ? _spUpW.y : 0;
          if (upw) {
            const wantWorld = (terr + w.radius) - _spC.y;
            const wantLocal = clampTravel(wantWorld / upw, w.up, w.down);
            w.travel = rateLimitTravel(w.travel, wantLocal, reaction, dt, snap);
          } else {
            w.travel = 0;
          }
        } else {
          w.travel = 0;
        }
        if (dS) w.spin = spinStep(w.spin, dS, w.radius);
        _spQ2.setFromAxisAngle(SUSP_SPIN_AXIS, w.spin);
        applyWheelSpin(w.node, w.restPos, w.restQuat, w.pivot, w.restPivotRot,
                       _spQ2, w.travelAxis, w.travel);
        side.wheelDelta[wi] = w.travel;
      }
      for (const tg of side.tracks) {
        const n = tg.chain.length;
        for (let i = 0; i < n; i++) {
          _spP.set(tg.lateral, tg.chain[i][0], tg.chain[i][1]).applyQuaternion(_spQ).add(v.glb.position);
          const terr = deps.sampleHeight(_spP.x, _spP.z);
          tg.groundDrop[i] = groundDropLocal(terr, _spP.y, upY);
        }
        solveChain(tg.chainZ, tg.chain, tg.attach, side.wheelDelta, tg.groundDrop, tg.wheelCfg, sp.bend, tg.spans);
        const uv = (dS && tg.dvPerM)
          ? (tg.uv = treadScrollStep(tg.uv, dS, tg.dvPerM))
          : tg.uv;
        const chainMoved = snap || !tg.appliedChainZ || chainChanged(tg.appliedChainZ, tg.chainZ);
        if (chainMoved) {
          const dNorm = (snap || !tg.normalChainZ) ? Infinity : chainDrift(tg.normalChainZ, tg.chainZ);
          const redoNormals = dNorm > 0.02;
          for (const gp of tg.parts) {
            applyChainToVertices(gp.posAttr.array as Float32Array, gp.basePos, gp.params,
                                 tg.chainZ, tg.restZ, gp.axis3);
            gp.posAttr.needsUpdate = true;
            markPickBoundsStale(gp.mesh.geometry);
            if (redoNormals) {
              gp.mesh.geometry.computeVertexNormals();
              const na = gp.mesh.geometry.getAttribute('normal');
              if (na) na.needsUpdate = true;
            }
          }
          if (redoNormals) {
            if (!tg.normalChainZ) tg.normalChainZ = new Float64Array(n);
            tg.normalChainZ.set(tg.chainZ);
          }
          if (!tg.appliedChainZ) tg.appliedChainZ = new Float64Array(n);
          tg.appliedChainZ.set(tg.chainZ);
        }
        for (const gp of tg.parts) {
          if (gp.uvAttr && gp.uvBase && Math.abs(uv - gp.appliedUv) > 1e-3) {
            gp.appliedUv = uv;
            writeUvOffsetV(gp.uvAttr.array, gp.uvBase, uv);
            gp.uvAttr.needsUpdate = true;
          }
        }
      }
    }
  }

  const _glbQuat = new THREE.Quaternion();
  const _glbEuler = new THREE.Euler();
  const _mRot = new THREE.Matrix4(), _mTmpA = new THREE.Matrix4(), _mTmpB = new THREE.Matrix4();
  const _mTmpC = new THREE.Matrix4(), _mTmpD = new THREE.Matrix4(), _mT = new THREE.Matrix4();
  const _mG = new THREE.Matrix4(), _mAcc = new THREE.Matrix4();

  function poseGlb(v: RuntimeVehicle) {
    poseGlbRig(v, deps.getT(), v.group.position);
    suspensionStep(v);
  }
  function poseGlbRig(v: RuntimeVehicle, t: number, pos: THREE.Vector3) {
    if (!v.glb) return;
    v.glb.position.copy(pos);
    v.glb.quaternion.copy(poseFromYPR(-yawAt(v, t), hullPitchAt(v, t), -rollAt(v, t), _glbQuat));
    const p = v.glbParts;
    if (p && p.hullGroup) {
      p.hullGroup.quaternion.identity();
      p.hullGroup.position.set(0, 0, 0);
    }
    if (!p) return;
    const gr = gunPitchAt(v, t);
    const mT = glbTurretMatrix(v, p, t);
    const mG = _mG.copy(_mT).multiply(_mTmpB.makeTranslation(p.gP[0], p.gP[1], p.gP[2]))
      .multiply(_mTmpC.makeRotationX(gr))
      .multiply(_mTmpD.makeTranslation(-p.gP[0], -p.gP[1], -p.gP[2]));
    p.poseT.copy(mT);
    p.poseG.copy(mG);
    const tn = p.turretNode;
    if (tn) {
      tn.updateMatrix();
      if (!tn.userData.__bake) { tn.userData.__bake = tn.matrix.clone(); tn.matrixAutoUpdate = false; }
      tn.matrix.copy(_mAcc.copy(mT).multiply(tn.userData.__bake as THREE.Matrix4));
    }
    for (const gn of p.gunNodes) {
      gn.updateMatrix();
      if (!gn.userData.__bake) { gn.userData.__bake = gn.matrix.clone(); gn.matrixAutoUpdate = false; }
      gn.matrix.copy(_mAcc.copy(mG).multiply(gn.userData.__bake as THREE.Matrix4));
    }
  }
  function glbTurretMatrix(v: RuntimeVehicle, p: GlbParts, t: number) {
    const rel = wrapPi(turretAbsAt(v, t) - yawAt(v, t));
    const tr = -rel;
    if (p.itr) {
      _glbEuler.set(-THREE.MathUtils.degToRad(p.itr.pitch || 0), -THREE.MathUtils.degToRad(p.itr.roll || 0),
                    tr - THREE.MathUtils.degToRad(p.itr.yaw || 0), 'ZYX');
      _mRot.makeRotationFromEuler(_glbEuler);
    } else {
      _mRot.makeRotationZ(tr);
    }
    return _mT.makeTranslation(p.tP[0], p.tP[1], p.tP[2]).multiply(_mRot)
      .multiply(_mTmpA.makeTranslation(-p.tP[0], -p.tP[1], -p.tP[2]));
  }
  function glbGunWorld(v: RuntimeVehicle, pos: THREE.Vector3, dir: THREE.Vector3): boolean {
    const p = v.glb ? v.glbParts : null;
    const parent = p && (p.turretNode ?? p.gunNodes[0])?.parent;
    if (!parent) return false;
    parent.updateWorldMatrix(true, false);
    const turret = glbTurretMatrix(v, p, deps.getT());
    const pitch = gunPitchAt(v, deps.getT());
    dir.set(0, Math.cos(pitch), Math.sin(pitch)).transformDirection(turret).transformDirection(parent.matrixWorld);
    pos.set(p!.gP[0], p!.gP[1], p!.gP[2]).applyMatrix4(turret).applyMatrix4(parent.matrixWorld);
    return true;
  }
  return { collectSuspensionParts, poseGlb, poseGlbRig, glbGunWorld,
    frameTiming: (dt: number, snap: boolean) => { suspDt = dt; suspSnap = snap },
    markSeekSnap: () => { suspSnap = true; suspDt = 0 }, clearSnap: () => { suspSnap = false } }
}
