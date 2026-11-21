import { inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { isInteractiveTarget, usePlaybackTransport } from '../composables/usePlaybackTransport.js'

export function useBattlePlaybackLifecycle(deps) {
  const {
    props, lifecycleVisible, wideLayout, playbackLifecycle,
    pbRoot, mapStageEl, transportEl, battlefieldWorkspaceEl, isFullscreen, fitViewIfReady,
    pause, exitOwnedFullscreen, disposeClock, disposeCamera, disposeMapPresentation,
    annotationOpen, routePoints, draft, cancelRoute, selectedAnnotation, selectedAnnotationIndex,
    closeAnnotation, finishRoute, deleteSelected, redoAnnot, undoAnnot, setUiHidden,
    duration, currentTime, playing, play, step, seek, uiHidden,
  } = deps
  let stageResizeObserver = null
  let wideLayoutQuery = null

  function onWideLayoutChange(event) {
    wideLayout.value = !!(event && event.matches)
  }
/**
 * §square-stage：正方形 Stage 的**纵向可用高度**实测值。
 *
 * 为什么必须实测：页面 chrome（顶栏 / 底部 Tab 栏 / 安全区 / HUD / 传输控件）随形态、
 * 全屏与机型变化，用固定常量扣减会算出比实际可用空间更高的正方形（实测 pc 桌面下
 * 常量算出 622px，而真实可用高度只有 578px），正方形于是压在传输控件上。
 *
 * 为什么不会形成循环依赖：量的是 `pbRoot` 的高度减去 HUD 与传输控件——这三者都由外层
 * 布局决定，与「由正方形宽度决定的 Stage 高度」无关。写回 `--pb-square-avail-h` 后
 * ResizeObserver 会再触发一次，但那时预算值已经稳定，不会来回震荡。
 */
function writeSquareAvailHeight() {
  const root = pbRoot.value
  if (!root) return
  const hud = root.querySelector('.pb-hud')
  const transport = transportEl.value
  // 根高度在纵向流里本身就由正方形撑开（自指），所以再用视口高度封顶：
  // 横屏手机 / 全屏下正方形 + HUD + 传输控件必须一屏放下，传输控件不被顶出首屏。
  const rootRect = root.getBoundingClientRect()
  const style = getComputedStyle(root)
  const viewportH = window.visualViewport?.height || window.innerHeight
  const pageStyle = getComputedStyle(document.documentElement)
  const headerH = parseFloat(pageStyle.getPropertyValue('--header-h')) || 0
  // Use viewport capacity, never a content-derived root height (which feeds back into Stage).
  // Scroll changes presentation position, not the workspace capacity.
  const top = isFullscreen.value ? 0 : headerH
  const workspaceH = Math.max(1, viewportH - top)
  root.style.setProperty('--pb-workspace-h', `${workspaceH}px`)
  const main = battlefieldWorkspaceEl.value
  const above = main ? Math.max(0, main.getBoundingClientRect().top - rootRect.top) : 0
  const content = transport?.closest?.('.pb-mobile-overlay-content')
  const controlsH = content?.getBoundingClientRect().height || transport?.getBoundingClientRect().height || 0
  const gap = parseFloat(style.getPropertyValue('--space-1')) || 4
  const bottom = parseFloat(style.paddingBottom) || 0
  const hudH = hud?.getBoundingClientRect().height || 0
  const budget = Math.max(1, workspaceH - above - hudH - controlsH - gap * 2 - bottom)
  root.style.setProperty('--pb-square-avail-h', `${Math.floor(budget)}px`)
}

// 外壳沉浸态切换改的是 --header-h（不触发任何元素 resize），显式重算高度预算与默认 fit。
const shellChrome = inject(SHELL_CHROME_KEY, null)
watch(() => shellChrome?.immersive.value, () => nextTick(() => { writeSquareAvailHeight(); fitViewIfReady(true) }))

watch(() => mapStageEl.value, (el) => {
  if (stageResizeObserver) { stageResizeObserver.disconnect(); stageResizeObserver = null }
  if (!el || typeof ResizeObserver !== 'function') return
  stageResizeObserver = new ResizeObserver(writeSquareAvailHeight)
  stageResizeObserver.observe(el)
  if (pbRoot.value) stageResizeObserver.observe(pbRoot.value)
  if (transportEl.value) stageResizeObserver.observe(transportEl.value)
  const hud = pbRoot.value?.querySelector('.pb-hud')
  if (hud) stageResizeObserver.observe(hud)
  writeSquareAvailHeight()
}, { immediate: true })
watch(transportEl, (el, previous) => {
  if (previous && stageResizeObserver) stageResizeObserver.unobserve(previous)
  if (el && stageResizeObserver) stageResizeObserver.observe(el)
  nextTick(writeSquareAvailHeight)
})

onMounted(() => {
  // window 级 pointermove/up/cancel 兜底监听由 usePlaybackMapGestures 挂载（#820 Agent C）
  // fullscreenchange 由 usePlaybackFullscreen 独占监听（onChange 注入布局反应），这里不再重复注册
  // §3：大桌面三列布局 —— 以 matchMedia 为事实源，监听宽度跨 1200px 边界。
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    wideLayoutQuery = window.matchMedia('(min-width: 1200px)')
    wideLayout.value = !!wideLayoutQuery.matches
    if (typeof wideLayoutQuery.addEventListener === 'function') {
      wideLayoutQuery.addEventListener('change', onWideLayoutChange)
    }
  }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', writeSquareAvailHeight)
})

/** 拖动进度条：按下即暂停，拖动中实时 seek，松开时若原先在播放则自动继续（与 3D 共用 usePlaybackTransport）。 */
function dragStart() {
  transport.scrubStart()
}

function dragEnd() {
  transport.scrubEnd()
}

// 能力切换或 KeepAlive 停用时暂停并退出本回放拥有的全屏。
onDeactivated(() => { lifecycleVisible.value = false; pause(); exitOwnedFullscreen() })
onActivated(() => { lifecycleVisible.value = true })
watch(() => props.active, (value) => { if (!value) { pause(); exitOwnedFullscreen() } })

// 共享播放键位/拖动语义；键盘监听由本组件挂卸，避免重复注册。
const transport = usePlaybackTransport({
  isPlaying: () => playing.value,
  // 播放时钟在下方解构（声明顺序晚于本调用）——惰性闭包避免 TDZ；事件期才求值。
  play: () => play(),
  pause: () => pause(),
  step: (delta) => step(delta),
  isAtEnd: () => duration.value > 0 && currentTime.value >= duration.value,
  restart: () => seek(0),
  isActive: () => props.active && lifecycleVisible.value,
}, { keyboard: false })

function onKeydown(e) {
  if (!props.active || !lifecycleVisible.value || e.isComposing) return
  if (annotationOpen.value && !isInteractiveTarget(e.target)) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (routePoints.value.length || draft.value) cancelRoute()
      else if (selectedAnnotation.value) selectedAnnotationIndex.value = -1
      else closeAnnotation()
      return
    }
    if (e.key === 'Enter' && routePoints.value.length) { e.preventDefault(); finishRoute(); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoAnnot() : undoAnnot(); return }
  }
  if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey && !isInteractiveTarget(e.target)) {
    e.preventDefault()
    setUiHidden(!uiHidden.value)
    return
  }
  transport.handleKeydown(e)
}

