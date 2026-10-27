/**
 * 交互射界图的几何层 golden：径向映射（BI 11.21 Gun arcs 锚点）、方位角换算、
 * 射界钳制、带路径轮廓与装备加成。数值语义由 tankSetup.pitchAtBearing 提供。
 */
import { describe, expect, it } from 'vitest'
import {
  arcBearingRange,
  bearingFromPoint,
  clampBearing,
  gunArcBandPath,
  gunArcSamples,
  pitchForRadius,
  radiusForPitch,
} from './gunArc'

describe('radiusForPitch / pitchForRadius（BI 锚点内外翻转）', () => {
  it('俯角向内、仰角向外，锚点取 BI 半径镜像', () => {
    expect(radiusForPitch(0)).toBeCloseTo(0.5, 4)
    // 外圈 = 仰角（BI 原半径的镜像）
    expect(radiusForPitch(10)).toBeCloseTo(0.7126, 4)
    expect(radiusForPitch(18)).toBeCloseTo(0.8295, 4)
    expect(radiusForPitch(26)).toBeCloseTo(0.8964, 4)
    // 内圈 = 俯角
    expect(radiusForPitch(-3)).toBeCloseTo(0.4315, 4)
    expect(radiusForPitch(-6)).toBeCloseTo(0.366, 4)
    expect(radiusForPitch(-8)).toBeCloseTo(0.3252, 4)
    expect(radiusForPitch(10)).toBeGreaterThan(0.5)
    expect(radiusForPitch(-10)).toBeLessThan(0.5)
  })

  it('反解与正映射互逆（超出锚点范围钳到端点）', () => {
    for (const pitch of [-20, -10, -6, -3, 0, 10, 18, 26, 45]) {
      expect(pitchForRadius(radiusForPitch(pitch))).toBeCloseTo(pitch, 1)
    }
    expect(pitchForRadius(0)).toBe(-22) // 圆心 = 最大俯角
    expect(pitchForRadius(1)).toBe(60) // 外沿 = 最大仰角
  })
})

describe('方位角换算与射界钳制', () => {
  it('0° 车头、90° 右舷、180° 车尾、−90° 左舷', () => {
    expect(bearingFromPoint(0, -1)).toBeCloseTo(0, 6)
    expect(bearingFromPoint(1, 0)).toBeCloseTo(90, 6)
    expect(bearingFromPoint(0, 1)).toBeCloseTo(180, 6)
    expect(bearingFromPoint(-1, 0)).toBeCloseTo(-90, 6)
  })

  it('全向炮塔不钳制；有限射界钳到 [-max, -min]', () => {
    expect(arcBearingRange(null)).toEqual({ lo: -180, hi: 180, full: true })
    expect(arcBearingRange({ min: -15, max: 15 })).toEqual({ lo: -15, hi: 15, full: false })
    expect(clampBearing(180, { min: -15, max: 15 })).toBe(15)
    expect(clampBearing(-180, { min: -15, max: 15 })).toBe(-15)
    expect(clampBearing(120, null)).toBe(120)
  })
})

describe('gunArcSamples / gunArcBandPath', () => {
  const pitch = { max: 6, min: -18, back: { max: 3, min: -18, range: 30 } }

  it('有限射界：包含两端点，值随方位变化', () => {
    const samples = gunArcSamples(pitch, { min: -15, max: 15 }, null, 5)
    expect(samples[0].bearing).toBe(-15)
    expect(samples[samples.length - 1].bearing).toBe(15)
    expect(samples[0]).toMatchObject({ up: 18, down: -6 })
    expect(samples.every(sample => sample.down >= -6)).toBe(true)
  })

  it('全向炮塔：阴影带为两条闭合轮廓（evenodd 环形）', () => {
    const path = gunArcBandPath(pitch, null)
    expect(path.startsWith('M ')).toBe(true)
    expect(path.match(/M /g)).toHaveLength(2)
    expect(path.match(/Z/g)).toHaveLength(2)
  })

  it('有限射界：单条带端盖的闭合多边形', () => {
    const path = gunArcBandPath(pitch, { min: -15, max: 15 })
    expect(path.match(/M /g)).toHaveLength(1)
    expect(path.endsWith(' Z')).toBe(true)
  })

  it('装备加成进入采样（+4 仰角 / +3 俯角）', () => {
    const samples = gunArcSamples(pitch, null, { up: 4, down: 3 }, 90)
    const bow = samples.find(sample => sample.bearing === 0)
    expect(bow).toMatchObject({ up: 22, down: -9 })
  })
})
