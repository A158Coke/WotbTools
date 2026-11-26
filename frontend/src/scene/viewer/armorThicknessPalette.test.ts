import { describe, expect, it } from 'vitest'
import {
  THICKNESS_BANDS, THICKNESS_UNKNOWN_COLOR, thicknessToColor,
} from './armorThicknessPalette.js'
import { SCENE_RESULT_COLORS } from './shotResultPalette.js'

describe('armorThicknessPalette', () => {
  it('5 档阈值不变：<30 绿 / 30–60 黄 / 60–100 橙 / 100–200 红 / ≥200 深红', () => {
    expect(thicknessToColor(0)).toBe(SCENE_RESULT_COLORS.PENETRATION)
    expect(thicknessToColor(29.9)).toBe(SCENE_RESULT_COLORS.PENETRATION)
    expect(thicknessToColor(30)).toBe(SCENE_RESULT_COLORS.MAY_PENETRATE)
    expect(thicknessToColor(59.9)).toBe(SCENE_RESULT_COLORS.MAY_PENETRATE)
    expect(thicknessToColor(60)).toBe(SCENE_RESULT_COLORS.SPLASH)
    expect(thicknessToColor(99.9)).toBe(SCENE_RESULT_COLORS.SPLASH)
    expect(thicknessToColor(100)).toBe(SCENE_RESULT_COLORS.BLOCKED)
    expect(thicknessToColor(199.9)).toBe(SCENE_RESULT_COLORS.BLOCKED)
    expect(thicknessToColor(200)).toBe(0xb8322a)
    expect(thicknessToColor(1000)).toBe(0xb8322a)
  })

  it('无厚度数据回中性灰，不当薄板绿', () => {
    expect(thicknessToColor(null)).toBe(THICKNESS_UNKNOWN_COLOR)
    expect(thicknessToColor(undefined)).toBe(THICKNESS_UNKNOWN_COLOR)
    expect(thicknessToColor(Number.NaN)).toBe(THICKNESS_UNKNOWN_COLOR)
    expect(thicknessToColor(Number.POSITIVE_INFINITY)).toBe(THICKNESS_UNKNOWN_COLOR)
  })

  it('分档颜色互不相同，且按厚度从绿到深红单调过渡', () => {
    const colors = THICKNESS_BANDS.map((band) => band.color)
    expect(new Set(colors).size).toBe(THICKNESS_BANDS.length)
    expect(colors).toContain(SCENE_RESULT_COLORS.PENETRATION)
    expect(colors).toContain(SCENE_RESULT_COLORS.MAY_PENETRATE)
    expect(colors).toContain(SCENE_RESULT_COLORS.SPLASH)
    expect(colors).toContain(SCENE_RESULT_COLORS.BLOCKED)
  })
})
