import { onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue'
import type { Ref } from 'vue'
import { isInteractiveTarget, usePlaybackTransport } from '../composables/usePlaybackTransport.js'
import type { EventTargetLike } from '../composables/usePlaybackTransport.js'

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

  function dragStart(): void {
    transport.scrubStart()
  }

  function dragEnd(): void {
    transport.scrubEnd()
  }

  onDeactivated(() => { S.lifecycleVisible.value = false; S.pause(); S.exitOwnedFullscreen() })
  onActivated(() => { S.lifecycleVisible.value = true })
  watch(() => props.active, (value) => { if (!value) { S.pause(); S.exitOwnedFullscreen() } })

  const transport = usePlaybackTransport({
    isPlaying: () => S.playing.value,
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
      if (S.pbRoot.value && S.pbRoot.value === document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        try {
          const exitResult = document.exitFullscreen()
          if (exitResult && typeof exitResult.catch === 'function') exitResult.catch(() => {})
        } catch {
          // fullscreen teardown is best-effort during component unmount
        }
      }
    }
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