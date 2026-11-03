// deriveLiteCore 单测（#857 Step 3）：合成 fixture GLB 驱动分类/重写/重建/验证全链。
// 锁定的 invariant：剔除分类只走 exporter 语义标记；retained 几何字节恒等；无纹理载荷；
// extras/变体元数据保真；verifier 对篡改（几何/变换/extras/载荷）fail-closed。
import { describe, expect, it, vi } from 'vitest'
import * as deriveCore from './deriveLiteCore.mjs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveMap } from '../derive-scenery-lite.mjs'
import { runInNewContext } from 'node:vm'
import { buildGlb, deriveSceneryLite, isLiteDropNode, parseGlb, verifyLite } from './deriveLiteCore.mjs'

// ---- fixture GLB：单 buffer，内嵌伪纹理；覆盖全部语义类别 ----
function accessorJson(viewIdx, count, type, componentType = 5126) {
  return { bufferView: viewIdx, componentType, count, type, max: undefined, min: undefined }
}

function buildFixture() {
  // BIN 布局：[pos0][idx0][pos1][idx1][image0]
  const pos0 = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const idx0 = new Uint16Array([0, 1, 2])
  const pos1 = new Float32Array([5, 5, 5, 6, 5, 5, 5, 6, 0])
  const idx1 = new Uint16Array([0, 2, 1])
  const image0 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])   // 伪 JPEG 魔数
  const parts = [
    { bytes: new Uint8Array(pos0.buffer), align: 4 },
    { bytes: new Uint8Array(idx0.buffer), align: 4 },
    { bytes: new Uint8Array(pos1.buffer), align: 4 },
    { bytes: new Uint8Array(idx1.buffer), align: 4 },
    { bytes: image0, align: 4 },
  ]
  const bufferViews = []
  const accessors = []
  let off = 0
  for (const p of parts) {
    off = (off + p.align - 1) & ~(p.align - 1)
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: p.bytes.length })
    off += p.bytes.length
  }
  accessors.push(accessorJson(0, 3, 'VEC3'))           // 0: pos bridge
  accessors.push(accessorJson(1, 3, 'SCALAR', 5123))   // 1: idx bridge
  accessors.push(accessorJson(2, 3, 'VEC3'))           // 2: pos other
  accessors.push(accessorJson(3, 3, 'SCALAR', 5123))   // 3: idx other
  const bin = new Uint8Array(off)
  let o = 0
  for (const p of parts) {
    o = (o + p.align - 1) & ~(p.align - 1)
    bin.set(p.bytes, o)
    o += p.bytes.length
  }
  const meshFor = (posAcc, idxAcc, matIdx, extraAttrs = {}) => ({
    primitives: [{ attributes: { POSITION: posAcc, ...extraAttrs }, indices: idxAcc, material: matIdx, mode: 4 }],
  })
  const json = {
    asset: { version: '2.0', generator: 'export_map_glb.py test' },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2, 3, 4, 5, 6], extras: { variantByMapId: { 7: 'md2' }, variantMappingIncomplete: false } }],
    nodes: [
      { name: 'StoneBridgePart1', mesh: 0, rotation: [0, 0, 0, 1], translation: [1, 2, 3], extras: { mdVariant: 'md2' } },
      { name: 'ST|branches_0', mesh: 1 },
      { name: 'GrassCard', mesh: 2 },
      { name: 'SkyDome', mesh: 3 },
      { name: 'SmokeFx', mesh: 4 },
      { name: 'RockBig', mesh: 5, translation: [9, 9, 9] },
      { name: 'md2', children: [7] },
      { name: 'HouseVariantB', mesh: 6, extras: { mdVariant: 'md2' } },
    ],
    meshes: [
      { ...meshFor(0, 1, 0), name: 'bridge_mesh' },                    // 0: 桥（decal 材质）
      { ...meshFor(2, 3, 1), name: 'st_foliage' },                     // 1: SpeedTree
      { primitives: [{ attributes: { POSITION: 0, _CORNER: 4 }, indices: 1, material: 2, mode: 4 }], name: 'card' }, // 2: billboard
      { ...meshFor(2, 3, 3), name: 'sky' },                            // 3: 天空穹
      { ...meshFor(2, 3, 4), name: 'fx' },                             // 4: 效果卡片
      { ...meshFor(2, 3, 5), name: 'rock' },                           // 5: 结构岩石
      { ...meshFor(2, 3, 6), name: 'house' },                          // 6: 变体建筑
    ],
    materials: [
      { name: 'Decal.material', alphaMode: 'MASK', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 1] }, extras: { decal: true, decalLmAdjust: [0.1, 0.2], decalTexture: 0 } },
      { name: 'ST|bark', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { name: 'card_mat', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { name: 'sky_mat', pbrMetallicRoughness: {}, extras: { sky: true } },
      { name: 'smoke_mat', pbrMetallicRoughness: {}, extras: { blendLayer: true, maskTexture: 0 } },
      { name: 'rock_mat', pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, extras: { occMean: 0.8, lightmap: 0 } },
      { name: 'house_mat', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.4, 0.3, 1] } },
    ],
    images: [{ bufferView: 4, mimeType: 'image/jpeg' }],
    textures: [{ source: 0 }],
    samplers: [{}],
    bufferViews,
    accessors,
    buffers: [{ byteLength: bin.length }],
  }
  return { json, bin }
}

