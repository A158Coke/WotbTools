import { describe, it, expect } from 'vitest'
import {
  TERRAIN_LAYOUT_ENGINE_VERTEX, decodeTerrainField, pairedTerrainBinUrl, terrainBinMatchesMeta,
  terrainFieldMetaValid, terrainBoundsOk,
} from './terrainMesh.js'
import { createHash } from 'node:crypto'

describe('decodeTerrainField（高度场 = 场景系引擎顶点口径）', () => {
  const n = 8
  const raw = Array.from({ length: n * n }, (_, i) => 100 + i)
  const pack = (pick) => {
    const out = new Uint16Array(n * n)
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[r * n + c] = raw[r * n + pick(c)]
    return out.buffer
  }
  const legacyPack = () => pack((c) => n - 1 - c)
  const enginePack = () => pack((c) => Math.min(n - c, n - 1))
  const meta = (extra = {}) => ({ size: n, zmin: 0, zmax: 65535, terrainLayout: 1, ...extra })
  const engineAt = (r, j) => raw[r * n + Math.min(n - j, n - 1)]

  it('两种布局解出同一张场景系引擎顶点高度场（旧包在读取边界平移一列）', () => {
    const legacy = decodeTerrainField(legacyPack(), meta())
    const engine = decodeTerrainField(enginePack(), meta({ terrainLayout: TERRAIN_LAYOUT_ENGINE_VERTEX }))
    for (let r = 0; r < n; r++) {
      for (let j = 0; j < n; j++) {
        expect(engine[r * n + j]).toBe(engineAt(r, j))
        expect(legacy[r * n + j]).toBe(engineAt(r, j))
      }
    }
  })

  it('行方向不动：只有列（镜像轴）补正', () => {
    const legacy = decodeTerrainField(legacyPack(), meta())
    const src = new Uint16Array(legacyPack())
    for (let r = 0; r < n; r++) {
      expect(legacy[r * n]).toBe(src[r * n])
      for (let j = 1; j < n; j++) expect(legacy[r * n + j]).toBe(src[r * n + j - 1])
    }
  })

  it('米制换算：zmin + u16·(zmax − zmin)/65535', () => {
    const buf = new Uint16Array(n * n).fill(65535).buffer
    const f = decodeTerrainField(buf, { size: n, zmin: 20, zmax: 100, terrainLayout: 2 })
    expect(f[0]).toBeCloseTo(100)
    const z = decodeTerrainField(new Uint16Array(n * n).buffer,
                                 { size: n, zmin: 20, zmax: 100, terrainLayout: 1 })
    expect(z[n * n - 1]).toBeCloseTo(20)
  })

  it('fail-closed：尺寸不符 / 未知布局 / 缺 layout 或高度范围 ⇒ null', () => {
    expect(decodeTerrainField(new Uint16Array(n * n - 1).buffer, meta())).toBeNull()
    expect(decodeTerrainField(null, meta())).toBeNull()
    expect(decodeTerrainField(enginePack(), meta({ terrainLayout: 3 }))).toBeNull()
    expect(decodeTerrainField(enginePack(), meta({ terrainLayout: '2' }))).toBeNull()
    expect(decodeTerrainField(enginePack(), { size: n, zmin: 0, zmax: 65535 })).toBeNull()
    expect(decodeTerrainField(enginePack(), { size: n, zmax: 65535, terrainLayout: 2 })).toBeNull()
    expect(decodeTerrainField(enginePack(), { size: n, zmin: 0, terrainLayout: 2 })).toBeNull()
    expect(terrainFieldMetaValid(meta())).toBe(true)
    expect(terrainFieldMetaValid({ size: n, zmin: 0, zmax: 65535 })).toBe(false)
    expect(terrainFieldMetaValid({ size: n, zmin: 10, zmax: 9, terrainLayout: 2 })).toBe(false)
    expect(terrainFieldMetaValid({ size: n, zmin: 10, zmax: 10, terrainLayout: 2 })).toBe(true)
    for (const bad of [null, '', false]) {
      expect(terrainFieldMetaValid({ size: n, zmin: bad, zmax: 100, terrainLayout: 2 })).toBe(false)
      expect(terrainFieldMetaValid({ size: n, zmin: 0, zmax: bad, terrainLayout: 2 })).toBe(false)
    }
    expect(terrainFieldMetaValid({ size: 1, zmin: 0, zmax: 1, terrainLayout: 2 })).toBe(false)
    expect(decodeTerrainField(new Uint16Array([0]).buffer, { size: 1, zmin: 0, zmax: 1, terrainLayout: 2 })).toBeNull()
  })

  it('worldBounds 契约：只接受居中正方形（当前消费口径）', () => {
    expect(terrainBoundsOk({ worldBounds: { min: [-300, -300, 0], max: [300, 300, 70] } })).toBe(true)
    expect(terrainBoundsOk({ worldBounds: { min: [-300, -290, 0], max: [300, 310, 70] } })).toBe(false)
    expect(terrainBoundsOk({ worldBounds: { min: [-200, -300, 0], max: [400, 300, 70] } })).toBe(false)
    expect(terrainBoundsOk({ worldBounds: { min: [null, -300, 0], max: [300, 300, 70] } })).toBe(false)
    expect(terrainBoundsOk({ worldBounds: { min: ['-300', '-300', 0], max: ['300', '300', 70] } })).toBe(false)
    expect(terrainBoundsOk({})).toBe(true)
  })
})

describe('terrain json/bin 配对（terrainBinSha256）', () => {
  const bytes = new Uint16Array([1, 2, 3, 4]).buffer
  const sha = createHash('sha256').update(Buffer.from(bytes)).digest('hex')

  it('bin URL 以 sha 作缓存键；无合法 sha（旧包）原样返回', () => {
    expect(pairedTerrainBinUrl('/map/plant/terrain.u16.bin', { terrainBinSha256: sha }))
      .toBe(`/map/plant/terrain.u16.bin?sha256=${sha}`)
    expect(pairedTerrainBinUrl('/x.bin?a=1', { terrainBinSha256: sha })).toBe(`/x.bin?a=1&sha256=${sha}`)
    expect(pairedTerrainBinUrl('/x.bin', {})).toBe('/x.bin')
    expect(pairedTerrainBinUrl('/x.bin', { terrainBinSha256: 'not-a-sha' })).toBe('/x.bin')
    expect(pairedTerrainBinUrl('/x.bin', { terrainBinSha256: sha.toUpperCase() })).toBe('/x.bin')
  })

  it('字节与声明 sha 一致才算配对；不一致 ⇒ false（调用方 fail-closed 回退 2D）', async () => {
    expect(await terrainBinMatchesMeta(bytes, { terrainBinSha256: sha })).toBe(true)
    const other = new Uint16Array([1, 2, 3, 5]).buffer
    expect(await terrainBinMatchesMeta(other, { terrainBinSha256: sha })).toBe(false)
  })

  it('旧包无 sha ⇒ true；有 sha 但环境无 WebCrypto ⇒ false（不能假装配对成功）', async () => {
    expect(await terrainBinMatchesMeta(bytes, {})).toBe(true)
    expect(await terrainBinMatchesMeta(bytes, { terrainBinSha256: sha }, null)).toBe(false)
  })
})
