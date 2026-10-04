// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, watch } from 'vue'
import { ConnectivityState } from '../platform/connectivity.js'
import { Feature } from '../app/featureCapabilities.js'
import { evaluateFeatureGate, useFeatureGate } from './useFeatureGate.js'
import { useConnectivityNotice } from './useConnectivityNotice.js'
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
  useConnectivityNotice().close()
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

  it('ONLINE_REQUIRED features fail fast and notify with the reason-specific availability', () => {
    // offline：功能专属文案（「需要联网」）
    const offlineNotify = vi.fn()
    expect(evaluateFeatureGate(Feature.AI_REVIEW, ConnectivityState.OFFLINE, offlineNotify)).toBe(false)
    expect(offlineNotify).toHaveBeenCalledTimes(1)
    expect(offlineNotify.mock.calls[0][0]).toMatchObject({
      messageKey: 'featureOffline.aiReview',
      titleKey: 'featureOffline.title',
      hintKey: 'featureOffline.retry',
      reason: ConnectivityState.OFFLINE,
    })

    // unknown / degraded / service-unavailable：**不得**说成「你离线」
    const cases = [
      [Feature.HALL_OF_FAME, ConnectivityState.UNKNOWN, 'connectivityNotice.unknown', 'connectivityNotice.unknownTitle'],
      [Feature.PLAYBACK_3D, ConnectivityState.DEGRADED, 'connectivityNotice.degraded', 'connectivityNotice.degradedTitle'],
      [Feature.AI_REVIEW, ConnectivityState.SERVICE_UNAVAILABLE, 'connectivityNotice.serviceUnavailable', 'connectivityNotice.serviceUnavailableTitle'],
    ]
    for (const [feature, state, messageKey, titleKey] of cases) {
      const notify = vi.fn()
      expect(evaluateFeatureGate(feature, state, notify), `${state}`).toBe(false)
      expect(notify.mock.calls[0][0], `${state}`).toMatchObject({
        messageKey,
        titleKey,
        hintKey: 'connectivityNotice.retry',
        reason: state,
      })
    }
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
    const notice = useConnectivityNotice()
    expect(notice.visible.value).toBe(true)
    expect(notice.notice.value).toMatchObject({
      titleKey: 'featureOffline.title',
      messageKey: 'featureOffline.aiReview',
      hintKey: 'featureOffline.retry',
    })
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

  it('defers the verdict until the first detection settles (deep-link mount race)', async () => {
    // 子组件先于 AppShell 挂载：门禁在 start() 之前被调用，此时 UNKNOWN 只是占位。
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
    const { requireFeature } = useFeatureGate()
    const notice = useConnectivityNotice()
    expect(requireFeature(Feature.AI_REVIEW)).toBe(false)
    expect(notice.visible.value).toBe(false)

    await useConnectivity().start()
    await Promise.resolve()
    // 实际在线：不得误报「暂时无法确认网络状态」。
    expect(notice.visible.value).toBe(false)
    expect(requireFeature(Feature.AI_REVIEW)).toBe(true)
  })

  it('still notifies after settling when the deferred check is really offline', async () => {
    stubNative({ getCapabilities: ['native-auth', 'connectivity'], connectivityGetState: 'offline' })
    const { requireFeature } = useFeatureGate()
    const notice = useConnectivityNotice()
    expect(requireFeature(Feature.HALL_OF_FAME)).toBe(false)
    expect(notice.visible.value).toBe(false)

    await useConnectivity().start()
    await Promise.resolve()
    expect(notice.notice.value).toMatchObject({ messageKey: 'featureOffline.hallOfFame' })
  })

  it('exposes pending only for connectivity-dependent features; LOCAL is never blocked by initialization', () => {
    const { availability } = useFeatureGate()
    expect(availability(Feature.AI_REVIEW)).toMatchObject({ available: false, pending: true })
    expect(availability(Feature.REPLAY_RESULT)).toMatchObject({ available: true, pending: false })
    expect(availability(Feature.RATING)).toMatchObject({ available: true, pending: false })
    // ONLINE_OPTIONAL：本地动作照常（available 不变），pending 只告诉 UI 先别下结论。
    expect(availability(Feature.TELEMETRY_UPLOAD)).toMatchObject({ available: true, pending: true })
  })

  it('settling UNKNOWN → UNKNOWN still re-evaluates availability (settled is reactive)', async () => {
    stubNative({ getCapabilities: ['native-auth', 'connectivity'], connectivityGetState: 'unknown' })
    const { availability } = useFeatureGate()
    const ai = computed(() => availability(Feature.AI_REVIEW))
    expect(ai.value).toMatchObject({ pending: true, available: false })

    await useConnectivity().start()
    await nextTick()
    // 连通性值始终是 UNKNOWN：只有 settled false → true 能让缓存的 computed 重算。
    expect(useConnectivity().connectivity.value).toBe(ConnectivityState.UNKNOWN)
    expect(ai.value).toMatchObject({
      pending: false,
      available: false,
      reason: ConnectivityState.UNKNOWN,
      messageKey: 'connectivityNotice.unknown',
    })
  })

  it('whenSettled resolves only after the first read result is committed', async () => {
    stubNative({ getCapabilities: ['native-auth', 'connectivity'], connectivityGetState: 'online' })
    const { connectivity, whenSettled } = useConnectivity()
    let seen = null
    const waiter = whenSettled().then(() => { seen = connectivity.value })
    await useConnectivity().start()
    await waiter
    expect(seen).toBe(ConnectivityState.ONLINE)
  })

  it('never exposes settled=true with the placeholder UNKNOWN, and connectivity watchers already see settled', async () => {
    stubNative({ getCapabilities: ['native-auth', 'connectivity'], connectivityGetState: 'online' })
    const { connectivity, settled } = useConnectivity()
    const { requireFeature } = useFeatureGate()
    const observed = []
    const stopObserved = watch([settled, connectivity], pair => observed.push([...pair]))
    let gateInWatcher = null
    const stopGate = watch(connectivity, () => { gateInWatcher = requireFeature(Feature.AI_REVIEW) })

    await useConnectivity().start()
    await nextTick()
    expect(observed).toEqual([[true, ConnectivityState.ONLINE]])
    // 重连补加载类副作用在 watch(connectivity) 里调门禁：此刻必须已视为测过并放行。
    expect(gateInWatcher).toBe(true)
    stopObserved()
    stopGate()
  })

  it('stop() resets settled so the next cold start is pending again', async () => {
    await useConnectivity().start()
    expect(useConnectivity().settled.value).toBe(true)
    useConnectivity().stop()
    expect(useConnectivity().settled.value).toBe(false)
    expect(useFeatureGate().availability(Feature.AI_REVIEW).pending).toBe(true)
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
