// 战斗表现运行时 owner（#820 结构拆分，2026-11-06 自 initPlayback 闭包出仓）：
// 炮线（spawnShot / advanceShotsTo / flushMuzzles / updateTracers）、弹着与击毁特效
//（spawnImpact / spawnBurst）、战斗特效批次（ensureBattleFx / updateBattleFx /
// emitReplayFx / wreckClock）、动态层清除（clearEffects）与战斗反馈 transient
//（createTransientFeedback3d 装配）的唯一归属。
// 代码与搬移前逐字一致；闭包读数改经 deps 注入（getter 快照）。会话 teardown
//（battleFx.dispose + window.__battleFx 删除 + tracers/traj/pendingMuzzles 清空 +
// transients.clear）由本模块 dispose() 一次性完成；宿主 seekTo 经 clearEffects() +
// resetShotsTo(index) 保持原游标语义（no replay of past feedback）。
import * as THREE from 'three'
import type { PerspectiveCamera, Scene } from 'three'
import { pathPointsOf, legSecsOf, legEndTimes, pointAtInto, legArcEnds, arcAtTime, pointAtArcInto } from '../shotPath.js'
import type { Vec3Tuple } from '../shotPath.js'
import { impactKind } from '../impactKind.js'
import { TRACER_STREAK_M, createBattleFx, muzzleTipOf, trailOpacityAt } from '../battleFx.js'
// 战斗反馈时长：与 2D 共用同一组 canonical 常量（SSOT，避免两处各自漂移）
import { FLASH_MS, FLOAT_DMG_MS, GHOST_MS } from '../../utils/battlePlayback.js'
import { tracerSpanSecs } from './pure.js'
import { createTransientFeedback3d } from './transientFeedback3d.js'
import type { TransientFeedback3d, TransientLabelOverlay, TransientVehicle } from './transientFeedback3d.js'
import type { RuntimeVehicle } from './vehicleRuntime.js'
import type { DestroyedLifeEvidence } from '../tankDestroyedVisual.js'
import type { AgentPlaybackShot } from '../../api/agent-replay-facets.js'

/** 本模块消费的回放数据面（DATA 中战斗表现读取的字段；其余由场景内核持有）。 */
export interface BattleRuntimeData {
  shots: AgentPlaybackShot[]
  vehicles: Array<{ eid: number; team: number }>
  meta: { friendly_team: number }
  [key: string]: unknown
}

/** 宿主注入的依赖（getter 快照；语义见各字段处原文注释）。 */
export interface BattleRuntimeDeps {
  /** 当前会话回放数据（宿主唯一 owner；shots 推进与炮线取色读它）。 */
  getData(): BattleRuntimeData | null
  /** 回放时钟（宿主唯一 owner；曳光推进 / 弹道光迹 / 残骸烟全部按它）。 */
  getT(): number
  getScene(): Scene | null
  getCamera(): PerspectiveCamera
  /** 舞台高度（updateBattleFx 的 battleFx.frame 入参；原 container.clientHeight）。 */
  getViewportHeight(): number
  /** ?debug 诊断（window.__battleFx 挂钩）。 */
  debug: boolean
  /** 车辆清单（owner = vehicleRuntime；炮口定位/残骸烟经它消费）。 */
  getVehicles(): Array<RuntimeVehicle & { def: { max_hp: number } }>
  /** 车辆运行时句柄（炮口摆位姿 / posAt / vehicleByEid）。 */
  vehicles: {
    poseGlbRig(v: RuntimeVehicle, t: number, pos: THREE.Vector3): void
    posAt(v: RuntimeVehicle, t: number, out: THREE.Vector3): THREE.Vector3
    vehicleByEid(eid: number): RuntimeVehicle | undefined
  }
  /** 场景死亡判据（canonical 事实 owner = 宿主 sceneLifeAt；残骸烟消费）。 */
  sceneLifeAt(v: RuntimeVehicle, t: number): DestroyedLifeEvidence | null
  /** 阵营色（HOST-owned 唯一事实源；炮线亮色板 + 中立白）。 */
  colorUnknown: number
  tracerFriendly: number
  tracerEnemy: number
  invalidate(): void
  /** 车辆每次死亡的场景时刻（canonical 生命链 owner = 宿主；入参面 = TransientVehicle）。 */
  deathTimesOf(v: TransientVehicle): number[]
  /** 战斗特效画质预算（宿主持有 QUALITY_PRESETS[QKEY].fx）。 */
  qualityFx(): Parameters<typeof createBattleFx>[0]
  /** 标签覆盖层（transients 的伤害数字/幽灵段消费；宿主可选注入）。 */
  getLabelOverlay(): TransientLabelOverlay | null
  /** 标签快照失效（owner = labelsRuntime 的 labelsTime）。 */
  invalidateLabels(): void
}

