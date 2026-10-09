// @vitest-environment node
/**
 * Canonical 2D 地图资产的完整性与映射一致性（2.1.0 Phase 11-Maps）。
 *
 * APK 的 2D 离线底图 = `src/assets/maps/*.webp`（Android 构建期派生缩小版）。这里在
 * frontend CI（无需 Pillow）守住两件事：
 *  1. **映射完整**：`data/mapImages.js` 引用的每张图都存在、且没有孤儿文件——漏一张 =
 *     某张地图在 2D 回放里空白，而 CI 完全看不到；
 *  2. **几何规格统一**：canonical 全部为 1254×1254 方形（派生管线的"等比 + 不裁剪"
 *     不变量以源为基准；源本身参差会让期望尺寸计算失去意义）。
 *
 * 派生后的尺寸/预算不变量由 `scripts/lib/mapAssetInvariants.mjs` 在构建期校验
 * （真编码器输出，见 scripts/build-android-map-assets.mjs）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { webpDimensions } from '../../scripts/lib/mapAssetInvariants.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(here, '..', '..')
const MAPS_DIR = join(FRONTEND, 'src/assets/maps')
const MAP_IMAGES = join(FRONTEND, 'src/data/mapImages.js')

const files = readdirSync(MAPS_DIR).filter((name) => name.toLowerCase().endsWith('.webp')).sort()
const referenced = [...readFileSync(MAP_IMAGES, 'utf8').matchAll(/assets\/maps\/([^'"]+\.webp)/g)]
  .map((match) => match[1]).sort()

describe('canonical 2D 地图资产', () => {
  it('mapImages.js 引用的每张图都存在，且没有孤儿文件', () => {
    expect(files.length).toBeGreaterThan(0)
    expect(files).toEqual(referenced)
  })

  it('全部为 1254×1254 方形（派生管线的不变量以源为基准）', () => {
    const offSpec = []
    for (const name of files) {
      const dims = webpDimensions(readFileSync(join(MAPS_DIR, name)))
      if (!dims || dims.width !== 1254 || dims.height !== 1254) offSpec.push(`${name}: ${JSON.stringify(dims)}`)
    }
    expect(offSpec, 'canonical 地图必须统一 1254×1254；源规格漂移会让派生期望尺寸失去意义').toEqual([])
  })

  it('canonical 体积与文档记载一致（Android 派生的收益基线）', () => {
    const total = files.reduce((sum, name) => sum + statSync(join(MAPS_DIR, name)).size, 0)
    // 记载于 docs/android/architecture.md：29 张 ≈ 18.3 MiB（AI 增强 WebP q90）；这里锁数量与量级，
    // 防止有人把大图直接塞进 canonical（没走派生管线）。
    expect(files.length).toBe(29)
    expect(total).toBeLessThan(40 * 1024 * 1024)
  })
})
