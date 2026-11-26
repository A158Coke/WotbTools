import * as THREE from 'three'
import type { Color, Mesh, Object3D, PerspectiveCamera, ShaderMaterial, Vector3 } from 'three'
import { atlasData, TILE, ATLAS_COLS, ATLAS_ROWS, createBatch, createSparkLines, RIBBON_VS, RIBBON_FS, noop } from './battleFxAtlas.js'
import type { FxBudget } from './battleFxAtlas.js'
import { createBattleFxEmitters } from './battleFxEmitters.js'
import { BURST_SECS, MUZZLE_FLASH_SECS, MUZZLE_SMOKE_SECS, IMPACT_FLASH_SECS, IMPACT_SMOKE_SECS, IMPACT_SPARK_SECS } from './battleFxEmitters.js'
import { GLOW_TILE } from './battleFxAtlas.js'
import { WHITE } from './battleFxEmitters.js'

export interface BurstEvent { x: number; y: number; z: number; seed: number; bornMs: number }
export interface MuzzleEvent extends BurstEvent { dx: number; dy: number; dz: number; sx: number; sz: number }
export interface ImpactEvent extends BurstEvent { kind: ImpactKind; dx: number; dy: number; dz: number; ox: number; oy: number; oz: number }
export type ImpactKind = 'pen' | 'nonpen' | 'ricochet'

type RibbonMesh = Mesh<THREE.BufferGeometry, ShaderMaterial>

export { FX_BUDGETS } from './battleFxAtlas.js'
export type { FxBudget } from './battleFxAtlas.js'

export { BURST_SECS }
export const TRAIL_HOLD_SECS = 2.5
export const TRAIL_FADE_SECS = 1.5
export const TRACER_STREAK_M = 14


export function trailOpacityAt(secsAfterFlight: number): number {
  if (!(secsAfterFlight > TRAIL_HOLD_SECS)) return 1
  return Math.max(0, 1 - (secsAfterFlight - TRAIL_HOLD_SECS) / TRAIL_FADE_SECS)
}

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
  smoke.mesh.renderOrder = 10
  glow.mesh.renderOrder = sparks.lines.renderOrder = 12
  root.add(smoke.mesh, glow.mesh, sparks.lines)

  const pxScale: { value: number } = { value: 0.001 }
  const camPos = new THREE.Vector3()
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
    mesh.frustumCulled = false
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
    setTracer(mesh: RibbonMesh, tail: Vector3, head: Vector3, hex: number): void {
      const c = teamColor(hex)
      writeRibbon(mesh, tail, head, 0.08, 0.6, 2.4, c.team, c.head, 0, 1, 0.35, 1, 1)
    },
    setTrail(mesh: RibbonMesh, a: Vector3, b: Vector3, hex: number, opacity: number): void {
      const c = teamColor(hex)
      writeRibbon(mesh, a, b, 0.16, 0.16, 1.6, c.team, c.team, 0.62, 0.62, 0.3, 0, opacity)
    },

    spawnBurst(pos: Vector3, nowMs: number, seed: number): void {
      bursts.push({ x: pos.x, y: pos.y, z: pos.z, seed: seed | 0, bornMs: nowMs })
    },
    spawnMuzzle(pos: Vector3, dir: Vector3, nowMs: number, seed: number): void {
      const sl = Math.hypot(dir.z, dir.x) || 1
      muzzles.push({ x: pos.x, y: pos.y, z: pos.z, dx: dir.x, dy: dir.y, dz: dir.z,
        sx: dir.z / sl, sz: -dir.x / sl, seed: seed | 0, bornMs: nowMs })
    },
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

    active(): boolean { return bursts.length > 0 || muzzles.length > 0 || impacts.length > 0 },
    activeBursts(): BurstEvent[] { return bursts.map(({ x, y, z, seed, bornMs }) => ({ x, y, z, seed, bornMs })) },
    stats(): { bursts: number; muzzles: number; impacts: number; glow: number; smoke: number; sparks: number; ribbons: number } {
      return { bursts: bursts.length, muzzles: muzzles.length, impacts: impacts.length,
        glow: glow.count, smoke: smoke.count, sparks: sparks.count, ribbons: ribbonsOut.size }
    },
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