/** 战斗表现运行时对外句柄（宿主的唯一消费面）。 */
export interface BattleRuntimeHandle {
  /** tick 的弹道推进循环（原 while (shotPtr < shots.length && t_fire <= T) 块）。 */
  advanceShotsTo(t: number): void
  /** 会话游标复位（startPlayback；原 shotPtr = 0）。 */
  resetShotPtr(): void
  /** seekTo：游标重定到「T 之后第一条」（索引由宿主 firstIndexAfter 计算）。 */
  resetShotsTo(index: number): void
  /** 炮口特效定位（applyPose 之后调用；原 flushMuzzles）。 */
  flushMuzzles(): void
  /** 曳光 / 弹道光迹推进（原 updateTracers）。 */
  updateTracers(): void
  /** 战斗特效逐帧写入（render 前；原 updateBattleFx）。 */
  updateBattleFx(): void
  /** 残骸烟翻滚相位推进（animate；原 wreckClock += dt）。 */
  advanceWreckClock(dt: number): void
  /** 按需渲染的 busy 判定段（原 tracers.length>0 || battleFx.active() || transients.hasActive()）。 */
  isActive(): boolean
  /** 动态层（弹道/弹着点/轨迹线）清除：seekTo 与会话 teardown 共用（原 clearEffects）。 */
  clearEffects(): void
  /** 着色器预热（prewarmShaders）与 prewarm 消费（原 ensureBattleFx）。 */
  ensureBattleFx(): ReturnType<typeof createBattleFx>
  /** 战斗反馈 transient（状态/游标在 playback/transientFeedback3d.ts；宿主经它调度）。 */
  transients: TransientFeedback3d
  /** 3D 反馈显示时长倍率（labelsRuntime 的 GHOST_MS 乘数）。 */
  fxScale(): number
  /** perf 帧统计读取面（原 tracers.length / trajLines.length / battleFx.stats()）。 */
  tracerCount(): number
  trajLineCount(): number
  fxStats(): { impacts: number; bursts: number } | null
  /** 会话 teardown：clearEffects + battleFx.dispose + battleFx=null + window.__battleFx 删除。 */
  dispose(): void
}

