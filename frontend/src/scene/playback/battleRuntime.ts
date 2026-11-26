import * as THREE from 'three'
import type { PerspectiveCamera, Scene } from 'three'
import { pathPointsOf, legSecsOf, legEndTimes, pointAtInto, legArcEnds, arcAtTime, pointAtArcInto } from '../shotPath.js'
import type { Vec3Tuple } from '../shotPath.js'
import { impactKind } from '../impactKind.js'
import { TRACER_STREAK_M, createBattleFx, muzzleTipOf, trailOpacityAt } from '../battleFx.js'
import { FLASH_MS, FLOAT_DMG_MS, GHOST_MS } from '../../utils/battlePlayback.js'
import { tracerSpanSecs } from './pure.js'
import { createGunfireAudio } from './gunfireAudio.js'
import { createTransientFeedback3d } from './transientFeedback3d.js'
import type { TransientFeedback3d, TransientLabelOverlay, TransientVehicle } from './transientFeedback3d.js'
import type { RuntimeVehicle } from './vehicleRuntime.js'
import type { DestroyedLifeEvidence } from '../tankDestroyedVisual.js'
import type { AgentPlaybackShot } from '../../api/agent-replay-facets.js'

export interface BattleRuntimeData {
  shots: AgentPlaybackShot[]
  vehicles: Array<{ eid: number; team: number }>
  meta: { friendly_team: number }
  [key: string]: unknown
}

export interface BattleRuntimeDeps {
  getData(): BattleRuntimeData | null
  getT(): number
  getScene(): Scene | null
  getCamera(): PerspectiveCamera
  getViewportHeight(): number
  debug: boolean
  getVehicles(): Array<RuntimeVehicle & { def: { max_hp: number } }>
  vehicles: {
    poseGlbRig(v: RuntimeVehicle, t: number, pos: THREE.Vector3): void
    posAt(v: RuntimeVehicle, t: number, out: THREE.Vector3): THREE.Vector3
    vehicleByEid(eid: number): RuntimeVehicle | undefined
  }
  sceneLifeAt(v: RuntimeVehicle, t: number): DestroyedLifeEvidence | null
  colorUnknown: number
  tracerFriendly: number
  tracerEnemy: number
  invalidate(): void
  deathTimesOf(v: TransientVehicle): number[]
  qualityFx(): Parameters<typeof createBattleFx>[0]
  getLabelOverlay(): TransientLabelOverlay | null
  invalidateLabels(): void
}

export interface BattleRuntimeHandle {
  advanceShotsTo(t: number): void
  resetShotPtr(): void
  resetShotsTo(index: number): void
  flushMuzzles(): void
  updateTracers(): void
  updateBattleFx(): void
  advanceWreckClock(dt: number): void
  isActive(): boolean
  clearEffects(): void
  ensureBattleFx(): ReturnType<typeof createBattleFx>
  transients: TransientFeedback3d
  fxScale(): number
  fxRoot(): THREE.Object3D | null
  tracerCount(): number
  trajLineCount(): number
  fxStats(): { impacts: number; bursts: number } | null
  prepareGunfire(defs: readonly { tank_id?: number | null, gun_local?: unknown, config_idx?: unknown }[]): void
  /** 炮声逐帧距离增益（renderLoop 在渲染前调用；相机移动后按炮口世界距离更新）。 */
  updateGunfire(): void
  /** 会话 teardown：clearEffects + battleFx.dispose + battleFx=null + window.__battleFx 删除
   *（含炮声在响声源停止）。 */
  dispose(): void
}

