// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetMap2dForTests, ensureMap2dImage, isValidIndex, map2dSrc, map2dState,
  pickNewestIndex, selectMap2dSources,
} from './map2dOverlay.js'
import { __resetAssetBaseForTests } from '../scene/assetBase.js'

const here = dirname(fileURLToPath(import.meta.url))

const CONTENT_TIME = '2026-10-16T00:47:16Z'
const NEWER_INDEX_TIME = '2026-10-20T00:00:00Z'
const OLDER_INDEX_TIME = '2026-10-18T00:00:00Z'
const BEFORE_CONTENT_TIME = '2026-10-15T00:00:00Z'
const EMBEDDED_HASH = 'a'.repeat(64)
const IMAGE_BYTES = new Uint8Array([1, 2, 3, 4, 5])
const IMAGE_HASH = createHash('sha256').update(Buffer.from(IMAGE_BYTES)).digest('hex')

const embeddedManifest = {
  schemaVersion: 2,
  contentGeneratedAt: CONTENT_TIME,
  maps: { canal: { file: 'canal.webp', asset: 'assets/canal-abc.webp', sha256: EMBEDDED_HASH } },
}
const BOUNDS_300 = { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
const BOUNDS_BY_CODE = { canal: BOUNDS_300 }
const indexAt = (generated, sha256 = IMAGE_HASH, geometry = {}) => ({
  schemaVersion: 2,
  generated,
  maps: {
    canal: {
      path: 'map2d/canal.webp', sha256, bytes: IMAGE_BYTES.length, width: 1254, height: 1254,
      worldBounds: BOUNDS_300, orientation: 'top=+Z,left=+X', ...geometry,
    },
  },
})
const select = (props) => selectMap2dSources({ boundsByCode: BOUNDS_BY_CODE, ...props })
const imageStub = (w = 1254, h = 1254) => class {
  constructor() { this.naturalWidth = w; this.naturalHeight = h }
  set src(_v) {}
  decode() { return Promise.resolve() }
}

function storeStub(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    _data: data,
  }
}

function fetchStub(routes) {
  return vi.fn(async (url) => {
    const key = String(url)
    const hit = Object.keys(routes).find((route) => key === route || key.endsWith(route))
    if (!hit) return { ok: false, status: 404, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) }
    const value = routes[hit]
    if (value instanceof Error) throw value
    if (value instanceof Uint8Array) {
      return { ok: true, status: 200, json: async () => null, arrayBuffer: async () => value.buffer.slice(0) }
    }
    return { ok: true, status: 200, json: async () => value, arrayBuffer: async () => new ArrayBuffer(0) }
  })
}

beforeEach(() => {
  vi.stubEnv('MODE', 'android')
  vi.stubGlobal('localStorage', storeStub())
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:map2d'),
    revokeObjectURL: vi.fn(),
  }))
  vi.stubGlobal('Image', imageStub())
  __resetMap2dForTests()
  __resetAssetBaseForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  __resetMap2dForTests()
})

describe('pickNewestIndex / isValidIndex', () => {
  it('取 generated 最大者；无效候选被跳过', () => {
    const newest = pickNewestIndex([
      { index: indexAt(OLDER_INDEX_TIME), source: 'stored' },
      { index: { schemaVersion: 9, generated: NEWER_INDEX_TIME }, source: 'remote' },
      { index: { schemaVersion: 1, generated: NEWER_INDEX_TIME }, source: 'remote' },
    ])
    expect(newest).toMatchObject({ source: 'stored' })
    expect(newest.index.generated).toBe(OLDER_INDEX_TIME)
    expect(pickNewestIndex([{ index: null, source: 'remote' }])).toBeNull()
  })

  it('并列时取后者（调用方按 stored → remote 传，偏向 live 的 remote）', () => {
    const newest = pickNewestIndex([
      { index: indexAt(NEWER_INDEX_TIME, EMBEDDED_HASH), source: 'stored' },
      { index: indexAt(NEWER_INDEX_TIME, IMAGE_HASH), source: 'remote' },
    ])
    expect(newest.source).toBe('remote')
  })

  it('isValidIndex：schema + 可解析 generated 才有效', () => {
    expect(isValidIndex(indexAt(NEWER_INDEX_TIME))).toBe(true)
    expect(isValidIndex({ schemaVersion: 1, generated: NEWER_INDEX_TIME }), 'v1 缺几何契约 ⇒ 不启用').toBe(false)
    expect(isValidIndex({ schemaVersion: 1, generated: '' })).toBe(false)
    expect(isValidIndex(null)).toBe(false)
  })
})

