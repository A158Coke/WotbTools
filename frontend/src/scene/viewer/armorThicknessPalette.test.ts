import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  THICKNESS_EXTERNAL_OPACITY, THICKNESS_STOPS, THICKNESS_UNKNOWN_COLOR,
  thicknessDepthWrite, thicknessOutlineColor, thicknessSurfaceOpacity, thicknessToColor,
} from './armorThicknessPalette.js'
import { SCENE_RESULT_COLORS } from './shotResultPalette.js'

const HERE = dirname(fileURLToPath(import.meta.url))

function channels(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff]
}

describe('armorThicknessPalette 连续渐变', () => {
  it('锚点保持击穿语义色与同一组阈值', () => {
    expect(thicknessToColor(30)).toBe(SCENE_RESULT_COLORS.PENETRATION)
    expect(thicknessToColor(60)).toBe(SCENE_RESULT_COLORS.MAY_PENETRATE)
    expect(thicknessToColor(100)).toBe(SCENE_RESULT_COLORS.SPLASH)
    expect(thicknessToColor(200)).toBe(SCENE_RESULT_COLORS.BLOCKED)
    expect(thicknessToColor(320)).toBe(0xb8322a)
  })

  it('<30 维持标定绿平段；≥320 维持深红平段', () => {
    expect(thicknessToColor(0)).toBe(SCENE_RESULT_COLORS.PENETRATION)
    expect(thicknessToColor(29.9)).toBe(SCENE_RESULT_COLORS.PENETRATION)
    expect(thicknessToColor(1000)).toBe(0xb8322a)
  })

  it('相邻锚点之间线性插值（不再出现档位色块）', () => {
    // 45mm = 30/60 的中点 → 绿/黄各半。
    const mid = channels(thicknessToColor(45))
    const green = channels(SCENE_RESULT_COLORS.PENETRATION)
    const yellow = channels(SCENE_RESULT_COLORS.MAY_PENETRATE)
    expect(mid[0]).toBe(Math.round((green[0] + yellow[0]) / 2))
    expect(mid[1]).toBe(Math.round((green[1] + yellow[1]) / 2))
    // 150mm = 100/200 的中点 → 橙/红各半。
    const midHigh = channels(thicknessToColor(150))
    const orange = channels(SCENE_RESULT_COLORS.SPLASH)
    const red = channels(SCENE_RESULT_COLORS.BLOCKED)
    expect(midHigh[0]).toBe(Math.round((orange[0] + red[0]) / 2))
  })

  it('渐变 C0 连续：0.5mm 步进下每通道最大跳变有界（无档位跳变）', () => {
    let previous = channels(thicknessToColor(30))
    for (let t = 30.5; t <= 320; t += 0.5) {
      const current = channels(thicknessToColor(t))
      // 最陡段 30→60mm：绿→黄 R 通道 193/30 ≈ 6.4/mm，0.5mm 步进 ≤4。
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs(current[channel] - previous[channel]), `t=${t} ch=${channel}`)
          .toBeLessThanOrEqual(4)
      }
      previous = current
    }
  })

  it('绿→黄→橙→红单调过渡（G 通道随厚度单调下降）', () => {
    let previous = channels(thicknessToColor(30))[1]
    for (let t = 31; t <= 200; t += 1) {
      const green = channels(thicknessToColor(t))[1]
      expect(green, `t=${t}`).toBeLessThanOrEqual(previous)
      previous = green
    }
  })

  it('无厚度数据回中性灰，不当薄板绿', () => {
    expect(thicknessToColor(null)).toBe(THICKNESS_UNKNOWN_COLOR)
    expect(thicknessToColor(undefined)).toBe(THICKNESS_UNKNOWN_COLOR)
    expect(thicknessToColor(Number.NaN)).toBe(THICKNESS_UNKNOWN_COLOR)
    expect(thicknessToColor(Number.POSITIVE_INFINITY)).toBe(THICKNESS_UNKNOWN_COLOR)
  })

  it('锚点色互不相同，且覆盖四档击穿语义色', () => {
    const colors = THICKNESS_STOPS.map((stop) => stop.color)
    expect(new Set(colors).size).toBe(THICKNESS_STOPS.length)
    expect(colors).toContain(SCENE_RESULT_COLORS.PENETRATION)
    expect(colors).toContain(SCENE_RESULT_COLORS.MAY_PENETRATE)
    expect(colors).toContain(SCENE_RESULT_COLORS.SPLASH)
    expect(colors).toContain(SCENE_RESULT_COLORS.BLOCKED)
  })
})