const MEAN = [0.25, 0.5, 0.75, 1]
const colorOf = async () => MEAN

describe('deriveLiteCore：scenery-lite 派生（#857 Step 3）', () => {
  it('分类只走语义标记：桥/岩石/变体建筑保留，SpeedTree/卡片/天空/效果剔除', async () => {
    const { json } = buildFixture()
    expect(isLiteDropNode(json.nodes[0], json)).toBe(false)   // 桥（decal）
    expect(isLiteDropNode(json.nodes[1], json)).toBe(true)    // ST| 节点名
    expect(isLiteDropNode(json.nodes[2], json)).toBe(true)    // _CORNER 卡片
    expect(isLiteDropNode(json.nodes[3], json)).toBe(true)    // extras.sky
    expect(isLiteDropNode(json.nodes[4], json)).toBe(true)    // extras.blendLayer
    expect(isLiteDropNode(json.nodes[5], json)).toBe(false)   // 岩石
    expect(isLiteDropNode(json.nodes[7], json)).toBe(false)   // 变体建筑
  })

  it('派生：retained 几何字节恒等、无纹理载荷、decal/变体 extras 保真、均值色注入', async () => {
    const { json, bin } = buildFixture()
    const lite = await deriveSceneryLite(json, bin, { colorOf, key: 'fixture' })
    // 场景图可达节点（nodes 数组保留下标稳定，孤儿项不进场景图）
    const walk = function* (idx) {
      yield lite.json.nodes[idx].name || `#${idx}`
      for (const c of lite.json.nodes[idx].children || []) yield* walk(c)
    }
    const sceneNames = lite.json.scenes[0].nodes.flatMap((r) => [...walk(r)])
    expect(sceneNames).toContain('StoneBridgePart1')
    expect(sceneNames).toContain('RockBig')
    expect(sceneNames).toContain('md2')
    expect(sceneNames).toContain('HouseVariantB')
    expect(sceneNames).not.toContain('ST|branches_0')
    expect(sceneNames).not.toContain('GrassCard')
    expect(sceneNames).not.toContain('SkyDome')
    expect(sceneNames).not.toContain('SmokeFx')
    // 桥的变换与 extras 原样
    const bridge = lite.json.nodes.find((n) => n.name === 'StoneBridgePart1')
    expect(bridge.translation).toEqual([1, 2, 3])
    expect(bridge.extras).toEqual({ mdVariant: 'md2' })
    // 材质：decal 语义保留、texture-index extras 摘除、均值色写入、alphaMode 保留
    const decal = lite.json.materials.find((m) => m.name === 'Decal.material')
    expect(decal.extras.decal).toBe(true)
    expect(decal.extras.decalLmAdjust).toEqual([0.1, 0.2])
    expect(decal.extras.decalTexture).toBeUndefined()
    expect(decal.alphaMode).toBe('MASK')
    expect(decal.pbrMetallicRoughness.baseColorFactor).toEqual(MEAN)
    const rock = lite.json.materials.find((m) => m.name === 'rock_mat')
    expect(rock.extras.occMean).toBe(0.8)
    expect(rock.extras.lightmap).toBeUndefined()
    expect(rock.pbrMetallicRoughness.baseColorFactor).toEqual(MEAN)
    const house = lite.json.materials.find((m) => m.name === 'house_mat')
    expect(house.pbrMetallicRoughness.baseColorFactor).toEqual([0.5, 0.4, 0.3, 1])   // 无贴图 ⇒ 原因子
    // 禁止载荷
    expect(lite.json.images).toBeUndefined()
    expect(lite.json.textures).toBeUndefined()
    expect(lite.json.samplers).toBeUndefined()
    // 场景级变体 extras 原样
    expect(lite.json.scenes[0].extras).toEqual({ variantByMapId: { 7: 'md2' }, variantMappingIncomplete: false })
    // GLB roundtrip + 字节瘦身（纹理 bufferView 不再进 buffer）
    const round = parseGlb(buildGlb(lite.json, lite.bin).buffer)
    expect(round.json.materials).toHaveLength(3)
    expect(round.bin.length).toBeLessThan(bin.length)
    // 报告字段（§15）
    expect(lite.report).toMatchObject({ fullMeshes: 7, liteMeshes: 3, fullMaterials: 7, liteMaterials: 3 })
    expect(lite.report.fullTriangles).toBeGreaterThan(lite.report.liteTriangles)
    expect(lite.report.droppedNodes).toBe(4)
  })

  it('verifier：派生输出全绿（exact geometry equality）', async () => {
    const { json, bin } = buildFixture()
    const lite = await deriveSceneryLite(json, bin, { colorOf })
    const v = verifyLite(json, bin, lite.json, lite.bin)
    expect(v.problems).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.report.structuralNodes).toBe(3)
    expect(v.report.geometryHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verifier fail-closed：几何字节/变换/extras/载荷 任一篡改都被抓出', async () => {
    const { json, bin } = buildFixture()
    const lite = await deriveSceneryLite(json, bin, { colorOf })

    const geoTampered = new Uint8Array(lite.bin)
    // 找 bridge POSITION 第一个 float（bufferView 0 = 新 bin 开头，4 字节对齐后即首字节）
    geoTampered[0] ^= 0xff
    expect(verifyLite(json, bin, lite.json, geoTampered).ok).toBe(false)

    const trTampered = JSON.parse(JSON.stringify(lite.json))
    trTampered.nodes.find((n) => n.name === 'RockBig').translation = [0, 0, 0]
    expect(verifyLite(json, bin, trTampered, lite.bin).ok).toBe(false)

    const exTampered = JSON.parse(JSON.stringify(lite.json))
    delete exTampered.nodes.find((n) => n.name === 'StoneBridgePart1').extras
    expect(verifyLite(json, bin, exTampered, lite.bin).ok).toBe(false)

    const loadTampered = JSON.parse(JSON.stringify(lite.json))
    loadTampered.images = [{ bufferView: 0, mimeType: 'image/png' }]
    expect(verifyLite(json, bin, loadTampered, lite.bin).ok).toBe(false)

    const varTampered = JSON.parse(JSON.stringify(lite.json))
    varTampered.scenes[0].extras.variantByMapId = {}
    expect(verifyLite(json, bin, varTampered, lite.bin).ok).toBe(false)
  })

  it('MASK instrumentation：全部 retained MASK 材质入 alphaMaskMaterials（含 cutoff coverage），低均值入 risks', async () => {
    const { json, bin } = buildFixture()
    // decal 材质 alphaMode=MASK：均值色 alpha 0.2 < cutoff 0.6 ⇒ risks 命中；
    // histogram 提供 coverageAboveCutoff（bin 中心 ≥ 0.6 ⇒ 后 20% bin，占比 0.3）
    json.materials[0].alphaCutoff = 0.6
    const lowAlpha = async () => ({
      color: [0.8, 0.6, 0.4, 0.2],
      alphaHistogram: [...new Array(25).fill(0), ...new Array(7).fill(0.04)].slice(0, 32),
    })
    const lite = await deriveSceneryLite(json, bin, { colorOf: lowAlpha, key: 'fixture' })
    expect(lite.report.alphaMaskMaterials).toEqual([
      { material: 'Decal.material', meanAlpha: 0.2, alphaCutoff: 0.6, coverageAboveCutoff: 0.28 },
    ])
    expect(lite.report.alphaMaskRisks).toEqual([
      { material: 'Decal.material', meanAlpha: 0.2, alphaCutoff: 0.6, coverageAboveCutoff: 0.28 },
    ])
    // 高均值 alpha + 无 histogram（旧数组契约）⇒ 无 risks、entry 无 coverage
    const safe = await deriveSceneryLite(json, bin, { colorOf: async () => [0.8, 0.6, 0.4, 0.9] })
    expect(safe.report.alphaMaskRisks).toEqual([])
    expect(safe.report.alphaMaskMaterials).toEqual([
      { material: 'Decal.material', meanAlpha: 0.9, alphaCutoff: 0.6 },
    ])
  })

  it('V1 边界 fail-closed：skins / extensionsRequired 拒绝派生', async () => {
    const { json, bin } = buildFixture()
    await expect(deriveSceneryLite({ ...json, skins: [{}] }, bin, { colorOf })).rejects.toThrow(/skins/)
    await expect(deriveSceneryLite({ ...json, extensionsRequired: ['KHR_draco_mesh_compression'] }, bin, { colorOf })).rejects.toThrow(/extensionsRequired/)
  })
})

