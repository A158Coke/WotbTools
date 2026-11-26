import * as THREE from 'three'
import type { Scene } from 'three'
import {
  advanceTrail, resetTrailState, resolveTreadParams,
  treadScaleFor,
  TREAD_FALLBACK, TREAD_RING,
} from '../treadMarks.js'
import type { TrailState, TreadParams, TreadTextureMeta } from '../treadMarks.js'
import { writeTreadBuffer, ageTreadBuffer } from './treadBufferWriter.js'
import type { TreadBufferInput } from './treadBufferWriter.js'
import { GRID_DT } from './util.js'
import { assetProvider } from '../assetProvider.js'
import { defLifeAt } from '../../utils/battlePlaybackV2.ts'
import type { RuntimeVehicle, TreadRuntimeParams } from './vehicleRuntime.js'

export interface TreadRuntimeDeps {
  store: { treadOn: boolean }
  quality(): { treadMarks?: boolean; anisotropy: number }
  getScene(): Scene | null
  destroyed(): boolean
  invalidate(): void
  getT(): number
  getStart(): number
  getData(): unknown | null
  getVehicles(): RuntimeVehicle[]
  vehicles: {
    posAt(v: RuntimeVehicle, t: number, out: THREE.Vector3): THREE.Vector3
    yawAt(v: RuntimeVehicle, t: number): number
  }
  visibleAt(v: RuntimeVehicle, t: number): boolean
  heightAt(x: number, z: number): number
  heightFieldReady(): boolean
}

export interface TreadRuntimeHandle {
  attachVehicle(v: RuntimeVehicle): void
  updateTrails(): void
  dispose(): void
}

