/**
 * 懒加载模块（Vite 动态 import）的可用性边界。
 *
 * 背景：Vite 产物是内容哈希命名，每次前端部署都会产生**全新的 chunk 文件名**。TX 部署用
 * `docker compose up -d --force-recreate` 整体替换镜像里的 `/usr/share/nginx/html`，因此上一次
 * 部署的 chunk 在磁盘上直接消失（`deploy/tx/deploy.sh`）。
 *
 * 于是「部署前就打开、部署后还活着的页面」再进入懒加载能力时，请求的是自己那个旧 bundle 记下的
 * 文件名 → 404 → import 抛错。`index.html` 已固定 `no-store`，所以**重新加载**必然拿到与新部署一致
 * 的 bundle；这是唯一正确的补救动作，旧 URL 不可恢复。
 *
 * 本模块只提供错误边界：失败必须变成可见、可操作、可重试的状态，**绝不**中断整页渲染。
 * 不做的事：不自动 reload（用户可能正在跑本机解析，静默刷新会丢状态）、不重试旧 URL、不吞错。
 */
import { defineAsyncComponent, ref, type AsyncComponentLoader, type Component, type Ref } from 'vue'

/** 一次 reload 的探测窗口：窗口内重复触发视为「刷新也修不好」，不再自动跳转。 */
const RELOAD_GUARD_KEY = 'wotb-module-reload'
const RELOAD_GUARD_WINDOW_MS = 60_000

export interface LazyModule<T = unknown> {
  /** 异步组件：直接放进模板。 */
  component: Component
  /** 加载失败原因（null = 正常）。渲染方据此切失败态。 */
  error: Ref<unknown>
  /** 用户主动再试一次（同一 URL，覆盖网络瞬断）；仍失败则保持失败态。 */
  retry: () => Promise<T | null>
  /** 清空失败态，让组件在下次挂载时重新尝试加载。 */
  reset: () => void
}

/**
 * 可重试的懒加载组件。
 *
 * `onError` 必须返回 `false`：默认行为是把错误继续抛出，会让 Vue 渲染中断、整页塌掉
 * ——那正是本次生产故障的形态（AI pane chunk 404 → 工作台变空壳）。
 *
 * 错误状态与 loader 都必须由本边界自己持有：Vue 的 `defineAsyncComponent` 会重写 loader
 * 契约（包成解析 default 的组件对象），失败的 async wrapper 还会缓存 reject 结果，
 * 因此重试必须重新执行**原始** import。
 */
export function defineLazyModule<T>(load: () => Promise<T>): LazyModule<T> {
  const error = ref<unknown>(null)
  const component = defineAsyncComponent({
    loader: async () => {
      try {
        const module = await load()
        error.value = null
        return module as Awaited<ReturnType<AsyncComponentLoader>>
      } catch (cause) {
        error.value = cause
        throw cause
      }
    },
    onError: () => false,
  })
  return {
    component,
    error,
    async retry() {
      error.value = null
      try {
        return await load()
      } catch (cause) {
        error.value = cause
        return null
      }
    },
    reset() {
      error.value = null
    },
  }
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
