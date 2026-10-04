// @vitest-environment node
/**
 * 地图派生不变量校验器的单测（2.1.0 Phase 11-Maps）。
 *
 * 校验器是 Android 地图派生链路的 fail-closed 闸门，它自己必须先被证明有牙：
 * 缺文件 / 多文件 / 被裁剪（尺寸≠期望）/ 宽高比漂移 / 超单张预算 / 超总量预算，
 * 每一类都必须被抓出来；合格的输入必须零错误。
 */
import { describe, expect, it } from 'vitest'
import {
  MAP_DERIVATIVE_BUDGETS,
  checkDerivativeInvariants,
  expectedDerivativeSize,
  webpDimensions,
} from './mapAssetInvariants.mjs'

/** 造一个带合法 VP8X 头的 WebP 缓冲区（只有头部有意义，足够尺寸解析）。 */
function webp(buf = Buffer.alloc(40), width = 2024, height = 2024) {
  buf.write('RIFF', 0, 'latin1')
  buf.writeUInt32LE(buf.length - 8, 4)
  buf.write('WEBP', 8, 'latin1')
  buf.write('VP8X', 12, 'latin1')
  buf.writeUInt32LE(10, 16)
  const w = width - 1
  const h = height - 1
  buf[24] = w & 0xff
  buf[25] = (w >> 8) & 0xff
  buf[26] = (w >> 16) & 0xff
  buf[27] = h & 0xff
  buf[28] = (h >> 8) & 0xff
  buf[29] = (h >> 16) & 0xff
  return buf
}

const derived = (name, { width = 1024, height = 1024, bytes = 200 * 1024 } = {}) => ({
  name, bytes, dimensions: { width, height },
})
const source = (name, { width = 2024, height = 2024, bytes = 1200 * 1024 } = {}) => ({
  name, bytes, dimensions: { width, height },
})

describe('webpDimensions', () => {
  it('解析 VP8X 尺寸；非 WebP / 太短一律 null（不猜）', () => {
    expect(webpDimensions(webp(Buffer.alloc(40), 2024, 2024))).toEqual({ width: 2024, height: 2024 })
    expect(webpDimensions(Buffer.from('not-a-webp-file-at-all-1234567890'))).toBe(null)
    expect(webpDimensions(Buffer.alloc(4))).toBe(null)
  })
})

describe('expectedDerivativeSize', () => {
  it('等比缩放到上限内；源小于上限时不放大', () => {
    expect(expectedDerivativeSize({ width: 2024, height: 2024 })).toEqual({ width: 1024, height: 1024 })
    // 非正方形：保持比例、最长边 = 上限
    expect(expectedDerivativeSize({ width: 2000, height: 1000 })).toEqual({ width: 1024, height: 512 })
    expect(expectedDerivativeSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 })
  })
})

describe('checkDerivativeInvariants（fail-closed 闸门）', () => {
  it('合格输入：零错误 + 汇总（总量 / 最大文件）', () => {
    const sources = [source('a.webp'), source('b.webp')]
    const derivatives = [derived('a.webp'), derived('b.webp')]
    const { errors, summary } = checkDerivativeInvariants({ sources, derivatives })
    expect(errors).toEqual([])
    expect(summary.files).toBe(2)
    expect(summary.totalBytes).toBe(400 * 1024)
    expect(summary.largest).toBe('a.webp')
  })

  it('缺文件 / 多文件都报错（集合必须逐字一致）', () => {
    const sources = [source('a.webp'), source('b.webp')]
    const missing = checkDerivativeInvariants({ sources, derivatives: [derived('a.webp')] })
    expect(missing.errors.join()).toContain('缺少 b.webp')
    const extra = checkDerivativeInvariants({ sources, derivatives: [derived('a.webp'), derived('b.webp'), derived('c.webp')] })
    expect(extra.errors.join()).toContain('多出 c.webp')
  })

  it('裁剪 / 非等比（尺寸 ≠ 期望）即失败——几何语义不得改变', () => {
    const sources = [source('a.webp')]
    const cropped = checkDerivativeInvariants({ sources, derivatives: [derived('a.webp', { width: 1024, height: 768 })] })
    expect(cropped.errors.join()).toContain('派生尺寸 1024x768 ≠ 期望 1024x1024')
    const upscaled = checkDerivativeInvariants({
      sources: [source('a.webp', { width: 800, height: 600 })],
      derivatives: [derived('a.webp', { width: 1024, height: 768 })],
    })
    expect(upscaled.errors.join()).toContain('≠ 期望 800x600')
  })

  it('单张 / 总量超预算即失败（不靠"看着差不多"）', () => {
    const sources = [source('a.webp'), source('b.webp')]
    const heavy = checkDerivativeInvariants({
      sources,
      derivatives: [derived('a.webp', { bytes: 600 * 1024 }), derived('b.webp')],
    })
    expect(heavy.errors.join()).toContain('超过单张预算 500 KiB')
    const bloated = checkDerivativeInvariants({
      sources,
      derivatives: [derived('a.webp', { bytes: 400 * 1024 }), derived('b.webp', { bytes: 400 * 1024 })],
      budgets: { ...MAP_DERIVATIVE_BUDGETS, totalBytes: 500 * 1024 },
    })
    expect(bloated.errors.join()).toContain('超过预算')
  })

  it('尺寸无法解析时显式报错（不静默放行）', () => {
    const { errors } = checkDerivativeInvariants({
      sources: [source('a.webp')],
      derivatives: [{ name: 'a.webp', bytes: 1024, dimensions: null }],
    })
    expect(errors.join()).toContain('无法解析 WebP 尺寸')
  })
})