describe('selectMap2dSources（纯决策）', () => {
  it('无包内清单 ⇒ 关闭通道（web / 旧包）', () => {
    expect(select({ embedded: null }).reason).toBe('no-embedded')
    expect(select({ embedded: { maps: {} } }).active).toBe(false)
  })

  it('无索引 / 索引全无效 ⇒ 全部包内', () => {
    expect(select({ embedded: embeddedManifest })).toMatchObject({ active: false, reason: 'no-index', use: {} })
    expect(select({ embedded: embeddedManifest, remoteIndex: { schemaVersion: 9, generated: NEWER_INDEX_TIME } }).reason).toBe('schema')
    expect(select({ embedded: embeddedManifest, remoteIndex: { schemaVersion: 1, generated: 'x' } }).reason).toBe('schema')
  })

  it('包内清单缺 contentGeneratedAt / 不可解析 ⇒ fail closed（不是构建时间兜底）', () => {
    const legacy = { schemaVersion: 1, buildTime: CONTENT_TIME, maps: embeddedManifest.maps }
    expect(select({ embedded: legacy, remoteIndex: indexAt(NEWER_INDEX_TIME) }).reason).toBe('timestamp')
  })

  it('索引不比包内内容新 ⇒ 一律包内（即使哈希不同）', () => {
    for (const generated of [BEFORE_CONTENT_TIME, CONTENT_TIME]) {
      const out = select({ embedded: embeddedManifest, remoteIndex: indexAt(generated) })
      expect(out).toMatchObject({ active: false, reason: 'stale-index', use: {} })
    }
  })

  it('**stored 比 remote 新 ⇒ 选 stored**（embedded=15日 / stored=20日 / remote=18日）', () => {
    const out = select({
      embedded: embeddedManifest,
      storedIndex: indexAt(NEWER_INDEX_TIME, IMAGE_HASH),
      remoteIndex: indexAt(OLDER_INDEX_TIME, EMBEDDED_HASH),
    })
    expect(out).toMatchObject({ active: true, source: 'stored', reason: 'stored-index' })
    expect(out.use.canal).toMatchObject({ sha256: IMAGE_HASH })
  })

  it('索引更新 + 同哈希 ⇒ 不进 OTA 清单（零流量）', () => {
    const out = select({ embedded: embeddedManifest, remoteIndex: indexAt(NEWER_INDEX_TIME, EMBEDDED_HASH) })
    expect(out.active).toBe(true)
    expect(out.use).toEqual({})
  })

  it('索引更新 + 哈希不同 ⇒ 该图走远端；索引缺失的图不越权', () => {
    const index = indexAt(NEWER_INDEX_TIME)
    index.maps.unknown = { path: 'map2d/unknown.webp', sha256: 'b'.repeat(64) }
    const out = select({ embedded: embeddedManifest, remoteIndex: index })
    expect(out.use.canal).toMatchObject({ sha256: IMAGE_HASH, path: 'map2d/canal.webp', bytes: IMAGE_BYTES.length })
    expect(out.use.unknown).toBeUndefined()
  })

  it('**几何契约不符 ⇒ 该图不换**（世界框 / 取向 / 方形 / 缺字段，逐个判否）', () => {
    const cases = {
      '世界框不同（换框）': { worldBounds: { xMin: -320, xMax: 320, yMin: -300, yMax: 300 } },
      '取向不符': { orientation: 'top=+Z,left=-X' },
      '非方形栅格': { width: 2048, height: 1024 },
      '缺 worldBounds': { worldBounds: undefined },
      '缺取向': { orientation: undefined },
    }
    for (const [label, geometry] of Object.entries(cases)) {
      const out = select({ embedded: embeddedManifest, remoteIndex: indexAt(NEWER_INDEX_TIME, IMAGE_HASH, geometry) })
      expect(out.use.canal, label).toBeUndefined()
      expect(out.rejected.canal, label).toBe('geometry')
    }
  })

  it('注册表没有该图的世界框 ⇒ 同样不换（无比对面 = 判否，绝不"缺省放行"）', () => {
    const out = selectMap2dSources({ remoteIndex: indexAt(NEWER_INDEX_TIME), embedded: embeddedManifest, boundsByCode: {} })
    expect(out.use.canal).toBeUndefined()
    expect(out.rejected.canal).toBe('geometry')
  })

  it('几何契约通过 + 字节不同 ⇒ 正常走远端（像素尺寸随件带出）', () => {
    const out = select({ embedded: embeddedManifest, remoteIndex: indexAt(NEWER_INDEX_TIME) })
    expect(out.use.canal).toMatchObject({ width: 1254, height: 1254 })
  })
})

