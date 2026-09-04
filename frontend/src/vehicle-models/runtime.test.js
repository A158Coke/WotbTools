/**
 * 生产 runtime 车型资产解析测试（PR2 — Dedicated Tier X Models in Battle Playback；
 * PR #92 Review 补：module-lifetime cache 行为）。
 * import.meta.glob 在 vitest 中由 Vite 解析——直接读真实资产（maus / ho-ri / spht / ac-teichos / nc-70-blyskawica）。
 *
 * cache 测试隔离：module-lifetime cache 是模块级 Map——每个用例前 vi.resetModules() +
 * 动态 import 获取全新模块实例（不污染生产 API，不用 test-only reset hook）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
// cache 无关的纯符号用静态 import（fallow 可静态链接消费方）；
// preloadBattleModels 依赖 module-lifetime cache，在 cache describe 内用
// vi.resetModules + 动态 import 隔离（不污染生产 API）。
import { PRELOAD_TIMEOUT_MS, modelKeyForTank, resolveModel } from './runtime.js'

describe('modelKeyForTank（tankId → modelKey）', () => {
  it('Tier X tankId 命中 mapping', () => {
    expect(modelKeyForTank(6929)).toBe('maus')
    expect(modelKeyForTank('19217')).toBe('grille-15')
  })
  it('非 Tier X / 未知 tankId → null（generic fallback）', () => {
    expect(modelKeyForTank(1)).toBeNull()
    expect(modelKeyForTank(999999)).toBeNull()
    expect(modelKeyForTank(null)).toBeNull()
  })
  it('全部 81 组已确认 kind（confirmPending 清零，2026-08-19 BlitzKit 数据逐车确认）', () => {
    expect(modelKeyForTank(29985)).toBe('spht')
    expect(modelKeyForTank(22129)).toBe('ac-teichos')
    expect(modelKeyForTank(19585)).toBe('nc-70-blyskawica')
  })
})

describe('resolveModel（modelKey → 正式资产）', () => {
  it('turreted：hull + turret + turretPivot + turretRaster 齐全', () => {
    const m = resolveModel('maus')
    expect(m).not.toBeNull()
    expect(m.kind).toBe('turreted')
    expect(m.hullSrc).toMatch(/hull\.webp$/)
    expect(m.turretSrc).toMatch(/turret\.webp$/)
    expect(m.turretPivot.x).toBe(160)
    expect(m.turretRaster.pixelWidth).toBeGreaterThan(0)
    expect(m.turretRaster.pivotX).toBeGreaterThan(0)
    expect(m.hullBounds).toEqual(expect.objectContaining({ minX: expect.any(Number), maxY: expect.any(Number) }))
  })
  it('turretless：仅 hull，无 turret / pivot / raster（无 fake turret layer，§14）', () => {
    const m = resolveModel('ho-ri')
    expect(m).not.toBeNull()
    expect(m.kind).toBe('turretless')
    expect(m.hullSrc).toMatch(/hull\.webp$/)
    expect(m.turretSrc).toBeNull()
    expect(m.turretPivot).toBeNull()
    expect(m.turretRaster).toBeNull()
    expect(m.hullBounds.maxY).toBeGreaterThan(m.hullBounds.minY)
  })
  it('未知 modelKey → null（generic fallback）', () => {
    expect(resolveModel('not-a-tank')).toBeNull()
    expect(resolveModel(null)).toBeNull()
  })
  it('已确认车型 resolve 出正式资产（spht / ac-teichos / nc-70-blyskawica，hull + turret + pivot）', () => {
    for (const key of ['spht', 'ac-teichos', 'nc-70-blyskawica']) {
      const m = resolveModel(key)
      expect(m, key + ' resolve 失败').not.toBeNull()
      expect(m.kind).toBe('turreted')
      expect(m.hullSrc).toMatch(/hull\.webp$/)
      expect(m.turretSrc).toMatch(/turret\.webp$/)
      expect(m.turretPivot).not.toBeNull()
    }
  })
})

describe('preloadBattleModels（module-lifetime cache，PR #92 Blocker 2）', () => {
  let runtime
  beforeEach(async () => {
    vi.resetModules()
    runtime = await import('./runtime.js')
  })
  const okLoader = async () => true
  const failLoader = async () => false

  it('只处理本场 Tier X：dedupe（同 modelKey 多辆只 resolve 一次）+ byTank 决策表', async () => {
    const r = await runtime.preloadBattleModels([6929, 6929, 1, 2, 3937, 999], { imageLoader: okLoader })
    expect([...r.resolved.keys()].sort()).toEqual(['ho-ri', 'maus'])
    expect(r.failed.size).toBe(0)
    expect(r.byTank.get('6929')).toBe('maus')
    expect(r.byTank.get('1')).toBeNull()
    expect(r.byTank.get('3937')).toBe('ho-ri')
  })

  it('图片加载失败/超时 → 该 modelKey failed（单车 fallback generic，不整场 fallback）', async () => {
    const r = await runtime.preloadBattleModels([6929, 3937], { imageLoader: failLoader })
    expect(r.resolved.size).toBe(0)
    expect([...r.failed].sort()).toEqual(['ho-ri', 'maus'])
    expect(r.byTank.get('6929')).toBe('maus')
  })

  it('未知 tankId 不进入 preload（byTank null；不触发 loader）', async () => {
    const r = await runtime.preloadBattleModels([999999], { imageLoader: okLoader })
    expect(r.resolved.size).toBe(0)
    expect(r.failed.size).toBe(0)
    expect(r.byTank.get('999999')).toBeNull()
  })

  it('整场无 Tier X → 直接 ready（resolved/failed 空；渲染走 generic）', async () => {
    const r = await runtime.preloadBattleModels([1, 2, 3], { imageLoader: okLoader })
    expect(r.resolved.size).toBe(0)
    expect(r.failed.size).toBe(0)
    expect(r.byTank.get('1')).toBeNull()
  })

  it('默认超时常量 = 3 秒', () => {
    expect(PRELOAD_TIMEOUT_MS).toBe(3000)
  })

  it('空输入不抛错', async () => {
    const r = await runtime.preloadBattleModels([], { imageLoader: okLoader })
    expect(r.resolved.size).toBe(0)
  })

  it('cache 1：第一次 preload Maus → imageLoader 被调用（hull + turret 各一次）', async () => {
    const loader = vi.fn(okLoader)
    await runtime.preloadBattleModels([6929], { imageLoader: loader })
    expect(loader).toHaveBeenCalledTimes(2) // hull.webp + turret.webp
  })

  it('cache 2：第二次 preload Maus（同模块实例）→ 不再调用 imageLoader', async () => {
    const loader = vi.fn(okLoader)
    await runtime.preloadBattleModels([6929], { imageLoader: loader })
    expect(loader).toHaveBeenCalledTimes(2)
    const again = await runtime.preloadBattleModels([6929, 6929], { imageLoader: loader })
    expect(loader).toHaveBeenCalledTimes(2) // 完全复用缓存
    expect(again.resolved.get('maus')).toBeTruthy()
    expect(again.failed.size).toBe(0)
  })

  it('cache 3：同一 modelKey 并发请求共享 in-flight Promise——实际只加载一次', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const loader = vi.fn(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return true
    })
    const [a, b] = await Promise.all([
      runtime.preloadBattleModels([6929], { imageLoader: loader }),
      runtime.preloadBattleModels([6929], { imageLoader: loader }),
    ])
    // 两个并发调用：hull+turret 各只加载一次（共享 in-flight）
    expect(loader).toHaveBeenCalledTimes(2)
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(a.resolved.has('maus')).toBe(true)
    expect(b.resolved.has('maus')).toBe(true)
  })

  it('cache 4：turreted 的 hull + turret 作为一个 modelKey 原子缓存（成功结果含两者）', async () => {
    const loader = vi.fn(okLoader)
    await runtime.preloadBattleModels([6929], { imageLoader: loader })
    const again = await runtime.preloadBattleModels([6929], { imageLoader: loader })
    expect(loader).toHaveBeenCalledTimes(2) // 原子：一次成功缓存 hull+turret，不再重载
    const m = again.resolved.get('maus')
    expect(m.kind).toBe('turreted')
    expect(m.turretSrc).toMatch(/turret\.webp$/)
  })

  it('cache 5：failed 缓存——失败车型不重试（避免每次 replay 重等 3s timeout）', async () => {
    const loader = vi.fn(failLoader)
    const first = await runtime.preloadBattleModels([6929], { imageLoader: loader })
    expect(first.failed.has('maus')).toBe(true)
    const second = await runtime.preloadBattleModels([6929], { imageLoader: loader })
    expect(loader).toHaveBeenCalledTimes(2) // 第一次 2 URL；第二次 0 新调用
    expect(second.failed.has('maus')).toBe(true)
    // 失败缓存不扩散：其他 modelKey 照常
    const third = await runtime.preloadBattleModels([6929, 3937], { imageLoader: okLoader })
    expect(third.resolved.has('ho-ri')).toBe(true)
    expect(third.failed.has('maus')).toBe(true)
  })

  it('cache 6：不同 modelKey 互不影响（maus ok + ho-ri 独立加载）', async () => {
    const loader = vi.fn(okLoader)
    await runtime.preloadBattleModels([6929], { imageLoader: loader })
    expect(loader).toHaveBeenCalledTimes(2)
    await runtime.preloadBattleModels([3937], { imageLoader: loader })
    expect(loader).toHaveBeenCalledTimes(3) // ho-ri 仅 hull 1 次
  })

  it('cache 7：non-Tier-X 不进入 cache（byTank null；不触发 loader）', async () => {
    const loader = vi.fn(okLoader)
    const r = await runtime.preloadBattleModels([1, 2, 3], { imageLoader: loader })
    expect(loader).not.toHaveBeenCalled()
    expect(r.resolved.size).toBe(0)
    expect(r.failed.size).toBe(0)
    // 再次调用同样零加载
    await runtime.preloadBattleModels([1], { imageLoader: loader })
    expect(loader).not.toHaveBeenCalled()
  })

  it('cache 8：imageLoader 抛异常 → 按失败缓存（cache 不留 rejected promise，不悬挂）', async () => {
    const loader = vi.fn(async () => { throw new Error('boom') })
    const first = await runtime.preloadBattleModels([6929], { imageLoader: loader })
    expect(first.failed.has('maus')).toBe(true)
    // 第二次不再调用 loader（失败已缓存）
    const second = await runtime.preloadBattleModels([6929], { imageLoader: loader })
    expect(loader).toHaveBeenCalledTimes(2) // 仅第一次 2 URL
    expect(second.failed.has('maus')).toBe(true)
  })
})
