// 战斗特效发射器（击毁爆炸 / 开火 / 命中 / 残骸烟的逐帧粒子外观）——自 battleFx.ts 出仓
//（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致；闭包读数改经 deps 注入）。
import * as THREE from 'three'
import type { Color, Vector3 } from 'three'
import type { FxBudget } from './battleFxAtlas.js'
import type { BurstEvent, ImpactEvent, ImpactKind, MuzzleEvent } from './battleFx.js'
import { FX_BUDGETS } from './battleFxAtlas.js'
import { GLOW_TILE, FLAME_TILES, SOOT_TILES, STAR_TILE, CHUNK_TILE } from './battleFxAtlas.js'
import { clamp01 } from './battleFxAtlas.js'
import type { ParticleBatch, SparkLineBatch } from './battleFxAtlas.js'

/** 发射器消费的批次与相机态（owner = createBattleFx；getter 语义见该模块）。 */
export interface BattleFxEmittersDeps {
  budget: FxBudget
  glow: ParticleBatch
  smoke: ParticleBatch
  sparks: SparkLineBatch
  /** 每帧更新的像素尺度（屏幕尺寸下限换算；owner = createBattleFx.frame）。 */
  pxScale: { value: number }
  /** 相机世界位（owner = createBattleFx.frame）。 */
  camPos: Vector3
}

// ---------- 特效寿命与屏幕尺寸常量（battleFx 的 life 函数同源消费） ----------

/** 击毁爆炸壁钟寿命（秒）。3D 专用，不再由 2D 的 `BURST_MS` 推导。 */
export const BURST_SECS = 4.2
export const MUZZLE_FLASH_SECS = 0.24
export const MUZZLE_SMOKE_SECS = 1.8
export const IMPACT_FLASH_SECS: Record<ImpactKind, number> = { pen: 0.18, nonpen: 0.13, ricochet: 0.1 }
export const IMPACT_SMOKE_SECS: Record<ImpactKind, number> = { pen: 1.8, nonpen: 1.4, ricochet: 1.2 }
export const IMPACT_SPARK_SECS = 0.8
/**
 * 命中特效最小屏幕尺寸。镜头拉远时 2 m 的命中火光只有十几像素，余火与烟几乎看不见
 * （2026-10-13 实机近景）。参考尺寸 IMPACT_REF_M 至少占 IMPACT_MIN_PX 像素：镜头拉远时
 * 整套命中特效（火光、余火、烟、火星的大小与散布）等比放大，最多 IMPACT_MAX_ZOOM 倍；
 * 回放相机可以贴近到约 1 m，离得近时保持世界尺寸，不额外放大。
 */
export const IMPACT_REF_M = 2
export const IMPACT_MIN_PX = 56
export const IMPACT_MAX_ZOOM = 3
export const MAX_FIRE = FX_BUDGETS.ultra.burstFire
export const MAX_SMOKE = FX_BUDGETS.ultra.burstSmoke
export const MAX_DUST = FX_BUDGETS.ultra.burstDust
export const G = 9.8
export const TAU = Math.PI * 2

// ---------- 缓动与确定性随机 ----------
const easeOut = (x: number): number => 1 - (1 - clamp01(x)) ** 3
const smooth = (x: number): number => { const t = clamp01(x); return t * t * (3 - 2 * t) }
/** 确定性哈希随机 [0,1)：同一 (seed, i, k) 永远同值——特效外观只依赖年龄。 */
function rnd(seed: number, i: number, k: number): number {
  let x = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35) ^ Math.imul(k + 1, 0x27d4eb2f)
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d)
  x ^= x >>> 12; x = Math.imul(x, 0x297a2d39)
  x ^= x >>> 15
  return (x >>> 0) / 4294967296
}

