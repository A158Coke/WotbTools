// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { isInteractiveTarget, usePlaybackTransport } from './usePlaybackTransport.js'
import type { PlaybackTransportAdapter } from './usePlaybackTransport.js'
import { isTextEntryTarget, isFlySpeedIndex, groundPanOffset, classifyTwoFinger } from './useSceneFlyControls.js'
import { usePlaybackFullscreen } from './usePlaybackFullscreen.js'
import type { PlaybackFullscreenOptions } from './usePlaybackFullscreen.js'

function makeAdapter(): PlaybackTransportAdapter {
  return { isPlaying: () => false, play: () => {}, pause: () => {}, step: () => {} }
}

describe('C5 composable 边界的编译期负向证明', () => {
  it('usePlaybackTransport：adapter 缺核心方法编译失败；键盘事件形状', () => {
    const transport = usePlaybackTransport(makeAdapter(), { keyboard: false })
    expect(transport.isScrubbing()).toBe(false)
    // @ts-expect-error — negative compile proof: adapter 缺 step（±5s 跳秒无落点）编译失败
    const incomplete: PlaybackTransportAdapter = { isPlaying: () => false, play: () => {}, pause: () => {} }
    expect(incomplete).toBeTruthy()
    expect(isInteractiveTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isInteractiveTarget(null)).toBe(false)
  })

  it('useSceneFlyControls：文本输入判定与触屏几何入参', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'button' })).toBe(false)
    expect(isFlySpeedIndex(3)).toBe(true)
    expect(isFlySpeedIndex('3')).toBe(false)
    expect(groundPanOffset({ x: 1, y: -1, z: 0 }, 5)).toEqual({ x: 5, z: 0 })
    // @ts-expect-error — negative compile proof: 双指判定需要四点对（b0 缺 y 编译失败）
    classifyTwoFinger({ x: 0, y: 0 }, { x: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 })
  })

  it('usePlaybackFullscreen：装配参数形状（缺 target getter 编译失败）', () => {
    // @ts-expect-error — negative compile proof: 缺 target（全屏目标 getter）编译失败
    const opts: PlaybackFullscreenOptions = { isPhone: ref(false) }
    expect(opts).toBeTruthy()
    const api = usePlaybackFullscreen({
      target: () => document.createElement('div'),
      isPhone: ref(false),
    })
    expect(typeof api.toggleFullscreen).toBe('function')
    expect(typeof api.toggleFullscreen).toBe('function')
    expect(typeof api.unlockOrientation).toBe('function')
  })
})