export function createTreadRuntime(deps: TreadRuntimeDeps): TreadRuntimeHandle {
  const treadParamCache = new Map<number, Promise<TreadParams>>();
  const treadTexCache = new Map<string, THREE.Texture>();
  let treadMetaPromise: Promise<{ textures?: Record<string, TreadTextureMeta> | null }> | null = null;

  const TRAIL_CAP_PER_SIDE = TREAD_RING;
  const TRAIL_SLOTS = TRAIL_CAP_PER_SIDE * 2;
  const TREAD_HALF_GAUGE = 0.9;

  function treadParamsFor(tankId: number): Promise<TreadParams> {
    const key = Number.isFinite(tankId) && tankId > 0 ? tankId : 0;
    let p = treadParamCache.get(key);
    if (!p) {
      p = key > 0
        ? assetProvider.json<Record<string, unknown> | null>(`/tread/${key}.json`)
          .then((j) => resolveTreadParams(j))
          .catch(() => resolveTreadParams(null))
        : Promise.resolve(resolveTreadParams(null));
      treadParamCache.set(key, p);
    }
    return p;
  }

  function treadMetaFor() {
    if (!treadMetaPromise) {
      treadMetaPromise = assetProvider.json<{ textures?: Record<string, TreadTextureMeta> | null }>('/tread/textures.json').catch(() => ({}));
    }
    return treadMetaPromise;
  }

  function beltWidthOf(v: RuntimeVehicle) {
    const sp = v.suspParts && v.suspParts.sides;
    if (!sp) return 0;
    let sum = 0, n = 0;
    for (const key of ['L', 'R'] as const) {
      const s = sp[key];
      if (s && s.beltW > 1e-3) { sum += s.beltW; n++; }
    }
    return n ? sum / n : 0;
  }

  function resolvedTreadWidth(v: RuntimeVehicle) {
    const beltW = beltWidthOf(v);
    return beltW > 1e-3 ? beltW : TREAD_FALLBACK.width;
  }

  function ensureTreadMesh(v: RuntimeVehicle, tp: TreadRuntimeParams) {
    const scene = deps.getScene();
    if (v.treadMesh || !scene) return;
    const SLOTS = TRAIL_SLOTS;
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(SLOTS * 4 * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos);
    const uvArr = new Float32Array(SLOTS * 4 * 2);
    for (let s = 0; s < SLOTS; s++) uvArr.set([0, 0, 1, 0, 1, 1, 0, 1], s * 8);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    const col = new THREE.BufferAttribute(new Float32Array(SLOTS * 4 * 4), 4);
    col.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', col);
    const idx = new Uint32Array(SLOTS * 6);
    for (let s = 0; s < SLOTS; s++) {
      const b = s * 4, o = s * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, vertexColors: true,
                                              side: THREE.DoubleSide });
    let tex = treadTexCache.get(tp.texture);
    if (!tex) {
      tex = new THREE.TextureLoader().load(assetProvider.url(tp.texture));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = deps.quality().anisotropy;
      treadTexCache.set(tp.texture, tex);
    }
    mat.map = tex;
    mat.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    mesh.visible = deps.store.treadOn;
    scene.add(mesh);
    v.treadMesh = mesh;
  }

  function trailHalfGauge(v: RuntimeVehicle, side: 'L' | 'R') {
    const s = v.suspParts && v.suspParts.sides[side];
    return s && s.halfW > 1e-3 ? s.halfW : TREAD_HALF_GAUGE;
  }

  const tmpV = new THREE.Vector3();

  /**
   * 采样 [t0,T] 的两侧接地点序列并推进路径态（coverage 空洞断链；阵亡后静止不再出段）。
   *
   * **固定网格喂样**（review P2 2026-10-11）：只喂**完整 0.1 s 网格片**（片界按 [START] 对齐），
   * 且首点固定为 t0 时刻的横截面——片内交会点的插值只依赖片界样本 ⇒ seek 重算与逐帧连续
   * 播放**逐值一致**。旧实现从任意帧的 builtT 重切网格、首锚取第一次子步的 tt：首锚随帧
   * 时刻漂移（实测同一直线同终点：一次 seek 首锚 z=0.5/t=0.3，60fps 泵 z=0.083/t=0.217，
   * 转弯处几何还有差异）。不足整片的尾巴**留待下次**：返回值为最后已喂的网格时刻（不是 T），
   * 调用方以此作 builtT——尾巴在网格片完成前不上屏，语义与"逐帧推进"等价。
   *
   * @returns {number} 已喂到的回放时刻（网格对齐；无完整片可喂时 = t0）
   */
  function feedTrail(v: RuntimeVehicle, tr: { L: TrailState; R: TrailState; builtT: number }, t0: number) {
    const tread = v.tread!;
    const space = tread.space;
    const hwL = trailHalfGauge(v, 'L'), hwR = trailHalfGauge(v, 'R');
    const def = v.def;
    const pendL: Array<{ x: number; z: number; t: number; yaw: number }> = [];
    const pendR: Array<{ x: number; z: number; t: number; yaw: number }> = [];
    let broken = false;
    const flush = () => {
      if (pendL.length) advanceTrail(tr.L, pendL, space, TRAIL_CAP_PER_SIDE);
      if (pendR.length) advanceTrail(tr.R, pendR, space, TRAIL_CAP_PER_SIDE);
      pendL.length = 0; pendR.length = 0;
    };
    const pushPoint = (tt: number) => {
      if (defLifeAt(def, tt)?.lifeState === 'DESTROYED') {
        if (!broken) {
          flush();
          resetTrailState(tr.L);
          resetTrailState(tr.R);
          broken = true;
        }
        return;
      }
      if (!deps.visibleAt(v, tt)) {
        if (!broken) {
          flush();
          resetTrailState(tr.L);
          resetTrailState(tr.R);
          broken = true;
        }
        return;
      }
      broken = false;
      deps.vehicles.posAt(v, tt, tmpV);
      const yaw = deps.vehicles.yawAt(v, tt);
      const fx = -Math.sin(yaw), fz = Math.cos(yaw);
      const rx = -fz, rz = fx;
      pendL.push({ x: tmpV.x - rx * hwL, z: tmpV.z - rz * hwL, t: tt, yaw });
      pendR.push({ x: tmpV.x + rx * hwR, z: tmpV.z + rz * hwR, t: tt, yaw });
    };
    pushPoint(t0);
    const START = deps.getStart();
    const k0 = Math.round((t0 - START) / GRID_DT);
    const kEnd = Math.floor((deps.getT() - START) / GRID_DT + 1e-9);
    let fedTo = t0;
    for (let k = Math.max(0, k0); k < kEnd; k++) {
      const tA2 = START + k * GRID_DT, tB2 = START + (k + 1) * GRID_DT;
      const pa = deps.vehicles.posAt(v, tA2, tmpV); const ax = pa.x, az = pa.z;
      const pb = deps.vehicles.posAt(v, tB2, tmpV); const bx = pb.x, bz = pb.z;
      const segLen = Math.hypot(bx - ax, bz - az);
      if (segLen > 2.5) {
        flush();
        resetTrailState(tr.L);
        resetTrailState(tr.R);
        fedTo = tB2;
        continue;
      }
      const nSub = Math.min(6, Math.max(1, Math.ceil(segLen / 0.6)));
      for (let s = 1; s <= nSub; s++) pushPoint(tA2 + (GRID_DT * s) / nSub);
      fedTo = tB2;
    }
    flush();
    return fedTo;
  }

  function writeTrailQuads(v: RuntimeVehicle, tr: { L: TrailState; R: TrailState; builtT: number }) {
    const mesh = v.treadMesh!
    const geo = mesh.geometry;
    if (writeTreadBuffer(treadBufferInput(v, tr))) {
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  function treadBufferInput(v: RuntimeVehicle, tr: { L: TrailState; R: TrailState; builtT: number }): TreadBufferInput {
    const tread = v.tread!;
    return {
      geometry: v.treadMesh!.geometry,
      trail: tr,
      width: tread.width,
      texScale: tread.texScale,
      now: deps.getT(),
      heightAt: deps.heightFieldReady() ? deps.heightAt : () => 0,
      cap: TRAIL_CAP_PER_SIDE,
      slots: TRAIL_SLOTS,
    };
  }

  function ageTrailAlphas(v: RuntimeVehicle, tr: { L: TrailState; R: TrailState; builtT: number }) {
    if (ageTreadBuffer(treadBufferInput(v, tr))) {
      ((v.treadMesh!.geometry.getAttribute("color")) as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  function updateTrails() {
    if (!deps.getData()) return;
    const on = deps.store.treadOn && !!deps.quality().treadMarks;
    for (const v of deps.getVehicles()) {
      const tr = v.trail;
      if (!tr) continue;
      if (v.treadMesh) v.treadMesh.visible = on;
      if (!on) {
        if (tr.builtT !== -Infinity || tr.L.total || tr.R.total) {
          resetTrailState(tr.L); resetTrailState(tr.R);
          tr.builtT = -Infinity;
        }
        continue;
      }
      if (!v.tread || !v.treadMesh) continue;
      if (!v.tread.authoredWidth) {
        const w = resolvedTreadWidth(v);
        if (Math.abs(w - v.tread.width) > 1e-3) {
          v.tread.width = w;
          resetTrailState(tr.L); resetTrailState(tr.R);
          tr.builtT = -Infinity;
        }
      }
      if (deps.getT() < tr.builtT) {
        resetTrailState(tr.L); resetTrailState(tr.R);
        tr.builtT = -Infinity;
      }
      const t0 = Math.max(tr.builtT, deps.getStart());
      tr.builtT = feedTrail(v, tr, t0);
      writeTrailQuads(v, tr);
      ageTrailAlphas(v, tr);
    }
  }

  function attachVehicle(v: RuntimeVehicle) {
    if (!deps.quality().treadMarks) return;
    const def = v.def;
    Promise.all([treadParamsFor(def.tank_id), treadMetaFor()]).then(([tp, meta]) => {
      if (deps.destroyed() || !v.trail) return;
      v.tread = {
        ...tp,
        authoredWidth: tp.width != null,
        width: tp.width != null ? tp.width : resolvedTreadWidth(v),
        texScale: treadScaleFor(meta, tp.texture),
      };
      ensureTreadMesh(v, v.tread);
      deps.invalidate();
    }).catch((e: unknown) => {
      console.warn('[playback] 履带印装配失败（该车无印记）tank=' + def.tank_id + ':', e);
    });
  }

  function dispose() {
    const scene = deps.getScene();
    for (const v of deps.getVehicles()) {
      if (v.treadMesh) {
        scene?.remove(v.treadMesh);
        v.treadMesh.geometry.dispose();
        const mat = v.treadMesh.material as THREE.Material
        mat.dispose();
        v.treadMesh = null;
      }
      v.tread = null;
      v.trail = null;
    }
    treadParamCache.clear();
    for (const tex of treadTexCache.values()) tex.dispose();
    treadTexCache.clear();
  }

  return {
    attachVehicle,
    updateTrails,
    dispose,
  };
}
