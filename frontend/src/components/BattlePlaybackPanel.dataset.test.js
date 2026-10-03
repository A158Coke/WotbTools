// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ReplayEngineUnavailableError } from '../replay-local/parseReplays.js'
import BattlePlayback from './BattlePlayback.vue'
import BattlePlaybackPanel from './BattlePlaybackPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, te: () => false, locale: { value: 'zh' } }),
}))

// 服务器没有 parser：2D 回放在本机解析。mock 本地解析入口，组件只负责生命周期与状态机。
const playback = vi.hoisted(() => ({ parseLocalPlayback: vi.fn() }))
vi.mock('../replay-local/playback/index.js', () => playback)

function dataset(overrides = {}) {
  return {
    durationSec: 300, mapCode: 'holland', friendlyTeam: 1, recorderAccountId: 42, arenaBonusType: 1,
    capability: 'FULL', limitations: [], vehicles: [], events: [], pointsSamples: [], baseStates: [],
    ...overrides,
  }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function mountPanel(props = {}) {
  return mount(BattlePlaybackPanel, {
    props: { file: new File(['a'], 'a.wotbreplay'), active: true, ...props },
    global: {
      mocks: { $t: key => key },
      stubs: {
        MapOverview: { props: ['overview'], template: '<div class="map-stub" data-test="map-stub">{{ overview.mapCode }}</div>' },
        BattlePlayback: { props: ['overview', 'playbackV2', 'reloadTelemetry'], template: '<div data-test="pb-stub">{{ overview.mapCode }}</div>' },
        BattleMap3D: true,
        teleport: true,
      },
    },
  })
}

const find = (wrapper, id) => wrapper.find(`[data-test="${id}"]`)

describe('BattlePlaybackPanel local playback parse', () => {
  beforeEach(() => {
    playback.parseLocalPlayback.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows LOADING while the local parse is pending, then FULL with BattlePlayback + map overlay', async () => {
    const pending = deferred()
    playback.parseLocalPlayback.mockReturnValue(pending.promise)
    const file = new File(['a'], 'a.wotbreplay')
    const wrapper = mountPanel({ file })

    expect(playback.parseLocalPlayback).toHaveBeenCalledWith(file)
    expect(find(wrapper, 'pb-loading').exists()).toBe(true)

    pending.resolve({ dataset: dataset(), overview: { mapCode: 'holland-overview' }, result: {} })
    await flushPromises()

    expect(find(wrapper, 'pb-loading').exists()).toBe(false)
    expect(find(wrapper, 'pb-capability-partial').exists()).toBe(false)
    // V2 是核心事实源：mapCode 取 dataset，MapOverview 只补 overlay
    expect(find(wrapper, 'pb-stub').text()).toBe('holland')
    expect(find(wrapper, 'map-stub').text()).toBe('holland-overview')
  })

  it('capability=PARTIAL → honest degradation note and BattlePlayback still renders', async () => {
    playback.parseLocalPlayback.mockResolvedValue({ dataset: dataset({ capability: 'PARTIAL' }), overview: null, result: {} })
    const wrapper = mountPanel()
    await flushPromises()

    expect(find(wrapper, 'pb-capability-partial').text()).toContain('recon.playback.partial')
    expect(find(wrapper, 'pb-stub').exists()).toBe(true)
    // 没有 overview：地图副视图显式不可用
    expect(find(wrapper, 'map-unavailable').exists()).toBe(true)
  })

  it('passes Playback reload telemetry to the 2D consumer and discards it on file changes', async () => {
    const reloadTelemetry = { timeOrigin: 40, friendlyTeam: 1, vehicles: [{ eid: 7, account_id: 42, team: 1 }], reloads: [] }
    // 两点注意：
    //  1. BattlePlayback 受 `v-if="pbOverview"` 保护（没有地图副视图就不挂载播放器），
    //     所以必须给 overview，否则找不到组件；
    //  2. BattlePlayback.vue 没有 name 选项，`findComponent({ name })` 恒为空
    //     ——按组件定义查找；stub 也带 data-test="pb-stub" 便于断言已挂载。
    playback.parseLocalPlayback.mockResolvedValueOnce({
      dataset: dataset(), overview: { mapCode: 'holland-overview' }, result: {}, reloadTelemetry,
    })
    const wrapper = mountPanel()
    await flushPromises()
    expect(find(wrapper, 'pb-stub').exists()).toBe(true)
    expect(wrapper.findComponent(BattlePlayback).props('reloadTelemetry')).toEqual(reloadTelemetry)
    playback.parseLocalPlayback.mockResolvedValueOnce({
      dataset: dataset(), overview: { mapCode: 'holland-overview' }, result: {}, reloadTelemetry: null,
    })
    await wrapper.setProps({ file: new File(['b'], 'b.wotbreplay') })
    await flushPromises()
    // 换文件必须丢弃上一场的装填遥测（否则会把 A 场的装填画到 B 场上）
    expect(wrapper.findComponent(BattlePlayback).props('reloadTelemetry')).toBeUndefined()
    wrapper.unmount()
  })

  it('null dataset → explicit UNAVAILABLE without retry; overview still usable in map view', async () => {
    playback.parseLocalPlayback.mockResolvedValue({ dataset: null, overview: { mapCode: 'lagoon' }, result: {} })
    const wrapper = mountPanel()
    await flushPromises()

    expect(find(wrapper, 'pb-unavailable').text()).toContain('recon.playback.unavailable')
    expect(find(wrapper, 'pb-retry').exists()).toBe(false)
    expect(find(wrapper, 'pb-stub').exists()).toBe(false)
    expect(find(wrapper, 'map-stub').text()).toBe('lagoon')
  })

  it('engine unavailable → recon.playback.engine_unavailable + retry', async () => {
    playback.parseLocalPlayback.mockRejectedValue(new ReplayEngineUnavailableError('wasm missing'))
    const wrapper = mountPanel()
    await flushPromises()

    const error = find(wrapper, 'pb-error')
    expect(error.text()).toContain('recon.playback.engine_unavailable')
    expect(find(wrapper, 'pb-retry').exists()).toBe(true)
  })

  it('per-file parse failure → recon.playback.parse_failed + retry', async () => {
    playback.parseLocalPlayback.mockRejectedValue(new Error('corrupt replay'))
    const wrapper = mountPanel()
    await flushPromises()

    expect(find(wrapper, 'pb-error').text()).toContain('recon.playback.parse_failed')
    expect(find(wrapper, 'map-unavailable').exists()).toBe(true)
  })

  it('retry re-parses the same file: ERROR → LOADING → FULL', async () => {
    const second = deferred()
    playback.parseLocalPlayback
      .mockRejectedValueOnce(new Error('transient'))
      .mockReturnValueOnce(second.promise)
    const wrapper = mountPanel()
    await flushPromises()
    expect(find(wrapper, 'pb-error').exists()).toBe(true)

    await find(wrapper, 'pb-retry').trigger('click')
    expect(playback.parseLocalPlayback).toHaveBeenCalledTimes(2)
    expect(find(wrapper, 'pb-loading').exists()).toBe(true)

    second.resolve({ dataset: dataset(), overview: null, result: {} })
    await flushPromises()
    expect(find(wrapper, 'pb-error').exists()).toBe(false)
    expect(find(wrapper, 'pb-stub').exists()).toBe(true)
  })

  it('does not parse while inactive; parses once on activation and never re-parses the same file', async () => {
    playback.parseLocalPlayback.mockResolvedValue({ dataset: dataset(), overview: null, result: {} })
    const wrapper = mountPanel({ active: false })
    await flushPromises()
    expect(playback.parseLocalPlayback).not.toHaveBeenCalled()

    await wrapper.setProps({ active: true })
    await flushPromises()
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(playback.parseLocalPlayback).toHaveBeenCalledTimes(1)
  })

  it('a stale result for the previous file is discarded when the file changes mid-parse', async () => {
    const parseA = deferred()
    const parseB = deferred()
    const fileA = new File(['a'], 'a.wotbreplay')
    const fileB = new File(['b'], 'b.wotbreplay')
    playback.parseLocalPlayback.mockImplementation(f => (f.name === fileA.name ? parseA.promise : parseB.promise))
    const wrapper = mountPanel({ file: fileA })

    await wrapper.setProps({ file: fileB })
    expect(playback.parseLocalPlayback).toHaveBeenLastCalledWith(fileB)

    parseB.resolve({ dataset: dataset({ mapCode: 'B' }), overview: null, result: {} })
    await flushPromises()
    // A 迟到（成功或失败）都不得覆盖 B
    parseA.resolve({ dataset: dataset({ mapCode: 'A' }), overview: null, result: {} })
    await flushPromises()
    expect(find(wrapper, 'pb-stub').text()).toBe('B')

    const parseC = deferred()
    const fileC = new File(['c'], 'c.wotbreplay')
    playback.parseLocalPlayback.mockImplementation(f => (f.name === fileC.name
      ? parseC.promise
      : Promise.resolve({ dataset: dataset({ mapCode: 'B2' }), overview: null, result: {} })))
    await wrapper.setProps({ file: fileC })
    await wrapper.setProps({ file: fileB })
    await flushPromises()
    parseC.reject(new Error('late failure'))
    await flushPromises()
    expect(find(wrapper, 'pb-error').exists()).toBe(false)
    expect(find(wrapper, 'pb-stub').text()).toBe('B2')
  })

  it('blockedReason shows the workspace message instead of the panel', () => {
    playback.parseLocalPlayback.mockResolvedValue({ dataset: dataset(), overview: null, result: {} })
    const wrapper = mountPanel({ file: null, blockedReason: 'workspace.single_replay_required' })

    expect(find(wrapper, 'map-dataset-status').text()).toBe('workspace.single_replay_required')
    expect(find(wrapper, 'map-panel').exists()).toBe(false)
    expect(playback.parseLocalPlayback).not.toHaveBeenCalled()
  })

  it('no file → empty hint, no parse', () => {
    const wrapper = mountPanel({ file: null })
    expect(wrapper.text()).toContain('workspace.playback_empty')
    expect(playback.parseLocalPlayback).not.toHaveBeenCalled()
  })
})
