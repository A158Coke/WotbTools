// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  installPaneTestLifecycle, mountPane, mockWebGL, mkFile, flush, start, here, testState,
  nextTick, readFileSync, resolve,
} from './Replay3DPane.test.harness.js'

const { canonical, playback, layout, connectivityState } = testState

installPaneTestLifecycle()

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

    await wrapper.setProps({ file: null })
    await flush()
    expect(firstApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.pb-root').exists()).toBe(false)
    expect(wrapper.find('.scene').exists()).toBe(false)
    expect(wrapper.get('[data-testid="replay3d-empty"]').exists()).toBe(true)

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

describe('Replay3DPane 就绪态（hasData）', () => {
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
    expect(api.store.hasData).toBe(true)

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

    await wrapper.setProps({ file: mkFile('b.wotbreplay') })
    await flush()
    expect(api.reset).toHaveBeenCalledTimes(1)
    expect(api.store.hasData).toBe(false)
    expect(wrapper.find('[data-testid="replay3d-toolbar"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)

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

  it('登录且偏好开启：进入 3D 自动解析并播放，不出现待开播遮罩；active 往返不重复开始', async () => {
    mockWebGL('webgl2')
    const file = mkFile('auto.wotbreplay')
    const wrapper = mountPane({ file, autoStartUserId: 'user-a' })
    await flush()
    expect(canonical.load).toHaveBeenCalledTimes(1)
    expect(playback.api.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file }))
    expect(wrapper.find('[data-test="replay3d-start"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(false)

    await wrapper.setProps({ active: false })
    await flush()
    await wrapper.setProps({ active: true })
    await flush()
    expect(canonical.load).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('偏好关闭时保留待开播，手动开始仍可用', async () => {
    mockWebGL('webgl2')
    localStorage.setItem('wotb.pb.3d-auto-start:user-a', '0')
    const wrapper = mountPane({ autoStartUserId: 'user-a' })
    await flush()
    expect(canonical.load).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)
    await start(wrapper)
    expect(canonical.load).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('偏好关闭时，渲染设置重载恢复同一场仍自动开始', async () => {
    mockWebGL('webgl2')
    localStorage.setItem('wotb.pb.3d-auto-start:user-a', '0')
    const file = mkFile('reload.wotbreplay')
    const wrapper = mountPane({ file, autoStartUserId: 'user-a' })
    await flush()
    expect(canonical.load).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)

    await wrapper.setProps({ resumeRequest: { id: 'reload-1', file } })
    await flush()
    expect(canonical.load).toHaveBeenCalledTimes(1)
    expect(playback.api.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file }))
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('偏好关闭时，重载恢复请求在面板挂载前已就绪也自动开始', async () => {
    mockWebGL('webgl2')
    localStorage.setItem('wotb.pb.3d-auto-start:user-b', '0')
    const file = mkFile('reload-before-mount.wotbreplay')
    const wrapper = mountPane({ file, autoStartUserId: 'user-b', resumeRequest: { id: 'reload-before-mount', file } })
    await flush()
    expect(canonical.load).toHaveBeenCalledTimes(1)
    expect(playback.api.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file }))
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('恢复请求绑定恢复出的 File：切到另一场不会把自动重播落到 B', async () => {
    mockWebGL('webgl2')
    localStorage.setItem('wotb.pb.3d-auto-start:user-a', '0')
    const fileA = mkFile('reload-a.wotbreplay')
    const fileB = mkFile('reload-b.wotbreplay')
    const wrapper = mountPane({ file: fileA, autoStartUserId: 'user-a' })
    await flush()
    expect(canonical.load).not.toHaveBeenCalled()

    await wrapper.setProps({ file: fileB, resumeRequest: { id: 'reload-a', file: fileA } })
    await flush()
    expect(canonical.load).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('恢复请求消费后重新挂载另一场：同一请求不得再次自动播放', async () => {
    mockWebGL('webgl2')
    localStorage.setItem('wotb.pb.3d-auto-start:user-a', '0')
    const fileA = mkFile('reload-consume-a.wotbreplay')
    const fileB = mkFile('reload-consume-b.wotbreplay')
    const first = mountPane({ file: fileA, autoStartUserId: 'user-a', resumeRequest: { id: 'reload-consume', file: fileA } })
    await flush()
    expect(canonical.load).toHaveBeenCalledTimes(1)
    expect(first.emitted('resume-consumed')).toHaveLength(1)
    first.unmount()

    canonical.load.mockClear()
    const second = mountPane({ file: fileB, autoStartUserId: 'user-a', resumeRequest: { id: 'reload-consume', file: fileA } })
    await flush()
    expect(canonical.load).not.toHaveBeenCalled()
    second.unmount()
  })

  it('Profile 关闭偏好后，KeepAlive 实例换文件不再自动开始', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane({ file: mkFile('auto-first.wotbreplay'), autoStartUserId: 'user-a' })
    await flush()
    expect(canonical.load).toHaveBeenCalledTimes(1)

    localStorage.setItem('wotb.pb.3d-auto-start:user-a', '0')
    await wrapper.setProps({ file: mkFile('auto-second.wotbreplay') })
    await flush()

    expect(canonical.load).toHaveBeenCalledTimes(1)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('Profile 打开偏好后，KeepAlive 实例在下次激活时自动开始', async () => {
    mockWebGL('webgl2')
    localStorage.setItem('wotb.pb.3d-auto-start:user-a', '0')
    const wrapper = mountPane({ autoStartUserId: 'user-a' })
    await flush()
    expect(canonical.load).not.toHaveBeenCalled()

    localStorage.setItem('wotb.pb.3d-auto-start:user-a', '1')
    await wrapper.setProps({ active: false })
    await flush()
    await wrapper.setProps({ active: true })
    await flush()
    expect(canonical.load).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('无用户 sub 时自动播放不可用，保留手动开始', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane({ autoStartUserId: null })
    await flush()
    expect(canonical.load).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="replay3d-start"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('离线不自动开始；连通性恢复后自动解析一次', async () => {
    mockWebGL('webgl2')
    connectivityState.state.value = 'offline'
    const wrapper = mountPane({ autoStartUserId: 'user-a' })
    await flush()
    expect(canonical.load).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="replay3d-connectivity"]').exists()).toBe(true)

    connectivityState.state.value = 'online'
    await flush()
    expect(canonical.load).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('blocked / 未激活时不自动开始；解除后自动一次', async () => {
    mockWebGL('webgl2')
    const blocked = mountPane({ autoStartUserId: 'user-a', blockedReason: 'workspace.single_replay_required' })
    await flush()
    expect(canonical.load).not.toHaveBeenCalled()
    await blocked.setProps({ blockedReason: '' })
    await flush()
    expect(canonical.load).toHaveBeenCalledTimes(1)
    blocked.unmount()

    canonical.load.mockClear()
    const inactive = mountPane({ autoStartUserId: 'user-a', active: false })
    await flush()
    expect(canonical.load).not.toHaveBeenCalled()
    await inactive.setProps({ active: true })
    await flush()
    expect(canonical.load).toHaveBeenCalledTimes(1)
    inactive.unmount()
  })

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
    expect(docked).toContain('flex-direction: row')
    expect(docked).toContain('padding: 0')
    const collapsed = /\.pb-root\.playback-workspace\.transport-docked:not\(\.portrait-flow\) > \.controls\.controls-docked \{([\s\S]*?)\}/.exec(css)?.[1] ?? ''
    expect(collapsed).toContain('inline-size: fit-content')
  })
})

