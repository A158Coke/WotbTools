/**
 * 懒加载模块（Vite 动态 import）的可用性边界。
 *
 * 背景：Vite 产物是内容哈希命名，每次前端部署都会产生**全新的 chunk 文件名**。TX 部署用
 * `docker compose up -d --force-recreate` 整体替换镜像里的 `/usr/share/nginx/html`，因此上一次
 * 部署的 chunk 在磁盘上直接消失（`deploy/tx/deploy.sh`）。
 *
 * 于是「部署前就打开、部署后还活着的页面」再进入懒加载能力时，请求的是自己那个旧 bundle 记下的
 * 文件名 → 404 → import 抛错。`index.html` 已固定 `no-store`，所以**重新加载**必然拿到与新部署一致
 * 的 bundle；这是旧 URL 唯一正确的补救动作，`retry()` 只覆盖网络瞬断这类可原地恢复的情况。
 *
 * 本模块只提供错误边界：失败必须变成可见、可操作、可重试的状态，**绝不**中断整页渲染。
 * 不做的事：不自动 reload（用户可能正在跑本机解析，静默刷新会丢状态）、不重试旧 URL、不吞错。
 *
 * ## 为什么必须是「一代一个 async wrapper」
 *
 * `defineAsyncComponent` 把 loader 包进一个组件定义：失败的 promise 会被它的 `pendingRequest`
 * 记住，之后的 `load()` 直接复用那个已 reject 的 promise，渲染永远停在失败状态。因此：
 *
 * - 单独再跑一次 `import()` **救不活**原来的 async wrapper——成功后没有任何通路把模块交回它的
 *   resolved state，只会出现「error 被清空 + 面板仍然空白」；
 * - 重新挂载同一个 wrapper 也没用（同一份组件定义、同一个 `pendingRequest`）；
 * - `onError` 必须调用 Vue 提供的 `fail()` 结束这一代，promise 才会 reject 而不是永远 pending；
 *   Vue 的 `onError` 不是「返回 false 即恢复」的协议，返回值只表示「不再走默认 throw 路径」。
 *
 * 所以恢复协议是：`retry()` **创建一个全新的 `defineAsyncComponent`**（新一代 async wrapper），
 * 由本模块持有的稳定 wrapper component 渲染当前代。调用方（Workspace）不需要理解 generation，
 * 也就不会出现双重 generation、或在重新进入能力时偷偷清掉失败态的问题。
 *
 * ## `retry()` 的真实边界（浏览器实测）
 *
 * 换一代 wrapper 解决的是「我们这边永远停在失败 promise 上」这个缺陷，但它**不能**让浏览器重新
 * 请求一个已经失败的 chunk URL：模块加载失败会被记进 module map，再次 `import()` 同一 URL 直接抛
 * `Failed to fetch dynamically imported module`，**不会再发网络请求**（生产构建 + CDP 实测：点击 Retry
 * 后 error 先被清空、随即被新一代的同一个 TypeError 填回，Network 面板无任何新请求）。
 *
 * 因此产品语义是：**Reload 是 chunk 失败的唯一可靠恢复动作**（换新 bundle → 新 URL），
 * `retry()` 只用于「同一代内的瞬时失败还没被记为永久失败」的情况。界面顺序必须反映这一点。
 */
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

/** 一次 reload 的探测窗口：窗口内重复触发视为「刷新也修不好」，不再自动跳转。 */
const RELOAD_GUARD_KEY = 'wotb-module-reload'
const RELOAD_GUARD_WINDOW_MS = 60_000

export interface LazyModule<T = unknown> {
  /**
   * 稳定组件：直接放进模板即可。
   *
   * 它内部渲染「当前代」的 async component；`retry()` 换代会自动反映到 DOM，
   * 调用方不需要 `:key` 或任何 generation 管理。
   */
  component: Component
  /** 加载失败原因（null = 正常）。渲染方据此切失败态；`retry()` 开始时清空。 */
  error: Ref<unknown>
  /**
   * 用户主动再试一次：**创建新一代 async wrapper** 并重新加载（模块已缓存时立即完成）。
   * 仍失败则重新记录失败态并返回 null。
   */
  retry: () => Promise<T | null>
}

/**
 * 可重试的懒加载组件。
 *
 * `onError` 收到 Vue 的 `fail()` 并立即调用：这一代明确以失败结束。调用方用 `error` 渲染失败态、
 * 用 `retry()` 换代重试——`retry()` 绝不复用旧的 async wrapper。
 */
export function defineLazyModule<T>(load: () => Promise<T>): LazyModule<T> {
  const error = ref<unknown>(null)
  /** 当前代 loader 的结果：`retry()` 等它，避免调用方自己再跑一次 `load()`（那会加载两次）。 */
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

  /** 一代 async wrapper：每次 retry 都必须是新对象（旧的已把 reject 结果记进 pendingRequest）。 */
  function createGeneration(): Component {
    const outcome = beginGeneration()
    const wrapper = defineAsyncComponent({
      // `delay` 只延后**发起加载**（不显示任何 loading UI），因此它只是白白推迟恢复；
      // 0 让「进入能力 → 加载」立即开始，失败也立即可见。
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
      // Vue 会给这个 promise 挂自己的 handler：补一个 no-op catch 防止 unhandled rejection。
      onError: (_cause, _retry, fail) => {
        outcome.catch(() => {})
        // 明确结束本代：不调用 fail 会让 loader promise 永远 pending，渲染无法 settle。
        fail()
      },
    })
    // async wrapper 暴露的 `__asyncLoader` 就是「本代加载」本身（且带 pendingRequest 缓存）。
    // 持有它是为了让 retry() 不依赖组件是否已经挂载：Workspace 用 v-if 控制面板挂载，
    // Banner 显示期间面板并不在树上，只靠 onMounted 触发加载会让 retry 悬空。
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
      // 主动启动本代加载（与 Vue 挂载后拿到的是同一个 pendingRequest，不会重复请求）；
      // 同时让 retry() 在不挂载的宿主里也能确定性地 settle。
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

/** `defineAsyncComponent` 返回的 wrapper 上的加载入口（Vue 公开用于预加载的入口）。 */
interface AsyncWrapper {
  __asyncLoader: () => Promise<unknown>
}

/**
 * 拿到与新部署一致的 bundle：chunk 名是内容哈希，旧 URL 不可恢复，只有重新加载有效。
 *
 * 用一次性 guard 防止「部署本身坏掉」时刷新成环：窗口内第二次调用不再自动跳转，
 * 让用户看清失败态而不是被无限刷新。
 */
export function reloadForFreshBundle(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
    if (last && Date.now() - last < RELOAD_GUARD_WINDOW_MS) return
  } catch {
    // sessionStorage 不可用（隐私模式）时直接刷新：一次可恢复的刷新优于停在坏页面上。
  }
  window.location.reload()
}
