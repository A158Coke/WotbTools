// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLAYBACK_SPEED, PLAYBACK_SPEEDS, isPlaybackSpeed, usePlaybackTransport } from './usePlaybackTransport.js'

function makeAdapter(initiallyPlaying = false) {
  const state = { playing: initiallyPlaying }
  const adapter = {
    isPlaying: () => state.playing,
    play: vi.fn(() => { state.playing = true }),
    pause: vi.fn(() => { state.playing = false }),
    step: vi.fn(),
  }
  return { state, adapter }
}

const key = (init, target = document.body) => {
  const event = new KeyboardEvent('keydown', { ...init, cancelable: true })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('usePlaybackTransport', () => {
  it('统一档位 0.5–8×，默认 1×', () => {
    expect([...PLAYBACK_SPEEDS]).toEqual([0.5, 1, 2, 4, 8])
    expect(DEFAULT_PLAYBACK_SPEED).toBe(1)
    expect(isPlaybackSpeed(16)).toBe(false)
  })

  it('拖动：原先在播放 → 按下暂停、松手继续', () => {
    const { state, adapter } = makeAdapter(true)
    const t = usePlaybackTransport(adapter, { keyboard: false })
    t.scrubStart()
    expect(state.playing).toBe(false)
    t.scrubEnd()
    expect(state.playing).toBe(true)
  })

  it('拖动：原先暂停 → 松手仍暂停', () => {
    const { state, adapter } = makeAdapter(false)
    const t = usePlaybackTransport(adapter, { keyboard: false })
    t.scrubStart()
    t.scrubEnd()
    expect(state.playing).toBe(false)
    expect(adapter.play).not.toHaveBeenCalled()
  })

  it('键盘：空格切换、←/→ ±5s，并阻止默认行为', () => {
    const { state, adapter } = makeAdapter(false)
    const t = usePlaybackTransport(adapter, { keyboard: false })
    const space = key({ code: 'Space', key: ' ' })
    t.handleKeydown(space)
    expect(state.playing).toBe(true)
    expect(space.defaultPrevented).toBe(true)
    t.handleKeydown(key({ key: 'ArrowLeft' }))
    t.handleKeydown(key({ key: 'ArrowRight' }))
    expect(adapter.step.mock.calls).toEqual([[-5], [5]])
  })

  it('键盘：输入框 / 按钮聚焦时、播放器不可见或未就绪时不劫持', () => {
    const { adapter } = makeAdapter(false)
    const input = document.createElement('input')
    const t = usePlaybackTransport(adapter, { keyboard: false })
    const typing = key({ code: 'Space', key: ' ' }, input)
    t.handleKeydown(typing)
    expect(typing.defaultPrevented).toBe(false)
    expect(adapter.play).not.toHaveBeenCalled()

    const hidden = usePlaybackTransport({ ...adapter, isActive: () => false }, { keyboard: false })
    hidden.handleKeydown(key({ code: 'Space', key: ' ' }))
    const notReady = usePlaybackTransport({ ...adapter, isReady: () => false }, { keyboard: false })
    notReady.handleKeydown(key({ key: 'ArrowRight' }))
    expect(adapter.play).not.toHaveBeenCalled()
    expect(adapter.step).not.toHaveBeenCalled()
  })
})
