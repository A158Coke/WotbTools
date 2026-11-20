import { onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue'
import type { Ref } from 'vue'
import { isInteractiveTarget, usePlaybackTransport } from '../composables/usePlaybackTransport.js'
import type { EventTargetLike } from '../composables/usePlaybackTransport.js'

/** C 段读取的跨段共享状态（结构性最小集；运行时实体在 SFC 里逐个赋值）。 */
export interface BpCParts {
  wideLayoutQuery: MediaQueryList | null
  wideLayout: Ref<boolean>
  onWideLayoutChange: (event: MediaQueryListEvent) => void
  writeSquareAvailHeight: () => void
  lifecycleVisible: Ref<boolean>
  pause: () => void
  play: () => void
  step: (delta: number) => void
  seek: (seconds: number) => void
  exitOwnedFullscreen: () => void
  disposeClock: () => void
  disposeCamera: () => void
  playing: Ref<boolean>
  duration: Ref<number>
  currentTime: Ref<number>
  annotationOpen: Ref<boolean>
  routePoints: Ref<unknown[]>
  draft: Ref<unknown>
  selectedAnnotation: Ref<unknown>
  selectedAnnotationIndex: Ref<number>
  cancelRoute: () => void
  closeAnnotation: () => void
  finishRoute: () => void
  deleteSelected: () => void
  redoAnnot: () => void
  undoAnnot: () => void
  setUiHidden: (hidden: boolean) => void
  uiHidden: Ref<boolean>
  playbackLifecycleActive: boolean
  paletteRequestToken: number
  stageResizeObserver: ResizeObserver | null
  pbRoot: Ref<HTMLElement | null>
}

export interface BpCProps {
  active: boolean
}

export function bpC(S: BpCParts, props: BpCProps): void {
  onMounted(() => {
    // pointermove/up 兜底在 usePlaybackMapGestures、fullscreenchange 在 usePlaybackFullscreen；
    // §3：大桌面三列布局以 matchMedia 为事实源，监听宽度跨 1200px 边界。
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(min-width: 1200px)')
      S.wideLayoutQuery = query
      S.wideLayout.value = !!query.matches
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', S.onWideLayoutChange)
      }
    }
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', S.writeSquareAvailHeight)
  })

  /** 拖动进度条：按下即暂停，拖动中实时 seek，松开时若原先在播放则自动继续（与 3D 共用 usePlaybackTransport）。 */
  function dragStart(): void {
    transport.scrubStart()
  }

  function dragEnd(): void {
    transport.scrubEnd()
  }

  // 能力切换或 KeepAlive 停用时暂停并退出本回放拥有的全屏。
  onDeactivated(() => { S.lifecycleVisible.value = false; S.pause(); S.exitOwnedFullscreen() })
  onActivated(() => { S.lifecycleVisible.value = true })
  watch(() => props.active, (value) => { if (!value) { S.pause(); S.exitOwnedFullscreen() } })

  // 共享播放键位/拖动语义；键盘监听由本组件挂卸，避免重复注册。
  const transport = usePlaybackTransport({
    isPlaying: () => S.playing.value,
    // 播放时钟在下方解构（声明顺序晚于本调用）——惰性闭包避免 TDZ；事件期才求值。
    play: () => S.play(),
    pause: () => S.pause(),
    step: (delta: number) => S.step(delta),
    isAtEnd: () => S.duration.value > 0 && S.currentTime.value >= S.duration.value,
    restart: () => S.seek(0),
    isActive: () => props.active && S.lifecycleVisible.value,
  }, { keyboard: false })

  function onKeydown(e: KeyboardEvent): void {
    if (!props.active || !S.lifecycleVisible.value || e.isComposing) return
    if (S.annotationOpen.value && !isInteractiveTarget(e.target as EventTargetLike | null)) {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (S.routePoints.value.length || S.draft.value) S.cancelRoute()
        else if (S.selectedAnnotation.value) S.selectedAnnotationIndex.value = -1
        else S.closeAnnotation()
        return
      }
      if (e.key === 'Enter' && S.routePoints.value.length) { e.preventDefault(); S.finishRoute(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); S.deleteSelected(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? S.redoAnnot() : S.undoAnnot(); return }
    }
    if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey && !isInteractiveTarget(e.target as EventTargetLike | null)) {
      e.preventDefault()
      S.setUiHidden(!S.uiHidden.value)
      return
    }
    transport.handleKeydown(e)
  }

  onBeforeUnmount(() => {
    S.playbackLifecycleActive = false
    S.paletteRequestToken += 1
    S.disposeClock()
    S.disposeCamera()
    if (S.stageResizeObserver) {
      S.stageResizeObserver.disconnect()
      S.stageResizeObserver = null
    }
    if (typeof document !== 'undefined') {
      // fullscreenchange 的移除归 usePlaybackFullscreen（onScopeDispose 内完成；它同时负责解锁方向）
      // 组件在 fullscreen 中被卸载 → 主动退出（浏览器通常会自动退出，这里兜底）
      if (S.pbRoot.value && S.pbRoot.value === document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        try {
          const exitResult = document.exitFullscreen()
          if (exitResult && typeof exitResult.catch === 'function') exitResult.catch(() => {})
        } catch {
          // fullscreen teardown is best-effort during component unmount
        }
      }
    }
    // §3：清理大桌面三列布局的 matchMedia 监听。
    if (S.wideLayoutQuery && typeof S.wideLayoutQuery.removeEventListener === 'function') {
      S.wideLayoutQuery.removeEventListener('change', S.onWideLayoutChange)
    }
    S.wideLayoutQuery = null
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', S.writeSquareAvailHeight)
  })

  Object.assign(S, {
    dragStart,
    dragEnd,
    transport,
    onKeydown,
  })
}