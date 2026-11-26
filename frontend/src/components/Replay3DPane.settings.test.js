// @vitest-environment happy-dom
/**
 * 3D 回放设置面板（Draft / Save）契约：
 * - 入口常驻传输条（齿轮旁），自动播放后仍可打开，不依赖待开播卡片；
 * - 打开时按**当前生效配置**取快照，面板内改动只写 Draft，不触达场景；
 * - Cancel / 关闭 / 无修改 Save 丢弃 Draft 且不调用任何 setter；
 * - Save 只把真实差异下发：live 项各走 setter，render 项合并成**一次** applyRenderSettings
 *   （一次 Save 最多一次重载），炮声只写反馈偏好、不重建渲染器；
 * - 画质降到不支持接地阴影的档位时，Draft 里该开关按场景门禁失效。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installPaneTestLifecycle, mountPane, mockWebGL, flush, start, testState, nextTick, mkFile,
} from './Replay3DPane.test.harness.js'

const cache = vi.hoisted(() => ({ stage: vi.fn(), discard: vi.fn() }))
vi.mock('../replay-local/replayReloadCache.js', () => ({
  stageReplayForReload: cache.stage,
  discardReloadReplay: cache.discard,
}))
const { playback } = testState
installPaneTestLifecycle()
beforeEach(() => {
  cache.stage.mockReset().mockResolvedValue('reload-test')
  cache.discard.mockReset().mockResolvedValue(undefined)
})

/** 开播后打开设置面：入口由传输条常驻渲染，与待开播卡片无关。 */
async function openSettings(wrapper) {
  await wrapper.get('[data-testid="replay3d-settings-toggle"]').trigger('click')
  await nextTick()
}

/** 稳定初值：store 是 mock initPlayback 注入的真实 reactive store，可直接写当前生效配置。 */
async function startedPane() {
  mockWebGL('webgl2')
  const wrapper = mountPane()
  await start(wrapper)
  const { store } = playback.api
  Object.assign(store, {
    qualityKey: 'high', logdepth: false, dynres: true, armorHighlight: false, contactShadows: false,
  })
  await flush()
  return { wrapper, store }
}

function feedback() {
  return JSON.parse(localStorage.getItem('wotb-feedback') || 'null')
}

