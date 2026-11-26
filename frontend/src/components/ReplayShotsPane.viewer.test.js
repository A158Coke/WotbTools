// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, ref } from 'vue'

const i18n = vi.hoisted(() => ({ t: vi.fn((key) => key) }))
const connectivityState = vi.hoisted(() => ({ state: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  connectivityState.settled = ref(true)
  return { useConnectivity: () => ({ connectivity: connectivityState.state, settled: connectivityState.settled, isSettled: () => connectivityState.settled.value, whenSettled: () => Promise.resolve() }) }
})

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: i18n.t }) }))

const parseAgentShotsFromBytes = vi.hoisted(() => vi.fn())
const parseAgentPlaybackFromBytes = vi.hoisted(() => vi.fn())
vi.mock('../api/agent-replay-facets.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    parseAgentShotsFromBytes,
    parseAgentPlaybackFromBytes,
  }
})

vi.mock('../scene/assetProvider.js', () => ({
  assetProvider: {
    configured: () => false,
    json: vi.fn(async () => { throw new Error('asset source unconfigured') }),
    bytes: async () => { throw new Error('asset source unconfigured') },
  },
}))

vi.mock('../scene/agentData.js', () => ({
  tankImageUrl: (id) => `img:${id}`,
  storeShotsForViewer: vi.fn(),
  shotViewerQuery: vi.fn(),
  fetchTankData: vi.fn(async () => ({ configs: [] })),
  fetchShotTankData: vi.fn(async () => ({ configs: [] })),
}))

const observers = []
class ResizeObserverStub {
  constructor(cb) { this.cb = cb; observers.push(this) }
  observe() {}
  disconnect() {}
  emit(width) { this.cb([{ contentRect: { width } }]) }
}
globalThis.ResizeObserver = ResizeObserverStub

vi.mock('../platform/screenForm.js', () => ({ forcedLandscapeDevice: async () => 'android-phone-app' }))

import { ONBOARDING_KEY } from '../shared/onboarding.js'
import ReplayShotsPane from './ReplayShotsPane.vue'
import { assetProvider } from '../scene/assetProvider.js'
import { fetchShotTankData, fetchTankData, storeShotsForViewer, shotViewerQuery } from '../scene/agentData.js'

function mkFile(name = 'cn.wotbreplay') {
  return new File([new Uint8Array([1, 2, 3, 4])], name)
}

const baseOthers = { total_launches: 0, skipped_no_endpoint: 0, skipped_no_target_state: 0, muzzle_fallback: 0 }

const guideSurfaces = {}
const guideActive = ref(false)
const guideHost = { guideActive, registerSurface: (id, surface) => { guideSurfaces[id] = surface } }
afterEach(() => {
  guideActive.value = false
  fetchShotTankData.mockReset()
  fetchShotTankData.mockImplementation(async () => ({ configs: [] }))
  assetProvider.json.mockReset()
  assetProvider.json.mockImplementation(async () => { throw new Error('asset source unconfigured') })
  document.body.innerHTML = ''
})

async function mountPane(props = {}) {
  const wrapper = mount(ReplayShotsPane, {
    props: { file: mkFile(), active: true, ...props },
    global: { mocks: { $t: i18n.t }, provide: { [ONBOARDING_KEY]: guideHost } },
    attachTo: document.body,
  })
  const shouldDecode = props.active !== false && !props.blockedReason && props.file !== null
  if (shouldDecode) {
    await vi.waitFor(() => {
      if (!wrapper.text().includes('agentShots.no_shots') && wrapper.findAll('.shot-row').length === 0) {
        throw new Error('still parsing')
      }
    }, { timeout: 3000 })
  }
  await flushPromises()
  return wrapper
}