describe('thicknessSurfaceOpacity', () => {
  it('primary 始终不透明', () => {
    expect(thicknessSurfaceOpacity('primary', 0)).toBe(1)
    expect(thicknessSurfaceOpacity('primary', 500)).toBe(1)
    expect(thicknessSurfaceOpacity('primary', null)).toBe(1)
  })

  it('spaced 按 200mm 归一的 BlitzKit clamp：0.5–1', () => {
    expect(thicknessSurfaceOpacity('spaced', 0)).toBe(0.5)
    expect(thicknessSurfaceOpacity('spaced', 20)).toBeCloseTo(0.6)
    expect(thicknessSurfaceOpacity('spaced', 100)).toBe(1)
    expect(thicknessSurfaceOpacity('spaced', 200)).toBe(1)
    expect(thicknessSurfaceOpacity('spaced', -10)).toBe(0.5)
    expect(thicknessSurfaceOpacity('spaced', Number.NaN)).toBe(0.5)
  })

  it('external 固定 1/8，且不写深度', () => {
    expect(thicknessSurfaceOpacity('external', 0)).toBe(THICKNESS_EXTERNAL_OPACITY)
    expect(thicknessSurfaceOpacity('external', 500)).toBe(THICKNESS_EXTERNAL_OPACITY)
    expect(thicknessDepthWrite('external')).toBe(false)
    expect(thicknessDepthWrite('primary')).toBe(true)
    expect(thicknessDepthWrite('spaced')).toBe(true)
  })
})

describe('thicknessOutlineColor', () => {
  it('primary/external 压暗一半', () => {
    expect(thicknessOutlineColor('primary', 0xffffff)).toBe(0x808080)
    expect(thicknessOutlineColor('external', 0x336699)).toBe(0x1a334d)
  })

  it('spaced 提亮四倍并按通道 clamp', () => {
    expect(thicknessOutlineColor('spaced', 0x336699)).toBe(0xccffff)
    expect(thicknessOutlineColor('spaced', 0x010101)).toBe(0x040404)
  })
})

describe('装甲查看器厚度模式的着色接线（source 契约）', () => {
  it('装甲查看器唯一的厚度着色来源 = 共享连续渐变调色板', () => {
    const tankArmor = readFileSync(resolve(HERE, '../tankViewer/tankArmor.ts'), 'utf8')
    expect(tankArmor).toContain("from '../viewer/armorThicknessPalette.js'")
    // 查看器不得自带第二套分档色表
    expect(tankArmor).not.toMatch(/0xb8322a|THICKNESS_BANDS/)
    const collisionView = readFileSync(resolve(HERE, 'collisionView.ts'), 'utf8')
    expect(collisionView).toContain('thicknessToColor')
    expect(collisionView).not.toMatch(/0xb8322a|THICKNESS_BANDS/)
    // 调色板本身：连续渐变（THICKNESS_STOPS），不再导出分档表，且保持纯函数（不依赖 three）
    const palette = readFileSync(resolve(HERE, 'armorThicknessPalette.ts'), 'utf8')
    expect(palette).toContain('THICKNESS_STOPS')
    expect(palette).not.toContain('THICKNESS_BANDS')
    expect(palette).not.toContain("from 'three'")
  })
})