onBeforeUnmount(() => {
  playbackLifecycle.active = false
  disposeMapPresentation()
  disposeClock()
  disposeCamera()
  if (stageResizeObserver) {
    stageResizeObserver.disconnect()
    stageResizeObserver = null
  }
  if (typeof document !== 'undefined') {
    // fullscreenchange 的移除归 usePlaybackFullscreen（onScopeDispose 内完成；它同时负责解锁方向）
    // 组件在 fullscreen 中被卸载 → 主动退出（浏览器通常会自动退出，这里兜底）
    if (pbRoot.value && pbRoot.value === document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      try {
        const exitResult = document.exitFullscreen()
        if (exitResult && typeof exitResult.catch === 'function') exitResult.catch(() => {})
      } catch {
        // fullscreen teardown is best-effort during component unmount
      }
    }
  }
  // §3：清理大桌面三列布局的 matchMedia 监听。
  if (wideLayoutQuery && typeof wideLayoutQuery.removeEventListener === 'function') {
    wideLayoutQuery.removeEventListener('change', onWideLayoutChange)
  }
  wideLayoutQuery = null
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', writeSquareAvailHeight)
})


  return { transport, stageResizeObserver: () => stageResizeObserver, writeSquareAvailHeight, dragStart, dragEnd }
}
