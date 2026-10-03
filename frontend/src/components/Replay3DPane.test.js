// @vitest-environment happy-dom
/**
 * 3D 回放面板（Replay3DPane）契约：
 * - WebGL 预检（不支持时不初始化场景，整块换说明）；
 * - 文件由工作台派生（面板自己不选文件）：切文件重新解析、同一文件不重复解析；
 * - `active` 闸门：切走停帧但不销毁会话、键盘不再被劫持；切回不重新解析；
 * - 解析失败可重试同一份文件（不必再选一次）；
 * - HUD 阵营色走语义 token（阵容 / 胜负横幅不再写死红绿）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import Replay3DPane from './Replay3DPane.vue'

const playback = vi.hoisted(() => ({ api: null, init: null }))
vi.mock('../scene/playbackScene.js', () => {
  playback.init = vi.fn((container, store) => {
    playback.api = {
      store,
      loadData: vi.fn(async () => {}),
      destroy: vi.fn(),
      setPlaying: vi.fn(),
      seekBy: vi.fn(),
      setSpeed: vi.fn(),
      seekTime: vi.fn(),
      setCam: vi.fn(),
      setFollow: vi.fn(),
      setGlb: vi.fn(),
      setLabels: vi.fn(),
      setQuality: vi.fn(),
      setPaused: vi.fn(),
    }
    return playback.api
  })
  return { initPlayback: playback.init, QUALITY_PRESETS: { low: { label: 'Low' }, mid: { label: 'Mid' }, high: { label: 'High' } } }
})
vi.mock('../scene/assetProvider.js', () => ({ assetProvider: { configured: () => true } }))
vi.mock('../composables/useBreakpoint.js', async () => {
  const { computed } = await import('vue')
  return { usePointer: () => ({ coarse: computed(() => false) }) }
})
// 唯一 reactive 主题源：给 HUD 阵营色一个可依赖的 profile ref
vi.mock('../composables/useUiProfile.js', async () => {
  const { ref } = await import('vue')
  return { uiProfile: ref('showcase'), useUiProfile: () => ({ uiProfile: ref('showcase') }) }
})
const translate = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('zh'), t: translate, te: () => false }),
}))

/** WebGL 模拟：'webgl2' | 'none' */
function mockWebGL(level) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (name) {
    return level === 'webgl2' && name === 'webgl2' ? { getExtension: () => ({ loseContext() {} }) } : null
  })
}

const mkFile = (name) => new File(['x'], name)

/** props 变化后的 flush：watcher 是 post-flush（要等模板刷新出 stage 节点） */
async function flush() {
  await nextTick()
  await nextTick()
}

function mountPane(props = {}) {
  return mount(Replay3DPane, {
    props: { file: mkFile('battle.wotbreplay'), active: true, ...props },
    global: { mocks: { $t: translate } },
  })
}