describe('实际解码页 alpha histogram', () => {
  async function sample(alphas) {
    const source = readFileSync(new URL('../derive-scenery-lite.mjs', import.meta.url), 'utf8')
    const script = source.split('<script type="module">')[1].split('</script>')[0]
    const pixels = new Uint8ClampedArray(alphas.flatMap(alpha => [100, 100, 100, alpha]))
    const window = {}
    class Canvas {
      getContext() { return { drawImage() {}, getImageData: () => ({ data: pixels }) } }
    }
    runInNewContext(script, {
      window, Uint8Array, Blob, atob: () => '', OffscreenCanvas: Canvas,
      createImageBitmap: async () => ({ width: alphas.length, height: 1 }),
    })
    return window.__mean('', 'image/png')
  }

  it('opaque 与 50/50 已知答案、顺序无关及 cutoff coverage', async () => {
    const opaque = await sample([255, 255, 255, 255])
    const mixed = await sample([0, 255, 0, 255])
    const reversed = await sample([255, 255, 0, 0])
    for (const result of [opaque, mixed, reversed]) {
      expect(result.alphaHistogram.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4)
    }
    expect(opaque.alphaHistogram[31]).toBe(1)
    expect(mixed.alphaHistogram[0]).toBe(0.5)
    expect(mixed.alphaHistogram[31]).toBe(0.5)
    expect(Array.from(mixed.alphaHistogram)).toEqual(Array.from(reversed.alphaHistogram))
    const coverage = async (mean) => {
      const { json, bin } = buildFixture()
      json.materials[0].alphaCutoff = 0.6
      const lite = await deriveSceneryLite(json, bin, { colorOf: async () => mean })
      return lite.report.alphaMaskMaterials[0].coverageAboveCutoff
    }
    expect(await coverage(opaque)).toBe(1)
    const actual = await coverage(mixed)
    expect(actual).toBe(0.5)
    expect(await coverage(reversed)).toBe(actual)
    expect(actual).toBeGreaterThanOrEqual(0)
    expect(actual).toBeLessThanOrEqual(1)
  })
})

