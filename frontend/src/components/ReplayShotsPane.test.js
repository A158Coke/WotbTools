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
function guideCompactInspector() { guideActive.value = true; guideSurfaces.shots?.setGuideInset(120) }
afterEach(() => { guideActive.value = false })

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

describe('ReplayShotsPane unmount authorization boundary', () => {
  it('unmount during file read never starts playback or shot parsing', async () => {
    let finishRead
    const file = { name: 'pending.wotbreplay', arrayBuffer: () => new Promise((resolve) => { finishRead = resolve }) }
    const wrapper = mount(ReplayShotsPane, {
      props: { file, active: true },
      global: { mocks: { $t: i18n.t } },
    })
    wrapper.unmount()
    finishRead(new ArrayBuffer(4))
    await flushPromises()
    expect(parseAgentPlaybackFromBytes).not.toHaveBeenCalled()
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
  })

  it('unmount during playback parsing never starts pitch assets or shot parsing', async () => {
    let finishPlayback
    parseAgentPlaybackFromBytes.mockImplementationOnce(() => new Promise((resolve) => { finishPlayback = resolve }))
    const wrapper = mount(ReplayShotsPane, {
      props: { file: { name: 'pending.wotbreplay', arrayBuffer: async () => new ArrayBuffer(4) }, active: true },
      global: { mocks: { $t: i18n.t } },
    })
    await flushPromises()
    expect(parseAgentPlaybackFromBytes).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    finishPlayback({ vehicles: [{ eid: 1, nickname: 'author', tank_id: 1 }] })
    await flushPromises()
    expect(fetchTankData).not.toHaveBeenCalled()
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
  })
})
afterEach(() => {
  fetchShotTankData.mockReset()
  fetchShotTankData.mockImplementation(async () => ({ configs: [] }))
  assetProvider.json.mockReset()
  assetProvider.json.mockImplementation(async () => { throw new Error('asset source unconfigured') })
  document.body.innerHTML = ''
})


describe('ReplayShotsPane author_path fail-visible（评审 blocker 回归）', () => {
  it('author_path=error 且 shots=[] → 警示可见并与空态并存（不得只显示 no_shots）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [],
      author_path: 'error',
      author_error: 'shot #1: 受击者实体 0x123 不在 type=5 名册中',
      author_eid: 7,
      others: baseOthers,
    })
    const wrapper = await mountPane()
    const warn = wrapper.get('[data-testid="shots-author-error"]')
    expect(warn.text()).toContain('agentShots.author_path_error')
    expect(warn.text()).toContain('type=5 名册')
    expect(wrapper.get('[data-testid="shots-no-shots"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('上游 v0.4.20：others 缺失而 others_error 在场 → 独立警示可见（不静默当全 0）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [],
      author_path: 'ok',
      author_eid: 7,
      others_error: '他人路径: shotId=9 非续段发射缺少命中通知窗口（build_notice_windows 不变量破坏）',
    })
    const wrapper = await mountPane()
    const warn = wrapper.get('[data-testid="shots-others-error"]')
    expect(warn.text()).toContain('agentShots.others_error')
    expect(warn.text()).toContain('build_notice_windows')
    wrapper.unmount()
  })

  it('上游 v0.4.20：others 在场 → 无他人警示', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [], author_path: 'ok', author_eid: 7,
      others: { ...baseOthers, total_launches: 12 },
    })
    const wrapper = await mountPane()
    expect(wrapper.find('[data-testid="shots-others-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('author_path=ok → 无警示', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [], author_path: 'ok', author_eid: 7,
      others: { ...baseOthers, total_launches: 12 },
    })
    const wrapper = await mountPane()
    expect(wrapper.find('[data-testid="shots-author-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('author_path=error 但他人路径有 shots → 警示与本人空态并存，全员结果可显式查看', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, time_s: 5, damage: 100, target_name: '林肝美', is_kill: false,
        shooter_eid: 200, target_eid: 101, hit_flags: 0, game_hit_result: 255, shell_id: 0,
      }],
      author_path: 'error',
      author_error: 'boom',
      author_eid: 7,
      others: { ...baseOthers, total_launches: 1 },
    })
    const wrapper = await mountPane()
    expect(wrapper.find('[data-testid="shots-author-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="shots-no-shots"]').exists()).toBe(true)
    expect(wrapper.findAll('.shot-row')).toHaveLength(0)
    await wrapper.get('#shots-shooter-select').setValue('all')
    expect(wrapper.findAll('.shot-row')).toHaveLength(1)
    expect(wrapper.text()).toContain('agentShots.res_hit_unknown')
    expect(wrapper.text()).not.toContain('agentShots.res_miss')
    expect(wrapper.text()).not.toContain('agentShots.res_nopen')
    wrapper.unmount()
  })
})


