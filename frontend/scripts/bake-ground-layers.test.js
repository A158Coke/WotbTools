import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createHash } from 'node:crypto'
import { loadBakeGroundLayers, requireBakeTerrain } from './bake-ground-layers.js'
import { buildGroundGeometry, groundLayerKeys, loadTerrain, makeGroundMaterial } from '../src/scene/groundPass.js'
import { CLIENT_NORMAL_CAMERA_FOV_H } from '../src/scene/terrainMesh.js'

const BASE = 'http://bake.test/pack/map/demo/'

function layersJson({ heightBlend = false } = {}) {
  const v4 = [1, 1, 1, 1]
  return {
    height_blend: heightBlend, flatcolor: true, separate_lm: true, scaled_tiles: false,
    tiling: [64, 64], tile_scale: v4, tile_colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]],
    flat_color: [0.5, 0.5, 0.5], lm_adjust: [0, 1, 1], tilemask_weight: 1,
    hb_scale: v4, hb_offset: [0, 0, 0, 0], hb_softness: v4,
  }
}

function packFetch(files, { throwOn = null } = {}) {
  const requested = []
  const fetchFn = async (url) => {
    const rel = url.slice(BASE.length)
    requested.push(rel)
    if (rel === throwOn) throw new TypeError('Failed to fetch')
    if (!(rel in files)) return new Response('nf', { status: 404 })
    return new Response(files[rel], { status: 200 })
  }
  return { fetchFn, requested }
}

function completeFiles(L) {
  const files = { 'ground.layers.json': JSON.stringify(L) }
  for (const k of groundLayerKeys(L)) files['ground/' + k + '.webp'] = new Uint8Array([1, 2, 3])
  return files
}

function textureLoader({ failOn = null, failWith = new Error('decode failed') } = {}) {
  const made = []
  const loadTexture = async (blob) => {
    expect(blob).toBeInstanceOf(Blob)
    if (failOn !== null && made.length === failOn) throw failWith
    const t = new THREE.Texture()
    const rec = { t, disposed: false }
    t.addEventListener('dispose', () => { rec.disposed = true })
    made.push(rec)
    return t
  }
  return { loadTexture, made }
}

describe('烘焙分层地表读取 fail-closed（缺/坏即抛出，不返回半成品或 null）', () => {
  it('Test A：ground/tile1.webp 404 ⇒ reject「ground layer 缺失: tile1」，已解码的 cm/lm/tile0 全部释放', async () => {
    const L = layersJson()
    const files = completeFiles(L)
    delete files['ground/tile1.webp']
    const { fetchFn, requested } = packFetch(files)
    const { loadTexture, made } = textureLoader()
    await expect(loadBakeGroundLayers({ base: BASE, fetchFn, loadTexture }))
      .rejects.toThrow(/^ground layer 缺失: tile1（HTTP 404）$/)
    expect(made).toHaveLength(3)
    expect(made.every((m) => m.disposed)).toBe(true)
    expect(requested).not.toContain('ground/mask0.webp')
  })

  it('ground.layers.json 缺失 ⇒ reject（此前 r.ok=false 时静默得到 null）', async () => {
    const { fetchFn } = packFetch({})
    const { loadTexture, made } = textureLoader()
    await expect(loadBakeGroundLayers({ base: BASE, fetchFn, loadTexture }))
      .rejects.toThrow(/^ground\.layers\.json 缺失（HTTP 404）$/)
    expect(made).toHaveLength(0)
  })

  it('ground.layers.json 无法解析 / 顶层非对象 ⇒ reject', async () => {
    for (const body of ['{not json', 'null', '7']) {
      const { fetchFn } = packFetch({ 'ground.layers.json': body })
      await expect(loadBakeGroundLayers({ base: BASE, fetchFn, loadTexture: textureLoader().loadTexture }))
        .rejects.toThrow(/^ground\.layers\.json 无法解析: /)
    }
  })

  it('TextureLoader 解码失败 ⇒ reject「ground layer 解码失败: <层>」，此前已解码的纹理释放', async () => {
    const { fetchFn } = packFetch(completeFiles(layersJson()))
    const { loadTexture, made } = textureLoader({ failOn: 4 })
    await expect(loadBakeGroundLayers({ base: BASE, fetchFn, loadTexture }))
      .rejects.toThrow(/^ground layer 解码失败: mask0: decode failed$/)
    expect(made).toHaveLength(4)
    expect(made.every((m) => m.disposed)).toBe(true)
    const ev = textureLoader({ failOn: 0, failWith: new Event('error') })
    await expect(loadBakeGroundLayers({ base: BASE, fetchFn, loadTexture: ev.loadTexture }))
      .rejects.toThrow(/^ground layer 解码失败: cm: error$/)
  })

  it('下载异常（网络错误）⇒ reject「ground layer 下载失败: <层>」', async () => {
    const { fetchFn } = packFetch(completeFiles(layersJson()), { throwOn: 'ground/lm.webp' })
    const { loadTexture, made } = textureLoader()
    await expect(loadBakeGroundLayers({ base: BASE, fetchFn, loadTexture }))
      .rejects.toThrow(/^ground layer 下载失败: lm: Failed to fetch$/)
    expect(made).toHaveLength(1)
    expect(made[0].disposed).toBe(true)
  })

  it('键集随 groundLayerKeys：height_blend 图缺 hmap1 同样 reject', async () => {
    const L = layersJson({ heightBlend: true })
    const files = completeFiles(L)
    delete files['ground/hmap1.webp']
    const { fetchFn } = packFetch(files)
    const { loadTexture, made } = textureLoader()
    await expect(loadBakeGroundLayers({ base: BASE, fetchFn, loadTexture }))
      .rejects.toThrow(/^ground layer 缺失: hmap1（HTTP 404）$/)
    expect(made).toHaveLength(7)
    expect(made.every((m) => m.disposed)).toBe(true)
  })

  it('Test B：分层完整 ⇒ 返回全部层；按烘焙页参数建出的地面网格是分层着色材质（非回退白底）', async () => {
    for (const heightBlend of [false, true]) {
      const L = layersJson({ heightBlend })
      const { fetchFn } = packFetch(completeFiles(L))
      const { loadTexture, made } = textureLoader()
      const groundLayers = await loadBakeGroundLayers({ base: BASE, fetchFn, loadTexture })
      expect(groundLayers.layers).toEqual(L)
      expect(Object.keys(groundLayers.texs)).toEqual(groundLayerKeys(L))
      expect(made.some((m) => m.disposed)).toBe(false)

      const n = 64, span = 600
      const field = new Float32Array(n * n)
      const mesh = new THREE.Mesh(buildGroundGeometry({
        field, n, span, cam: { x: 0, y: 1000, z: 0 }, fovY: 0.96, aspect: 1,
        hFovDeg: CLIENT_NORMAL_CAMERA_FOV_H, refineMask: null,
      }), makeGroundMaterial({ layers: groundLayers.layers, texs: groundLayers.texs, size: span }))
      expect(mesh.geometry.attributes.position.count).toBeGreaterThan(0)
      expect(mesh.material.isShaderMaterial).toBe(true)
      expect(mesh.material.isMeshBasicMaterial).toBeUndefined()
      expect(mesh.material.uniforms.uCM.value).toBe(groundLayers.texs.cm)
      expect(mesh.material.uniforms.uTile1.value).toBe(groundLayers.texs.tile1)
      expect(!!mesh.material.defines.HEIGHT_BLEND).toBe(heightBlend)
    }
  })
})

