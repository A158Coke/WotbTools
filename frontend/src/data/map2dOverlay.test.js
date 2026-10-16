// @vitest-environment node
/**
 * 2D 底图 OTA 覆盖层的契约测试（判据 + fail-closed 行为）。
 *
 * 锁的是决策规则本身：**绝不降级**（索引比包内旧 ⇒ 一律包内）、字节不校验通过绝不启用、
 * 任何失败都回落包内而不是抛给渲染层。真机上的"确实换图了/离线仍可用"属端到端行为，
 * 由用户在设备上确认（本文件覆盖可确定的部分）。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetMap2dForTests, ensureMap2dImage, map2dSrc, map2dState, selectMap2dSources,
} from './map2dOverlay.js'

const here = dirname(fileURLToPath(import.meta.url))

const BUILD_TIME = '2026-10-16T00:00:00Z'
const INDEX_TIME = '2026-10-17T00:00:00Z'
const EMBEDDED_HASH = 'a'.repeat(64)
const IMAGE_BYTES = new Uint8Array([1, 2, 3, 4, 5])
const IMAGE_HASH = createHash('sha256').update(Buffer.from(IMAGE_BYTES)).digest('hex')

const embeddedManifest = {
  schemaVersion: 1,
  buildTime: BUILD_TIME,
  maps: { canal: { file: 'canal.webp', asset: 'assets/canal-abc.webp', sha256: EMBEDDED_HASH } },
}
const remoteIndex = {
  schemaVersion: 1,
  generated: INDEX_TIME,
  maps: {
    canal: { path: 'map2d/canal.webp', sha256: IMAGE_HASH, bytes: IMAGE_BYTES.length, width: 1254, height: 1254 },
  },
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

/** 按 URL 分派的 fetch 桩；未命中的 URL 返回 404（与代理的缺文件行为一致）。 */
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
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:map2d') }))
  __resetMap2dForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  __resetMap2dForTests()
})

describe('selectMap2dSources（纯决策）', () => {
  it('无包内清单 ⇒ 关闭通道（web / 旧包）', () => {
    expect(selectMap2dSources({ embedded: null }).reason).toBe('no-embedded')
    expect(selectMap2dSources({ embedded: { maps: {} } }).active).toBe(false)
  })

  it('无索引 ⇒ 全部包内', () => {
    const out = selectMap2dSources({ embedded: embeddedManifest })
    expect(out).toMatchObject({ active: false, reason: 'no-index', use: {} })
  })

  it('schemaVersion 不支持 / 时间戳不可解析 ⇒ fail closed', () => {
    expect(selectMap2dSources({ embedded: embeddedManifest, remoteIndex: { ...remoteIndex, schemaVersion: 9 } }).reason).toBe('schema')
    expect(selectMap2dSources({ embedded: embeddedManifest, remoteIndex: { ...remoteIndex, generated: 'not-a-date' } }).reason).toBe('timestamp')
    expect(selectMap2dSources({ embedded: { buildTime: 'x', maps: embeddedManifest.maps }, remoteIndex }).reason).toBe('timestamp')
  })

  it('索引不比包内新 ⇒ 一律包内（绝不降级，即使哈希不同）', () => {
    for (const generated of ['2026-10-15T00:00:00Z', BUILD_TIME]) {
      const out = selectMap2dSources({ embedded: embeddedManifest, remoteIndex: { ...remoteIndex, generated } })
      expect(out).toMatchObject({ active: false, reason: 'stale-index', use: {} })
    }
  })

  it('索引更新 + 同哈希 ⇒ 不进 OTA 清单（零流量）', () => {
    const index = { ...remoteIndex, maps: { canal: { ...remoteIndex.maps.canal, sha256: EMBEDDED_HASH } } }
    const out = selectMap2dSources({ embedded: embeddedManifest, remoteIndex: index })
    expect(out.active).toBe(true)
    expect(out.use).toEqual({})
  })

  it('索引更新 + 哈希不同 ⇒ 该图走远端；索引缺失的图不越权', () => {
    const index = { ...remoteIndex, maps: { ...remoteIndex.maps, unknown: { path: 'map2d/unknown.webp', sha256: 'b'.repeat(64) } } }
    const out = selectMap2dSources({ embedded: embeddedManifest, remoteIndex: index })
    expect(out.use.canal).toMatchObject({ sha256: IMAGE_HASH, path: 'map2d/canal.webp', bytes: IMAGE_BYTES.length })
    expect(out.use.unknown).toBeUndefined()
  })

  it('远端索引缺失时用持久化副本（离线仍有判据）', () => {
    const out = selectMap2dSources({ embedded: embeddedManifest, remoteIndex: null, storedIndex: remoteIndex })
    expect(out).toMatchObject({ active: true, reason: 'stored-index' })
    expect(out.use.canal).toBeDefined()
  })
})

describe('ensureMap2dImage（取字节 + 校验 + 启用）', () => {
  it('哈希校验通过 ⇒ 启用 blob URL，并记录来源', async () => {
    vi.stubGlobal('fetch', fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/index.json': remoteIndex,
      '/agent-assets/map2d/canal.webp': IMAGE_BYTES,
    }))
    const url = await ensureMap2dImage('canal')
    expect(url).toBe('blob:map2d')
    expect(map2dState.status).toBe('active')
    expect(map2dState.maps.canal).toMatchObject({ source: 'remote', bytes: IMAGE_BYTES.length })
    expect(map2dSrc('canal', 'assets/canal-abc.webp')).toBe('blob:map2d')
  })

  it('哈希不符 ⇒ 不启用、回落包内（fail closed）', async () => {
    vi.stubGlobal('fetch', fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/index.json': remoteIndex,
      '/agent-assets/map2d/canal.webp': new Uint8Array([9, 9, 9]),
    }))
    expect(await ensureMap2dImage('canal')).toBeNull()
    expect(map2dState.maps.canal.source).toBe('rejected')
    expect(map2dSrc('canal', 'assets/canal-abc.webp')).toBe('assets/canal-abc.webp')
  })

  it('图片请求失败 ⇒ 回落包内', async () => {
    vi.stubGlobal('fetch', fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/index.json': remoteIndex,
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
    localStorage.setItem('wotb.map2d.index.v1', JSON.stringify(remoteIndex))
    vi.stubGlobal('fetch', fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/canal.webp': IMAGE_BYTES,
    }))
    expect(await ensureMap2dImage('canal')).toBe('blob:map2d')
    expect(map2dState.indexSource).toBe('stored-index')
  })

  it('索引比包内旧 ⇒ 不取远端（APK 升级后不降级）', async () => {
    const staleIndex = { ...remoteIndex, generated: '2026-10-15T00:00:00Z' }
    const fetchMock = fetchStub({
      '/map2d-embedded.json': embeddedManifest,
      '/agent-assets/map2d/index.json': staleIndex,
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

describe('构建产物：map2d-embedded.json 的存在性契约', () => {
  it('bundle 构建脚本必须产出该文件（否则通道永远关闭）', () => {
    const text = readFileSync(resolve(here, '../../scripts/build-android-bundle.mjs'), 'utf8')
    expect(text).toContain('map2d-embedded.json')
    expect(text).toMatch(/buildMap2dEmbedded|map2d-embedded/)
    expect(join(here, '..').length).toBeGreaterThan(0)
  })
})
