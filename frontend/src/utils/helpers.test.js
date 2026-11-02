import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasChineseMapName, mapLabel } from './helpers.js'
import MAP_NAMES from '../../../common/map_names.json'

describe('mapLabel locale selection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the explicit locale and a pure Chinese fallback when omitted', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'ru' })
    expect(mapLabel('canal', 'en')).toBe('Canal')
    expect(mapLabel('canal')).toBe('运河尽头')
  })

  it('returns the accepted Chinese names for newly catalogued asset maps', () => {
    expect(mapLabel('erlenberg_old', 'zh')).toBe('米德尔博格 2014版')
    expect(mapLabel('grossberg', 'zh')).toBe('王朝的珍珠')
    expect(mapLabel('savanna_old', 'zh')).toBe('沙漠之心2014版')
    expect(mapLabel('moon', 'zh')).toBe('寂静之海')
    expect(mapLabel('iceworld', 'zh')).toBe('永冻')
    // en 保持国际服正式名（资产 display 原文），不因新增中文名而变
    expect(mapLabel('grossberg', 'en')).toBe("Dynasty's Pearl")
    expect(mapLabel('moon', 'en')).toBe('Sea of Tranquility')
    expect(mapLabel('savanna_old', 'en')).toBe('Oasis Palms mod. 2014')
  })
})

describe('hasChineseMapName（地图页默认可见性判据）', () => {
  it('is true only for keys the catalog accepted with a Chinese name', () => {
    expect(hasChineseMapName('erlenberg')).toBe(true)
    expect(hasChineseMapName('moon')).toBe(true)
    // 归一化与 mapLabel 一致（资产 key 本身是小写）
    expect(hasChineseMapName('MOON')).toBe(true)
    expect(hasChineseMapName(' moon ')).toBe(true)
    // 资产里有这张图，但我们没有登记中文名 → 默认隐藏
    expect(hasChineseMapName('rudniki_03')).toBe(false)
    expect(hasChineseMapName('does_not_exist')).toBe(false)
    expect(hasChineseMapName('')).toBe(false)
    expect(hasChineseMapName(undefined)).toBe(false)
  })

  it('keeps the catalog a usable allowlist: every entry carries a non-empty zh', () => {
    for (const [key, node] of Object.entries(MAP_NAMES)) {
      expect(typeof node, key).toBe('object')
      expect(typeof node.zh, key).toBe('string')
      expect(node.zh.trim().length, key).toBeGreaterThan(0)
    }
  })
})