export function createBattleRuntime(deps: BattleRuntimeDeps): BattleRuntimeHandle {
  const tracerColors = { unknown: deps.colorUnknown, friendly: deps.tracerFriendly, enemy: deps.tracerEnemy };
  const tracers: TracerRuntime[] = [];
  const pendingMuzzles: PendingMuzzle[] = [];   // 本 tick 开火、待炮管姿态摆完再定位的炮口特效（见 flushMuzzles）
  // 战斗反馈显示时长倍率（**只作用于 3D 场景**）：掉血飘字、HP 条幽灵/受击闪乘这个系数——
  // 回放里这些反馈需要更长的可读时间。乘在 transient 段的 2D SSOT 常量之上，因此 **2D 回放
  // 时序不受影响**；1 = 与 2D 逐值一致。爆炸 / 开火 / 命中 / 光迹的 3D 时长是 battleFx.js 的
  // 独立常量（2026-10-13 写实化），不再由 2D 常量推导。
  const FX_SCALE = 2;
  // 战斗特效（会话拥有，按当局画质档预算创建；teardownSession 释放）
  let battleFx: ReturnType<typeof createBattleFx> | null = null;
  function ensureBattleFx() {
    if (!battleFx) {
      battleFx = createBattleFx(deps.qualityFx());
      deps.getScene()?.add(battleFx.root);
      if (deps.debug) debugWindow.__battleFx = battleFx;   // 诊断钩子（仅 ?debug；会话结束 / destroy 时清除）
    }
    return battleFx;
  }
  // 残骸烟翻滚相位：只在播放时按壁钟累计（倍速不加快，暂停冻结 → 不需要额外重绘）
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
    // 炮线唯一颜色规则 = 射手阵营（绿/红/白）；命中/跳弹/击毁不改炮线颜色——
    // 结果由弹着点 impact 编码（原实现按结果上色，与上游 Agent 不一致）
    const color = shotTeamColor(s);
    const fx = ensureBattleFx();
    // 飞行段时长 = **真实飞行时长**（直射弹 = |终点−炮口|/弹速；跳弹/穿透弹 = 各折线段
    // 时长之和，见 shotPath.js）。此处曾设 0.22s 最小时长"保证可见性"——但实测 68% 的射击
    // 真飞行时长 <0.22s（J39 样本 155 发：中位 0.16s、p10 0.04s），那些炮弹被放慢最多 11×，
    // 与客户端不一致。现只保留 1 帧下限，防退化数据（flight_secs=0/负数）造成零时长除零。
    // 折线：from → via…（跳弹/出射点）→ to（**method20 服务器终点**＝弹道最终停止点，跳弹后
    // 落在出射方向延长线上）；各段按时长匀速推进。
    // 折线点表必须**先镜像 x**（游戏系 → 场景系，与 posAt 同规则）：facet 的 from/via/to
    // 是游戏系原始坐标；折线改造曾直接消费原始坐标——轨迹线/飞行段/弹着特效全部画到
    // 地图镜像侧（用户实测"炮线轨迹不见了"）。
    const pts3: Vec3Tuple[] = pathPointsOf(s).map(([x, y, z]) => [-x, y, z]);
    const legSecs = legSecsOf(s, tracerSpanSecs(s.flight_secs));
    const legEnds = legEndTimes(legSecs, s.t_fire);
    const t1 = legEnds[legEnds.length - 1];
    const from = new THREE.Vector3().fromArray(pts3[0]);
    // 弹着特效落点 = **抵达点**（有跳弹 = via[0]，即镜像后的 pts3[1]；直射 = 服务器终点），
    // 命中时刻 = 抵达点时刻 legEnds[0]（跳弹后弹头继续沿出射段飞，特效不等它飞完）
    const impactPos = new THREE.Vector3().fromArray(pts3[1]);
    const dir = impactPos.clone().sub(from);
    if (dir.lengthSq() > 1e-8) dir.normalize(); else dir.set(0, 0, 1);
    // 跳弹出射方向 = 折线下一段方向（缺省由 battleFx 按来弹方向上挑）
    const out = pts3.length > 2 ? new THREE.Vector3().fromArray(pts3[2]).sub(impactPos) : null;
    // s0 = 可见起点弧长：炮管里那一段（起点 → 炮口）不画曳光与光迹，由 flushMuzzles 填入
    const tracer: TracerRuntime = { mesh: fx.takeRibbon('tracer'), points: pts3, legEnds, arcEnds: legArcEnds(pts3),
      t0: s.t_fire, t1, shot: s, color, seed, impactPos, dir, out, head: from.clone(), hit: false,
      s0: 0, inBarrel: false };
    tracers.push(tracer);
    // 弹道光迹（逐段一条：折线在跳弹处拐弯）：段起点时刻起随弹头显现，弹头走完全程后
    // 停留再淡出（trailOpacityAt，回放时钟；暂停时一直留着，seek 清空）。
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
  // 炮口火光 / 炮口烟放在炮管末端：回放记录的开火起点是火炮枢轴（在炮塔 / 炮盾里），直接放会被
  // 车模挡住（2026-10-13 实机近景）。没有可见车模（代理车 / 兵种图标 / 不可见）时用记录起点。
  // 同一段距离也是曳光与第一段光迹的可见起点（s0）：炮管里那截不画，否则光迹会贴着炮管
  // 露出一条线；弹道折线与计时不变，最多截到抵达点（贴脸射击时整段都在炮管里）。
  // 炮管按**开火时刻** t_fire 的姿态量：处理这一 tick 时 T 已晚于 t_fire（掉帧 / 倍速），射手
  // 早已前移或转动，用 T 时刻的炮管会把这段位移混进固定弹道的起点，同一发炮弹的光迹起点随
  // 倍速 / 帧间隔变化（PR #613 审查：10 m/s 射手、100 ms 帧，1×/2×/4×/8× 起点 5/6/8/12 m，
  // 应为 4.5 m）。所以把射手一台临时摆到 t_fire（纯姿态，不碰悬挂积分），量完摆回 T。
  // 在 applyPose 之后调用：摆回用的是本 tick 的 T 时刻位置。
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
  // 阵营色（唯一规则：按射手阵营 → green / red / white）。炮线用**亮色板**
  //（TRACER_FRIENDLY/ENEMY，见宿主顶部注释）；未知阵营仍为白（unknown ≠ enemy）。
  function shotTeamColor(s: AgentPlaybackShot) {
    const data = deps.getData();
    if (!data) return tracerColors.unknown;
    const d = data.vehicles.find((x) => x.eid === s.shooter_eid);
    const t = d ? d.team : 0;
    const ft = data.meta.friendly_team;
    if ((t !== 1 && t !== 2) || (ft !== 1 && ft !== 2)) return tracerColors.unknown;
    return t === ft ? tracerColors.friendly : tracerColors.enemy;
  }
  // 命中类型 → 写实命中特效（全部 transient，无 decal/弹孔；外观见 battleFx.js）：
  //   pen（击穿）= 小火光 + 橙色余火 + 暗烟；nonpen = 亮白火花回溅 + 灰烟；
  //   ricochet = 火花顺出射方向划过 + 淡烟；miss（无 target）/未知结果 = 不生成（不伪造）。
  // impactKind 见 ../impactKind.js（纯函数，可单测）：game_hit_result 枚举里没有"跳弹"
  // 取值（1=未击穿、2=间隙止），只有作者 hit_flags & 0x0008 才是跳弹证据。
  // 寿命按真实壁钟计（UI feedback transient）：0.5x / 16x 下可读时长一致；暂停时自然播完；
  // seek 由 clearEffects 直接清空。
  function spawnImpact(tr: TracerRuntime) {
    const kind = impactKind(tr.shot);
    if (!kind) return;
    battleFx!.spawnImpact(kind, tr.impactPos, tr.dir, tr.out, performance.now(), tr.seed);
  }

  // 弹道推进 scratch（每帧多车并发，避免逐帧分配）
  const _tpA = new THREE.Vector3(), _tpB = new THREE.Vector3();
  function updateTracers() {
    const T = deps.getT();
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i];
      if (T < tr.t0) continue;
      // 沿折线推进：头部按时间落在当前段（段内匀速），尾部 = 头部**弧长位置**回退
      // TRACER_STREAK_M 米（跳弹拐角时尾巴跟着折线弯）。零分配：into 变体直写 scratch。
      pointAtInto(tr.points, tr.legEnds, T, tr.t0, _tpA);
      const sHead = arcAtTime(tr.points, tr.legEnds, tr.arcEnds, T, tr.t0);
      // 弹头还在炮管里（没过炮口 s0）：曳光与弹头光晕都不画；尾部不早于炮口
      tr.inBarrel = sHead <= tr.s0;
      tr.mesh.visible = !tr.inBarrel;
      pointAtArcInto(tr.points, tr.arcEnds, Math.max(sHead - TRACER_STREAK_M, tr.s0), _tpB);
      battleFx!.setTracer(tr.mesh, _tpB, _tpA, tr.color);
      tr.head.copy(_tpA);
      if (!tr.hit && T >= tr.legEnds[0]) { tr.hit = true; spawnImpact(tr); }
      // 完成判定 = **时间到终点**（折线改造曾误留旧变量 `f >= 1`——f 已不存在，
      // 每帧 ReferenceError 中断整个 tick：不渲染、位姿/HUD 全停，且该炮线永远走不到
      // 移除分支 → 持续抛到暂停为止。这就是此前"播放中卡死、暂停即止"的根因。）
      if (T >= tr.t1) {
        battleFx!.giveRibbon(tr.mesh);   // 归还条带池；真正的释放在会话结束（battleFx.dispose）
        tracers.splice(i, 1);
      }
    }
    // 弹道光迹：随弹头显现 → 停留 → 淡出 → 归还
    for (let i = trajLines.length - 1; i >= 0; i--) {
      const tl = trajLines[i];
      const opacity = trailOpacityAt(T - tl.t1);
      if (opacity <= 0) {
        battleFx!.giveRibbon(tl.mesh);
        trajLines.splice(i, 1); continue;
      }
      const f = tl.end > tl.start ? Math.min(1, (T - tl.start) / (tl.end - tl.start)) : 1;
      const f0 = Math.min(1, tl.s0 / tl.len);   // 炮管内那段不画（见 flushMuzzles）
      tl.mesh.visible = T >= tl.start && f > f0;
      if (!tl.mesh.visible) continue;
      battleFx!.setTrail(tl.mesh, _tpA.copy(tl.a).lerp(tl.b, f0), _tpB.copy(tl.a).lerp(tl.b, f), tl.color, opacity);
    }
  }

  // 战斗特效逐帧写入（render 前；按需渲染下只在真正重绘的帧执行）。回放时钟驱动的粒子：
  // 在飞炮弹的弹头光晕、残骸持续烟（存在与否看场景唯一死亡判据 sceneLifeAt，倒带到死亡前
  // 即消失；未知死亡时刻按已渐入处理）。
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

  // 击毁爆炸（外观见 battleFx.js：强闪光 + 地面光斑、湍流火球、黑烟柱、火星；高档加碎片与
  // 地面尘浪）。权威死亡触发一次（transient 事件源），壁钟寿命 BURST_SECS，seek 不补播。
  function spawnBurst(eid: number) {
    const v = deps.vehicles.vehicleByEid(eid);
    if (!v || !v.group.visible) return;
    ensureBattleFx().spawnBurst(v.group.position, performance.now(), eid);
  }

  // ---------- 战斗反馈 transient（状态/游标在 playback/transientFeedback3d.ts）----------
  // 壁钟寿命、血量链事件源、幽灵段/受击闪的语义注释随实现迁往该模块；本处只保留
  // 依赖场景的事实：canonical 生命链的 deathTimesOf、车模可见性/位置、battleFx 爆散。
  const transients = createTransientFeedback3d({
    getData: () => deps.getData(),
    getVehicles: () => deps.getVehicles(),
    deathTimesOf: (v) => deps.deathTimesOf(v),
    getLabelOverlay: () => deps.getLabelOverlay(),
    getBattleFx: () => battleFx,
    // 壁钟寿命到期 / 伤害事件到达都要重画标签（HP 幽灵段与闪光在覆盖层）
    invalidateLabels: () => deps.invalidateLabels(),
    invalidate: () => deps.invalidate(),
    scale: FX_SCALE,
    floatDmgMs: FLOAT_DMG_MS,
    ghostMs: GHOST_MS,
    flashMs: FLASH_MS,
    onBurst: (eid) => spawnBurst(eid),
  });

  // 动态层（弹道/弹着点/轨迹线）清除：与 seekTo 共用一条路径
  function clearEffects() {
    // 条带归还 battleFx 的池（对象留待复用），会话结束时由 battleFx.dispose 统一释放
    for (const tr of tracers) battleFx!.giveRibbon(tr.mesh);
    tracers.length = 0;
    for (const tl of trajLines) battleFx!.giveRibbon(tl.mesh);
    trajLines.length = 0;
    pendingMuzzles.length = 0;
    transients.clear();   // 战斗反馈（飘字/爆散/幽灵段/受击闪）：seek 后不补播
  }

  // 会话 teardown：原 teardownSession 的战斗表现段（clearEffects → battleFx.dispose →
  // battleFx=null → window.__battleFx 删除）整体收口，对象清单与顺序逐字保留。
  function dispose() {
    clearEffects();
    battleFx?.dispose();   // 战斗特效（粒子批次 / 条带 / 图集）随会话一次性释放
    battleFx = null;
    if (deps.debug) delete debugWindow.__battleFx;
  }

  /** 弹道推进游标（宿主唯一写入口：advanceShotsTo / resetShotPtr / resetShotsTo）。 */
  let shotPtr = 0;

  return {
    advanceShotsTo(t: number) {
      const shots = deps.getData()?.shots;
      if (!shots) return;
      while (shotPtr < shots.length && shots[shotPtr].t_fire <= t) { spawnShot(shots[shotPtr], shotPtr); shotPtr++; }
    },
    resetShotPtr() { shotPtr = 0; },
    resetShotsTo(index: number) { shotPtr = index; },
    flushMuzzles,
    updateTracers,
    updateBattleFx,
    advanceWreckClock(dt: number) { wreckClock += dt; },
    isActive() { return tracers.length > 0 || (battleFx && battleFx.active()) || transients.hasActive(); },
    clearEffects,
    ensureBattleFx,
    transients,
    fxScale: () => FX_SCALE,
    tracerCount: () => tracers.length,
    trajLineCount: () => trajLines.length,
    fxStats() { return battleFx ? battleFx.stats() : null; },
    dispose,
  };
}

// ?debug 诊断钩子（window.__battleFx；宿主 JS 域裸写口径同 mapWorld.ts）
const debugWindow = (typeof window !== 'undefined' ? window : {}) as Window & { __battleFx?: unknown };
