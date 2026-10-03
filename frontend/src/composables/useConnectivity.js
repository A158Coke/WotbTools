import { readonly, ref } from 'vue'
import { ConnectivityState, createConnectivity, selectConnectivitySource } from '../platform/connectivity.js'
import { getCapabilities, isAndroidApp } from './usePlatformBridge.js'

/**
 * 连通性的 Vue 投影：**唯一**允许被业务组件读取的连通性入口。
 *
 * 业务组件不得：
 *  - 直接监听 `window` 的 online/offline（Android WebView 的权威在系统侧）；
 *  - 直接读 `navigator.onLine`（计划 §2 禁止的散落判定）；
 *  - 各自缓存一份 online 布尔值。
 *
 * 而应当：`useFeatureGate()`（capability 门禁）或
 * `getFeatureAvailability(feature, { connectivity })`。
 *
 * 单例：整页共享一个 store（一次订阅、一次回读）。`start()` 幂等且只解析一次来源。
 */
const state = ref(ConnectivityState.UNKNOWN)
let store = null
let unsubscribeProjection = null
let startPromise = null

/**
 * 平台来源选择：Android 壳先问能力再决定。
 * 老客户端（bridge v2 但没有 `connectivity` 方法/能力）退回浏览器近似，而不是把
 * 「读不到」当成永久离线 —— 计划 §4 允许的最低要求就是 offline/online 两态。
 */
async function resolveSource() {
  const android = isAndroidApp()
  const capabilities = android ? await getCapabilities() : []
  return selectConnectivitySource({ android, capabilities })
}

function ensureStore(source) {
  if (store) return store
  store = createConnectivity(source ? { source } : {})
  unsubscribeProjection = store.subscribe(next => {
    state.value = next
  })
  return store
}

export function useConnectivity() {
  return {
    /** 响应式状态 token（online / offline / unknown / degraded / service-unavailable）。 */
    connectivity: readonly(state),
    isOnline() {
      return state.value === ConnectivityState.ONLINE
    },
    /** 解析来源并启动监听（幂等）；返回启动后的状态。 */
    start() {
      if (!startPromise) {
        startPromise = (async () => {
          const source = await resolveSource()
          return ensureStore(source).start()
        })()
      }
      return startPromise
    },
    /**
     * **仅测试**注入一次状态（生产代码没有任何调用点，也不会替代真实来源）。
     *
     * 存在的理由：浏览器来源只能表达 online/offline，`degraded` / `service-unavailable`
     * 由 Native 报告（计划 §4），因此纯 Web 单测无法自然产生这两种状态。真正需要区分
     * 「谁读了连通性」的断言仍然走 `connectivity` / 门禁，这里只移动事实源。
     * 未 start 时是空操作（没有 store 可注入）。
     */
    setStateForTest(next) {
      if (!store) return state.value
      return store.setState(next)
    },
    /** 仅供测试 / 登出重置：释放订阅与单例。 */
    stop() {
      if (store) store.stop()
      if (unsubscribeProjection) unsubscribeProjection()
      store = null
      unsubscribeProjection = null
      startPromise = null
      state.value = ConnectivityState.UNKNOWN
    },
  }
}