describe('单图派生的旧产物清理', () => {
  it('成功替换；解析、贴图解码或报告写入失败时旧产物和临时文件均不存在', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-derive-'))
    try {
      const mapDir = join(root, 'map'), dir = join(mapDir, 'fixture'), reportDir = join(root, 'reports')
      mkdirSync(dir, { recursive: true })
      mkdirSync(reportDir)
      const scene = join(dir, 'scenery.glb'), out = join(dir, 'scenery-lite.glb')
      const { json, bin } = buildFixture()
      const valid = buildGlb(json, bin)
      const seed = () => { writeFileSync(out, 'old'); writeFileSync(out + '.tmp', 'old tmp') }
      const run = (opts = {}) => deriveMap({ mapDir, reportDir, key: 'fixture', colorOf, ...opts })
      seed()
      writeFileSync(scene, valid)
      expect((await run()).written).toBe(true)
      expect(parseGlb(readFileSync(out)).json.asset.version).toBe('2.0')
      expect(existsSync(out + '.tmp')).toBe(false)
      seed()
      const verify = vi.spyOn(deriveCore, 'verifyLite').mockReturnValueOnce({
        ok: false, problems: ['injected mismatch'], report: { structuralNodes: 0, geometryHash: '' },
      })
      expect((await run()).written).toBe(false)
      expect(existsSync(out)).toBe(false)
      expect(existsSync(out + '.tmp')).toBe(false)
      verify.mockRestore()
      for (const mode of ['parse', 'decode', 'report']) {
        seed()
        writeFileSync(scene, mode === 'parse' ? 'bad' : valid)
        const result = await run({
          ...(mode === 'decode' ? { colorOf: async () => { throw new Error('decode failed') } } : {}),
          ...(mode === 'report' ? { reportDir: join(root, 'missing') } : {}),
        })
        expect(result.written).toBe(false)
        expect(existsSync(out)).toBe(false)
        expect(existsSync(out + '.tmp')).toBe(false)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
