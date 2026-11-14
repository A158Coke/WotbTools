// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PRODUCTION_CATALOG from './__fixtures__/versions.production.json'

/**
 * 数据版本选择器的契约：
 *   - ?data=<id> 写/删与 ?assets= 完整版本基址的剥离（dataVersionUrl 纯函数）
 *   - select 同步剥离持久化 override 里的旧 dataset 段（选 A 仍取 B 的案例）
 *   - versions.json 的加载/校验/错误状态
 *   - 选项映射（label / tank_count / preview / status）
 */
async function load({ url = '/', origin = 'https://assets.example.com', fetchImpl = null } = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_ASSET_BASE_URL', origin)
  localStorage.clear()
  window.history.replaceState({}, '', url)
  if (fetchImpl) vi.stubGlobal('fetch', fetchImpl)
  return import('./useDataVersion.js')
}

const CATALOG = {
  schema: 1,
  updated: '2026-11-05T00:00:00+00:00',
  default: '11.21.0',
  datasets: [
    {
      id: '11.21.0',
      label: '11.21.0',
      game_version: 'release/11.21.0',
      variant: null,
      release: '20261101-aaaaaaaa',
      tank_count: 738,
      generated: '2026-11-01T00:00:00+00:00',
      content_digest: 'sha256:aaa',
      manifest_sha256: 'bbb',
      status: 'active',
    },
    {
      id: '11.21.0-t11-preview',
      label: '11.21.0 + Tier XI 预览',
      game_version: 'release/11.21.0',
      variant: 't11-preview',
      release: '20261104-bbbbbbbb',
      tank_count: 740,
      generated: '2026-11-04T00:00:00+00:00',
      content_digest: 'sha256:ccc',
      manifest_sha256: 'ddd',
      status: 'active',
    },
  ],
}

