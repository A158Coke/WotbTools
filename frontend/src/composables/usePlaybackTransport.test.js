// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLAYBACK_SPEED, PLAYBACK_SPEEDS, isPlaybackSpeed, usePlaybackTransport } from './usePlaybackTransport.ts'

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

  it('停在终点时按播放（按钮或空格）→ 先回到起点再播放；未到终点不回卷', () => {
    const { state, adapter } = makeAdapter(false)
    const atEnd = { value: true }
    adapter.isAtEnd = () => atEnd.value
    adapter.restart = vi.fn(() => { atEnd.value = false })
    const t = usePlaybackTransport(adapter, { keyboard: false })
    t.togglePlay()
    expect(adapter.restart).toHaveBeenCalledTimes(1)
    expect(adapter.restart.mock.invocationCallOrder[0]).toBeLessThan(adapter.play.mock.invocationCallOrder[0])
    expect(state.playing).toBe(true)
    t.togglePlay() // 播放中 → 暂停，不回卷
    expect(state.playing).toBe(false)
    t.handleKeydown(key({ code: 'Space', key: ' ' })) // 中途暂停后继续
    expect(adapter.restart).toHaveBeenCalledTimes(1)
    expect(state.playing).toBe(true)
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

  it('`,` 上一发 / `.` 下一发：preventDefault + 方向；未接 jumpShot 时保持原样不吞键', () => {
    const jumpShot = vi.fn()
    const { adapter } = makeAdapter(false)
    const t = usePlaybackTransport({ ...adapter, jumpShot }, { keyboard: false })
    const prev = key({ code: 'Comma', key: ',' })
    t.handleKeydown(prev)
    expect(jumpShot).toHaveBeenCalledWith(-1)
    expect(prev.defaultPrevented).toBe(true)
    const next = key({ code: 'Period', key: '.' })
    t.handleKeydown(next)
    expect(jumpShot).toHaveBeenCalledWith(1)

    const bare = usePlaybackTransport(adapter, { keyboard: false })   // 2D：未接 jumpShot
    const untouched = key({ code: 'Comma', key: ',' })
    bare.handleKeydown(untouched)
    expect(jumpShot).toHaveBeenCalledTimes(2)
    expect(untouched.defaultPrevented).toBe(false)
  })

  it('Ctrl/Meta/Alt 修饰的 , / . 不劫持（留给浏览器与系统快捷键）', () => {
    const jumpShot = vi.fn()
    const { adapter } = makeAdapter(false)
    const t = usePlaybackTransport({ ...adapter, jumpShot }, { keyboard: false })
    t.handleKeydown(key({ code: 'Comma', key: ',', ctrlKey: true }))
    t.handleKeydown(key({ code: 'Period', key: '.', metaKey: true }))
    t.handleKeydown(key({ code: 'Comma', key: ',', altKey: true }))
    expect(jumpShot).not.toHaveBeenCalled()
  })

  it('数字键 1–7 骑乘：rideVehicle(digit, shiftKey)；Digit8 / 未接 rideVehicle 不响应', () => {
    const rideVehicle = vi.fn()
    const { adapter } = makeAdapter(false)
    const t = usePlaybackTransport({ ...adapter, rideVehicle }, { keyboard: false })
    const one = key({ code: 'Digit1', key: '1' })
    t.handleKeydown(one)
    expect(rideVehicle).toHaveBeenCalledWith(1, false)
    expect(one.defaultPrevented).toBe(true)
    t.handleKeydown(key({ code: 'Digit2', key: '2', shiftKey: true }))
    expect(rideVehicle).toHaveBeenCalledWith(2, true)
    t.handleKeydown(key({ code: 'Digit7', key: '7' }))
    expect(rideVehicle).toHaveBeenCalledWith(7, false)
    expect(rideVehicle).toHaveBeenCalledTimes(3)

    const eight = key({ code: 'Digit8', key: '8' })
    t.handleKeydown(eight)
    expect(eight.defaultPrevented).toBe(false)
    expect(rideVehicle).toHaveBeenCalledTimes(3)

    const bare = usePlaybackTransport(adapter, { keyboard: false })   // 2D：未接 rideVehicle
    const untouched = key({ code: 'Digit1', key: '1' })
    bare.handleKeydown(untouched)
    expect(untouched.defaultPrevented).toBe(false)
    expect(rideVehicle).toHaveBeenCalledTimes(3)
    // Ctrl/Meta/Alt 组合键不得劫持（浏览器标签页切换等系统快捷键）
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      const combo = key({ code: 'Digit1', key: '1', [mod]: true })
      t.handleKeydown(combo)
      expect(combo.defaultPrevented).toBe(false)
    }
    expect(rideVehicle).toHaveBeenCalledTimes(3)
  })

  it('数字键冲突消解：自由飞行激活（isFlyMode true）→ 让给飞行速率，不骑乘也不 preventDefault', () => {
    const rideVehicle = vi.fn()
    const { adapter } = makeAdapter(false)
    const t = usePlaybackTransport({ ...adapter, rideVehicle, isFlyMode: () => true }, { keyboard: false })
    const digit = key({ code: 'Digit3', key: '3' })
    t.handleKeydown(digit)
    expect(rideVehicle).not.toHaveBeenCalled()
    expect(digit.defaultPrevented).toBe(false)
    // 同一 usage 下飞行态按事件当次判定：切出自由飞行后数字键归骑乘
    const fly = { value: true }
    const dynamic = usePlaybackTransport({ ...adapter, rideVehicle, isFlyMode: () => fly.value }, { keyboard: false })
    dynamic.handleKeydown(key({ code: 'Digit3', key: '3' }))
    expect(rideVehicle).not.toHaveBeenCalled()
    fly.value = false
    dynamic.handleKeydown(key({ code: 'Digit3', key: '3' }))
    expect(rideVehicle).toHaveBeenCalledWith(3, false)
  })

  it('跳炮击 / 骑乘同样在输入控件聚焦、播放器不可见时不响应', () => {
    const jumpShot = vi.fn()
    const rideVehicle = vi.fn()
    const { adapter } = makeAdapter(false)
    const input = document.createElement('input')
    const t = usePlaybackTransport({ ...adapter, jumpShot, rideVehicle }, { keyboard: false })
    t.handleKeydown(key({ code: 'Comma', key: ',' }, input))
    t.handleKeydown(key({ code: 'Digit1', key: '1' }, input))
    expect(jumpShot).not.toHaveBeenCalled()
    expect(rideVehicle).not.toHaveBeenCalled()

    const hidden = usePlaybackTransport({ ...adapter, jumpShot, rideVehicle, isActive: () => false }, { keyboard: false })
    hidden.handleKeydown(key({ code: 'Period', key: '.' }))
    hidden.handleKeydown(key({ code: 'Digit2', key: '2' }))
    expect(jumpShot).not.toHaveBeenCalled()
    expect(rideVehicle).not.toHaveBeenCalled()
  })
})
