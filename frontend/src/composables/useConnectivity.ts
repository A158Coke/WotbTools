import { readonly, ref } from 'vue'
import {
  ConnectivityState,
  createConnectivity,
  selectConnectivitySource,
  type ConnectivitySource,
  type ConnectivityStateValue,
} from '../platform/connectivity.js'
import { getCapabilities, isAndroidApp } from './usePlatformBridge.js'

const state = ref<ConnectivityStateValue>(ConnectivityState.UNKNOWN)
let store: ReturnType<typeof createConnectivity> | null = null
let unsubscribeProjection: (() => void) | null = null
let startPromise: Promise<ConnectivityStateValue> | null = null

const settled = ref(false)
let settledWaiters: Array<() => void> = []
let firstReadDone = false

function settleOnFirstRead(source: ConnectivitySource): ConnectivitySource {
  return {
    ...source,
    async read() {
      try {
        return await source.read()
      } finally {
        firstReadDone = true
      }
    },
  }
}

function markSettled() {
  settled.value = true
  const waiters = settledWaiters
  settledWaiters = []
  waiters.forEach(resolve => resolve())
}

async function resolveSource() {
  const android = isAndroidApp()
  const capabilities = android ? await getCapabilities() : []
  return selectConnectivitySource({ android, capabilities })
}

function ensureStore(source?: ConnectivitySource) {
  if (store) return store
  store = createConnectivity(source ? { source } : {})
  unsubscribeProjection = store.subscribe(next => {
    if (firstReadDone) settled.value = true
    state.value = next
  })
  return store
}

export function useConnectivity() {
  return {
    connectivity: readonly(state),
    isOnline() {
      return state.value === ConnectivityState.ONLINE
    },
    settled: readonly(settled),
    isSettled() {
      return settled.value
    },
    whenSettled() {
      if (settled.value) return Promise.resolve()
      return new Promise<void>(resolve => settledWaiters.push(resolve))
    },
    start() {
      if (!startPromise) {
        startPromise = (async () => {
          try {
            const source = settleOnFirstRead(await resolveSource())
            return await ensureStore(source).start()
          } finally {
            markSettled()
          }
        })()
      }
      return startPromise
    },
    setStateForTest(next: unknown) {
      if (!store) return state.value
      return store.setState(next)
    },
    stop() {
      if (store) store.stop()
      if (unsubscribeProjection) unsubscribeProjection()
      store = null
      unsubscribeProjection = null
      startPromise = null
      settled.value = false
      firstReadDone = false
      settledWaiters = []
      state.value = ConnectivityState.UNKNOWN
    },
  }
}