describe('useDataVersion', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('dataVersionUrl sets, removes and keeps other query parameters', async () => {
    const { dataVersionUrl } = await load()
    const set = new URL(dataVersionUrl('https://a/?view=replay&data=11.21.0', '11.22.0'))
    expect(set.searchParams.get('view')).toBe('replay')
    expect(set.searchParams.get('data')).toBe('11.22.0')

    const reset = new URL(dataVersionUrl('https://a/?view=replay&data=11.21.0', ''))
    expect(reset.searchParams.get('view')).toBe('replay')
    expect(reset.searchParams.has('data')).toBe(false)
  })

  it('strips a versioned ?assets= base when switching back to ?data=', async () => {
    const { dataVersionUrl } = await load()
    const url = new URL(dataVersionUrl(
      'https://a/?assets=https://assets.example.com/v/11.21.0&data=11.21.0',
      '11.22.0',
    ))
    expect(url.searchParams.get('assets')).toBe('https://assets.example.com')
    expect(url.searchParams.get('data')).toBe('11.22.0')
  })

  it('loads and validates versions.json', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG }))
    const { loadDataVersionCatalog } = await load({ fetchImpl: fetchMock })
    const state = await loadDataVersionCatalog()
    expect(fetchMock).toHaveBeenCalledWith('https://assets.example.com/versions.json', { cache: 'no-cache' })
    expect(state.status).toBe('ready')
    expect(state.defaultId).toBe('11.21.0')
    expect(state.datasets.map((entry) => entry.id)).toEqual(['11.21.0', '11.21.0-t11-preview'])
  })

  it('accepts client SmartDLC slot ids with underscore and still rejects URL-unsafe ids', async () => {
    // 2026-11-11 放宽 `_`：客户端 SmartDLC 槽位命名（s11.21.0_1.yaml → 11.21.0_1）
    const catalog = {
      schema: 1,
      default: '11.21.0',
      datasets: [
        { id: '11.21.0', label: '11.21.0', content_digest: 'sha256:a', status: 'active' },
        { id: '11.21.0_1', label: '11.21.0_1', content_digest: 'sha256:b', status: 'active' },
        { id: '11.4.0.130', label: '超测服', content_digest: 'sha256:c', status: 'active' },
      ],
    }
    const ok = await load({ fetchImpl: vi.fn(async () => ({ ok: true, json: async () => catalog })) })
    const state = await ok.loadDataVersionCatalog()
    expect(state.status).toBe('ready')
    expect(state.datasets.map((entry) => entry.id)).toEqual(['11.21.0', '11.21.0_1', '11.4.0.130'])

    const bad = {
      ...catalog,
      datasets: [
        { id: '11.21.0', label: '11.21.0', content_digest: 'sha256:a', status: 'active' },
        { id: '11.21.0+x', label: 'bad', content_digest: 'sha256:d', status: 'active' },
      ],
    }
    const rejected = await load({ fetchImpl: vi.fn(async () => ({ ok: true, json: async () => bad })) })
    const badState = await rejected.loadDataVersionCatalog()
    expect(badState.status).toBe('error')
    expect(badState.error).toContain('非法')
  })

  it('strips a versioned ?assets= base before fetching the catalog', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG }))
    const { loadDataVersionCatalog } = await load({
      url: '/?assets=https://assets.example.com/v/11.21.0',
      fetchImpl: fetchMock,
    })
    await loadDataVersionCatalog()
    expect(fetchMock).toHaveBeenCalledWith('https://assets.example.com/versions.json', { cache: 'no-cache' })
  })

  it('surfaces a schema error instead of silently accepting a bad catalog', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ schema: 2, datasets: [] }) }))
    const { loadDataVersionCatalog } = await load({ fetchImpl: fetchMock })
    const state = await loadDataVersionCatalog()
    expect(state.status).toBe('error')
    expect(state.datasets).toEqual([])
    expect(state.error).toContain('schema')
  })

  it('is unavailable without an asset origin and never calls fetch', async () => {
    const fetchMock = vi.fn()
    const { loadDataVersionCatalog } = await load({ origin: '', fetchImpl: fetchMock })
    const state = await loadDataVersionCatalog()
    expect(state.status).toBe('unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps catalog entries to selector options and resolves the selected dataset', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG }))
    const mod = await load({ url: '/?data=11.21.0-t11-preview', fetchImpl: fetchMock })
    await mod.loadDataVersionCatalog()
    const { options, selected, currentDataset } = mod.useDataVersion()
    expect(selected.value).toBe('11.21.0-t11-preview')
    // 陈列顺序（2026-11-14 反馈）：最新超测 → 最新正式
    expect(options.value.map((option) => option.value)).toEqual(['11.21.0-t11-preview', '11.21.0'])
    expect(options.value[0].tankCount).toBe(740)
    expect(options.value[0].preview).toBe(true)
    expect(options.value[1].preview).toBe(false)
    expect(currentDataset.value.id).toBe('11.21.0-t11-preview')
  })

  it('真实生产 catalog（无 preview 字段）也用 variant 标记预览通道', async () => {
    // 夹具来自 Assets Host 的实际 versions.json：Agent collect_datasets 不输出
    // version.json.preview，因此消费契约只能依赖 catalog 已有的字段。
    expect('preview' in PRODUCTION_CATALOG.datasets[1]).toBe(false)
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => PRODUCTION_CATALOG }))
    const mod = await load({ fetchImpl: fetchMock })
    await mod.loadDataVersionCatalog()
    const { options } = mod.useDataVersion()
    // 陈列顺序：最新超测（11.4.0.130）→ 最新正式 → 其余版本递降
    expect(options.value.map((option) => [option.value, option.preview])).toEqual([
      ['11.4.0.130', true],
      ['11.21.0', false],
      ['11.21.0_1', false],
    ])
  })

  it('目录就绪后选择器才挂载：下线的持久化 id 注册即自愈回默认（watch immediate）', async () => {
    // 移动端抽屉开合会卸载/重建实例：目录请求在上一实例卸载后完成，新实例挂载时
    // 目录已就绪、watcher 不会再触发变更——注册时必须检查当前快照（immediate）。
    const assign = vi.fn()
    vi.spyOn(window.location, 'assign').mockImplementation(assign)
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG }))
    const mod = await load({ url: '/?localuser=1', fetchImpl: fetchMock }) // load 会 clear localStorage
    await mod.loadDataVersionCatalog() // 上一实例周期：目录已就绪
    localStorage.setItem('wotb_data_version', 'supertest') // 已从目录下线的 id（clear 之后写入）
    const { selected } = mod.useDataVersion() // 新实例挂载：watcher 以 immediate 注册，注册即自愈
    // select() 的语义 = 写存储 + 整页重载（不原地改 ref）；重载后即回默认。
    expect(localStorage.getItem('wotb_data_version')).toBeNull()
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign.mock.calls[0][0]).not.toContain('data=supertest')
  })

  it('选择器先挂载、目录后才就绪：快照就绪同样触发自愈', async () => {
    // 同一自愈的另一半时序：单实例先挂载、目录请求后完成。watcher 依赖的是
    // 快照状态变化，而不是挂载动作本身——两条时序都必须收敛到回默认。
    const assign = vi.fn()
    vi.spyOn(window.location, 'assign').mockImplementation(assign)
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG }))
    const mod = await load({ url: '/?localuser=1', fetchImpl: fetchMock })
    localStorage.setItem('wotb_data_version', 'supertest')
    const { selected } = mod.useDataVersion()
    await mod.loadDataVersionCatalog() // 目录就绪 → watcher 检查当前快照
    expect(localStorage.getItem('wotb_data_version')).toBeNull()
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign.mock.calls[0][0]).not.toContain('data=supertest')
  })

  it('strips a persisted versioned ?assets= override when selecting a dataset', async () => {
    // review 复现案例：曾访问 ?assets=https://origin/v/11.21.0 会把完整版本基址
    // 存进 wotb_asset_base；只更新 wotb_data_version 时 withDataset 走 escape
    // hatch，选择器显示新 dataset、资产仍从旧 /v/<id> 取。select 必须同步剥掉。
    const assign = vi.fn()
    vi.spyOn(window.location, 'assign').mockImplementation(assign)
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG }))
    const mod = await load({ url: '/?data=11.21.0', fetchImpl: fetchMock })
    localStorage.setItem('wotb_asset_base', 'https://assets.example.com/v/11.21.0')
    await mod.loadDataVersionCatalog()
    const { select } = mod.useDataVersion()
    select('11.21.0-t11-preview')
    expect(localStorage.getItem('wotb_asset_base')).toBe('https://assets.example.com')
    expect(localStorage.getItem('wotb_data_version')).toBe('11.21.0-t11-preview')
    const target = new URL(assign.mock.calls[0][0])
    expect(target.searchParams.get('data')).toBe('11.21.0-t11-preview')
    vi.restoreAllMocks()
  })
})