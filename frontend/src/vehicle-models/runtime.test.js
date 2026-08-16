/**
 * 生产 runtime 车型资产解析测试（PR2 — Dedicated Tier X Models in Battle Playback）。
 * import.meta.glob 在 vitest 中由 Vite 解析——直接读真实资产（maus / ho-ri / confirmPending）。
 */
import { describe, expect, it, vi } from 'vitest'
import { modelKeyForTank, preloadBattleModels, resolveModel, PRELOAD_TIMEOUT_MS } from './runtime.js'

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
  it('confirmPending 车型仍可映射（contract 未冻结，preload 阶段按 resolve 失败处理）', () => {
    expect(modelKeyForTank(29985)).toBe('spht')
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
  })
  it('turretless：仅 hull，无 turret / pivot / raster（无 fake turret layer，§14）', () => {
    const m = resolveModel('ho-ri')
    expect(m).not.toBeNull()
    expect(m.kind).toBe('turretless')
    expect(m.hullSrc).toMatch(/hull\.webp$/)
    expect(m.turretSrc).toBeNull()
    expect(m.turretPivot).toBeNull()
    expect(m.turretRaster).toBeNull()
  })
  it('confirmPending（spht）→ null（contract 未冻结，不生成/不 resolve）', () => {
    expect(resolveModel('spht')).toBeNull()
    expect(resolveModel('ac-teichos')).toBeNull()
    expect(resolveModel('nc-70-blyskawica')).toBeNull()
  })
  it('未知 modelKey → null', () => {
    expect(resolveModel('not-a-tank')).toBeNull()
    expect(resolveModel(null)).toBeNull()
  })
})

describe('preloadBattleModels（战局级 preload，计划 §12/§13）', () => {
  const okLoader = async () => true
  const failLoader = async () => false

  it('只处理本场 Tier X：dedupe（同 modelKey 多辆只 resolve 一次）+ byTank 决策表', async () => {
    const r = await preloadBattleModels([6929, 6929, 1, 2, 3937, 999], { imageLoader: okLoader })
    expect([...r.resolved.keys()].sort()).toEqual(['ho-ri', 'maus'])
    expect(r.failed.size).toBe(0)
    // byTank：tankId → modelKey（非 Tier X → null）
    expect(r.byTank.get('6929')).toBe('maus')
    expect(r.byTank.get('1')).toBeNull()
    expect(r.byTank.get('3937')).toBe('ho-ri')
  })

  it('图片加载失败/超时 → 该 modelKey failed（单车 fallback generic，不整场 fallback）', async () => {
    const r = await preloadBattleModels([6929, 3937], { imageLoader: failLoader })
    expect(r.resolved.size).toBe(0)
    expect([...r.failed].sort()).toEqual(['ho-ri', 'maus'])
    // 其他车型照常语义：byTank 仍给出决策（渲染侧按 failed 走 generic）
    expect(r.byTank.get('6929')).toBe('maus')
  })

  it('confirmPending / 未知 modelKey → failed（不 resolve）', async () => {
    const r = await preloadBattleModels([29985, 999], { imageLoader: okLoader })
    expect(r.resolved.size).toBe(0)
    expect([...r.failed]).toEqual(['spht'])
  })

  it('整场无 Tier X → 直接 ready（resolved/failed 空；渲染走 generic）', async () => {
    const r = await preloadBattleModels([1, 2, 3], { imageLoader: okLoader })
    expect(r.resolved.size).toBe(0)
    expect(r.failed.size).toBe(0)
    expect(r.byTank.get('1')).toBeNull()
  })

  it('默认超时常量 = 3 秒（计划 §13）', () => {
    expect(PRELOAD_TIMEOUT_MS).toBe(3000)
  })

  it('空输入不抛错', async () => {
    const r = await preloadBattleModels([], { imageLoader: okLoader })
    expect(r.resolved.size).toBe(0)
  })
})
