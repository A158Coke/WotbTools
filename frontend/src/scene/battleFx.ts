/**
 * 3D 回放战斗特效（只服务 3D 场景；2D 回放与 `utils/battlePlayback.ts` 的 2D 常量不受影响）。
 *
 * 职责：击毁爆炸、开火、命中、残骸持续烟、曳光弹头与弹道光迹的外观，画质档位预算，
 * 以及这些特效的 GPU 资源（唯一 owner）。`playbackScene.js` 只负责"何时发生"（事件泵、
 * seek 语义、生命判据），这里负责"长什么样"。
 *
 * 结构：
 * - 所有 billboard 粒子（火球、烟、尘、碎片、炮口焰、命中火光、火星头）每帧**立即模式**
 *   写进两个实例化批次：加色一批、普通混合一批（后者按视深从远到近排序），各一次 draw call；
 *   火星拖尾一个 `LineSegments`。容量按档位封顶，超出的粒子直接丢弃——交火再激烈、残骸
 *   再多，粒子的 GPU 成本也有上限。
 * - 每个粒子的状态都是「特效年龄 → 外观」的纯函数（确定性哈希取随机），不积累逐粒子状态：
 *   seek、暂停、重绘任何一帧都得到同一结果。
 * - 曳光弹头 / 弹道光迹是相机朝向的条带 shader，宽度取「世界宽度」与「屏幕像素下限」的较大者，
 *   拉远看全场也不会细到消失。条带对象由本模块池化，`playbackScene` 只借用与归还。
 *
 * 时钟：爆炸 / 开火 / 命中按**壁钟**（与旧 impact 同语义：任意倍速下可读时长一致，暂停时自然
 * 播完）；弹道光迹停留与残骸烟是否存在按**回放时钟**（由调用方传入），残骸烟的翻滚相位由调用方
 * 传入的"播放中壁钟累计秒"驱动（倍速不加快、暂停冻结，不强制重绘）。
 *
 * 自定义 shader 一律手挂 logdepthbuf 代码块（`?logdepth` 开启时深度与内建材质一致），
 * 且不做 tone mapping（特效颜色直出，不被逐图曝光压暗）。
 */
import * as THREE from 'three'
import type { Color, Mesh, Object3D, PerspectiveCamera, ShaderMaterial, Vector3 } from 'three'
import { atlasData, TILE, ATLAS_COLS, ATLAS_ROWS, createBatch, createSparkLines, RIBBON_VS, RIBBON_FS, noop } from './battleFxAtlas.js'
import { createBattleFxEmitters } from './battleFxEmitters.js'
import { BURST_SECS, MUZZLE_FLASH_SECS, MUZZLE_SMOKE_SECS, IMPACT_FLASH_SECS, IMPACT_SMOKE_SECS, IMPACT_SPARK_SECS } from './battleFxEmitters.js'
import { GLOW_TILE } from './battleFxAtlas.js'
import { WHITE } from './battleFxEmitters.js'

/** 画质档位的特效预算（FX_BUDGETS 各档的同形状）。 */
export type FxBudget = (typeof FX_BUDGETS)[keyof typeof FX_BUDGETS]

/** battleFx 生命周期内的爆炸事件（壁钟驱动）。 */
export interface BurstEvent { x: number; y: number; z: number; seed: number; bornMs: number }
/** 开火事件（含炮口朝向与侧向单位向量）。 */
export interface MuzzleEvent extends BurstEvent { dx: number; dy: number; dz: number; sx: number; sz: number }
/** 命中事件（kind = impactKind() 的结果；跳弹时带出射方向）。 */
export interface ImpactEvent extends BurstEvent { kind: ImpactKind; dx: number; dy: number; dz: number; ox: number; oy: number; oz: number }
export type ImpactKind = 'pen' | 'nonpen' | 'ricochet'

/** 条带网格（tracer/trail 池化对象；material 恒为 ShaderMaterial）。 */
type RibbonMesh = Mesh<THREE.BufferGeometry, ShaderMaterial>

/**
 * 画质档位预算（键与 `QUALITY_PRESETS` 一一对应；`QUALITY_PRESETS[k].fx` 引用这里）。
 * 信息类元素（曳光、光迹、命中火光、爆炸闪光）四档都有；氛围元素按档裁剪。
 * capacity = 每个粒子批次（加色 / 普通混合各一）的实例上限。
 */
