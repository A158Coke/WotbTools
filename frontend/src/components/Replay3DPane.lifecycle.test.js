// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  installPaneTestLifecycle, mountPane, mockWebGL, mkFile, flush, start, here, testState,
  nextTick, readFileSync, resolve,
} from './Replay3DPane.test.harness.js'

const { canonical, playback, layout, connectivityState } = testState

installPaneTestLifecycle()

/**
 * 场景生命周期不变量：sceneApi 存在 ⟺ 活的 stage DOM ∧ file ∧ !blocked ∧ WebGL。
 * 这三种变化的产品语义必须分开：active=false 只停帧；file/blocked 变化会销毁场景。
 */
describe('Replay3DPane 场景生命周期', () => {
  it('Test A — file → null 销毁旧场景；给新 file 时在新 stage 上重建，按开始后解析新文件', async () => {
    mockWebGL('webgl2')
    const fileA = mkFile('a.wotbreplay')
    const wrapper = mountPane({ file: fileA })
    await flush()
    const firstApi = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    await start(wrapper)
    expect(firstApi.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file: fileA }))

    // file=null：模板移除 .pb-root（stage 变成游离节点）→ 必须销毁场景，不能继续往它上面画
    await wrapper.setProps({ file: null })
    await flush()
    expect(firstApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.pb-root').exists()).toBe(false)
    expect(wrapper.find('.scene').exists()).toBe(false)
    expect(wrapper.get('[data-testid="replay3d-empty"]').exists()).toBe(true)

    // 新文件：必须是一次**全新的** initPlayback；新场景先待开播，按开始才解析
    const fileB = mkFile('b.wotbreplay')
    await wrapper.setProps({ file: fileB })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    const secondApi = playback.api
    expect(secondApi).not.toBe(firstApi)
    expect(secondApi.loadData).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)
    await start(wrapper)
    expect(secondApi.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file: fileB }))
    // 新场景必须挂在**当前**的 stage 节点上，而不是那个已被移除的旧节点
    expect(wrapper.find('.scene').exists()).toBe(true)
    expect(playback.init.mock.calls[1][0]).toBe(wrapper.get('.scene').element)

    wrapper.unmount()
  })

  it('Test B — blocked 非空销毁场景；解除阻断后重建，按开始后重新解析同一文件', async () => {
    mockWebGL('webgl2')
    const file = mkFile('a.wotbreplay')
    const wrapper = mountPane({ file })
    await flush()
    const firstApi = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    await start(wrapper)
    expect(firstApi.loadData).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ blockedReason: 'workspace.single_replay_required' })
    await flush()
    expect(firstApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="replay3d-blocked"]').text()).toBe('workspace.single_replay_required')
    expect(wrapper.find('.scene').exists()).toBe(false)

    await wrapper.setProps({ blockedReason: '' })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    expect(playback.api).not.toBe(firstApi)
    expect(playback.api.loadData).not.toHaveBeenCalled()
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file }))

    wrapper.unmount()
  })

  it('Test C — active=false 只停帧：不销毁、不重建、不重解析；切回只恢复', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    await start(wrapper)
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

/**
 * 就绪态（store.hasData）契约：它是 HUD 与播放传输的 authoritative gate
 * （`usePlaybackTransport({ isReady: () => store.hasData })`），因此必须在
 * 「新会话被接受」与「会话终止」两个时点落下，绝不能让上一场的 ready 泄漏到新会话。
 */
describe('Replay3DPane 就绪态（hasData）', () => {
  /** 让下一次加载保持挂起（按场景契约翻转 loading / hasData），返回完成句柄 */
  function pendNextLoad(api) {
    let settle
    api.loadData.mockImplementationOnce(() => {
      const store = api.store
      store.hasData = false
      store.loading = true
      return new Promise((resolve) => {
        settle = () => { store.loading = false; store.hasData = true; resolve() }
      })
    })
    return () => settle?.()
  }

  it('A：file=null 销毁会话后就绪态落下', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)      // 按开始后的加载已完成

    await wrapper.setProps({ file: null })
    await flush()
    expect(api.destroy).toHaveBeenCalledTimes(1)
    expect(api.store.hasData).toBe(false)
    expect(api.store.loading).toBe(false)
    wrapper.unmount()
  })

  it('B：被工作台阻断时就绪态落下', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)

    await wrapper.setProps({ blockedReason: 'workspace.single_replay_required' })
    await flush()
    expect(api.destroy).toHaveBeenCalledTimes(1)
    expect(api.store.hasData).toBe(false)
    wrapper.unmount()
  })

  it('C：换文件先撤下上一场（reset）；新加载窗口不得继承上一场的 ready', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)

    // 换场：撤下旧场景（内核 reset）→ 回到待开播，ready 不得留在屏幕上
    await wrapper.setProps({ file: mkFile('b.wotbreplay') })
    await flush()
    expect(api.reset).toHaveBeenCalledTimes(1)
    expect(api.store.hasData).toBe(false)
    expect(wrapper.find('[data-testid="replay3d-toolbar"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)

    // 新加载窗口：HUD / 播放传输都不得按 ready 渲染
    const settle = pendNextLoad(api)
    await start(wrapper)
    expect(api.store.loading).toBe(true)
    expect(api.store.hasData).toBe(false)
    expect(wrapper.find('[data-testid="replay3d-toolbar"]').exists()).toBe(false)

    settle()
    await flush()
    expect(api.store.hasData).toBe(true)
    expect(api.store.loading).toBe(false)
    wrapper.unmount()
  })

  it('卸载销毁会话后就绪态落下', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)

    wrapper.unmount()
    expect(api.store.hasData).toBe(false)
  })
})

