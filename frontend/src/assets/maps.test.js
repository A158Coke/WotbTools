// @vitest-environment node
/**
 * Canonical 2D 地图资产的完整性与映射一致性（2.1.0 Phase 11-Maps）。
 *
 * APK 的 2D 离线底图 = `src/assets/maps/*.webp` 原图（**与 Web 同字节，Android 不再派生缩小副本**）。
 * 这里在 frontend CI 守住两件事：
 *  1. **映射完整**：`data/mapImages.js` 引用的每张图都存在、且没有孤儿文件——漏一张 =
 *     某张地图在 2D 回放里空白，而 CI 完全看不到；
 *  2. **几何规格统一**：canonical 全部为 1254×1254 方形——2D 渲染契约（等比、不裁剪、
 *     坐标线性映射）以这份为准，源本身参差会让地图坐标语义失效。
 *
 * 随包字节的真实性由 `scripts/build-android-bundle.mjs` 的 `buildMap2dEmbedded` 逐条核对
 * （注册表每张地图都必须有随包资源，缺一即构建失败；同时产出运行时 OTA 判据用的 sha256 清单）。
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(here, '..', '..')
const MAPS_DIR = join(FRONTEND, 'src/assets/maps')
const MAP_IMAGES = join(FRONTEND, 'src/data/mapImages.js')

const files = readdirSync(MAPS_DIR).filter((name) => name.toLowerCase().endsWith('.webp')).sort()
const referenced = [...readFileSync(MAP_IMAGES, 'utf8').matchAll(/assets\/maps\/([^'"]+\.webp)/g)]
  .map((match) => match[1]).sort()

/** WebP 头部尺寸解析（VP8X / VP8 / VP8L）；无法识别返回 null。无需图像库。 */
function webpDimensions(buffer) {
  if (!buffer || buffer.length < 30) return null
  if (buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WEBP') return null
  const kind = buffer.toString('latin1', 12, 16)
  if (kind === 'VP8X') {
    return {
      width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
      height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
    }
  }
  if (kind === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  }
  if (kind === 'VP8L') {
    const bits = buffer.readUInt32LE(21)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
  }
  return null
}

describe('canonical 2D 地图资产', () => {
  it('mapImages.js 引用的每张图都存在，且没有孤儿文件', () => {
    expect(files.length).toBeGreaterThan(0)
    expect(files).toEqual(referenced)
  })

  it('全部为 1254×1254 方形（2D 渲染契约以源为基准）', () => {
    const offSpec = []
    for (const name of files) {
      const dims = webpDimensions(readFileSync(join(MAPS_DIR, name)))
      if (!dims || dims.width !== 1254 || dims.height !== 1254) offSpec.push(`${name}: ${JSON.stringify(dims)}`)
    }
    expect(offSpec, 'canonical 地图必须统一 1254×1254；源规格漂移会让地图坐标语义失效').toEqual([])
  })

  it('canonical 体积与文档记载一致（随包体积 = 站点体积）', () => {
    const total = files.reduce((sum, name) => sum + statSync(join(MAPS_DIR, name)).size, 0)
    // 记载于 docs/android/architecture.md：29 张 ≈ 21.5 MiB（pack ground.webp 派生的 WebP q90）。
    // 这份字节 Web 与 APK 共用，因此这里锁的是**随包/站点体积上限**。
    expect(files.length).toBe(29)
    expect(total).toBeLessThan(40 * 1024 * 1024)
  })

  it('map2d-source.json 与 29 张 canonical 字节**逐条绑定**（换图必须同步交接件）', () => {
    // 交接件（Agent 仓 tools/export_2d_basemaps.py 产出）同时承载运行时的 contentGeneratedAt 与
    // 它所属图集的字节绑定。这里用**仓库里的真实字节**重算并比对——不改图就永远成立；一旦有人
    // 换了某张 webp 却没重跑导出，这条立刻失败（否则旧时间戳配新图会让运行时可能 OTA 降级）。
    const text = readFileSync(MAP_IMAGES, 'utf8')
    const imports = new Map([...text.matchAll(/import\s+(\w+)\s+from\s+'\.\.\/assets\/maps\/([^']+)'/g)]
      .map((match) => [match[1], match[2]]))
    const pairs = [...text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*\{\s*src:\s*(\w+),/gm)]
    const source = JSON.parse(readFileSync(join(MAPS_DIR, 'map2d-source.json'), 'utf8'))
    expect(source.schemaVersion).toBe(2)
    expect(Number.isFinite(Date.parse(source.contentGeneratedAt))).toBe(true)

    const bound = source.maps || {}
    const expectCodes = pairs.map(([, code]) => code).sort()
    expect(Object.keys(bound).sort()).toEqual(expectCodes)

    const hashes = {}
    for (const [, code, variable] of pairs) {
      const file = imports.get(variable)
      const entry = bound[code]
      expect(entry, `${code} 缺绑定`).toBeTruthy()
      expect(entry.file, `${code} 交接件文件名与注册表不符`).toBe(file)
      const digest = createHash('sha256').update(readFileSync(join(MAPS_DIR, file))).digest('hex')
      expect(entry.sha256, `${code} 交接件 sha256 与 canonical 字节不符——换图后须重跑 Agent 仓导出`).toBe(digest)
      hashes[code] = digest
    }
    // mapsDigest：与 Agent 仓/构建脚本同式（排序后的 `code<TAB>sha256` 行做 sha256）。
    const lines = Object.keys(hashes).sort().map((code) => `${code}\t${hashes[code]}`).join('\n')
    expect(source.mapsDigest).toBe(createHash('sha256').update(lines, 'utf8').digest('hex'))
  })
})
