// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installWorkspaceTestLifecycle, resetWorkspaceTestState, flushPromises, mountWorkspace,
  withBattles, viewerClocks,
} from './ReplayWorkspace.test.harness.js'

installWorkspaceTestLifecycle()

describe('ReplayWorkspace 统一回放时钟交接', () => {
  beforeEach(() => {
    resetWorkspaceTestState()
  })

  it('2D/3D 切换共享进度：旧 pane 的 currentTime 交给新 pane 的 seek 通道', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    viewerClocks['2d'] = { time: 42.5, playing: true, ready: true, startRaw: 30, speed: 2 }
    viewerClocks['3d'] = { time: 0, playing: false, ready: false, startRaw: 30, speed: 1 }
    await wrapper.get('[data-testid="viewer-mode-3d"]').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent({ name: 'Replay3DPaneMock' }).props('pendingSeek')).toMatchObject({ sec: 72.5, playing: true, speed: 2 })
    viewerClocks['3d'] = { time: 77.25, playing: true, ready: true, startRaw: 30, speed: 2 }
    await wrapper.get('[data-testid="viewer-mode-2d"]').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent({ name: 'BattlePlaybackPanelMock' }).props('seekRequest')).toMatchObject({ sec: 77.25, playing: true, speed: 2 })
    wrapper.unmount()
  })

  it('浏览器前进/后退切 2D/3D 也交接时钟（URL 来源，不反向 navigate）', async () => {
    withBattles(1)
    const navigate = vi.fn()
    const wrapper = mountWorkspace('playback', { navigate })
    await flushPromises()
    navigate.mockClear()
    viewerClocks['2d'] = { time: 10, playing: false, ready: true, startRaw: 30, speed: 1 }
    viewerClocks['3d'] = { time: 0, playing: false, ready: false, startRaw: 30, speed: 1 }
    await wrapper.setProps({ initialCapability: '3d' })
    await flushPromises()
    expect(wrapper.getComponent({ name: 'Replay3DPaneMock' }).props('pendingSeek')).toMatchObject({ sec: 40, playing: false, speed: 1 })
    viewerClocks['3d'] = { time: 70, playing: true, ready: true, startRaw: 30, speed: 2 }
    await wrapper.setProps({ initialCapability: 'playback' })
    await flushPromises()
    expect(wrapper.getComponent({ name: 'BattlePlaybackPanelMock' }).props('seekRequest')).toMatchObject({ sec: 70, playing: true, speed: 2 })
    expect(navigate).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('3D 未就绪（待开播，time=0）切回 2D 时不得重置 2D 进度', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    viewerClocks['2d'] = { time: 30, playing: false, ready: true, startRaw: 30, speed: 1 }
    await wrapper.get('[data-testid="viewer-mode-3d"]').trigger('click')
    await flushPromises()
    viewerClocks['3d'] = { time: 0, playing: false, ready: false, startRaw: 30, speed: 1 }
    await wrapper.get('[data-testid="viewer-mode-2d"]').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent({ name: 'BattlePlaybackPanelMock' }).props('seekRequest') ?? null).toBeNull()
    wrapper.unmount()
  })

  it('信息流行点击：原始事件时间在 2D 下换算成战斗相对秒', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    viewerClocks['2d'].ready = true
    viewerClocks['2d'].startRaw = 30
    wrapper.getComponent({ name: 'ReplayEventStreamPaneMock' }).vm.$emit('seek', 60)
    await flushPromises()
    expect(wrapper.getComponent({ name: 'BattlePlaybackPanelMock' }).props('seekTo')).toBe(30)
    wrapper.unmount()
  })
})