// ---------- 颜色（three 线性空间；shader 末尾转输出色彩空间） ----------
// ---------- 颜色（three 线性空间；shader 末尾转输出色彩空间） ----------
const C = (hex: number) => new THREE.Color(hex)
const HOT = C(0xfff4dc), YEL = C(0xffc864), ORA = C(0xff7f2a), RED = C(0xa6381a)
const LIT = C(0x6e3d22), SOOT = C(0x1f1b18), ASH = C(0x46423d), WRECK_TOP = C(0x5f5a54)
const DUST0 = C(0x8c7c63), DUST1 = C(0x6f685e)
const SPARK0 = C(0xfff0c0), SPARK1 = C(0xff6a1a)
const FLASH = C(0xfff0cc), GROUND_GLOW = C(0xff8a3a), MUZZLE = C(0xffc777), WHITE = C(0xffffff)
const PEN_SMOKE0 = C(0x48433d), PEN_SMOKE1 = C(0x6c6660), GREY0 = C(0x9d978d), GREY1 = C(0x847e76)
const MUZZLE_SMOKE = C(0xa29c92), DEBRIS = C(0x23201d)
export { WHITE }

/**
 * 创建一个会话的发射器闭包（原 createBattleFx 内的 spark/emit* 逐字迁入）。
 * 返回的函数只写 deps 批次，不持有 GPU 资源。
 */