describe('Replay3DPane 回放设置（Draft / Save）', () => {
  it('开播后入口仍在：打开显示当前生效配置，关闭即丢弃', async () => {
    const { wrapper } = await startedPane()
    expect(wrapper.find('[data-testid="replay3d-settings-toggle"]').exists()).toBe(true)
    await openSettings(wrapper)
    const panel = wrapper.get('[data-testid="replay3d-settings"]')
    expect(panel.attributes('aria-label')).toBe('agentReplay.settings_title')
    expect(panel.get('[data-testid="replay3d-settings-quality"]').findAll('button').map(b => b.attributes('data-value')))
      .toEqual(['low', 'mid', 'high', 'ultra'])
    expect(panel.get('[data-testid="replay3d-settings-quality"] button[data-value="high"]').classes()).toContain('is-active')
    expect(panel.get('[data-testid="settings-logdepth"]').element.checked).toBe(false)
    expect(panel.get('[data-testid="settings-dynres"]').element.checked).toBe(true)
    expect(panel.get('[data-testid="settings-contact-shadows"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="replay3d-settings-cancel"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="replay3d-settings"]').exists()).toBe(false)
    expect(playback.api.applyRenderSettings).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('播放中改 Draft 不立即触达场景；Cancel 后重开仍是原值', async () => {
    const { wrapper, store } = await startedPane()
    await openSettings(wrapper)
    await wrapper.get('[data-testid="settings-armor-highlight"]').setValue(true)
    await wrapper.get('[data-testid="settings-logdepth"]').setValue(true)
    await wrapper.get('[data-testid="replay3d-settings-quality"] button[data-value="low"]').trigger('click')
    await nextTick()
    // Draft 阶段：不写场景、不写 store、不重载
    expect(playback.api.setArmorHighlight).not.toHaveBeenCalled()
    expect(playback.api.applyRenderSettings).not.toHaveBeenCalled()
    expect(store.qualityKey).toBe('high')
    expect(store.logdepth).toBe(false)
    // 降档后接地阴影按门禁失效
    expect(wrapper.get('[data-testid="settings-contact-shadows"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="replay3d-settings-cancel"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="replay3d-settings"]').exists()).toBe(false)
    await openSettings(wrapper)
    expect(wrapper.get('[data-testid="settings-armor-highlight"]').element.checked).toBe(false)
    expect(wrapper.get('[data-testid="settings-logdepth"]').element.checked).toBe(false)
    expect(wrapper.get('[data-testid="replay3d-settings-quality"] button[data-value="high"]').classes()).toContain('is-active')
    expect(playback.api.setArmorHighlight).not.toHaveBeenCalled()
    expect(playback.api.applyRenderSettings).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('无实际修改的 Save 是 no-op：不调用任何 setter，也不重载', async () => {
    const { wrapper } = await startedPane()
    await openSettings(wrapper)
    await wrapper.get('[data-testid="replay3d-settings-save"]').trigger('click')
    await nextTick()
    expect(playback.api.applyRenderSettings).not.toHaveBeenCalled()
    expect(playback.api.setArmorHighlight).not.toHaveBeenCalled()
    expect(playback.api.setContactShadows).not.toHaveBeenCalled()
    expect(feedback()).toBeNull()
    wrapper.unmount()
  })

  it('只改炮声：仅写反馈偏好，不重载、不重建渲染器', async () => {
    const { wrapper } = await startedPane()
    await openSettings(wrapper)
    await wrapper.get('[data-testid="settings-battle-sound"]').setValue(false)
    await wrapper.get('[data-testid="replay3d-settings-save"]').trigger('click')
    await nextTick()
    expect(feedback()).toMatchObject({ battleSound: false })
    expect(playback.api.applyRenderSettings).not.toHaveBeenCalled()
    expect(playback.api.setArmorHighlight).not.toHaveBeenCalled()
    expect(playback.api.setContactShadows).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('多项渲染设置一次 Save：合并成一次 applyRenderSettings（最多一次重载）', async () => {
    const { wrapper } = await startedPane()
    await openSettings(wrapper)
    await wrapper.get('[data-testid="replay3d-settings-quality"] button[data-value="low"]').trigger('click')
    await wrapper.get('[data-testid="settings-logdepth"]').setValue(true)
    await wrapper.get('[data-testid="settings-dynres"]').setValue(false)
    await wrapper.get('[data-testid="replay3d-settings-save"]').trigger('click')
    await nextTick()
    expect(playback.api.applyRenderSettings).toHaveBeenCalledTimes(1)
    expect(playback.api.applyRenderSettings).toHaveBeenCalledWith({ qualityKey: 'low', logdepth: true, dynres: false })
    // 画质不再走旧的 setQuality（面板统一走一次应用入口），也不额外触发第二次
    expect(playback.api.setQuality).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('live 项立即下发；接地阴影与 render 项合并成一次重载应用', async () => {
    const { wrapper, store } = await startedPane()
    await openSettings(wrapper)
    await wrapper.get('[data-testid="settings-armor-highlight"]').setValue(true)
    await wrapper.get('[data-testid="settings-contact-shadows"]').setValue(true)
    await wrapper.get('[data-testid="settings-logdepth"]').setValue(true)
    await wrapper.get('[data-testid="replay3d-settings-save"]').trigger('click')
    await nextTick()
    expect(playback.api.setArmorHighlight).toHaveBeenCalledWith(true)
    expect(playback.api.setContactShadows).not.toHaveBeenCalled()
    expect(playback.api.applyRenderSettings).toHaveBeenCalledTimes(1)
    expect(playback.api.applyRenderSettings).toHaveBeenCalledWith({ logdepth: true, contactShadows: true })
    expect(store.armorHighlight).toBe(true)
    wrapper.unmount()
  })

  it('只改接地阴影：走一次 applyRenderSettings（重载后装配），不直接改当前场景', async () => {
    const { wrapper } = await startedPane()
    await openSettings(wrapper)
    await wrapper.get('[data-testid="settings-contact-shadows"]').setValue(true)
    await wrapper.get('[data-testid="replay3d-settings-save"]').trigger('click')
    await nextTick()
    expect(playback.api.setContactShadows).not.toHaveBeenCalled()
    expect(playback.api.applyRenderSettings).toHaveBeenCalledTimes(1)
    expect(playback.api.applyRenderSettings).toHaveBeenCalledWith({ contactShadows: true })
    wrapper.unmount()
  })

  it('场景宿主收到重载暂存钩子：Render 设置重载前能暂存当前回放（P2-1 wiring）', async () => {
    const { wrapper } = await startedPane()
    // 回归点：钩子必须经 initPlayback 的 options 进入场景宿主；只挂在 Vue parts 上时
    // 场景侧 S.stageReloadReplay 为 undefined，会在真正重载前静默跳过暂存。
    const options = playback.init.mock.calls.at(-1)?.[3]
    expect(typeof options?.stageReloadReplay).toBe('function')
    wrapper.unmount()
  })

  it('重载暂存完整多选批次与当前场次，而不是只存当前文件', async () => {
    const fileA = mkFile('a.wotbreplay')
    const fileB = mkFile('b.wotbreplay')
    mockWebGL('webgl2')
    const wrapper = mountPane({ file: fileA, replayFiles: [fileA, fileB] })
    await start(wrapper)
    const stage = playback.init.mock.calls.at(-1)?.[3]?.stageReloadReplay
    await stage()
    expect(cache.stage).toHaveBeenCalledWith({
      files: [fileA, fileB], currentIndex: 0, demo: false,
    })
    wrapper.unmount()
  })

  it('暂存期间切换场次：只清理本次暂存并中止重载，不把 A 的状态带到 B', async () => {
    const fileA = mkFile('a.wotbreplay')
    const fileB = mkFile('b.wotbreplay')
    mockWebGL('webgl2')
    const wrapper = mountPane({ file: fileA, replayFiles: [fileA, fileB] })
    await start(wrapper)
    const stage = playback.init.mock.calls.at(-1)?.[3]?.stageReloadReplay
    let release
    cache.stage.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const pending = stage()
    await flush()
    await wrapper.setProps({ file: fileB })
    release('reload-stale')
    await expect(pending).rejects.toThrow('Replay selection changed before reload')
    expect(cache.discard).toHaveBeenCalledWith('reload-stale')
    wrapper.unmount()
  })

  it('设置面与 Display 面互斥：打开一个会收起另一个', async () => {
    const { wrapper } = await startedPane()
    await openSettings(wrapper)
    expect(wrapper.find('[data-testid="replay3d-settings"]').exists()).toBe(true)
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="replay3d-settings"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(true)
    await wrapper.get('[data-testid="replay3d-settings-toggle"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="replay3d-settings"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
