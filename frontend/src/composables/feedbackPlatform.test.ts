// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ android: false, capabilities: [] as string[], calls: [] as Array<[string, unknown]> }))
vi.mock('./usePlatformBridge.js', () => ({
  isAndroidApp: () => bridge.android,
  getCapabilities: async () => bridge.capabilities,
  callBridge: async (method: string, params: unknown) => { bridge.calls.push([method, params]); return true },
}))

import { __reloadFeedbackPrefsForTest, FEEDBACK_PREFS_STORAGE_KEY, feedbackPrefs, setFeedbackPref } from './useFeedbackPrefs.js'
import { __resetHapticsForTest, haptic, HAPTIC_PATTERNS } from './useHaptics.js'
import { __resetSoundForTest, playSound } from './useSound.js'
import { __reloadNotificationsForTest, markAllRead, notifications, notify, NOTIFICATION_LIMIT, unreadCount } from './useNotifications.js'

beforeEach(() => {
  window.localStorage.clear()
  __reloadFeedbackPrefsForTest()
  __resetHapticsForTest()
  __resetSoundForTest()
  __reloadNotificationsForTest()
  Object.assign(bridge, { android: false, capabilities: [], calls: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('feedback preferences', () => {
  it('默认触感开、音效关；写入后持久化，非法值回落默认', () => {
    expect(feedbackPrefs.value).toEqual({ haptics: true, sound: false })
    setFeedbackPref('sound', true)
    expect(JSON.parse(window.localStorage.getItem(FEEDBACK_PREFS_STORAGE_KEY) ?? 'null')).toEqual({ haptics: true, sound: true })
    window.localStorage.setItem(FEEDBACK_PREFS_STORAGE_KEY, JSON.stringify({ haptics: 'yes' }))
    __reloadFeedbackPrefsForTest()
    expect(feedbackPrefs.value).toEqual({ haptics: true, sound: false })
  })
})

describe('haptics', () => {
  it('Android 浏览器用 navigator.vibrate，按事件取固定节奏', async () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    await haptic('success')
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.success)
  })

  it('Android App 走原生 haptics 能力；没有能力的旧 App 静默', async () => {
    bridge.android = true
    bridge.capabilities = ['haptics']
    await haptic('primary')
    expect(bridge.calls).toContainEqual(['haptic', { kind: 'primary' }])
    __resetHapticsForTest()
    bridge.capabilities = []
    bridge.calls = []
    await haptic('primary')
    expect(bridge.calls).toEqual([])
  })

  it('不支持（iPhone Safari）或设置关闭时静默，不抛错', async () => {
    vi.stubGlobal('navigator', {})
    await expect(haptic('error')).resolves.toBeUndefined()
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    setFeedbackPref('haptics', false)
    await haptic('error')
    expect(vibrate).not.toHaveBeenCalled()
  })
})

describe('sound', () => {
  it('默认关闭；开启后合成短音；减少动态效果时不播放', () => {
    const start = vi.fn()
    class FakeContext {
      currentTime = 0
      destination = {}
      createOscillator() { return { frequency: { value: 0 }, connect: (node: unknown) => node, start, stop() {} } }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (node: unknown) => node } }
    }
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(playSound('click')).toBe(false)
    setFeedbackPref('sound', true)
    expect(playSound('success')).toBe(true)
    expect(start).toHaveBeenCalledTimes(2)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    expect(playSound('click')).toBe(false)
  })
})

describe('notifications', () => {
  it('本机最多 20 条、新的在前、未读计数与全部已读、同 id 去重', () => {
    for (let index = 0; index < NOTIFICATION_LIMIT + 3; index += 1) notify({ kind: 'submission', titleKey: `t${index}` })
    expect(notifications.value).toHaveLength(NOTIFICATION_LIMIT)
    expect(notifications.value[0].titleKey).toBe(`t${NOTIFICATION_LIMIT + 2}`)
    expect(unreadCount.value).toBe(NOTIFICATION_LIMIT)
    notify({ id: 'app-update-4.9.0', kind: 'app-update', titleKey: 'u' })
    notify({ id: 'app-update-4.9.0', kind: 'app-update', titleKey: 'u' })
    expect(notifications.value.filter(item => item.id === 'app-update-4.9.0')).toHaveLength(1)
    markAllRead()
    expect(unreadCount.value).toBe(0)
    __reloadNotificationsForTest()
    expect(notifications.value).toHaveLength(NOTIFICATION_LIMIT)
  })
})