describe('烘焙地形配对 fail-closed（真实 loadTerrain → requireBakeTerrain；PR #621 re-review P2）', () => {
  const N = 512
  const BIN = new Uint8Array(N * N * 2)
  const sha = createHash('sha256').update(BIN).digest('hex')
  const META = { size: N, zmin: -5, zmax: 60, terrainLayout: 2, worldBounds: { min: [-400, -400], max: [400, 400] }, terrainBinSha256: sha }
  async function terrainOf({ json, bin }) {
    const respond = (body) => (body === undefined ? new Response('nf', { status: 404 })
      : typeof body === 'number' ? new Response('err', { status: body })
        : new Response(body instanceof Uint8Array ? body : JSON.stringify(body), { status: 200 }))
    const fetchFn = async (url) => respond(url.includes('terrain.json') ? json : bin)
    return loadTerrain({ binUrl: BASE + 'terrain.u16.bin', metaUrl: BASE + 'terrain.json', fetchFn })
  }

  it('json+bin 有效配对 ⇒ 有地形；json+bin 均 404 ⇒ 无地形（ground=false 口径）', async () => {
    expect(requireBakeTerrain(await terrainOf({ json: META, bin: BIN }))).toBe(true)
    const none = await terrainOf({})
    expect(none.field).toBeNull()
    expect(requireBakeTerrain(none)).toBe(false)
  })

  it('terrain.json 404 + 恰好 512²×2 的 bin ⇒ 不产 field，但烘焙仍按 HTTP 事实抛出', async () => {
    const t = await terrainOf({ bin: BIN })
    expect(t.field).toBeNull()
    expect(t.meta).toEqual({})
    expect(() => requireBakeTerrain(t)).toThrow(/^terrain 不完整: terrain\.json 缺失（HTTP 404）但 terrain\.u16\.bin 存在/)
  })

  it('json 在而 bin 缺 / sha 不符 / 尺寸不符 ⇒ 抛出', async () => {
    const missing = await terrainOf({ json: META })
    expect(() => requireBakeTerrain(missing)).toThrow(/terrain\.json 存在但 terrain\.u16\.bin 缺失（HTTP 404）/)
    const shaMismatch = await terrainOf({ json: { ...META, terrainBinSha256: '0'.repeat(64) }, bin: BIN })
    expect(() => requireBakeTerrain(shaMismatch)).toThrow(/不配对/)
    const badSize = await terrainOf({ json: { ...META, terrainBinSha256: undefined }, bin: new Uint8Array(100) })
    expect(() => requireBakeTerrain(badSize)).toThrow(/不配对/)
  })

  it('读取异常（json 500）不得当作"无地形"', async () => {
    const t = await terrainOf({ json: 500 })
    expect(() => requireBakeTerrain(t)).toThrow(/terrain\.json 读取失败（HTTP 500）/)
  })
})