describe('ReplayShotsPane 数据与筛选', () => {
  it('上游已聚合的单个 Shot 只渲染一行，不按 hit_flags 展开', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, shot_id: 45509301, time_s: 110.26, damage: 0,
        target_name: 'target', target_eid: 200, is_kill: false,
        shooter_eid: 100, shooter_name: 'author', is_author: true,
        hit_flags: 0x28, game_hit_result: 0, shell_id: 79242,
      }],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountPane()
    expect(wrapper.findAll('.shot-row')).toHaveLength(1)
    expect(wrapper.get('[data-stat="shots"] .stat-value').text()).toBe('1')
    expect(wrapper.text()).toContain('agentShots.res_ric')
    expect(wrapper.text()).toContain('01:50')
    expect(wrapper.text()).not.toContain('01:50.')
    wrapper.unmount()
  })

  it('射击者分组三态：未知阵营绝不并入我方（评审 blocker 回归）', async () => {
    parseAgentPlaybackFromBytes.mockResolvedValue({
      vehicles: [
        { eid: 100, nickname: '名雅山庄', team: 1, tank_id: 30085, is_author: true },
        { eid: 200, nickname: '林肝美', team: 2, tank_id: 40085 },
        { eid: 300, nickname: '观察者', team: 0, tank_id: 0 },
      ],
    })
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { index: 1, time_s: 5, damage: 100, target_name: 'x', is_kill: false, shooter_eid: 100, shooter_name: '名雅山庄', target_eid: 200, hit_flags: 16, game_hit_result: 3, shell_id: 0, shooter_team: 'ally' },
        { index: 2, time_s: 6, damage: 100, target_name: 'y', is_kill: false, shooter_eid: 200, shooter_name: '林肝美', target_eid: 100, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'enemy' },
        { index: 3, time_s: 7, damage: 0, target_name: '', is_kill: false, shooter_eid: 300, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: undefined },
      ],
      author_path: 'ok', author_eid: 100, others: { ...baseOthers, total_launches: 3 },
    })
    const wrapper = await mountPane()
    const labels = wrapper.findAll('optgroup').map(g => g.attributes('label'))
    expect(labels).toEqual(['agentShots.allies', 'agentShots.enemies', 'agentShots.unknown_side'])
    const options = wrapper.findAll('option').map(o => o.text())
    expect(options.some(t => t.includes('名雅山庄'))).toBe(true)
    expect(options.some(t => t.includes('林肝美'))).toBe(true)
    expect(options.some(t => t.includes('观察者'))).toBe(true)
    wrapper.unmount()
  })

  it('昵称不可解析时不暴露内部 id，显示「未知玩家」', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, time_s: 5, damage: 0, target_name: '', is_kill: false,
        shooter_eid: 300, target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0,
      }],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountPane()
    expect(wrapper.text()).toContain('agentShots.unknown_player')
    expect(wrapper.text()).not.toContain('eid:')
    expect(wrapper.text()).not.toContain('300')
    wrapper.unmount()
  })

  it('筛选某位射击者后总览随筛选联动', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { index: 1, time_s: 5, damage: 100, is_kill: false, shooter_eid: 100, shooter_name: 'A', target_eid: 200, hit_flags: 16, game_hit_result: 3, shell_id: 0, shooter_team: 'ally' },
        { index: 2, time_s: 6, damage: 0, is_kill: false, shooter_eid: 200, shooter_name: 'B', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'enemy' },
      ],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountPane()
    expect(wrapper.get('[data-stat="shots"] .stat-value').text()).toBe('1')
    await wrapper.get('#shots-shooter-select').setValue('all')
    expect(wrapper.get('[data-stat="shots"] .stat-value').text()).toBe('2')
    expect(wrapper.findAll('#shots-shooter-select option').map(o => o.attributes('value'))).toEqual(['own', 'all', 'player-0', 'player-1'])
    await wrapper.get('#shots-shooter-select').setValue('player-0')
    expect(wrapper.get('[data-stat="shots"] .stat-value').text()).toBe('1')
    expect(wrapper.findAll('.shot-row')).toHaveLength(1)
    wrapper.unmount()
  })
})