export const FX_BUDGETS = Object.freeze({
  low: Object.freeze({
    capacity: 256, muzzleBrake: false, muzzleSmoke: 0, impactSparks: 6, impactSmoke: 0,
    burstFire: 5, burstSmoke: 6, burstSparks: 16, burstDebris: 0, burstDust: 0, wreckSmoke: 0, wreckEmbers: false,
  }),
  mid: Object.freeze({
    capacity: 512, muzzleBrake: true, muzzleSmoke: 0, impactSparks: 10, impactSmoke: 2,
    burstFire: 8, burstSmoke: 10, burstSparks: 32, burstDebris: 0, burstDust: 10, wreckSmoke: 0, wreckEmbers: false,
  }),
  high: Object.freeze({
    capacity: 1024, muzzleBrake: true, muzzleSmoke: 3, impactSparks: 16, impactSmoke: 4,
    burstFire: 11, burstSmoke: 16, burstSparks: 56, burstDebris: 12, burstDust: 16, wreckSmoke: 10, wreckEmbers: false,
  }),
  ultra: Object.freeze({
    capacity: 1536, muzzleBrake: true, muzzleSmoke: 6, impactSparks: 16, impactSmoke: 6,
    burstFire: 14, burstSmoke: 20, burstSparks: 80, burstDebris: 16, burstDust: 20, wreckSmoke: 14, wreckEmbers: true,
  }),
})

/** 击毁爆炸壁钟寿命（秒）。3D 专用，不再由 2D 的 `BURST_MS` 推导。（owner = battleFxEmitters，本文件 import 后同名导出） */
export { BURST_SECS }
/** 弹道光迹：弹头走完全程后停留 / 淡出（回放秒）。 */
export const TRAIL_HOLD_SECS = 2.5
export const TRAIL_FADE_SECS = 1.5
/** 曳光弹头尾迹长度（米）。 */
export const TRACER_STREAK_M = 14

// MUZZLE_*/IMPACT_* 寿命常量 owner = battleFxEmitters.ts（本文件 import）。
/**
 * 命中特效最小屏幕尺寸。应用相机最近也在视点 max(20 m, 地图尺寸×0.08) 之外，2 m 的命中火光
 * 只有十几像素，余火与烟几乎看不见（2026-10-13 实机近景）。参考尺寸 IMPACT_REF_M 至少占
 * IMPACT_MIN_PX 像素：镜头拉远时整套命中特效（火光、余火、烟、火星的大小与散布）等比放大，
 * 最多 IMPACT_MAX_ZOOM 倍；离得近时保持世界尺寸。
 */

/** 弹道光迹不透明度系数：`secsAfterFlight` = 回放时刻 − 弹头到达终点时刻（飞行中为负）。 */
export function trailOpacityAt(secsAfterFlight: number): number {
  if (!(secsAfterFlight > TRAIL_HOLD_SECS)) return 1
  return Math.max(0, 1 - (secsAfterFlight - TRAIL_HOLD_SECS) / TRAIL_FADE_SECS)
}

/** 炮管末端到开火起点的合理距离（米）：超出说明炮管姿态与弹道对不上，回落到记录起点。 */
const MUZZLE_REACH_M = [0.3, 15]
const _corner = new THREE.Vector3()
/**
 * 炮口位置。回放记录的开火起点在火炮枢轴（炮塔 / 炮盾里），火光与炮口烟放在那里会被车模挡住
 * （2026-10-13 实机近景）。取炮管节点下各网格包围盒 8 个角点（世界系；调用方保证 matrixWorld
 * 已是开火时刻的姿态）沿弹道方向的最远投影，把起点沿弹道推到炮管末端；没有网格或投影超出
 * 合理范围时返回起点。
 * @param {THREE.Object3D[]|null} barrelNodes 炮管节点（GLB `gun_NN` / `gun_NN_mask`）
 * @param {THREE.Vector3} from 开火起点
 * @param {THREE.Vector3} dir 弹道方向（单位向量）
 */
