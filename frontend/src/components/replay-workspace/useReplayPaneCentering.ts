/**
 * ReplayWorkspace —— 回放视窗自动垂直居中（拆分自 ReplayWorkspace.vue，行为原样）。
 * 激活令牌 + pane-ready 观察在内部闭环；宿主卸载即撤销监听。
 */
import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'

export interface ReplayPaneCenteringCtx {
  activeCapability: Ref<string>
  initialLoading: Ref<boolean>
}

/** 回放类视图（2D/3D/事件流/射击/AI）：打开时把视窗放到屏幕中间。 */
const REPLAY_CAPABILITIES = new Set(['playback', '3d', 'events', 'shots', 'ai'])
/** 能力 → 视窗容器（`.capability-pane` 的稳定 testid；测量目标是 pane 本身，不含工具栏）。 */
const PANE_TEST_IDS: Record<string, string> = { playback: 'ws-playback', '3d': 'ws-3d', events: 'ws-events', shots: 'ws-shots', ai: 'ws-ai' }
const PANE_READY_SELECTOR = '[data-pane-ready="true"]'

export function useReplayPaneCentering({ activeCapability, initialLoading }: ReplayPaneCenteringCtx) {
  // 回放内容容器（视图切换居中与手机横屏沉浸态共用；声明须早于下方 immediate watcher）
  const workspaceContentEl = ref<HTMLElement | null>(null)

  /** 当前能力的视窗容器（懒加载面板挂载前它是空 div，高度为 0）。 */
  function activePaneEl(): HTMLElement | null {
    const id = PANE_TEST_IDS[activeCapability.value]
    if (!id) return null
    const root = workspaceContentEl.value?.parentElement ?? (typeof document !== 'undefined' ? document : null)
    return root?.querySelector?.(`[data-testid="${id}"]`) ?? null
  }

  /**
   * 打开 2D/3D 等回放视窗时**自动垂直居中**（用户 2026-10-31 要求：此前视窗偏上，
   * 每次都要手动往下滚一段）。规则：
   * - 视窗比视口矮 → `block: 'center'`（这正是"偏上、要往下滚"的场景）；
   * - 视窗比视口高 → `block: 'start'`（居中的话会裁掉顶部，继续往下滚才是浏览剩余内容的自然动作）。
   * 只在切换视图/首次进入时触发一次（边沿），不监听滚动、不覆盖用户后续滚动位置。
   * 手机横屏沉浸态另有 `scrollIntoView({block:'start'})`（见 wantsImmersive），两者目的不同。
   */
  function centerReplayPane() {
    const pane = activePaneEl()
    if (!pane || typeof pane.scrollIntoView !== 'function') return
    const rect = pane.getBoundingClientRect()
    const viewportH = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 0
    // 高度不可测量（隐藏 / jsdom 无布局）时按居中处理：scrollIntoView 自身会安全退化为最近可滚位置
    const tallerThanViewport = viewportH > 0 && rect.height > viewportH
    pane.scrollIntoView({ block: tallerThanViewport ? 'start' : 'center' })
  }

  // 视图切换的正确时序（Codex review P2）：面板是**懒加载 chunk**（`defineLazyModule` 动态
  // import），nextTick 等不到 chunk；而且「有高度」也不等于视窗就绪——2D 的标题栏 + LOADING
  // 提示、3D 的解析/资产阶段、射击的解析中、AI 的投影构建中都已经有高度。若此时定位会锁在
  // 加载提示上，真实视窗出现后不再定位。
  // 因此就绪信号是各 pane 自己给出的 **`data-pane-ready`**（内容就绪或终态；加载中不置位），
  // 由 ResizeObserver 在布局变化时重新检查；激活令牌在切换/卸载时撤销过期请求，每次进入只定位一次。
  let centerToken = 0
  let centerObserver: ResizeObserver | null = null
  let centerMutationObserver: MutationObserver | null = null
  function cancelPendingCenter() {
    centerToken += 1
    centerObserver?.disconnect?.()
    centerObserver = null
  }
  /** 当前 pane 已就绪：真实内容（或终态外壳）已布局 —— 标记在位且有高度。 */
  function paneIsReady(pane: HTMLElement | null) {
    if (initialLoading.value) return false         // 首批在途：等内容区出现再定位
    if (!pane || !pane.querySelector(PANE_READY_SELECTOR)) return false
    return pane.getBoundingClientRect().height > 0
  }
  function scheduleCenterWhenLaidOut() {
    const token = centerToken
    const tryOnce = () => {
      if (token !== centerToken) return true          // 已切换/离开：撤销
      const pane = activePaneEl()
      if (!paneIsReady(pane)) return false
      centerReplayPane()
      // 成功即收尾：RO / MO 两个监听都撤销，保证每次进入只定位一次
      cancelPendingCenter()
      return true
    }
    if (tryOnce()) return
    const pane = activePaneEl()
    if (!pane || typeof ResizeObserver === 'undefined') return
    centerObserver = new ResizeObserver(() => {
      if (tryOnce()) { centerObserver?.disconnect?.(); centerObserver = null }
    })
    centerObserver.observe(pane)
    // 子元素替换（pane 高度不变、仅内容切换）时 ResizeObserver 不触发：MutationObserver 补一道
    if (typeof MutationObserver !== 'undefined') {
      centerMutationObserver?.disconnect?.()
      centerMutationObserver = new MutationObserver(() => {
        if (tryOnce()) { centerMutationObserver?.disconnect?.(); centerMutationObserver = null }
      })
      centerMutationObserver.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pane-ready'] })
    }
  }

  watch(activeCapability, (cap) => {
    cancelPendingCenter()
    centerMutationObserver?.disconnect?.()
    centerMutationObserver = null
    if (!REPLAY_CAPABILITIES.has(cap)) return
    nextTick(scheduleCenterWhenLaidOut)
  }, { immediate: true })
  onBeforeUnmount(() => {
    cancelPendingCenter()
    centerMutationObserver?.disconnect?.()
    centerMutationObserver = null
  })

  return { workspaceContentEl, centerReplayPane }
}