describe('Replay3DPane 3D annotation wiring', () => {
  async function openDrawing({ playing = false } = {}) {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    playback.api.store.playing = playing
    await nextTick()
    await wrapper.get('[data-testid="replay3d-drawing-entry"]').trigger('click')
    await flush()
    return wrapper
  }

  it('统一传输条：3D 主进度条带名册入口（与 2D 同位），切换不改变共用按键位置', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const api = playback.api
    api.store.hasData = true
    await nextTick()
    const entry = () => wrapper.get('.pb-controls [data-test="pb-roster-entry"]')
    const pressed = entry().attributes('aria-pressed')
    await entry().trigger('click')
    expect(entry().attributes('aria-pressed')).toBe(pressed === 'true' ? 'false' : 'true')
    wrapper.unmount()
  })

  /**
   * 2026-11-19 用户要求：2D/3D 同一个面板窗口，播放条从场景里拿出来、放到窗口下方通栏。
   * 源码级守卫：根节点必须带 transport-docked；共享 CSS 必须把 controls 放回普通流
   * （否则播放条又变成压在场景底部的 absolute 浮层）。
   */
  it('统一回放面板：3D 根带 transport-docked，播放条在舞台下方通栏（源码守卫）', () => {
    const src = readFileSync(resolve(here, 'Replay3DPane.vue'), 'utf8')
    expect(src).toContain('class="pb-root playback-workspace transport-docked"')
    const css = [
      readFileSync(resolve(here, '../styles/playback-workspace.css'), 'utf8'),
      readFileSync(resolve(here, '../styles/playback-workspace-3d.css'), 'utf8'),
    ].join('\n')
    const docked = /\.pb-root\.playback-workspace\.transport-docked:not\(\.portrait-flow\) > \.controls \{([\s\S]*?)\}/.exec(css)?.[1] ?? ''
    expect(docked).toContain('position: relative')
    expect(docked).toContain('inline-size: 100%')
    expect(docked).toContain('order: 1')
    // 2026-11-19 统一传输条 chrome：与 2D 同一行布局（次级行在上 | 主进度条 | 折叠钮在右）
    expect(docked).toContain('flex-direction: row')
    expect(docked).toContain('padding: 0')
    // 收起态只包按钮（不占满行宽），否则手机横屏折叠不省空间。
    const collapsed = /\.pb-root\.playback-workspace\.transport-docked:not\(\.portrait-flow\) > \.controls\.controls-docked \{([\s\S]*?)\}/.exec(css)?.[1] ?? ''
    expect(collapsed).toContain('inline-size: fit-content')
  })
})

