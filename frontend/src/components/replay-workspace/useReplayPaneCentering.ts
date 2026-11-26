import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'

export interface ReplayPaneCenteringCtx {
  activeCapability: Ref<string>
  initialLoading: Ref<boolean>
}

const REPLAY_CAPABILITIES = new Set(['playback', '3d', 'events', 'shots', 'ai'])
const PANE_TEST_IDS: Record<string, string> = { playback: 'ws-playback', '3d': 'ws-3d', events: 'ws-events', shots: 'ws-shots', ai: 'ws-ai' }
const PANE_READY_SELECTOR = '[data-pane-ready="true"]'

export function useReplayPaneCentering({ activeCapability, initialLoading }: ReplayPaneCenteringCtx) {
  const workspaceContentEl = ref<HTMLElement | null>(null)

  function activePaneEl(): HTMLElement | null {
    const id = PANE_TEST_IDS[activeCapability.value]
    if (!id) return null
    const root = workspaceContentEl.value?.parentElement ?? (typeof document !== 'undefined' ? document : null)
    return root?.querySelector?.(`[data-testid="${id}"]`) ?? null
  }

  function centerReplayPane() {
    const pane = activePaneEl()
    if (!pane || typeof pane.scrollIntoView !== 'function') return
    const rect = pane.getBoundingClientRect()
    const viewportH = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 0
    const tallerThanViewport = viewportH > 0 && rect.height > viewportH
    pane.scrollIntoView({ block: tallerThanViewport ? 'start' : 'center' })
  }

  let centerToken = 0
  let centerObserver: ResizeObserver | null = null
  let centerMutationObserver: MutationObserver | null = null
  function cancelPendingCenter() {
    centerToken += 1
    centerObserver?.disconnect?.()
    centerObserver = null
  }
  function paneIsReady(pane: HTMLElement | null) {
    if (initialLoading.value) return false
    if (!pane || !pane.querySelector(PANE_READY_SELECTOR)) return false
    return pane.getBoundingClientRect().height > 0
  }
  function scheduleCenterWhenLaidOut() {
    const token = centerToken
    const tryOnce = () => {
      if (token !== centerToken) return true
      const pane = activePaneEl()
      if (!paneIsReady(pane)) return false
      centerReplayPane()
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