beforeEach(() => {
  playback.api = null
  playback.init?.mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('Replay3DPane', () => {
  it('不支持 WebGL：不初始化场景，显示说明', () => {
    mockWebGL('none')
    const wrapper = mountPane()
    expect(playback.init).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="scene3d-unsupported"]').text()).toContain('scene3d.webgl_unavailable')
    wrapper.unmount()
  })

  it('没有文件 / 被工作台阻断时不初始化场景，也不自己开文件选择器', () => {
    mockWebGL('webgl2')
    const empty = mountPane({ file: null })
    expect(playback.init).not.toHaveBeenCalled()
    expect(empty.get('[data-testid="replay3d-empty"]').text()).toBe('agentReplay.no_file')
    expect(empty.find('input[type="file"]').exists()).toBe(false)
    empty.unmount()

    const blocked = mountPane({ blockedReason: 'workspace.single_replay_required' })
    expect(blocked.get('[data-testid="replay3d-blocked"]').text()).toBe('workspace.single_replay_required')
    blocked.unmount()
  })

  it('有文件即用工作台派生文件加载一次；同一文件不重复解析', async () => {
    mockWebGL('webgl2')
    const file = mkFile('battle.wotbreplay')
    const wrapper = mountPane({ file })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(1)
    expect(playback.api.loadData).toHaveBeenCalledWith({ kind: 'local', file })
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flush()
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('换目标回放 → 重新解析新文件（不要求用户重新选）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    const next = mkFile('b2.wotbreplay')
    await wrapper.setProps({ file: next })
    await flush()
    expect(playback.api.loadData).toHaveBeenLastCalledWith({ kind: 'local', file: next })
    wrapper.unmount()
  })

  it('active 闸门：切走 setPaused(true)、切回 setPaused(false)，且不销毁场景', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    expect(playback.api.setPaused).toHaveBeenLastCalledWith(false)
    playback.api.setPaused.mockClear()
    await wrapper.setProps({ active: false })
    expect(playback.api.setPaused).toHaveBeenCalledWith(true)
    expect(playback.api.destroy).not.toHaveBeenCalled()
    await wrapper.setProps({ active: true })
    expect(playback.api.setPaused).toHaveBeenLastCalledWith(false)
    wrapper.unmount()
    expect(playback.api.destroy).toHaveBeenCalledTimes(1)
  })

  it('解析中为不确定进度，资产阶段显示资产进度；失败后可重试同一文件或关闭', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const { store } = playback.api

    let finish
    playback.api.loadData.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await wrapper.setProps({ file: mkFile('c.wotbreplay') })
    await flush()
    expect(wrapper.get('[data-testid="scene3d-loading"]').text()).toContain('agentReplay.parsing')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()

    store.assetStage = true
    store.assetProgress = 0.3
    await nextTick()
    expect(wrapper.get('[data-testid="scene3d-loading"]').text()).toContain('agentReplay.loading_assets')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('30')

    store.err = 'bad replay'
    store.assetStage = false
    finish()
    await flush()
    expect(wrapper.get('[data-testid="scene3d-error"]').text()).toContain('agentReplay.error_load')
    await wrapper.get('[data-testid="scene3d-retry"]').trigger('click')
    await flush()
    expect(playback.api.loadData).toHaveBeenLastCalledWith({ kind: 'local', file: wrapper.props('file') })

    store.err = 'still bad'
    await nextTick()
    await wrapper.get('[data-testid="scene3d-dismiss"]').trigger('click')
    expect(store.err).toBe('')
    expect(wrapper.find('[data-testid="scene3d-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('HUD 阵营色取语义 token（inject 的 --color-team-* 生效），不写死红绿', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    // 阵容条目的真实形状来自 playbackScene 的 buildRoster（无 team 字段，分组即阵营）
    store.roster = {
      team1: [{ eid: 1, nick: 'A', tank: 'T-62A', frac: 50, dead: false, followed: false, dot: '#26794a' }],
      team2: [{ eid: 2, nick: 'B', tank: 'Maus', frac: 100, dead: false, followed: false, dot: '#98322a' }],
      unknown: [{ eid: 3, nick: 'C', tank: '', frac: 100, dead: false, followed: false, dot: '#f5f5f5' }],
    }
    document.documentElement.style.setProperty('--color-team-ally', 'rgb(1, 2, 3)')
    document.documentElement.style.setProperty('--color-team-enemy', 'rgb(4, 5, 6)')
    await nextTick()
    const dots = wrapper.findAll('.pl .dot')
    expect(dots).toHaveLength(3)
    expect(dots[0].attributes('style')).toContain('rgb(1, 2, 3)')
    expect(dots[1].attributes('style')).toContain('rgb(4, 5, 6)')
    // 未知阵营既不并入我方也不并入敌方（用中性色）
    expect(dots[2].attributes('style')).not.toContain('rgb(1, 2, 3)')
    expect(dots[2].attributes('style')).not.toContain('rgb(4, 5, 6)')
    // 分组标题三语（未知阵营独立一段）
    expect(wrapper.findAll('.roster h3').map(h => h.text())).toEqual([
      'agentReplay.team1', 'agentReplay.team2', 'agentReplay.teamUnknown',
    ])
    document.documentElement.style.removeProperty('--color-team-ally')
    document.documentElement.style.removeProperty('--color-team-enemy')
    wrapper.unmount()
  })

  it('播放传输控件是 2D / 3D 共用的那一套（同一组 data-test 契约）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    playback.api.store.hasData = true
    playback.api.store.duration = 300
    await nextTick()
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-speed-0.5"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-time"]').exists()).toBe(true)
    // 3D 专属控件在独立 toolbar 行里，不混进传输控件
    expect(wrapper.get('[data-testid="replay3d-toolbar"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

/**
 * 场景生命周期不变量：sceneApi 存在 ⟺ 活的 stage DOM ∧ file ∧ !blocked ∧ WebGL。
 * 这三种变化的产品语义必须分开：active=false 只停帧；file/blocked 变化会销毁场景。
 */
describe('Replay3DPane 场景生命周期', () => {
  it('Test A — file → null 销毁旧场景；给新 file 时在新 stage 上重建并解析新文件', async () => {
    mockWebGL('webgl2')
    const fileA = mkFile('a.wotbreplay')
    const wrapper = mountPane({ file: fileA })
    await flush()
    const firstApi = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    expect(firstApi.loadData).toHaveBeenCalledWith({ kind: 'local', file: fileA })

    // file=null：模板移除 .pb-root（stage 变成游离节点）→ 必须销毁场景，不能继续往它上面画
    await wrapper.setProps({ file: null })
    await flush()
    expect(firstApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.pb-root').exists()).toBe(false)
    expect(wrapper.find('.scene').exists()).toBe(false)
    expect(wrapper.get('[data-testid="replay3d-empty"]').exists()).toBe(true)

    // 新文件：必须是一次**全新的** initPlayback，并解析新文件
    const fileB = mkFile('b.wotbreplay')
    await wrapper.setProps({ file: fileB })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    const secondApi = playback.api
    expect(secondApi).not.toBe(firstApi)
    expect(secondApi.loadData).toHaveBeenCalledWith({ kind: 'local', file: fileB })
    // 新场景必须挂在**当前**的 stage 节点上，而不是那个已被移除的旧节点
    expect(wrapper.find('.scene').exists()).toBe(true)
    expect(playback.init.mock.calls[1][0]).toBe(wrapper.get('.scene').element)

    wrapper.unmount()
  })

  it('Test B — blocked 非空销毁场景；解除阻断后重建并重新解析同一文件', async () => {
    mockWebGL('webgl2')
    const file = mkFile('a.wotbreplay')
    const wrapper = mountPane({ file })
    await flush()
    const firstApi = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ blockedReason: 'workspace.single_replay_required' })
    await flush()
    expect(firstApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="replay3d-blocked"]').text()).toBe('workspace.single_replay_required')
    expect(wrapper.find('.scene').exists()).toBe(false)

    await wrapper.setProps({ blockedReason: '' })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    expect(playback.api).not.toBe(firstApi)
    expect(playback.api.loadData).toHaveBeenCalledWith({ kind: 'local', file })

    wrapper.unmount()
  })

  it('Test C — active=false 只停帧：不销毁、不重建、不重解析；切回只恢复', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    expect(api.loadData).toHaveBeenCalledTimes(1)
    api.setPaused.mockClear()

    await wrapper.setProps({ active: false })
    await flush()
    expect(api.setPaused).toHaveBeenCalledWith(true)
    expect(api.destroy).not.toHaveBeenCalled()
    expect(playback.init).toHaveBeenCalledTimes(1)
    expect(api.loadData).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ active: true })
    await flush()
    expect(api.setPaused).toHaveBeenLastCalledWith(false)
    expect(api.destroy).not.toHaveBeenCalled()
    expect(playback.init).toHaveBeenCalledTimes(1)
    expect(api.loadData).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('卸载销毁且只销毁一次', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    wrapper.unmount()
    expect(api.destroy).toHaveBeenCalledTimes(1)
  })

  it('无 WebGL 时不建场景，也不因 file 变化而建', async () => {
    mockWebGL('none')
    const wrapper = mountPane()
    await flush()
    expect(playback.init).not.toHaveBeenCalled()
    await wrapper.setProps({ file: mkFile('b.wotbreplay') })
    await flush()
    expect(playback.init).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
