import {
  defineAsyncComponent,
  defineComponent,
  h,
  ref,
  shallowRef,
  type AsyncComponentLoader,
  type Component,
  type Ref,
} from 'vue'

const RELOAD_GUARD_KEY = 'wotb-module-reload'
const RELOAD_GUARD_WINDOW_MS = 60_000

export interface LazyModule<T = unknown> {
  component: Component
  error: Ref<unknown>
  retry: () => Promise<T | null>
}

export function defineLazyModule<T>(load: () => Promise<T>): LazyModule<T> {
  const error = ref<unknown>(null)
  let settled: Promise<T> = Promise.resolve(null as T)
  let resolveGeneration: (value: T) => void = () => {}
  let rejectGeneration: (cause: unknown) => void = () => {}

  function beginGeneration(): Promise<T> {
    settled = new Promise<T>((resolve, reject) => {
      resolveGeneration = resolve
      rejectGeneration = reject
    })
    return settled
  }

  function createGeneration(): Component {
    const outcome = beginGeneration()
    const wrapper = defineAsyncComponent({
      delay: 0,
      loader: (async () => {
        try {
          const module = await load()
          resolveGeneration(module)
          return module
        } catch (cause) {
          error.value = cause
          rejectGeneration(cause)
          throw cause
        }
      }) as AsyncComponentLoader,
      onError: (_cause, _retry, fail) => {
        outcome.catch(() => {})
        fail()
      },
    })
    loaders.set(wrapper, (wrapper as AsyncWrapper).__asyncLoader)
    return wrapper
  }

  const loaders = new WeakMap<Component, () => Promise<unknown>>()
  const current = shallowRef<Component | null>(createGeneration())

  const component = defineComponent({
    name: 'LazyModuleBoundary',
    setup() {
      return () => (current.value ? h(current.value) : null)
    },
  })

  return {
    component,
    error,
    async retry() {
      error.value = null
      const next = createGeneration()
      current.value = next
      loaders.get(next)?.().catch(() => {})
      try {
        return await settled
      } catch (cause) {
        error.value = cause
        return null
      }
    },
  }
}

interface AsyncWrapper {
  __asyncLoader: () => Promise<unknown>
}

interface FreshBundleReloadTarget {
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
  location: Pick<Location, 'reload'>
}

interface FreshBundleReloadOptions {
  requirePersistentGuard?: boolean
  explicit?: boolean
}

export function tryReloadForFreshBundle(
  beforeReload: () => void = () => {},
  target: FreshBundleReloadTarget = window,
  { requirePersistentGuard = false, explicit = false }: FreshBundleReloadOptions = {},
): boolean {
  const now = Date.now()
  try {
    const last = Number(target.sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
    if (!explicit && last && now - last < RELOAD_GUARD_WINDOW_MS) return false
    target.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now))
  } catch {
    if (requirePersistentGuard) return false
  }

  beforeReload()
  target.location.reload()
  return true
}

export function reloadForFreshBundle(options: FreshBundleReloadOptions = {}): void {
  tryReloadForFreshBundle(undefined, window, options)
}