export function teamTracerColor(
  t: number | null | undefined,
  ft: number | null | undefined,
  colors: { unknown: number; friendly: number; enemy: number },
): number {
  if ((t !== 1 && t !== 2) || (ft !== 1 && ft !== 2)) return colors.unknown;
  return t === ft ? colors.friendly : colors.enemy;
}
export function createBattleRuntime(deps: BattleRuntimeDeps): BattleRuntimeHandle {
  const tracerColors = { unknown: deps.colorUnknown, friendly: deps.tracerFriendly, enemy: deps.tracerEnemy };
  const gunfire = createGunfireAudio({
    getCamera: deps.getCamera,
    getVehicleDef: (shot) => deps.vehicles.vehicleByEid(shot.shooter_eid)?.def ?? null,
  });
  const tracers: TracerRuntime[] = [];
  const pendingMuzzles: PendingMuzzle[] = [];
  const FX_SCALE = 2;
  let battleFx: ReturnType<typeof createBattleFx> | null = null;
  function ensureBattleFx() {
    if (!battleFx) {
      battleFx = createBattleFx(deps.qualityFx());
      deps.getScene()?.add(battleFx.root);
      if (deps.debug) debugWindow.__battleFx = battleFx;
    }
    return battleFx;
  }
  let wreckClock = 0;
  const trajLines: TrajLine[] = [];

  interface TracerRuntime {
    mesh: ReturnType<ReturnType<typeof createBattleFx>['takeRibbon']>;
    points: Vec3Tuple[];
    legEnds: number[];
    arcEnds: number[];
    t0: number; t1: number;
    shot: AgentPlaybackShot; color: number; seed: number;
    impactPos: THREE.Vector3; dir: THREE.Vector3; out: THREE.Vector3 | null;
    head: THREE.Vector3; hit: boolean; s0: number; inBarrel: boolean;
  }
  interface TrajLine {
    mesh: ReturnType<ReturnType<typeof createBattleFx>['takeRibbon']>;
    a: THREE.Vector3; b: THREE.Vector3; len: number;
    start: number; end: number; t1: number; color: number; s0: number;
  }
  interface PendingMuzzle {
    eid: number; tFire: number;
    from: THREE.Vector3; dir: THREE.Vector3; seed: number;
    tracer: TracerRuntime; firstTrail: TrajLine | null;
  }

  function spawnShot(s: AgentPlaybackShot, seed: number) {
    const color = shotTeamColor(s);
    const fx = ensureBattleFx();
    const pts3: Vec3Tuple[] = pathPointsOf(s).map(([x, y, z]) => [-x, y, z]);
    const legSecs = legSecsOf(s, tracerSpanSecs(s.flight_secs));
    const legEnds = legEndTimes(legSecs, s.t_fire);
    const t1 = legEnds[legEnds.length - 1];
    const from = new THREE.Vector3().fromArray(pts3[0]);
    const impactPos = new THREE.Vector3().fromArray(pts3[1]);
    const dir = impactPos.clone().sub(from);
    if (dir.lengthSq() > 1e-8) dir.normalize(); else dir.set(0, 0, 1);
    const out = pts3.length > 2 ? new THREE.Vector3().fromArray(pts3[2]).sub(impactPos) : null;
    const tracer: TracerRuntime = { mesh: fx.takeRibbon('tracer'), points: pts3, legEnds, arcEnds: legArcEnds(pts3),
      t0: s.t_fire, t1, shot: s, color, seed, impactPos, dir, out, head: from.clone(), hit: false,
      s0: 0, inBarrel: false };
    tracers.push(tracer);
    gunfire.onShot(s, from);
    let firstTrail: TrajLine | null = null;
    for (let k = 0; k + 1 < pts3.length; k++) {
      const a = new THREE.Vector3().fromArray(pts3[k]);
      const b = new THREE.Vector3().fromArray(pts3[k + 1]);
      const len = a.distanceTo(b);
      if (!(len > 1e-3)) continue;
      const mesh = fx.takeRibbon('trail');
      mesh.visible = false;
      const tl: TrajLine = { mesh, a, b, len, start: k === 0 ? s.t_fire : legEnds[k - 1], end: legEnds[k], t1, color, s0: 0 };
      trajLines.push(tl);
      if (k === 0) firstTrail = tl;
    }
    pendingMuzzles.push({ eid: s.shooter_eid, tFire: s.t_fire, from, dir, seed, tracer, firstTrail });
  }
  const _muzzleTip = new THREE.Vector3(), _firePos = new THREE.Vector3();
  function flushMuzzles() {
    for (const m of pendingMuzzles) {
      const v = deps.getVehicles().find((x) => x.def.eid === m.eid);
      const parts = v && v.group.visible && v.glb && v.glb.visible ? v.glbParts : null;
      if (v && parts) {
        deps.vehicles.poseGlbRig(v, m.tFire, deps.vehicles.posAt(v, m.tFire, _firePos));
        v.glb!.updateMatrixWorld(true);
      }
      const at = muzzleTipOf(parts ? parts.gunNodes : null, m.from, m.dir, _muzzleTip);
      if (v && parts) {
        deps.vehicles.poseGlbRig(v, deps.getT(), v.group.position);
        v.glb!.updateMatrixWorld(true);
      }
      const s0 = Math.min(at.distanceTo(m.from), m.tracer.arcEnds[0] || 0);
      m.tracer.s0 = s0;
      if (m.firstTrail) m.firstTrail.s0 = s0;
      battleFx!.spawnMuzzle(at, m.dir, performance.now(), m.seed);
    }
    pendingMuzzles.length = 0;
  }
  function shotTeamColor(s: AgentPlaybackShot) {
    const data = deps.getData();
    if (!data) return tracerColors.unknown;
    const d = data.vehicles.find((x) => x.eid === s.shooter_eid);
    return teamTracerColor(d ? d.team : 0, data.meta.friendly_team, tracerColors);
  }
  function spawnImpact(tr: TracerRuntime) {
    const kind = impactKind(tr.shot);
    if (!kind) return;
    battleFx!.spawnImpact(kind, tr.impactPos, tr.dir, tr.out, performance.now(), tr.seed);
  }

  const _tpA = new THREE.Vector3(), _tpB = new THREE.Vector3();
  function updateTracers() {
    const T = deps.getT();
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i];
      if (T < tr.t0) continue;
      pointAtInto(tr.points, tr.legEnds, T, tr.t0, _tpA);
      const sHead = arcAtTime(tr.points, tr.legEnds, tr.arcEnds, T, tr.t0);
      tr.inBarrel = sHead <= tr.s0;
      tr.mesh.visible = !tr.inBarrel;
      pointAtArcInto(tr.points, tr.arcEnds, Math.max(sHead - TRACER_STREAK_M, tr.s0), _tpB);
      battleFx!.setTracer(tr.mesh, _tpB, _tpA, tr.color);
      tr.head.copy(_tpA);
      if (!tr.hit && T >= tr.legEnds[0]) { tr.hit = true; spawnImpact(tr); }
      if (T >= tr.t1) {
        battleFx!.giveRibbon(tr.mesh);
        tracers.splice(i, 1);
      }
    }
    for (let i = trajLines.length - 1; i >= 0; i--) {
      const tl = trajLines[i];
      const opacity = trailOpacityAt(T - tl.t1);
      if (opacity <= 0) {
        battleFx!.giveRibbon(tl.mesh);
        trajLines.splice(i, 1); continue;
      }
      const f = tl.end > tl.start ? Math.min(1, (T - tl.start) / (tl.end - tl.start)) : 1;
      const f0 = Math.min(1, tl.s0 / tl.len);
      tl.mesh.visible = T >= tl.start && f > f0;
      if (!tl.mesh.visible) continue;
      battleFx!.setTrail(tl.mesh, _tpA.copy(tl.a).lerp(tl.b, f0), _tpB.copy(tl.a).lerp(tl.b, f), tl.color, opacity);
    }
  }

  function updateBattleFx() {
    if (!battleFx) return;
    battleFx.frame(performance.now(), deps.getCamera(), deps.getViewportHeight(), emitReplayFx);
  }
  interface ReplayFxEmitter {
    headGlow(pos: THREE.Vector3, hex: number): void
    wreck(x: number, y: number, z: number, yaw: number, since: number, phase: number, seed: number): void
  }
  function emitReplayFx(emit: ReplayFxEmitter) {
    const T = deps.getT();
    for (const tr of tracers) if (T >= tr.t0 && !tr.inBarrel) emit.headGlow(tr.head, tr.color);
    if (!battleFx!.budget.wreckSmoke) return;
    for (const v of deps.getVehicles()) {
      if (!v.group.visible) continue;
      const life = deps.sceneLifeAt(v, T);
      if (life?.lifeState !== 'DESTROYED') continue;
      const knownAt = life.destroyedKnownAtSec;
      const since = Number.isFinite(knownAt) ? T - knownAt! : Infinity;
      const p = v.group.position;
      emit.wreck(p.x, p.y, p.z, v.group.rotation.y, since, wreckClock, v.def.eid);
    }
  }

  function spawnBurst(eid: number) {
    const v = deps.vehicles.vehicleByEid(eid);
    if (!v || !v.group.visible) return;
    ensureBattleFx().spawnBurst(v.group.position, performance.now(), eid);
  }

  const transients = createTransientFeedback3d({
    getData: () => deps.getData(),
    getVehicles: () => deps.getVehicles(),
    deathTimesOf: (v) => deps.deathTimesOf(v),
    getLabelOverlay: () => deps.getLabelOverlay(),
    getBattleFx: () => battleFx,
    invalidateLabels: () => deps.invalidateLabels(),
    invalidate: () => deps.invalidate(),
    scale: FX_SCALE,
    floatDmgMs: FLOAT_DMG_MS,
    ghostMs: GHOST_MS,
    flashMs: FLASH_MS,
    onBurst: (eid) => spawnBurst(eid),
  });

  function clearEffects() {
    for (const tr of tracers) battleFx!.giveRibbon(tr.mesh);
    tracers.length = 0;
    for (const tl of trajLines) battleFx!.giveRibbon(tl.mesh);
    trajLines.length = 0;
    pendingMuzzles.length = 0;
    transients.clear();
  }

  function dispose() {
    clearEffects();
    battleFx?.dispose();
    battleFx = null;
    gunfire.dispose();
    if (deps.debug) delete debugWindow.__battleFx;
  }

  let shotPtr = 0;

  return {
    advanceShotsTo(t: number) {
      const shots = deps.getData()?.shots;
      if (!shots) return;
      while (shotPtr < shots.length && shots[shotPtr].t_fire <= t) { spawnShot(shots[shotPtr], shotPtr); shotPtr++; }
    },
    resetShotPtr() { shotPtr = 0; },
    resetShotsTo(index: number) { shotPtr = index; gunfire.invalidatePending(); },
    flushMuzzles,
    updateTracers,
    updateBattleFx,
    advanceWreckClock(dt: number) { wreckClock += dt; },
    isActive() { return tracers.length > 0 || (battleFx && battleFx.active()) || transients.hasActive(); },
    clearEffects,
    ensureBattleFx,
    transients,
    fxScale: () => FX_SCALE,
    fxRoot: () => battleFx?.root ?? null,
    tracerCount: () => tracers.length,
    trajLineCount: () => trajLines.length,
    fxStats() { return battleFx ? battleFx.stats() : null; },
    prepareGunfire: (defs) => gunfire.prepare(defs),
    updateGunfire: () => gunfire.update(),
    dispose,
  };
}

const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & { __battleFx?: unknown };
