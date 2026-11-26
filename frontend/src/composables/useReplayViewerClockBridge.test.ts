import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { resetViewerClocks, viewerClocks } from '../scene/playback/viewerClockSync.js'
import { useReplayViewerClockBridge } from './useReplayViewerClockBridge.js'

type Cap = 'data' | 'playback' | '3d' | 'events' | 'shots' | 'ai'

function harness(initial: Cap) {
  const activeCapability = ref<string>(initial)
  const switches: Array<{ key: string; navigate: boolean }> = []
  const bridge = useReplayViewerClockBridge({
    viewerMode: { get value() { return activeCapability.value === '3d' ? '3d' : '2d' } },
    activeCapability,
    switchCapability: (key, navigate) => {
      switches.push({ key, navigate })
      activeCapability.value = key
    },
  })
  return { bridge, switches }
}

describe('useReplayViewerClockBridge 路由交接边界', () => {
  it('3D → 数据页 → Back 回 3D：保留 3D 自己的时钟，不投旧 2D 进度', () => {
    resetViewerClocks()
    viewerClocks['2d'] = { time: 10, playing: false, ready: true, startRaw: 30, speed: 1 }
    viewerClocks['3d'] = { time: 70, playing: true, ready: true, startRaw: 30, speed: 2 }
    const { bridge } = harness('3d')
    bridge.applyCapabilityFromRoute('data')
    expect(bridge.pending3dSeek.value).toBeNull()
    bridge.applyCapabilityFromRoute('3d')
    expect(bridge.pending3dSeek.value).toBeNull()
  })

  it('events ↔ playback 同属 2D：URL 变化不发无谓 seek', () => {
    resetViewerClocks()
    viewerClocks['2d'] = { time: 10, playing: false, ready: true, startRaw: 30, speed: 1 }
    const { bridge } = harness('playback')
    bridge.applyCapabilityFromRoute('events')
    expect(bridge.playbackSeekRequest.value).toBeNull()
    bridge.applyCapabilityFromRoute('playback')
    expect(bridge.playbackSeekRequest.value).toBeNull()
  })

  it('2D → 3D：真实模式变化仍交接（含播放态与倍速）', () => {
    resetViewerClocks()
    viewerClocks['2d'] = { time: 42.5, playing: true, ready: true, startRaw: 30, speed: 2 }
    viewerClocks['3d'] = { time: 0, playing: false, ready: false, startRaw: 30, speed: 1 }
    const { bridge } = harness('playback')
    bridge.applyCapabilityFromRoute('3d')
    expect(bridge.pending3dSeek.value).toMatchObject({ sec: 72.5, playing: true, speed: 2 })
  })

  it('2D 未就绪时事件跳转保留原始时间，canonical 就绪后再换算', async () => {
    resetViewerClocks()
    viewerClocks['2d'] = { time: 0, playing: false, ready: false, startRaw: 0, speed: 1 }
    const { bridge } = harness('events')
    bridge.onEventSeek(60)
    expect(bridge.playbackSeek.value).toBeNull()
    Object.assign(viewerClocks['2d'], { ready: true, startRaw: 30 })
    await nextTick()
    await nextTick()
    expect(bridge.playbackSeek.value).toBe(30)
  })

  it('URL watcher 从不反向 navigate', () => {
    resetViewerClocks()
    const { bridge, switches } = harness('playback')
    bridge.applyCapabilityFromRoute('3d')
    bridge.applyCapabilityFromRoute('data')
    bridge.applyCapabilityFromRoute('playback')
    expect(switches.every(s => s.navigate === false)).toBe(true)
  })
})
