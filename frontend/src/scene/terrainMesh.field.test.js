import { describe, it, expect } from 'vitest'
import {
  TERRAIN_LAYOUT_ENGINE_VERTEX, decodeTerrainField, pairedTerrainBinUrl, terrainBinMatchesMeta,
  terrainFieldMetaValid, terrainBoundsOk,
} from './terrainMesh.js'
import { createHash } from 'node:crypto'

// 高度场列口径（2026-10-13 用户"wotbtools 墙前有土包、游戏里没有"）：引擎顶点 k 在 `k/size`、取 texel k
// （`Heightmap::GetPoint` / `tilemask-vp.sl`，corner 口径）；场景 x = −游戏 x 的镜像若按 `size−1−c`
// 离散翻转列，翻转后第 c 列的真实位置是 `((c+1)/n − 0.5)·span` ⇒ 整张地形沿场景 −x 偏一格。
// 实测（6 张图）：编辑器贴地实例的原点高度与地形逐毫米吻合的数量只在"列偏一格"时成峰
// （plant 9→177、karelia 5→157、italy 0→301），行方向无偏。
describe('decodeTerrainField（高度场 = 场景系引擎顶点口径）', () => {
  const n = 8
  /** 引擎原始高度图（游戏朝向：列 = 游戏 x 从 min 起，行 = 游戏 y），值互不相同便于定位 */
  const raw = Array.from({ length: n * n }, (_, i) => 100 + i)
  const pack = (pick) => {
    const out = new Uint16Array(n * n)
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[r * n + c] = raw[r * n + pick(c)]
    return out.buffer
  }
  const legacyPack = () => pack((c) => n - 1 - c)                        // 旧打包器：离散翻转
  const enginePack = () => pack((c) => Math.min(n - c, n - 1))           // terrainLayout 2：corner 口径镜像
  // layout 必须显式：缺省 layout 不再按 1 猜（旧包 terrainLayout 缺失 ⇒ fail-closed 2D）
  const meta = (extra = {}) => ({ size: n, zmin: 0, zmax: 65535, terrainLayout: 1, ...extra })
  /** 场景顶点 j（x_j = (j/n − 0.5)·span）处的引擎真值：游戏 x = −x_j ⇒ 源列 n−j（GetHeightClamp 夹到 n−1） */
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
      expect(legacy[r * n]).toBe(src[r * n])                   // 第 0 列 = 场景 −x 边界，夹取自身
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
    // terrain.json 缺失/缺字段时不得按缺省 layout 1 + zmax 100 解码（会差一列且高度缩放错）
    expect(decodeTerrainField(enginePack(), { size: n, zmin: 0, zmax: 65535 })).toBeNull()
    expect(decodeTerrainField(enginePack(), { size: n, zmax: 65535, terrainLayout: 2 })).toBeNull()
    expect(decodeTerrainField(enginePack(), { size: n, zmin: 0, terrainLayout: 2 })).toBeNull()
    expect(terrainFieldMetaValid(meta())).toBe(true)
    expect(terrainFieldMetaValid({ size: n, zmin: 0, zmax: 65535 })).toBe(false)
    expect(terrainFieldMetaValid({ size: n, zmin: 10, zmax: 9, terrainLayout: 2 })).toBe(false)
    expect(terrainFieldMetaValid({ size: n, zmin: 10, zmax: 10, terrainLayout: 2 })).toBe(true)
    // null / '' / false 不得被 Number() 强转成 0 后当作合法高度范围
    for (const bad of [null, '', false]) {
      expect(terrainFieldMetaValid({ size: n, zmin: bad, zmax: 100, terrainLayout: 2 })).toBe(false)
      expect(terrainFieldMetaValid({ size: n, zmin: 0, zmax: bad, terrainLayout: 2 })).toBe(false)
    }
    // 单点高度场（size=1）会让 buildAdaptiveTerrain 抛错并同时失去地形/底图，提前拒绝
    expect(terrainFieldMetaValid({ size: 1, zmin: 0, zmax: 1, terrainLayout: 2 })).toBe(false)
    expect(decodeTerrainField(new Uint16Array([0]).buffer, { size: 1, zmin: 0, zmax: 1, terrainLayout: 2 })).toBeNull()
  })

  it('worldBounds 契约：只接受居中正方形（当前消费口径）', () => {
    expect(terrainBoundsOk({ worldBounds: { min: [-300, -300, 0], max: [300, 300, 70] } })).toBe(true)
    expect(terrainBoundsOk({ worldBounds: { min: [-300, -290, 0], max: [300, 310, 70] } })).toBe(false)
    expect(terrainBoundsOk({ worldBounds: { min: [-200, -300, 0], max: [400, 300, 70] } })).toBe(false)
    expect(terrainBoundsOk({ worldBounds: { min: [null, -300, 0], max: [300, 300, 70] } })).toBe(false)
    expect(terrainBoundsOk({ worldBounds: { min: ['-300', '-300', 0], max: ['300', '300', 70] } })).toBe(false)
    expect(terrainBoundsOk({})).toBe(true)   // 旧包无 bounds：由 span 校验兜底
  })
})

// json/bin 配对（PR #615 review P2）：terrain.json（no-cache）与 bin（max-age=3600）独立请求，发布切换期
// "新 json + 缓存旧 bin" 会跳过补正、"旧 json + 新 bin" 会再平移一列（实测 plant 250019/262144 个高度不同、
// 最大差 5.6 m）。上游 terrain.json 带 terrainBinSha256 作配对锚点。
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
