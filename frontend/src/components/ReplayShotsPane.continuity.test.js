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
import { KeepAlive, defineComponent, h, nextTick, ref } from 'vue'

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
function guideCompactInspector() { guideActive.value = true; guideSurfaces.shots?.setGuideInset(120) }
afterEach(() => { guideActive.value = false })

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

describe('ReplayShotsPane recorder-first review', () => {
  const own = { index: 1, time_s: 5, shooter_eid: 7, target_eid: 8, shooter_tank_id: 385, target_tank_id: 6929, damage: 400, hit_flags: 16, quality: { shooter_pos_from_muzzle: true } }
  const enemy = { index: 2, time_s: 10, shooter_eid: 8, target_eid: 7, shooter_tank_id: 6929, target_tank_id: 385, damage: 500, game_hit_result: 3 }
  const later = { ...own, index: 3, time_s: 20, damage: 200 }

  it('defaults to recorder identity without depending on is_author flags; all remains explicit', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [{ ...own }, { ...enemy }, { ...later }], author_eid: 7 })
    const wrapper = await mountPane()
    const rows = () => wrapper.findAll('.shot-row').map(row => row.attributes('data-testid'))
    expect(wrapper.get('#shots-shooter-select').element.value).toBe('own')
    expect(rows()).toEqual(['shot-row-1', 'shot-row-3'])
    expect(wrapper.get('[data-stat="damage"] .stat-value').text()).toBe('600')
    await wrapper.get('#shots-shooter-select').setValue('all')
    expect(rows()).toEqual(['shot-row-1', 'shot-row-2', 'shot-row-3'])
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    expect(wrapper.get('#shots-shooter-select').element.value).toBe('all')
    expect(rows()).toHaveLength(3)
    wrapper.unmount()
  })

  it('prepares a cached shooting lesson by restoring own shots and closing the previous inspector', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [{ ...own }, { ...enemy }], author_eid: 7 })
    const registerSurface = vi.fn()
    const wrapper = mount(ReplayShotsPane, { props: { file: mkFile(), active: true },
      global: { mocks: { $t: i18n.t }, provide: { [ONBOARDING_KEY]: { registerSurface } } }, attachTo: document.body })
    await vi.waitFor(() => expect(wrapper.findAll('.shot-row')).toHaveLength(1))
    await wrapper.get('#shots-shooter-select').setValue('all')
    await wrapper.get('[data-testid="shot-row-2"]').trigger('click')
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(true)
    const surface = registerSurface.mock.calls[0][1]
    expect(surface.ready()).toBe(true)
    surface.setGuideInset(240)
    await nextTick()
    expect(wrapper.get('[data-testid="shot-inspector"]').element.style.insetBlockEnd).toBe('240px')
    surface.cleanup()
    await nextTick()
    expect(wrapper.get('[data-testid="shot-inspector"]').element.style.insetBlockEnd).toBe('')
    await surface.prepare()
    await nextTick()
    expect(surface.ready()).toBe(false)
    expect(wrapper.get('#shots-shooter-select').element.value).toBe('own')
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    expect(parseAgentShotsFromBytes).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('zero recorder shots stays empty even when other players have shots', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [{ ...enemy }], author_eid: 7, author_path: 'ok' })
    const wrapper = await mountPane()
    expect(wrapper.findAll('.shot-row')).toHaveLength(0)
    expect(wrapper.get('[data-testid="shots-no-shots"]').text()).toContain('agentShots.no_own_shots')
    expect(wrapper.get('[data-stat="shots"] .stat-value').text()).toBe('0')
    await wrapper.get('[data-testid="shots-no-shots"] button').trigger('click')
    expect(wrapper.findAll('.shot-row')).toHaveLength(1)
    expect(wrapper.get('#shots-shooter-select').element.value).toBe('all')
    wrapper.unmount()
  })

  it('roster identity resolves own shots when author_eid is absent', async () => {
    parseAgentPlaybackFromBytes.mockResolvedValue({ vehicles: [{ eid: 7, nickname: 'Recorder', tank_id: 385, is_author: true }] })
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [{ ...own }, { ...enemy }] })
    const wrapper = await mountPane()
    expect(wrapper.findAll('.shot-row').map(row => row.attributes('data-testid'))).toEqual(['shot-row-1'])
    wrapper.unmount()
  })

  it('tank models lead the list and inspector, names travel with only the selected shooter’s shots', async () => {
    parseAgentPlaybackFromBytes.mockResolvedValue({ vehicles: [
      { eid: 7, nickname: 'Recorder nickname', tank_id: 385, tank_name: 'Progetto 65', is_author: true },
      { eid: 8, nickname: 'Opponent nickname', tank_id: 6929, tank_name: 'Maus' },
    ] })
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [{ ...own }, { ...enemy }, { ...later }, { ...later, index: 4, target_eid: null }], author_eid: 7 })
    const wrapper = await mountPane({ navigate: vi.fn() })
    const row = wrapper.get('[data-testid="shot-row-1"]')
    expect(row.findAll('.shot-name').map(label => label.text())).toEqual(['Progetto 65', 'Maus'])
    expect(row.findAll('.shot-player').map(label => label.text())).toEqual(['Recorder nickname', 'Opponent nickname'])
    await row.trigger('click')
    expect(wrapper.get('.shot-matchup').text()).toContain('Progetto 65')
    expect(wrapper.get('.shot-detail-quality').element.open).toBe(false)
    await wrapper.get('[data-testid="shot-open-viewer"]').trigger('click')
    await flushPromises()
    const saved = storeShotsForViewer.mock.calls[0][0]
    expect(saved.map(shot => shot.index)).toEqual([1, 3])
    expect(saved[0]).toMatchObject({ shooter_tank_name: 'Progetto 65', target_tank_name: 'Maus' })
    expect(saved[0].shooter_tank_class).toBe('Medium tank')
    wrapper.unmount()
  })

  it('uses bundled tank names when roster names are IDs and never exposes a raw unknown tank ID', async () => {
    parseAgentPlaybackFromBytes.mockResolvedValue({ vehicles: [
      { eid: 7, nickname: 'Recorder', tank_id: 385, tank_name: '#385', is_author: true },
      { eid: 8, nickname: 'Opponent', tank_id: 999999, tank_name: '#999999' },
    ] })
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [{ ...own }], author_eid: 7 })
    const wrapper = await mountPane()
    expect(wrapper.get('.shot-row').findAll('.shot-name').map(label => label.text())).toEqual(['Progetto 65', 'agentShots.unknown_tank'])
    expect(wrapper.get('.shot-row').text()).not.toContain('999999')
    wrapper.unmount()
  })

  it('battle switch resets explicit all selection to the new recorder and clears old detail', async () => {
    parseAgentShotsFromBytes.mockResolvedValueOnce({ shots: [{ ...own }, { ...enemy }], author_eid: 7 })
    const wrapper = await mountPane()
    await wrapper.get('#shots-shooter-select').setValue('all')
    await wrapper.get('[data-testid="shot-row-2"]').trigger('click')
    parseAgentShotsFromBytes.mockResolvedValueOnce({ shots: [{ ...own }, { ...enemy }], author_eid: 8 })
    await wrapper.setProps({ file: mkFile('next.wotbreplay') })
    await vi.waitFor(() => expect(wrapper.findAll('.shot-row').map(row => row.attributes('data-testid'))).toEqual(['shot-row-2']))
    expect(wrapper.get('#shots-shooter-select').element.value).toBe('own')
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('a stale parser result cannot republish the previous battle after file clearing', async () => {
    let finishParse
    parseAgentShotsFromBytes.mockImplementationOnce(() => new Promise((resolve) => { finishParse = resolve }))
    const wrapper = mount(ReplayShotsPane, { props: { file: mkFile(), active: true }, global: { mocks: { $t: i18n.t } } })
    await vi.waitFor(() => expect(finishParse).toBeTypeOf('function'))
    await wrapper.setProps({ file: null })
    finishParse({ shots: [{ ...own }], author_eid: 7 })
    await flushPromises()
    expect(wrapper.find('[data-testid="shots-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('.shot-row')).toHaveLength(0)
    wrapper.unmount()
  })
})


it('compact shot inspector traps Tab focus and returns focus when closed', async () => {
  parseAgentShotsFromBytes.mockResolvedValue({ shots: [
    { index: 1, shooter_eid: 7, target_eid: 8, shooter_tank_id: 385, target_tank_id: 6929, quality: { shooter_pos_from_muzzle: true } },
    { index: 2, shooter_eid: 7, target_eid: 8, shooter_tank_id: 385, target_tank_id: 6929 },
  ], author_eid: 7 })
  const wrapper = await mountPane()
  observers.at(-1).emit(420)
  guideCompactInspector()
  await nextTick()
  await wrapper.get('[data-testid="shot-row-1"]').trigger('click')
  await flushPromises()
  const dialog = wrapper.get('[data-testid="shot-inspector"]')
  expect(dialog.attributes('role')).toBe('dialog')
  expect(dialog.attributes('aria-modal')).toBe('true')
  const first = wrapper.get('[data-testid="shot-next"]')
  const last = wrapper.get('.shot-detail-quality summary')
  last.element.focus()
  await last.trigger('keydown', { key: 'Tab' })
  expect(document.activeElement).toBe(first.element)
  await first.trigger('keydown', { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(last.element)
  await wrapper.get('[data-testid="shot-detail-close"]').trigger('click')
  expect(document.activeElement).toBe(wrapper.get('[data-testid="shot-row-1"]').element)
  wrapper.unmount()
})



describe('ReplayShotsPane 自动全屏与连续性（Android 手机 App）', () => {
  const shotsResult = {
    shots: [7, 8].map(index => ({
      index, time_s: 30 + index, damage: 100, is_kill: false,
      shooter_eid: 100, shooter_name: 'A158', shooter_tank_id: 1,
      target_name: 'Maus', target_eid: 200, target_tank_id: 2,
      hit_flags: 16, game_hit_result: 3, shell_id: 79242, shell_kind: 'APCR', shell: { type: 'APCR', penetration: 245 },
      ball_a: [0, 0, 0], ball_b: [0, 0, 300],
    })),
    author_path: 'ok', author_eid: 100, others: baseOthers,
  }

  /** happy-dom 没有 Fullscreen API：request 成功时设置 fullscreenElement 并派发 fullscreenchange */
  function stubFullscreen(root, { reject = false, deferred = null } = {}) {
    const request = vi.fn(async () => {
      if (deferred) await deferred.promise
      if (reject) throw new TypeError('Permission check failed')
      Object.defineProperty(document, 'fullscreenElement', { value: root, configurable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    root.requestFullscreen = request
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    document.exitFullscreen = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    return request
  }
  const exitFullscreen = async () => { await document.exitFullscreen(); await flushPromises() }

  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }))
    parseAgentShotsFromBytes.mockResolvedValue(shotsResult)
  })
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

  async function mountAuto(props, fullscreenOptions) {
    const wrapper = mount(ReplayShotsPane, {
      props: { file: mkFile(), active: true, autoFullscreenToken: 1, ...props },
      global: { mocks: { $t: i18n.t }, provide: { [ONBOARDING_KEY]: guideHost } },
      attachTo: document.body,
    })
    const request = stubFullscreen(wrapper.get('[data-testid="replay-shots-pane"]').element, fullscreenOptions)
    return { wrapper, request }
  }
  const waitRows = (wrapper) => vi.waitFor(() => { if (!wrapper.findAll('.shot-row').length) throw new Error('parsing') }, { timeout: 3000 })

  it('成功就绪后自动进入一次；退出后不重入，且不重解析、选中与筛选保持', async () => {
    const { wrapper, request } = await mountAuto()
    await waitRows(wrapper)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await flushPromises()
    expect(wrapper.find('[data-testid="shots-fullscreen"]').attributes('aria-pressed')).toBe('true')

    await wrapper.get('[data-testid="shot-row-8"]').trigger('click')
    await wrapper.get('[data-testid="shots-shooter-select"]').setValue('all')
    await flushPromises()
    await exitFullscreen()

    expect(wrapper.find('[data-testid="shots-fullscreen"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[data-testid="shot-row-8"]').attributes('aria-current')).toBe('true')
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(true)
    expect(parseAgentShotsFromBytes).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
    // 仍 Ready、重渲染、再次点击行都不会自动重入
    await wrapper.setProps({ blockedReason: '' })
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('新的进入事件（token 递增）再次自动进入；手动全屏按钮保持可用', async () => {
    const { wrapper, request } = await mountAuto()
    await waitRows(wrapper)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await exitFullscreen()
    await wrapper.setProps({ autoFullscreenToken: 2 })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await flushPromises()
    await exitFullscreen()
    await wrapper.get('[data-testid="shots-fullscreen"]').trigger('click')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('被浏览器拒绝：静默失败、不重试，手动按钮可用，列表照常', async () => {
    const { wrapper, request } = await mountAuto({}, { reject: true })
    await waitRows(wrapper)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await flushPromises()
    expect(wrapper.find('[data-testid="shots-fullscreen"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.findAll('.shot-row')).toHaveLength(2)
    await wrapper.setProps({ autoFullscreenToken: 1 })
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('迟到的成功不会让已失活的查看器留在全屏', async () => {
    let release
    const deferred = { promise: new Promise((resolve) => { release = resolve }) }
    const { wrapper, request } = await mountAuto({}, { deferred })
    await waitRows(wrapper)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await wrapper.setProps({ active: false })
    release()
    await flushPromises()
    expect(document.fullscreenElement).toBeNull()
    wrapper.unmount()
  })

  it('KeepAlive 停用：已进入的全屏被交还；请求挂起期间停用则迟到完成也交还；重新激活不自动重入', async () => {
    const show = ref(true)
    const stableFile = mkFile()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const Host = defineComponent({
      setup: () => () => h(KeepAlive, null, show.value ? [h(ReplayShotsPane, { file: stableFile, active: true, autoFullscreenToken: 1 })] : []),
    })
    const wrapper = mount(Host, { global: { mocks: { $t: i18n.t }, provide: { [ONBOARDING_KEY]: guideHost } }, attachTo: document.body })
    const root = wrapper.get('[data-testid="replay-shots-pane"]').element
    const request = stubFullscreen(root, { deferred: { promise: gate } })
    await waitRows(wrapper)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    show.value = false
    await flushPromises()
    release()
    await flushPromises()
    expect(document.fullscreenElement).toBeNull()
    show.value = true
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('非成功就绪（无射击 / 解析失败 / 未激活）不触发', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({ ...shotsResult, shots: [] })
    const empty = await mountAuto()
    await vi.waitFor(() => expect(empty.wrapper.text()).toContain('agentShots.no_shots'))
    await flushPromises()
    expect(empty.request).not.toHaveBeenCalled()
    empty.wrapper.unmount()

    parseAgentShotsFromBytes.mockRejectedValue(new Error('boom'))
    const failed = await mountAuto()
    await vi.waitFor(() => expect(failed.wrapper.find('[data-testid="shots-error"]').exists()).toBe(true))
    expect(failed.request).not.toHaveBeenCalled()
    failed.wrapper.unmount()
  })
})