export function muzzleTipOf(barrelNodes: readonly Object3D[] | null | undefined, from: Vector3, dir: Vector3, out: Vector3 = new THREE.Vector3()): Vector3 {
  let reach = -Infinity
  for (const node of barrelNodes || []) {
    node.traverse((n) => {
      const o = n as Mesh
      if (!o.isMesh || !o.geometry) return
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
      const { min, max } = o.geometry.boundingBox as THREE.Box3
      for (let i = 0; i < 8; i++) {
        _corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(o.matrixWorld)
        reach = Math.max(reach, _corner.sub(from).dot(dir))
      }
    })
  }
  out.copy(from)
  if (reach >= MUZZLE_REACH_M[0] && reach <= MUZZLE_REACH_M[1]) out.addScaledVector(dir, reach)
  return out
}


/**
 * 创建一个会话的战斗特效实例。`root` 由调用方加进场景；`dispose()` 释放全部 GPU 资源。
 * @param {typeof FX_BUDGETS.low} budget
 */
export function createBattleFx(budget: FxBudget) {
  const root = new THREE.Group()
  root.name = 'battle-fx'
  const atlas = new THREE.DataTexture(atlasData(), TILE * ATLAS_COLS, TILE * ATLAS_ROWS)
  atlas.generateMipmaps = true
  atlas.minFilter = THREE.LinearMipmapLinearFilter
  atlas.magFilter = THREE.LinearFilter
  atlas.needsUpdate = true
  const glow = createBatch(budget.capacity, atlas, { additive: true, sorted: false, name: 'battle-fx-glow' })
  const smoke = createBatch(budget.capacity, atlas, { additive: false, sorted: true, name: 'battle-fx-smoke' })
  const sparks = createSparkLines(Math.ceil(budget.capacity / 2))
  // 特效不写深度：排在场景其他透明物（水面、贴花等）之后画，组内按 光迹 → 烟 → 曳光 → 火光 叠放
  smoke.mesh.renderOrder = 10
  glow.mesh.renderOrder = sparks.lines.renderOrder = 12
  root.add(smoke.mesh, glow.mesh, sparks.lines)

  const pxScale: { value: number } = { value: 0.001 }
  const camPos = new THREE.Vector3()
  // 发射器（spark/emitBurst/emitMuzzle/emitImpact/emitWreck）自 2026-11-21 起出仓
  // battleFxEmitters.ts（#LOC 结构拆分）：闭包读数改经 deps 注入，外观逐字一致。
  const { emitBurst, emitMuzzle, emitImpact, emitWreck } = createBattleFxEmitters({ budget, glow, smoke, sparks, pxScale, camPos })
  const ribbonGeometry = new THREE.PlaneGeometry(1, 1, 1, 1)
  const ribbonPool: { tracer: RibbonMesh[]; trail: RibbonMesh[] } = { tracer: [], trail: [] }
  const ribbonsOut = new Set<RibbonMesh>()
  const teamColors = new Map<number, { team: Color; head: Color; glow: Color }>()
  const bursts: BurstEvent[] = [], muzzles: MuzzleEvent[] = [], impacts: ImpactEvent[] = []

  function makeRibbon(kind: 'tracer' | 'trail'): RibbonMesh {
    const additive = kind === 'tracer'
    const mesh = new THREE.Mesh(ribbonGeometry, new THREE.ShaderMaterial({
      name: 'battle-fx-' + kind, vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS,
      transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() },
        uWA: { value: 0.1 }, uWB: { value: 0.1 }, uMinPx: { value: 0 }, uPxScale: pxScale,
        uCA: { value: new THREE.Color() }, uCB: { value: new THREE.Color() },
        uAA: { value: 0 }, uAB: { value: 1 }, uCore: { value: 0 }, uCoreAlong: { value: 0 }, uOpacity: { value: 1 },
      },
    }))
    mesh.name = 'battle-fx-' + kind
    mesh.renderOrder = additive ? 11 : 9
    mesh.userData.ribbonKind = kind
    mesh.frustumCulled = false   // 顶点在 shader 里展开，几何包围球不代表真实位置
    mesh.matrixAutoUpdate = false
    mesh.raycast = noop
    return mesh
  }
  function teamColor(hex: number) {
    let entry = teamColors.get(hex)
    if (!entry) {
      const team = new THREE.Color(hex)
      entry = { team, head: team.clone().lerp(WHITE, 0.45), glow: team.clone().lerp(WHITE, 0.3) }
      teamColors.set(hex, entry)
    }
    return entry
  }
  function writeRibbon(mesh: RibbonMesh, a: Vector3, b: Vector3, wA: number, wB: number, minPx: number, cA: Color, cB: Color, aA: number, aB: number, core: number, coreAlong: number, opacity: number): void {
    const u = mesh.material.uniforms
    u.uA.value.copy(a); u.uB.value.copy(b)
    u.uWA.value = wA; u.uWB.value = wB; u.uMinPx.value = minPx
    u.uCA.value.copy(cA); u.uCB.value.copy(cB)
    u.uAA.value = aA; u.uAB.value = aB; u.uCore.value = core; u.uCoreAlong.value = coreAlong
    u.uOpacity.value = opacity
  }


  const replayEmit: {
    headGlow(pos: Vector3, hex: number): void
    wreck(x: number, y: number, z: number, yaw: number, since: number, phase: number, seed: number): void
  } = {
    /** 曳光弹头光晕（阵营色偏白）。 */
    headGlow(pos: Vector3, hex: number): void {
      glow.push(pos.x, pos.y, pos.z, 0, 2.2, 2.2, GLOW_TILE, teamColor(hex).glow, 0.9)
    },
    wreck: emitWreck,
  }

  function expireAndEmit<T extends { bornMs: number }>(list: T[], lifeSecs: (e: T) => number, nowMs: number, emit: (e: T, age: number) => void): void {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i], age = (nowMs - e.bornMs) / 1000
      if (age >= lifeSecs(e)) { list.splice(i, 1); continue }
      emit(e, Math.max(0, age))
    }
  }
  const burstLife = (): number => BURST_SECS
  const muzzleLife = (): number => (budget.muzzleSmoke > 0 ? MUZZLE_SMOKE_SECS : MUZZLE_FLASH_SECS)
  const impactLife = (e: ImpactEvent): number => Math.max(IMPACT_SPARK_SECS, budget.impactSmoke > 0 ? IMPACT_SMOKE_SECS[e.kind] + 0.15 : 0,
    e.kind === 'pen' ? 0.9 : 0)

  return {
    root,
    budget,

    /** 借一条条带（`tracer` = 加色曳光弹头，`trail` = 普通混合弹道光迹），已挂进 root。 */
    takeRibbon(kind: 'tracer' | 'trail'): RibbonMesh {
      const mesh = ribbonPool[kind].pop() || makeRibbon(kind)
      mesh.visible = true
      ribbonsOut.add(mesh)
      root.add(mesh)
      return mesh
    },
    giveRibbon(mesh: RibbonMesh): void {
      if (!ribbonsOut.delete(mesh)) return
      root.remove(mesh)
      mesh.visible = false
      ribbonPool[mesh.userData.ribbonKind as 'tracer' | 'trail'].push(mesh)
    },
    /** 曳光弹头：tail → head，白热弹头 + 阵营色渐隐尾迹。 */
    setTracer(mesh: RibbonMesh, tail: Vector3, head: Vector3, hex: number): void {
      const c = teamColor(hex)
      writeRibbon(mesh, tail, head, 0.08, 0.6, 2.4, c.team, c.head, 0, 1, 0.35, 1, 1)
    },
    /** 弹道光迹：阵营色细线、柔边、整段等宽，`opacity` 见 trailOpacityAt。 */
    setTrail(mesh: RibbonMesh, a: Vector3, b: Vector3, hex: number, opacity: number): void {
      const c = teamColor(hex)
      writeRibbon(mesh, a, b, 0.16, 0.16, 1.6, c.team, c.team, 0.62, 0.62, 0.3, 0, opacity)
    },

    spawnBurst(pos: Vector3, nowMs: number, seed: number): void {
      bursts.push({ x: pos.x, y: pos.y, z: pos.z, seed: seed | 0, bornMs: nowMs })
    },
    /** dir：炮口朝向（单位向量）。 */
    spawnMuzzle(pos: Vector3, dir: Vector3, nowMs: number, seed: number): void {
      const sl = Math.hypot(dir.z, dir.x) || 1
      muzzles.push({ x: pos.x, y: pos.y, z: pos.z, dx: dir.x, dy: dir.y, dz: dir.z,
        sx: dir.z / sl, sz: -dir.x / sl, seed: seed | 0, bornMs: nowMs })
    },
    /** kind：impactKind() 的结果；dir：来弹方向；out：跳弹出射方向（缺省按来弹方向上挑）。 */
    spawnImpact(kind: ImpactKind, pos: Vector3, dir: Vector3, out: { x: number; y: number; z: number } | null | undefined, nowMs: number, seed: number): void {
      if (!IMPACT_FLASH_SECS[kind]) return
      let ox = 0, oy = 0, oz = 0
      if (kind === 'ricochet') {
        const o = out || { x: dir.x, y: dir.y + 0.8, z: dir.z }
        const n = Math.hypot(o.x, o.y, o.z) || 1
        ox = o.x / n; oy = o.y / n; oz = o.z / n
      }
      impacts.push({ kind, x: pos.x, y: pos.y, z: pos.z, dx: dir.x, dy: dir.y, dz: dir.z, ox, oy, oz,
        seed: seed | 0, bornMs: nowMs })
    },

    /** 有尚未播完的壁钟特效（爆炸 / 开火 / 命中）：调用方据此保持逐帧重绘。 */
    active(): boolean { return bursts.length > 0 || muzzles.length > 0 || impacts.length > 0 },
    /** 存活中的爆炸（只读快照：位置、种子、出生壁钟）。 */
    activeBursts(): BurstEvent[] { return bursts.map(({ x, y, z, seed, bornMs }) => ({ x, y, z, seed, bornMs })) },
    stats(): { bursts: number; muzzles: number; impacts: number; glow: number; smoke: number; sparks: number; ribbons: number } {
      return { bursts: bursts.length, muzzles: muzzles.length, impacts: impacts.length,
        glow: glow.count, smoke: smoke.count, sparks: sparks.count, ribbons: ribbonsOut.size }
    },
    /** seek：壁钟特效直接清空，不补播；回放时钟驱动的条带由调用方归还。 */
    clearTransients(): void { bursts.length = 0; muzzles.length = 0; impacts.length = 0 },

    /**
     * 每个渲染帧调用一次（render 之前）：按优先级（命中 → 开火 → 爆炸 → 回放驱动粒子）
     * 写粒子，容量满时低优先级的先被丢弃。
     * @param {(emit: typeof replayEmit) => void} [emitReplay] 回放时钟驱动的粒子（弹头光晕、残骸烟）
     */
    frame(nowMs: number, camera: PerspectiveCamera, viewportHeightPx: number, emitReplay?: (emit: typeof replayEmit) => void): void {
      pxScale.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, viewportHeightPx)
      camera.updateMatrixWorld()
      camPos.setFromMatrixPosition(camera.matrixWorld)
      glow.begin(); smoke.begin(); sparks.begin()
      expireAndEmit(impacts, impactLife, nowMs, emitImpact)
      expireAndEmit(muzzles, muzzleLife, nowMs, emitMuzzle)
      expireAndEmit(bursts, burstLife, nowMs, emitBurst)
      if (emitReplay) emitReplay(replayEmit)
      smoke.finish(camera.matrixWorldInverse.elements)
      glow.finish()
      sparks.finish()
    },

    /** 着色器预热：临时显示批次与两种条带样本，交给调用方的 compile。 */
    prewarm(compile: () => void): void {
      const samples = [this.takeRibbon('tracer'), this.takeRibbon('trail')]
      const objects = [glow.mesh, smoke.mesh, sparks.lines]
      const was = objects.map((o) => o.visible)
      for (const o of objects) o.visible = true
      try { compile() } finally {
        objects.forEach((o, i) => { o.visible = was[i] })
        for (const s of samples) this.giveRibbon(s)
      }
    },

    dispose(): void {
      root.parent?.remove(root)
      glow.dispose(); smoke.dispose(); sparks.dispose()
      for (const mesh of [...ribbonsOut, ...ribbonPool.tracer, ...ribbonPool.trail]) mesh.material.dispose()
      ribbonsOut.clear(); ribbonPool.tracer.length = 0; ribbonPool.trail.length = 0
      ribbonGeometry.dispose()
      atlas.dispose()
      bursts.length = 0; muzzles.length = 0; impacts.length = 0
    },
  }
}
