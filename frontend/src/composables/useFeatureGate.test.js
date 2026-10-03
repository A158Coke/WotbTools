// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectivityState } from '../platform/connectivity.js'
import { Feature } from '../app/featureCapabilities.js'
import { evaluateFeatureGate, useFeatureGate } from './useFeatureGate.js'
import { useOfflineNotice } from './useOfflineNotice.js'
import { useConnectivity } from './useConnectivity.js'

function stubNative(results) {
  const listeners = []
  window.WotbNative = {
    postMessage: vi.fn((json) => {
      const msg = JSON.parse(json)
      const raw = results[msg.method]
      const result = typeof raw === 'function' ? raw() : (raw ?? null)
      listeners.forEach(cb => cb({ data: JSON.stringify({ id: msg.id, result }) }))
    }),
    addEventListener: vi.fn((type, cb) => listeners.push(cb)),
    removeEventListener: vi.fn((type, cb) => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    }),
  }
}

/** 重置连通性单例与提示状态（避免测试之间互相污染）。 */
function reset() {
  useConnectivity().stop()
  useOfflineNotice().close()
  delete window.WotbNative
}

describe('feature gate (pure)', () => {
  it('LOCAL features pass silently in every connectivity state', () => {
    for (const state of [ConnectivityState.ONLINE, ConnectivityState.OFFLINE, ConnectivityState.UNKNOWN]) {
      const notify = vi.fn()
      expect(evaluateFeatureGate(Feature.REPLAY_RESULT, state, notify), state).toBe(true)
      expect(evaluateFeatureGate(Feature.RATING, state, notify), state).toBe(true)
      expect(notify, state).not.toHaveBeenCalled()
    }
  })

  it('ONLINE_REQUIRED features fail fast offline and notify once with the feature key', () => {
    const notify = vi.fn()
    expect(evaluateFeatureGate(Feature.AI_REVIEW, ConnectivityState.OFFLINE, notify)).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('featureOffline.aiReview')

    const notifyHof = vi.fn()
    expect(evaluateFeatureGate(Feature.HALL_OF_FAME, ConnectivityState.OFFLINE, notifyHof)).toBe(false)
    expect(notifyHof).toHaveBeenCalledWith('featureOffline.hallOfFame')

    const notify3d = vi.fn()
    expect(evaluateFeatureGate(Feature.PLAYBACK_3D, ConnectivityState.OFFLINE, notify3d)).toBe(false)
    expect(notify3d).toHaveBeenCalledWith('featureOffline.playback3d')
  })

  it('ONLINE_REQUIRED features pass online without touching the notice', () => {
    const notify = vi.fn()
    expect(evaluateFeatureGate(Feature.AI_REVIEW, ConnectivityState.ONLINE, notify)).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })

  it('ONLINE_OPTIONAL features keep the local action and never block on the notice', () => {
    const notify = vi.fn()
    expect(evaluateFeatureGate(Feature.TELEMETRY_UPLOAD, ConnectivityState.OFFLINE, notify)).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })

  it('an unregistered feature is refused without inventing copy', () => {
    const notify = vi.fn()
    expect(evaluateFeatureGate('not-a-feature', ConnectivityState.ONLINE, notify)).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('feature gate (wired to the connectivity singleton)', () => {
  afterEach(reset)

  it('reads the native connectivity state and shows the unified notice', async () => {
    stubNative({ getCapabilities: ['native-auth', 'connectivity'], connectivityGetState: 'offline' })
    const { requireFeature, availability } = useFeatureGate()
    await useConnectivity().start()

    expect(requireFeature(Feature.AI_REVIEW)).toBe(false)
    const notice = useOfflineNotice()
    expect(notice.visible.value).toBe(true)
    expect(notice.noticeKey.value).toBe('featureOffline.aiReview')
    expect(availability(Feature.REPLAY_RESULT).available).toBe(true)
  })

  it('becomes available after the native side reports online (no restart)', async () => {
    let nativeState = 'offline'
    stubNative({
      getCapabilities: ['native-auth', 'connectivity'],
      connectivityGetState: () => nativeState,
    })

    const { requireFeature, availability } = useFeatureGate()
    await useConnectivity().start()
    expect(requireFeature(Feature.AI_REVIEW)).toBe(false)

    // 网络恢复：Native 推送 → 页面回读（事件不带 payload）→ capability 立即更新，无需重启。
    nativeState = 'online'
    await window.wotbtoolsOnConnectivityChanged()
    expect(availability(Feature.AI_REVIEW).available).toBe(true)
    expect(availability(Feature.AI_REVIEW).online).toBe(true)

    // 再断开：本地功能不受影响，联网功能立刻回到提示路径。
    nativeState = 'offline'
    await window.wotbtoolsOnConnectivityChanged()
    expect(requireFeature(Feature.AI_REVIEW)).toBe(false)
    expect(requireFeature(Feature.REPLAY_RESULT)).toBe(true)
  })

  it('falls back to the browser approximation when the shell lacks the capability', async () => {
    stubNative({ getCapabilities: ['native-auth'], connectivityGetState: 'offline' })
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    await useConnectivity().start()
    // 老客户端（bridge v2 无 connectivity 能力）：退化为 navigator.onLine，而不是永久离线。
    expect(useConnectivity().connectivity.value).toBe(ConnectivityState.OFFLINE)
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  })
})