describe('ReplayShotsPane Master–Detail 与可访问性', () => {
  const oneShot = {
    shots: [{
      index: 7, time_s: 32.4, damage: 524, is_kill: false,
      shooter_eid: 100, shooter_name: 'A158', shooter_tank_id: 1,
      target_name: 'Maus', target_eid: 200, target_tank_id: 2,
      hit_flags: 16, game_hit_result: 3, shell_id: 79242,
      shell_kind: 'APCR', shell: { type: 'APCR', penetration: 245 },
      ball_a: [0, 0, 0], ball_b: [0, 0, 300],
    }],
    author_path: 'ok', author_eid: 100, others: baseOthers,
  }

  it('射击时间以开战为 00:00（与 2D / 3D 同一时钟），不显示原始回放时钟', async () => {
    parseAgentPlaybackFromBytes.mockResolvedValue({ vehicles: [], periods: [{ clock: 13.4, period: 3 }], meta: { duration: 280 } })
    parseAgentShotsFromBytes.mockResolvedValue({ ...oneShot, shots: [{ ...oneShot.shots[0], time_s: 140.4 }] })
    const wrapper = await mountPane()
    expect(wrapper.get('[data-testid="shot-row-7"] .shot-clock').text()).toBe('02:07')
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="shot-inspector"]').text()).toContain('02:07')
    expect(wrapper.get('[data-testid="shot-inspector"]').text()).not.toContain('02:20')
    wrapper.unmount()
  })

  it('点一行 → 出检视面板（弹种 / 穿深 / 命中 / 弹道长度），关闭后回到该行', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(oneShot)
    const wrapper = await mountPane()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    const inspector = wrapper.get('[data-testid="shot-inspector"]')
    expect(inspector.text()).toContain('agentShots.inspector_title')
    expect(inspector.text()).toContain('APCR')
    expect(inspector.text()).toContain('245 mm')
    expect(inspector.text()).toContain('agentShots.impact_hit')
    expect(inspector.text()).toContain('300.0 m')
    await wrapper.get('[data-testid="shot-detail-close"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('容器 < 600px（教程引导中）→ 检视面板整屏，打开时焦点进入面板，Esc 关闭', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(oneShot)
    const wrapper = await mountPane()
    observers.at(-1).emit(420)
    guideCompactInspector()
    await nextTick()
    expect(wrapper.get('.shots-split').classes()).toContain('is-compact')
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="shot-inspector"]').element)
    await wrapper.get('[data-testid="replay-shots-pane"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('容器 ≥ 900px → 常驻右栏（两列）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(oneShot)
    const wrapper = await mountPane()
    observers.at(-1).emit(1000)
    await nextTick()
    expect(wrapper.get('.shots-split').classes()).toContain('is-expanded')
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.shots-split').classes()).toContain('has-detail')
    wrapper.unmount()
  })

  it('600–899px → 推开式（列表让位，不整屏）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(oneShot)
    const wrapper = await mountPane()
    observers.at(-1).emit(760)
    await nextTick()
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    const split = wrapper.get('.shots-split')
    expect(split.classes()).toContain('is-medium')
    expect(split.classes()).not.toContain('is-compact')
    wrapper.unmount()
  })
})