beforeEach(() => {
    connectivityState.state.value = 'online'
  observers.length = 0
  parseAgentShotsFromBytes.mockReset()
  parseAgentPlaybackFromBytes.mockReset()
  parseAgentPlaybackFromBytes.mockResolvedValue({ vehicles: [] })
  storeShotsForViewer.mockClear()
  shotViewerQuery.mockReset()
  shotViewerQuery.mockImplementation(async (shot) => ({
    view: 'agent-armor', tank: String(shot.target_tank_id || shot.shooter_tank_id),
    ...(shot.shooter_tank_id ? { shooter: String(shot.shooter_tank_id) } : {}),
    shot: String(shot.index),
    ...(shot.is_author && shot.shell_slot != null ? { shell: String(shot.shell_slot) } : {}),
    ...(shot.target_config_idx != null ? { config: String(shot.target_config_idx) } : {}),
    world: '1', heatmap: '1',
  }))
  fetchTankData.mockClear()
})

describe('ReplayShotsPane 文件与激活契约', () => {
  it('没有文件 → 提示先选回放，不解码', async () => {
    const wrapper = await mountPane({ file: null })
    expect(wrapper.get('[data-testid="shots-empty"]').text()).toBe('workspace.capability_upload_hint')
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('多文件未选场次 → 显示工作台给的阻断原因，不解码', async () => {
    const wrapper = await mountPane({ blockedReason: 'workspace.single_replay_required' })
    expect(wrapper.get('[data-testid="shots-blocked"]').text()).toBe('workspace.single_replay_required')
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('未激活时不解码；首次激活才解码一次（切走再切回不重新解码）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [], author_path: 'ok', author_eid: 1, others: baseOthers })
    const wrapper = await mountPane({ active: false })
    await flushPromises()
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(parseAgentShotsFromBytes).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(parseAgentShotsFromBytes).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})


describe('ReplayShotsPane → 装甲查看器交接', () => {
  const hitShot = {
    shots: [{
      index: 2, time_s: 41.2, damage: 0, is_kill: false,
      shooter_eid: 100, shooter_name: 'A158', shooter_tank_id: 19969, is_author: true, shell_slot: 3,
      target_name: 'Maus', target_eid: 200, target_tank_id: 13825, target_config_idx: 1,
      hit_flags: 0x28, game_hit_result: 0, shell_id: 79242,
    }],
    author_path: 'ok', author_eid: 100, others: baseOthers,
  }

  it('compact（手机）：点一发直接进入射击复现，不弹检视面板', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(hitShot)
    const navigate = vi.fn()
    const wrapper = await mountPane({ navigate })
    observers.at(-1).emit(420)
    await nextTick()
    await wrapper.get('[data-testid="shot-row-2"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    expect(navigate).toHaveBeenCalledWith({ query: expect.objectContaining({ view: 'agent-armor', shot: '2' }) })
    wrapper.unmount()
  })

  it('compact（手机）离线：3D 不可用时退回本地射击详情，不丢失这一发', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(hitShot)
    const navigate = vi.fn()
    const wrapper = await mountPane({ navigate })
    connectivityState.state.value = 'offline'
    observers.at(-1).emit(420)
    await nextTick()
    await wrapper.get('[data-testid="shot-row-2"]').trigger('click')
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(true)
    connectivityState.state.value = 'online'
    wrapper.unmount()
  })

  it('compact（手机）点击后、导航前断网：第二次能力检查拒绝导航，退回本地射击详情', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(hitShot)
    let finishQuery
    shotViewerQuery.mockImplementationOnce(() => new Promise((resolve) => { finishQuery = resolve }))
    const navigate = vi.fn()
    const wrapper = await mountPane({ navigate })
    observers.at(-1).emit(420)
    await nextTick()
    await wrapper.get('[data-testid="shot-row-2"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    connectivityState.state.value = 'offline'
    finishQuery({ view: 'agent-armor', shot: '2' })
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(true)
    connectivityState.state.value = 'online'
    wrapper.unmount()
  })

  it('命中弹：先交出射击数据，再把场景参数整个交给 router', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(hitShot)
    const navigate = vi.fn()
    const wrapper = await mountPane({ navigate })
    await wrapper.get('[data-testid="shot-row-2"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="shot-open-viewer"]').trigger('click')
    await flushPromises()

    expect(storeShotsForViewer).toHaveBeenCalledTimes(1)
    expect(storeShotsForViewer.mock.calls[0][0]).toHaveLength(1)
    expect(navigate).toHaveBeenCalledWith({
      query: {
        view: 'agent-armor', tank: '13825', shooter: '19969', shot: '2',
        shell: '3', config: '1', world: '1', heatmap: '1',
      },
    })
    wrapper.unmount()
  })

  it('未命中弹（无目标实体）不给入口，也不交接数据', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{ ...hitShot.shots[0], index: 3, target_eid: null, target_name: '', target_tank_id: 0 }],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const navigate = vi.fn()
    const wrapper = await mountPane({ navigate })
    await wrapper.get('[data-testid="shot-row-3"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="shot-open-viewer"]').exists()).toBe(false)
    expect(storeShotsForViewer).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

it('shooting inputs come from the asset pack: compact projection over tank/{id}.json + shell table fetch', async () => {
  const { fetchShotTankData: realFetchShotTankData } = await vi.importActual('../scene/agentData.js')
  const packTank = {
    name: 'T-34', nation: 'ussr', is_premium: false,
    configs: [
      { pitch_limits: { max: 15, min: -7 }, shell_global_ids: [13, 42], armor: { hull_front: 50 } },
      { shell_global_ids: [42, 91] },
    ],
  }
  const requested = []
  assetProvider.json.mockImplementation(async (path) => {
    requested.push(path)
    if (path === '/tank/101.json') return packTank
    throw new Error(`asset ${path}: HTTP 404`)
  })
  expect(await realFetchShotTankData(101)).toEqual({
    configs: [
      { pitch_limits: { max: 15, min: -7 }, shell_global_ids: [13, 42] },
      { shell_global_ids: [42, 91] },
    ],
  })
  expect(requested).toEqual(['/tank/101.json'])
  await expect(realFetchShotTankData('not-a-tank')).rejects.toThrow('HTTP 404')
})


describe('ReplayShotsPane viewer snapshot lifecycle', () => {
  it('click captures one immutable version for handoff and async query resolution', async () => {
    const live = { index: 1, time_s: 5, shooter_eid: 7, shooter_tank_id: 3649, target_eid: 101, target_tank_id: 1, shell_id: 5914 }
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [live], author_eid: 7, author_path: 'ok' })
    let finishQuery
    shotViewerQuery.mockImplementationOnce(() => new Promise((resolve) => { finishQuery = resolve }))
    const navigate = vi.fn()
    const wrapper = await mountPane({ navigate })
    await wrapper.get('[data-testid="shot-row-1"]').trigger('click')
    await wrapper.get('[data-testid="shot-open-viewer"]').trigger('click')
    live.shooter_config_idx = 0
    expect(shotViewerQuery.mock.calls[0][0].shooter_config_idx).toBeUndefined()
    expect(storeShotsForViewer.mock.calls[0][0][0].shooter_config_idx).toBeUndefined()
    finishQuery({ view: 'agent-armor', scfg: '2' })
    await flushPromises()
    expect(navigate).toHaveBeenCalledWith({ query: { view: 'agent-armor', scfg: '2' } })
    wrapper.unmount()
  })

  it('changing battle during query resolution cancels stale navigation', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [{ index: 1, shooter_eid: 7, shooter_tank_id: 1, target_eid: 9, target_tank_id: 2 }], author_eid: 7 })
    let finishQuery
    shotViewerQuery.mockImplementationOnce(() => new Promise((resolve) => { finishQuery = resolve }))
    const navigate = vi.fn()
    const wrapper = await mountPane({ navigate })
    await wrapper.get('[data-testid="shot-row-1"]').trigger('click')
    await wrapper.get('[data-testid="shot-open-viewer"]').trigger('click')
    await wrapper.setProps({ file: null })
    finishQuery({ view: 'agent-armor' })
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})


describe('ReplayShotsPane 搭载配置注解（评审 P1 回归）', () => {
  it('远端资产请求挂起不得阻塞本地列表发布（WASM 解析完成即出结果）', async () => {
    assetProvider.json.mockImplementationOnce(() => new Promise(() => {}))
    parseAgentPlaybackFromBytes.mockResolvedValue({
      vehicles: [{ eid: 7, nickname: 'A', team: 1, tank_id: 3649, is_author: true, shell_ids: [5914], max_hp: 100 }],
    })
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, time_s: 5, damage: 100, target_name: '林肝美', is_kill: false,
        shooter_eid: 7, target_eid: 101, hit_flags: 0, game_hit_result: 255, shell_id: 5914,
      }],
      author_path: 'ok',
      author_eid: 7,
      others: { ...baseOthers, total_launches: 1 },
    })
    const wrapper = await mountPane()
    expect(wrapper.find('[data-testid="shots-no-shots"]').exists()).toBe(false)
    expect(wrapper.findAll('.shot-row')).toHaveLength(1)
    wrapper.unmount()
  })

  it('俯仰锚定资产挂起：有界等待后降级发布，不被单个请求拖死（评审 P1：真实挂起路径）', async () => {
    vi.useFakeTimers()
    fetchShotTankData.mockImplementation(() => new Promise(() => {}))
    parseAgentPlaybackFromBytes.mockResolvedValue({
      vehicles: [{ eid: 7, nickname: 'A', team: 1, tank_id: 3649, is_author: true }],
    })
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, time_s: 5, damage: 100, target_name: 'B', is_kill: false,
        shooter_eid: 7, shooter_tank_id: 3649, target_eid: 101, hit_flags: 0, game_hit_result: 255, shell_id: 5914,
      }],
      author_path: 'ok',
      author_eid: 7,
      others: baseOthers,
    })
    const wrapper = mount(ReplayShotsPane, {
      props: { file: mkFile(), active: true },
      global: { mocks: { $t: i18n.t } },
      attachTo: document.body,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1501)
    expect(parseAgentShotsFromBytes).toHaveBeenCalledTimes(1)
    const limits = parseAgentShotsFromBytes.mock.calls.at(-1)[1]
    expect(!limits || Object.keys(limits).length === 0).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    expect(wrapper.findAll('.shot-row')).toHaveLength(1)
    wrapper.unmount()
  })
})


describe('ReplayShotsPane 弹表迟到补齐（评审 P2 回归）', () => {
  it('迟到的弹表经响应式视图写入并触发重绘（修复前：原始数组写入不重绘）', async () => {
    let resolveTable
    assetProvider.json.mockImplementation((path) => (
      path === '/data/shellKinds.json'
        ? new Promise((resolve) => { resolveTable = resolve })
        : Promise.reject(new Error('asset source unconfigured'))
    ))
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, time_s: 5, damage: 100, is_kill: false,
        shooter_eid: 100, shooter_name: 'A', target_eid: 200, target_name: 'B',
        hit_flags: 16, game_hit_result: 3, shell_id: 5914,
      }],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountPane()
    await wrapper.get('[data-testid="shot-row-1"]').trigger('click')
    await flushPromises()
    const inspector = () => wrapper.get('[data-testid="shot-inspector"]')
    expect(inspector().text()).not.toContain('APCR')
    resolveTable({ '5914': { type: 'apcr', penetration: 245, damage: 100 } })
    await flushPromises()
    await nextTick()
    expect(inspector().text()).toContain('APCR')
    expect(inspector().text()).toContain('245 mm')
    wrapper.unmount()
  })
})