export function createBattleFxEmitters(deps: BattleFxEmittersDeps) {
  const { budget, glow, smoke, sparks, pxScale, camPos } = deps
  const _c = new THREE.Color()

  /** 加色粒子 + 拖尾线段组成的一颗火星。 */
  function spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: Color, k: number, tail: number, size = 0.28): void {
    glow.push(x, y, z, 0, size, size, GLOW_TILE, color, k)
    sparks.push(x, y, z, x - vx * tail, y - vy * tail, z - vz * tail, color, k)
  }

  function emitBurst(e: BurstEvent, a: number): void {
    const { x, y, z, seed } = e
    if (a < 0.22) {
      const s = 9 + 8 * easeOut(a / 0.12)
      glow.push(x, y + 1.7, z, 0.4, s, s, STAR_TILE, FLASH, (1 - a / 0.22) ** 2)
    }
    if (a < 0.8) {
      // 贴地光斑：压扁的大光晕，模拟爆炸照亮地面
      const k = a / 0.8, s = 9 + 7 * easeOut(k)
      glow.push(x, y + 0.35, z, 0, s, s * 0.45, GLOW_TILE, GROUND_GLOW, 0.55 * (1 - k) ** 1.6)
    }
    const nFire = budget.burstFire, fireScale = (MAX_FIRE / nFire) ** 0.35
    for (let i = 0; i < nFire; i++) {
      const t = a - (i === 0 ? 0 : 0.01 + rnd(seed, i, 0) * 0.07), life = t / 1.0
      if (t < 0 || life >= 1) continue
      const th = rnd(seed, i, 1) * TAU, el = Math.asin(0.15 + rnd(seed, i, 2) * 0.85)
      const grow = easeOut(t / 0.3), r = 0.25 + 1.9 * grow
      const size = (2.0 + rnd(seed, i, 4) * 1.7) * fireScale * (0.45 + 1.75 * grow) * (1 + 0.25 * life)
      if (life < 0.1) _c.lerpColors(HOT, YEL, life / 0.1)
      else if (life < 0.45) _c.lerpColors(YEL, ORA, (life - 0.1) / 0.35)
      else _c.lerpColors(ORA, RED, (life - 0.45) / 0.55)
      glow.push(
        x + Math.cos(th) * Math.cos(el) * r,
        y + 1.5 + Math.sin(el) * r * 0.8 + life * (0.6 + rnd(seed, i, 3)) * 1.4,
        z + Math.sin(th) * Math.cos(el) * r,
        rnd(seed, i, 5) * TAU + (rnd(seed, i, 6) - 0.5) * 1.4 * t,
        size, size, FLAME_TILES[i % 3], _c, 0.78 * (1 - life) ** 1.4)
    }
    const nSmoke = budget.burstSmoke, smokeScale = (MAX_SMOKE / nSmoke) ** 0.3
    for (let i = 0; i < nSmoke; i++) {
      const delay = 0.10 + (i % 16) * 0.045 + rnd(seed, i, 10) * 0.03
      const t = a - delay, L = BURST_SECS - delay, life = t / L
      if (t < 0 || life >= 1) continue
      const th = rnd(seed, i, 11) * TAU, el = Math.asin(0.15 + rnd(seed, i, 12) * 0.85)
      const spread = 0.5 + 1.5 * easeOut(life)
      const size = (2.0 + rnd(seed, i, 13) * 1.2 + t * (1.8 + rnd(seed, i, 14) * 1.4)) * smokeScale
      if (t < 0.35) _c.lerpColors(LIT, SOOT, t / 0.35)
      else _c.lerpColors(SOOT, ASH, (t - 0.35) / (L - 0.35))
      smoke.push(
        x + Math.cos(th) * Math.cos(el) * spread + t * 0.45,
        y + 1.6 + t * (1.6 + rnd(seed, i, 15) * 1.5) * (1 - 0.3 * life),
        z + Math.sin(th) * Math.cos(el) * spread,
        rnd(seed, i, 16) * TAU + (rnd(seed, i, 17) - 0.5) * 0.5 * t,
        size, size * 1.08, SOOT_TILES[i % 2], _c, Math.min(1, t / 0.15) * 0.95 * (1 - life) ** 0.9)
    }
    const nDust = budget.burstDust
    for (let i = 0; i < nDust; i++) {
      const t = a - 0.02 - rnd(seed, i, 20) * 0.06, life = t / 1.8
      if (t < 0 || life >= 1) continue
      const angle = (i / nDust) * TAU + (rnd(seed, i, 21) - 0.5) * 0.35
      const dist = 5.5 + rnd(seed, i, 22) * 3.5
      const r = 1.8 + (dist - 1.8) * easeOut(t / 1.1)
      const size = (2.0 + rnd(seed, i, 23) * 1.6) * (0.6 + 1.1 * easeOut(life)) * (MAX_DUST / nDust) ** 0.3
      _c.lerpColors(DUST0, DUST1, life)
      smoke.push(x + Math.cos(angle) * r, y + 0.45 + 0.7 * life, z + Math.sin(angle) * r,
        rnd(seed, i, 24) * TAU, size * 1.3, size * 0.8, SOOT_TILES[i % 2], _c,
        Math.min(1, t / 0.05) * 0.55 * (1 - life) ** 1.4)
    }
    if (a < 1.5) {
      for (let i = 0; i < budget.burstSparks; i++) {
        const t = a - rnd(seed, i, 30) * 0.05, life = t / (0.55 + rnd(seed, i, 31) * 0.8)
        if (t < 0 || life >= 1) continue
        const th = rnd(seed, i, 32) * TAU, el = 0.2 + rnd(seed, i, 33) * 1.2, spd = 8 + rnd(seed, i, 34) * 16
        const vx0 = Math.cos(th) * Math.cos(el) * spd, vy0 = Math.sin(el) * spd, vz0 = Math.sin(th) * Math.cos(el) * spd
        let py = y + 1.6 + vy0 * t - 0.5 * G * t * t, vy = vy0 - G * t, k = (1 - life) ** 1.5
        if (py < y + 0.06) { py = y + 0.06; vy = 0; k *= 0.6 }
        _c.lerpColors(SPARK0, SPARK1, life)
        spark(x + vx0 * t, py, z + vz0 * t, vx0, vy, vz0, _c, k, 0.035)
      }
    }
    if (a < 3.4) {
      const fade = 1 - smooth((a - 2.6) / 0.8)
      for (let i = 0; i < budget.burstDebris; i++) {
        const th = rnd(seed, i, 40) * TAU, h = 2.5 + rnd(seed, i, 41) * 6, size = 0.3 + rnd(seed, i, 42) * 0.45
        const vy0 = 4 + rnd(seed, i, 43) * 7
        const tHit = (vy0 + Math.sqrt(vy0 * vy0 + 2 * G * 1.5)) / G
        const t = Math.min(a, tHit)
        smoke.push(x + Math.cos(th) * h * t, y + Math.max(0.05, 1.5 + vy0 * t - 0.5 * G * t * t), z + Math.sin(th) * h * t,
          rnd(seed, i, 44) * TAU + (rnd(seed, i, 45) - 0.5) * 14 * t,
          size, size * (0.5 + rnd(seed, i, 46) * 0.5), CHUNK_TILE, DEBRIS, fade)
      }
    }
  }

  function emitMuzzle(e: MuzzleEvent, m: number): void {
    const { x, y, z, dx, dy, dz, sx, sz, seed } = e
    if (m < MUZZLE_FLASH_SECS) {
      const f = m / MUZZLE_FLASH_SECS
      for (let i = 0; i < 3; i++) {
        const d = [0.5, 1.2, 2.0][i] * (0.7 + 0.5 * f), s = [1.9, 1.5, 1.0][i] * (0.8 + 0.5 * f)
        _c.lerpColors(WHITE, MUZZLE, f)
        glow.push(x + dx * d, y + dy * d, z + dz * d, rnd(seed, i, 0) * TAU, s, s, FLAME_TILES[i], _c, 0.95 * (1 - f) ** 2)
      }
    }
    if (m < 0.14) glow.push(x, y, z, rnd(seed, 0, 1) * TAU, 2.6, 2.6, STAR_TILE, WHITE, (1 - m / 0.14) ** 2)
    if (budget.muzzleBrake && m < 0.18) {
      for (const sgn of [1, -1]) {
        glow.push(x - dx * 0.25 + sx * sgn * 0.7, y - dy * 0.25, z - dz * 0.25 + sz * sgn * 0.7,
          0, 1, 1, FLAME_TILES[1], MUZZLE, 0.8 * (1 - m / 0.18) ** 2)
      }
    }
    const life = m / MUZZLE_SMOKE_SECS
    if (life < 1) {
      for (let i = 0; i < budget.muzzleSmoke; i++) {
        const d = (1.5 + rnd(seed, i, 10) * 3.2) * easeOut(m / 0.9)
        const fwd = 0.5 + rnd(seed, i, 11) * 0.5, lat = rnd(seed, i, 12) - 0.5, up = rnd(seed, i, 13) * 0.3
        const s = 0.7 + 2.6 * easeOut(m / 1.4)
        smoke.push(x + (dx * fwd + sx * lat) * d, y + dy * fwd * d + up * d + m * 0.4, z + (dz * fwd + sz * lat) * d,
          rnd(seed, i, 14) * TAU + m * 0.3, s, s, SOOT_TILES[i % 2], MUZZLE_SMOKE,
          Math.min(1, m / 0.04) * 0.55 * (1 - life) ** 1.3)
      }
    }
  }

  // 命中点就在车体表面：面向相机的火光 / 烟四边形有一半插进车体，被深度测试裁掉（实机近景里
  // 暗烟完全看不见、火光被切掉一块）。沿视线朝相机挪半个粒子尺寸：屏幕位置不变，只把四边形
  // 从车体里拉出来。
  function pushTowardCamera(batch: ParticleBatch, x: number, y: number, z: number, rot: number, w: number, h: number, tile: number, color: Color, alpha: number): void {
    const vx = camPos.x - x, vy = camPos.y - y, vz = camPos.z - z
    const d = Math.hypot(vx, vy, vz)
    const k = d > 1e-3 ? Math.min(0.5 * w, 0.5 * d) / d : 0
    batch.push(x + vx * k, y + vy * k, z + vz * k, rot, w, h, tile, color, alpha)
  }

  function emitImpact(e: ImpactEvent, a: number): void {
    const { kind, x, y, z, dx, dy, dz, seed } = e
    // 屏幕尺寸下限（见 IMPACT_MIN_PX）：zoom ≥ 1 时大小与散布等比放大
    const zoom = Math.min(IMPACT_MAX_ZOOM, Math.max(1,
      IMPACT_MIN_PX * Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z) * pxScale.value / IMPACT_REF_M))
    const flashSecs = IMPACT_FLASH_SECS[kind]
    if (a < flashSecs) {
      const f = a / flashSecs
      const s = (kind === 'pen' ? 1.5 : kind === 'nonpen' ? 1.1 : 0.9) * (1 + 0.5 * easeOut(f * 2)) * zoom
      _c.lerpColors(HOT, kind === 'pen' ? ORA : YEL, f)
      pushTowardCamera(glow, x - dx * 0.2 * zoom, y - dy * 0.2 * zoom, z - dz * 0.2 * zoom, rnd(seed, 0, 0) * TAU,
        s, s, FLAME_TILES[0], _c, (1 - f) ** 1.5)
    }
    // 命中点余火：击穿留一点橙色火光，未击穿只闪一下亮点；跳弹不留
    const glowSecs = kind === 'pen' ? 0.9 : kind === 'nonpen' ? 0.4 : 0
    if (a < glowSecs) {
      const s = (kind === 'pen' ? 0.9 : 0.6) * zoom
      pushTowardCamera(glow, x - dx * 0.15 * zoom, y - dy * 0.15 * zoom, z - dz * 0.15 * zoom, 0, s, s, GLOW_TILE,
        kind === 'pen' ? ORA : YEL, 0.9 * (1 - a / glowSecs) ** 1.5)
    }
    // 烟：击穿深灰、其余中灰。单团烟贴图平均不透明度只有 ~0.2，暗烟叠在深灰车体上实机几乎
    // 看不出（像素回读：命中点附近中位只压暗 ~13/255），所以每团再叠一层小一号的烟芯，颜色取中灰，
    // 在深色车体与亮地面上都有对比。
    const smokeSecs = IMPACT_SMOKE_SECS[kind]
    const nSmoke = kind === 'ricochet' ? Math.ceil(budget.impactSmoke / 2) : budget.impactSmoke
    const peak = kind === 'pen' ? 1 : kind === 'nonpen' ? 0.9 : 0.6
    for (let i = 0; i < nSmoke; i++) {
      const t = a - (0.03 + rnd(seed, i, 10) * 0.12), life = t / smokeSecs
      if (t < 0 || life >= 1) continue
      const spread = (0.4 + t) * zoom, back = (0.4 + t * 0.3) * zoom
      const s = (1.0 + rnd(seed, i, 11) * 0.6) * (1 + 2.6 * easeOut(life)) * zoom
      if (kind === 'pen') _c.lerpColors(PEN_SMOKE0, PEN_SMOKE1, life)
      else _c.lerpColors(GREY0, GREY1, life)
      const px = x - dx * back + (rnd(seed, i, 12) - 0.5) * 0.8 * spread
      const py = y - dy * back + t * (0.9 + rnd(seed, i, 13) * 0.8) * zoom
      const pz = z - dz * back + (rnd(seed, i, 14) - 0.5) * 0.8 * spread
      const rot = rnd(seed, i, 15) * TAU + t * 0.4, alpha = Math.min(1, t / 0.08) * peak * (1 - life) ** 1.4
      pushTowardCamera(smoke, px, py, pz, rot, s, s, SOOT_TILES[i % 2], _c, alpha)
      pushTowardCamera(smoke, px, py, pz, rot + 2.1, s * 0.6, s * 0.6, SOOT_TILES[(i + 1) % 2], _c, alpha)
    }
    if (a < IMPACT_SPARK_SECS) {
      const head = kind === 'pen' ? ORA : SPARK0
      for (let i = 0; i < budget.impactSparks; i++) {
        const rx = (rnd(seed, i, 20) - 0.5) * 2, ry = rnd(seed, i, 21) * 1.6, rz = (rnd(seed, i, 22) - 0.5) * 2
        let vx, vy0, vz, lifeSecs
        if (kind === 'ricochet') {
          // 沿偏转方向的窄锥
          const spd = 12 + rnd(seed, i, 23) * 10
          vx = e.ox * spd + rx * 2.2; vy0 = e.oy * spd + ry * 2.2; vz = e.oz * spd + rz * 2.2
          lifeSecs = 0.25 + rnd(seed, i, 24) * 0.25
        } else {
          // 迎着来弹方向回溅：击穿低速橙色，未击穿高速亮白
          let bx = -dx * 0.6 + rx, by = -dy * 0.6 + ry, bz = -dz * 0.6 + rz
          const n = Math.hypot(bx, by, bz) || 1
          const spd = kind === 'pen' ? 3 + rnd(seed, i, 23) * 4 : 6 + rnd(seed, i, 23) * 8
          bx /= n; by /= n; bz /= n
          vx = bx * spd; vy0 = by * spd; vz = bz * spd
          lifeSecs = (kind === 'pen' ? 0.35 : 0.3) + rnd(seed, i, 24) * 0.3
        }
        const life = a / lifeSecs
        if (life >= 1) continue
        // 命中点在车体上、地面高度未知：不做落地钳制（寿命 ≤0.65 s，落到地下的部分由深度测试遮住）
        _c.lerpColors(head, SPARK1, life)
        spark(x + vx * a * zoom, y + (vy0 * a - 0.5 * G * a * a) * zoom, z + vz * a * zoom,
          vx * zoom, (vy0 - G * a) * zoom, vz * zoom, _c,
          (1 - life) ** 1.4, kind === 'ricochet' ? 0.06 : 0.035, 0.36 * zoom)
      }
    }
  }

  /** 残骸持续烟（+ 极致档余火）。`since` 回放秒（未知死亡时刻传 Infinity），`phase` 播放中壁钟累计秒。 */
  function emitWreck(x: number, y: number, z: number, yaw: number, since: number, phase: number, seed: number): void {
    // 车体局部 (lx, lz) → 世界 xz（绕 Y 转 yaw；车头 +z，发动机舱在 -z 侧）
    const cos = Math.cos(yaw), sin = Math.sin(yaw)
    const n = budget.wreckSmoke
    const ramp = n > 0 ? smooth((since - 1.4) / 2.2) : 0
    if (ramp > 0) {
      const offset = rnd(seed, 0, 50)
      for (let i = 0; i < n; i++) {
        const ph = (phase * 0.2 + i / n + offset) % 1, age = ph * 5
        const lx = (rnd(seed, i, 51) - 0.5) * 0.8 + age * (0.7 + rnd(seed, i, 52) * 0.6) * 0.7
        const lz = -1.6 + (rnd(seed, i, 53) - 0.5) * 0.8 + age * 0.25
        // 烟团大、升得慢、彼此重叠成连续烟柱：单团烟贴图中心 alpha 只有 ~0.6，稀疏摆放在亮图远景下
        // 只剩一层看不出的薄灰（实机像素回读：峰值只压暗 ~1/3）。
        // 底部炭黑（亮图上读得出）→ 顶部转灰（暗图上读得出）。
        const size = 2.4 + ph * 6.5
        _c.lerpColors(SOOT, WRECK_TOP, ph)
        smoke.push(x + lx * cos + lz * sin, y + 1.6 + ph * 10, z - lx * sin + lz * cos,
          i * 2.39996323 + ph * 0.9, size, size * 1.1, SOOT_TILES[i % 2], _c,
          ramp * smooth(ph / 0.08) * (1 - ph) ** 0.8)
      }
    }
    if (budget.wreckEmbers) {
      const er = smooth((since - 0.7) / 0.6) * (1 - smooth((since - 6) / 4))
      if (er > 0.001) {
        for (let i = 0; i < 3; i++) {
          const f = 0.55 + 0.45 * Math.sin(phase * (9 + rnd(seed, i, 60) * 6) + i * 2.1) * Math.sin(phase * (5 + rnd(seed, i, 61) * 4) + i)
          const size = 0.8 + 0.5 * f
          const lx = (i - 1) * 0.6, lz = -1.9 + rnd(seed, i, 62) * 0.5
          _c.lerpColors(ORA, YEL, f * 0.6)
          glow.push(x + lx * cos + lz * sin, y + 1.75 + 0.2 * f, z - lx * sin + lz * cos,
            0, size, size * 1.5, FLAME_TILES[i], _c, 0.6 * er * f)
        }
      }
    }
  }

  return { spark, emitBurst, emitMuzzle, emitImpact, emitWreck }
}