describe('ensureMap2dImage（取字节 + 校验 + 启用）', () => {
  it('哈希校验通过 ⇒ 启用 blob URL，并记录来源', async () => {
    vi.stubGlobal('fetch', fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/index.json': indexAt(NEWER_INDEX_TIME),
      '/agent-assets/map2d/canal.webp': IMAGE_BYTES,
    }))
    const url = await ensureMap2dImage('canal')
    expect(url).toBe('blob:map2d')
    expect(map2dState.status).toBe('active')
    expect(map2dState.contentGeneratedAt).toBe(CONTENT_TIME)
    expect(map2dState.maps.canal).toMatchObject({ source: 'remote', bytes: IMAGE_BYTES.length })
    expect(map2dSrc('canal', 'assets/canal-abc.webp')).toBe('blob:map2d')
  })

  it('哈希不符 ⇒ 不启用、回落包内（fail closed）', async () => {
    vi.stubGlobal('fetch', fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/index.json': indexAt(NEWER_INDEX_TIME),
      '/agent-assets/map2d/canal.webp': new Uint8Array([9, 9, 9]),
    }))
    expect(await ensureMap2dImage('canal')).toBeNull()
    expect(map2dState.maps.canal.source).toBe('rejected')
    expect(map2dSrc('canal', 'assets/canal-abc.webp')).toBe('assets/canal-abc.webp')
  })

  it('字节校验通过但解码尺寸与索引声明不符 ⇒ 不启用、回落包内（几何 fail closed）', async () => {
    vi.stubGlobal('Image', imageStub(2048, 2048))
    vi.stubGlobal('fetch', fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/index.json': indexAt(NEWER_INDEX_TIME),
      '/agent-assets/map2d/canal.webp': IMAGE_BYTES,
    }))
    expect(await ensureMap2dImage('canal')).toBeNull()
    expect(map2dState.maps.canal).toMatchObject({ source: 'rejected' })
    expect(String(map2dState.maps.canal.reason)).toContain('geometry')
    expect(map2dSrc('canal', 'assets/canal-abc.webp')).toBe('assets/canal-abc.webp')
  })

  it('图片请求失败 ⇒ 回落包内', async () => {
    vi.stubGlobal('fetch', fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/index.json': indexAt(NEWER_INDEX_TIME),
    }))
    expect(await ensureMap2dImage('canal')).toBeNull()
    expect(map2dSrc('canal', 'assets/canal-abc.webp')).toBe('assets/canal-abc.webp')
  })

  it('索引取不到（离线首次）⇒ 通道关闭，全部包内', async () => {
    vi.stubGlobal('fetch', fetchStub({ '/map2d-embedded.json': embeddedManifest }))
    expect(await ensureMap2dImage('canal')).toBeNull()
    expect(map2dState.status).toBe('no-index')
  })

  it('远端索引失败但本地有副本 ⇒ 仍可判定并启用', async () => {
    localStorage.setItem('wotb.map2d.index.v1', JSON.stringify(indexAt(NEWER_INDEX_TIME)))
    vi.stubGlobal('fetch', fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/canal.webp': IMAGE_BYTES,
    }))
    expect(await ensureMap2dImage('canal')).toBe('blob:map2d')
    expect(map2dState.indexSource).toBe('stored')
  })

  it('dataset 选择同时隔离索引 URL 与 localStorage 缓存键', async () => {
    localStorage.setItem('wotb_data_version', '11.21.0')
    const fetchMock = fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/map2d/index.json': indexAt(NEWER_INDEX_TIME),
      '/map2d/canal.webp': IMAGE_BYTES,
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await ensureMap2dImage('canal')).toBe('blob:map2d')
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.some((url) => url.endsWith('/agent-assets/v/11.21.0/map2d/index.json'))).toBe(true)
    expect(urls.some((url) => url.endsWith('/agent-assets/v/11.21.0/map2d/canal.webp'))).toBe(true)
    expect(localStorage.getItem('wotb.map2d.index.v1:11.21.0')).not.toBeNull()
    expect(localStorage.getItem('wotb.map2d.index.v1')).toBeNull()
  })

  it('**远端索引比本地副本旧 ⇒ 用副本且不回写**（stale proxy 不得降级）', async () => {
    localStorage.setItem('wotb.map2d.index.v1', JSON.stringify(indexAt(NEWER_INDEX_TIME, IMAGE_HASH)))
    vi.stubGlobal('fetch', fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/index.json': indexAt(OLDER_INDEX_TIME, EMBEDDED_HASH),
      '/agent-assets/map2d/canal.webp': IMAGE_BYTES,
    }))
    expect(await ensureMap2dImage('canal')).toBe('blob:map2d')
    expect(map2dState.indexSource).toBe('stored')
    expect(JSON.parse(localStorage.getItem('wotb.map2d.index.v1')).generated).toBe(NEWER_INDEX_TIME)
  })

  it('索引不比包内内容新 ⇒ 不取远端（APK 升级后不降级）', async () => {
    const fetchMock = fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/index.json': indexAt(BEFORE_CONTENT_TIME),
      '/agent-assets/map2d/canal.webp': IMAGE_BYTES,
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await ensureMap2dImage('canal')).toBeNull()
    expect(map2dState.status).toBe('stale-index')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('canal.webp'))).toBe(false)
  })

  it('map2dSrc 只触发一次惰性升级，返回包内 URL 直到覆盖生效', async () => {
    const fetchMock = fetchStub({ '/map2d-embedded.json': embeddedManifest })
    vi.stubGlobal('fetch', fetchMock)
    expect(map2dSrc('canal', 'assets/canal-abc.webp')).toBe('assets/canal-abc.webp')
    expect(map2dSrc('canal', 'assets/canal-abc.webp')).toBe('assets/canal-abc.webp')
    await Promise.resolve()
    const embeddedFetches = fetchMock.mock.calls.filter(([url]) => String(url).includes('map2d-embedded.json'))
    expect(embeddedFetches.length).toBe(1)
  })

  it('非 Android 运行时 ⇒ 通道关闭（web 行为不变）', async () => {
    vi.stubEnv('MODE', 'production')
    __resetMap2dForTests()
    vi.stubGlobal('fetch', fetchStub({ '/map2d-embedded.json': embeddedManifest }))
    expect(await ensureMap2dImage('canal')).toBeNull()
    expect(map2dState.status).toBe('off')
  })
})

describe('构建产物契约', () => {
  const script = readFileSync(resolve(here, '../../scripts/build-android-bundle.mjs'), 'utf8')
  const body = script.match(/function buildMap2dEmbedded[\s\S]*?\n}/)?.[0] ?? ''
  const bodyCode = body.replace(/\/\/[^\n]*/g, '')

  it('兜底清单的时间戳来自 map2d-source.json（内容自身），不是构建时间', () => {
    expect(body).toContain('MAP2D_SOURCE_NAME')
    expect(body).toContain('contentGeneratedAt')
    expect(bodyCode, 'buildMap2dEmbedded 不得引入 wall-clock（会破坏 OTA 判据与 stage 可重跑性）').not.toMatch(/new Date\(/)
  })

  it('该清单确实被写出并进 bundle 清单', () => {
    expect(script).toContain("const EMBEDDED_MAP2D_NAME = 'map2d-embedded.json'")
    expect(script).toContain('map2dSegment(')
  })
})
