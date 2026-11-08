// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const feedback = vi.hoisted(() => ({ haptics: [] as string[], sounds: [] as string[] }))
vi.mock('./useHaptics.js', () => ({ haptic: async (kind: string) => { feedback.haptics.push(kind) } }))
vi.mock('./useSound.js', () => ({ playSound: (kind: string) => { feedback.sounds.push(kind); return true } }))

import { __resetToastsForTest, dismissToast, dismissTransientToasts, pauseToast, resumeToast, showToast, toasts, TOAST_DURATION_MS, TOAST_LIMIT } from './useToast.js'

beforeEach(() => { vi.useFakeTimers(); feedback.haptics = []; feedback.sounds = [] })
afterEach(() => { __resetToastsForTest(); vi.useRealTimers() })

describe('useToast', () => {
  it('成功 / 提示 4 秒后自动消失', () => {
    showToast({ tone: 'success', title: 'ok' })
    showToast({ tone: 'info', title: 'fyi' })
    vi.advanceTimersByTime(TOAST_DURATION_MS - 1)
    expect(toasts.value).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(toasts.value).toHaveLength(0)
  })

  it('警告 / 错误不自动消失，只能关闭', () => {
    const id = showToast({ tone: 'error', title: 'failed' })
    showToast({ tone: 'warning', title: 'offline' })
    vi.advanceTimersByTime(TOAST_DURATION_MS * 10)
    expect(toasts.value.map(toast => toast.persistent)).toEqual([true, true])
    dismissToast(id)
    expect(toasts.value).toHaveLength(1)
  })

  it('悬停 / 按住暂停计时，离开后按剩余时间继续', () => {
    const id = showToast({ tone: 'success', title: 'ok' })
    vi.advanceTimersByTime(3000)
    pauseToast(id)
    vi.advanceTimersByTime(10_000)
    expect(toasts.value).toHaveLength(1)
    resumeToast(id)
    vi.advanceTimersByTime(999)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toasts.value).toHaveLength(0)
  })

  it('同一 id 替换内容；最多同时 3 条，最早的一条让位并通知 onDismiss', () => {
    const dropped = vi.fn()
    showToast({ id: 'a', tone: 'error', title: 'first', onDismiss: dropped })
    showToast({ id: 'a', tone: 'error', title: 'replaced', onDismiss: dropped })
    expect(toasts.value.map(toast => toast.title)).toEqual(['replaced'])
    for (let index = 0; index < TOAST_LIMIT; index += 1) showToast({ tone: 'error', title: `n${index}` })
    expect(toasts.value).toHaveLength(TOAST_LIMIT)
    expect(dropped).toHaveBeenCalledTimes(1)
  })

  it('同一事件同一种反馈：成功双击 + 成功音，错误长振 + 错误音，提示只出声', () => {
    showToast({ tone: 'success', title: 'ok' })
    showToast({ tone: 'error', title: 'x' })
    showToast({ tone: 'info', title: 'i' })
    expect(feedback.haptics).toEqual(['success', 'error'])
    expect(feedback.sounds).toEqual(['success', 'error', 'notice'])
  })

  it('换视图时只收起成功 / 提示，警告 / 错误保留', () => {
    showToast({ tone: 'success', title: 'parsed' })
    showToast({ tone: 'info', title: 'fyi' })
    showToast({ tone: 'error', title: 'failed' })
    dismissTransientToasts()
    expect(toasts.value.map(toast => toast.title)).toEqual(['failed'])
  })
})
