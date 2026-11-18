// @vitest-environment happy-dom
/**
 * 射击分析面板状态链回归：
 * - author_path="error" 且他人宽松路径 0 发 → 警示必须可见，且与空态并存——
 *   绝不允许只显示"没有射击"把作者链失败伪装成正常空结果（契约 v0.1.9 评审 blocker）；
 * - 射击者筛选三态（未知阵营绝不并入我方）；
 * - Master–Detail：一行一 Shot、选中出检视、窄容器整屏 + 焦点管理；
 * - 术语：界面不得出现内部 id（eid）、WebAssembly / Agent 等实现层词汇。
 */

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

/** happy-dom 没有 ResizeObserver：记录回调以便按容器宽度驱动 Master–Detail 分档 */
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

/** 新手教程表面（ONBOARDING_KEY）：compact 检视面板只在教程引导中出现，测试用它模拟引导态 */
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
  // 只有"应当解码"的场景才等终态（无文件 / 被阻断 / 未激活时不发解码）
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

/**
 * 交接护栏：命中弹的「在装甲查看器里打开」把整份射击数据交出去（本机通道），
 * 并把装甲查看器要读的场景参数**一个不少**地交给 router owner——参数由目的地组件消费，
 * 不能在这里被裁掉（导航层的视图私有 key 清理只作用于"离开场景"方向，见 navigation.test.js）。
 */

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
    // 等待坦克数据期间不弹检视面板
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

    // 交接通道：整份 shots 交出去（查看器按 shot 序号找这一发）
    expect(storeShotsForViewer).toHaveBeenCalledTimes(1)
    expect(storeShotsForViewer.mock.calls[0][0]).toHaveLength(1)
    // 目的地：装甲查看器要读的键一个不少（view / tank / shooter / shot / shell / config / world / heatmap）
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
  // 2026-10-15 起弹种表与搭载输入不再内嵌进前端构建，改由资产包分发
  // （/data/shellKinds.json 与 tank/{id}.json，随上游 tanks.pb 同批更新）：
  // 搭载输入 = fetchShotTankData 对包内 tank/{id}.json 的紧凑投影（config 顺序 +
  // pitch_limits + shell_global_ids），缺车按 assetProvider 的 404 如实拒绝。
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
    // annotateMountedConfigs 的资产请求保持挂起（模拟资产服务卡住）：
    // buildPitchLimits 走 agentData 层不受影响，decode 的前置步骤全部正常完成
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
    // 配置注解仍挂起，但本地射击列表必须已发布（有行 = 不被远端资产卡在解析中）
    expect(wrapper.find('[data-testid="shots-no-shots"]').exists()).toBe(false)
    expect(wrapper.findAll('.shot-row')).toHaveLength(1)
    wrapper.unmount()
  })

  it('俯仰锚定资产挂起：有界等待后降级发布，不被单个请求拖死（评审 P1：真实挂起路径）', async () => {
    // 该表是解析期入参（不能事后补齐）——单个 /tank/{id}.json 永不返回时，
    // 必须在 PITCH_ANCHOR_WAIT_MS 到期后以"已到部分"（此处为空表）继续解析并发布。
    // 直挂载而非 mountPane：后者的 vi.waitFor 会自动推进假时钟，掩盖"仍停在等待上"的边界。
    vi.useFakeTimers()
    fetchShotTankData.mockImplementation(() => new Promise(() => {})) // 永不 resolve
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
    await vi.advanceTimersByTimeAsync(0) // 冲刷微任务：playback 已解析、停在有界等待上
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1501) // 到期即降级继续
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
    // 表未到：无弹种标签（槽位/id 兜底）
    expect(inspector().text()).not.toContain('APCR')
    // 表迟到返回（资产平台慢响应）→ 重绘后同一次检视即见弹种与穿深
    resolveTable({ '5914': { type: 'apcr', penetration: 245, damage: 100 } })
    await flushPromises()
    await nextTick()
    expect(inspector().text()).toContain('APCR')
    expect(inspector().text()).toContain('245 mm')
    wrapper.unmount()
  })
})
