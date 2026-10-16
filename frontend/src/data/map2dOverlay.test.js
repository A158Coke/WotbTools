// @vitest-environment node
/**
 * 2D 底图 OTA 覆盖层的契约测试（判据 + fail-closed 行为）。
 *
 * 锁的规则：
 *  - **绝不降级**：候选索引取 `generated` 最大者（`AgentAssetProxy` 的陈旧缓存返回旧索引时，
 *    不得覆盖已见过的新版，更不得据它把底图 OTA 回退）；索引不比包内内容新 ⇒ 一律包内；
 *  - **确定性内容时间戳**：包内清单携带 `contentGeneratedAt`（底图内容的生成时刻，与 COS 索引
 *    同源），不是构建时间；构建脚本里不得用 `new Date()`；
 *  - 字节 sha256 校验不通过绝不启用；任何失败都回落包内而不是抛给渲染层。
 *
 * 真机上的"确实换图了 / 离线仍可用"属端到端行为，由用户在设备上确认（本文件覆盖可确定的部分）。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetMap2dForTests, ensureMap2dImage, isValidIndex, map2dSrc, map2dState,
  pickNewestIndex, selectMap2dSources,
} from './map2dOverlay.js'

const here = dirname(fileURLToPath(import.meta.url))

const CONTENT_TIME = '2026-10-16T00:47:16Z'     // 包内底图内容的生成时刻（= COS 索引同源）
const NEWER_INDEX_TIME = '2026-10-20T00:00:00Z'
const OLDER_INDEX_TIME = '2026-10-18T00:00:00Z'      // 比 NEWER 旧，但仍晚于包内内容
const BEFORE_CONTENT_TIME = '2026-10-15T00:00:00Z'   // 比包内内容还旧（真·陈旧索引）
const EMBEDDED_HASH = 'a'.repeat(64)
const IMAGE_BYTES = new Uint8Array([1, 2, 3, 4, 5])
const IMAGE_HASH = createHash('sha256').update(Buffer.from(IMAGE_BYTES)).digest('hex')

const embeddedManifest = {
  schemaVersion: 2,
  contentGeneratedAt: CONTENT_TIME,
  maps: { canal: { file: 'canal.webp', asset: 'assets/canal-abc.webp', sha256: EMBEDDED_HASH } },
}
const indexAt = (generated, sha256 = IMAGE_HASH) => ({
  schemaVersion: 1,
  generated,
  maps: { canal: { path: 'map2d/canal.webp', sha256, bytes: IMAGE_BYTES.length, width: 1254, height: 1254 } },
})

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

describe('pickNewestIndex / isValidIndex', () => {
  it('取 generated 最大者；无效候选被跳过', () => {
    const newest = pickNewestIndex([
      { index: indexAt(OLDER_INDEX_TIME), source: 'stored' },
      { index: { schemaVersion: 9, generated: NEWER_INDEX_TIME }, source: 'remote' },
      { index: { schemaVersion: 1, generated: 'not-a-date' }, source: 'remote' },
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
    expect(isValidIndex({ schemaVersion: 2, generated: NEWER_INDEX_TIME })).toBe(false)
    expect(isValidIndex({ schemaVersion: 1, generated: '' })).toBe(false)
    expect(isValidIndex(null)).toBe(false)
  })
})

describe('selectMap2dSources（纯决策）', () => {
  it('无包内清单 ⇒ 关闭通道（web / 旧包）', () => {
    expect(selectMap2dSources({ embedded: null }).reason).toBe('no-embedded')
    expect(selectMap2dSources({ embedded: { maps: {} } }).active).toBe(false)
  })

  it('无索引 / 索引全无效 ⇒ 全部包内', () => {
    expect(selectMap2dSources({ embedded: embeddedManifest })).toMatchObject({ active: false, reason: 'no-index', use: {} })
    expect(selectMap2dSources({ embedded: embeddedManifest, remoteIndex: { schemaVersion: 9, generated: NEWER_INDEX_TIME } }).reason).toBe('schema')
    expect(selectMap2dSources({ embedded: embeddedManifest, remoteIndex: { schemaVersion: 1, generated: 'x' } }).reason).toBe('timestamp')
  })

  it('包内清单缺 contentGeneratedAt / 不可解析 ⇒ fail closed（不是构建时间兜底）', () => {
    const legacy = { schemaVersion: 1, buildTime: CONTENT_TIME, maps: embeddedManifest.maps }
    expect(selectMap2dSources({ embedded: legacy, remoteIndex: indexAt(NEWER_INDEX_TIME) }).reason).toBe('timestamp')
  })

  it('索引不比包内内容新 ⇒ 一律包内（即使哈希不同）', () => {
    for (const generated of [BEFORE_CONTENT_TIME, CONTENT_TIME]) {
      const out = selectMap2dSources({ embedded: embeddedManifest, remoteIndex: indexAt(generated) })
      expect(out).toMatchObject({ active: false, reason: 'stale-index', use: {} })
    }
  })

  it('**stored 比 remote 新 ⇒ 选 stored**（embedded=15日 / stored=20日 / remote=18日）', () => {
    const out = selectMap2dSources({
      embedded: embeddedManifest,
      storedIndex: indexAt(NEWER_INDEX_TIME, IMAGE_HASH),
      remoteIndex: indexAt(OLDER_INDEX_TIME, EMBEDDED_HASH),
    })
    expect(out).toMatchObject({ active: true, source: 'stored', reason: 'stored-index' })
    expect(out.use.canal).toMatchObject({ sha256: IMAGE_HASH })
  })

  it('索引更新 + 同哈希 ⇒ 不进 OTA 清单（零流量）', () => {
    const out = selectMap2dSources({ embedded: embeddedManifest, remoteIndex: indexAt(NEWER_INDEX_TIME, EMBEDDED_HASH) })
    expect(out.active).toBe(true)
    expect(out.use).toEqual({})
  })

  it('索引更新 + 哈希不同 ⇒ 该图走远端；索引缺失的图不越权', () => {
    const index = indexAt(NEWER_INDEX_TIME)
    index.maps.unknown = { path: 'map2d/unknown.webp', sha256: 'b'.repeat(64) }
    const out = selectMap2dSources({ embedded: embeddedManifest, remoteIndex: index })
    expect(out.use.canal).toMatchObject({ sha256: IMAGE_HASH, path: 'map2d/canal.webp', bytes: IMAGE_BYTES.length })
    expect(out.use.unknown).toBeUndefined()
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

  it('**远端索引比本地副本旧 ⇒ 用副本且不回写**（stale proxy 不得降级）', async () => {
    localStorage.setItem('wotb.map2d.index.v1', JSON.stringify(indexAt(NEWER_INDEX_TIME, IMAGE_HASH)))
    // 远端这份更旧，且其哈希等于包内（若被错误采用 ⇒ 不会发生升级，断言即可区分）
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
  // 注释里可以说明"为什么不能用 wall-clock"——判据只看**代码**。
  const bodyCode = body.replace(/\/\/[^\n]*/g, '')

  it('兜底清单的时间戳来自 map2d-source.json（内容自身），不是构建时间', () => {
    expect(body).toContain('map2d-source.json')
    expect(body).toContain('contentGeneratedAt')
    expect(bodyCode, 'buildMap2dEmbedded 不得引入 wall-clock（会破坏 OTA 判据与 stage 可重跑性）').not.toMatch(/new Date\(/)
  })

  it('该清单确实被写出并进 bundle 清单', () => {
    expect(script).toContain("const EMBEDDED_MAP2D_NAME = 'map2d-embedded.json'")
    expect(script).toContain('map2dSegment(')
  })
})
