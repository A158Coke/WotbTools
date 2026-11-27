import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref, ComputedRef } from 'vue'

type Shot = { index: number }
type DetailContext = {
  shots: Ref<Shot[]>; filteredShots: ComputedRef<Shot[]>; selectedIndex: Ref<number | null>
  paneRoot: Ref<HTMLElement | null>; onboarding: { guideActive?: Ref<boolean> } | null
  availability3d: () => { available: boolean }; openInViewer: (shot: Shot) => Promise<boolean>
  rowHas3d: (shot: Shot) => boolean
}

const SWIPE_MIN_DX = 48
const SWIPE_DX_RATIO = 1.25

/** @param {{
 *  shots: import('vue').Ref<Array<object>>,
 *  filteredShots: import('vue').ComputedRef<Array<object>>,
 *  selectedIndex: import('vue').Ref<number|null>,
 *  paneRoot: import('vue').Ref<HTMLElement|null>,
 *  onboarding: object|null,
 *  availability3d: () => { available: boolean },
 *  openInViewer: (shot: object) => Promise<boolean>,
 *  rowHas3d: (shot: object) => boolean,
 * }} ctx */
export function useShotsDetail({ shots, filteredShots, selectedIndex, paneRoot, onboarding, availability3d, openInViewer, rowHas3d }: DetailContext) {
  const layout = ref('expanded')
  const guideLayout = computed(() => guideInset.value > 0 ? 'compact' : layout.value)
  const directOpening = ref(false)
  const detailOpen = computed(() => selectedIndex.value != null && !directOpening.value)
  const isOverlay = computed(() => guideLayout.value === 'compact')

  let observer: ResizeObserver | null = null
  const detailPane = ref<HTMLElement | null>(null)
  let lastTrigger: HTMLElement | null = null
  const guideInset = ref(0)

  function applyLayout(width: number) {
    layout.value = width >= 900 ? 'expanded' : width >= 600 ? 'medium' : 'compact'
  }

  function selectShot(index: number, event?: Event) {
    const shot = shots.value.find(s => s.index === index)
    if (layout.value === 'compact' && !onboarding?.guideActive?.value && shot && rowHas3d(shot)
      && availability3d().available) {
      selectedIndex.value = index
      directOpening.value = true
      const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
      void openInViewer(shot).catch(() => false).then((navigated) => {
        directOpening.value = false
        if (selectedIndex.value !== index) return
        if (navigated) selectedIndex.value = null
        else showDetail(trigger)
      })
      return
    }
    selectedIndex.value = index
    showDetail(event?.currentTarget instanceof HTMLElement ? event.currentTarget : null)
  }

  function showDetail(trigger: HTMLElement | null) {
    lastTrigger = trigger
    if (isOverlay.value) nextTick(() => detailPane.value?.focus?.())
  }

  function closeDetail() {
    selectedIndex.value = null
    if (lastTrigger?.focus) lastTrigger.focus()
  }

  const selectedPosition = computed(() =>
    filteredShots.value.findIndex((s) => s.index === selectedIndex.value))
  const hasPreviousShot = computed(() => selectedPosition.value > 0)
  const hasNextShot = computed(() =>
    selectedPosition.value >= 0 && selectedPosition.value < filteredShots.value.length - 1)

  function goToAdjacentShot(step: number) {
    const position = selectedPosition.value
    if (position < 0) return false
    const next = position + step
    if (next < 0 || next >= filteredShots.value.length) return false
    selectedIndex.value = filteredShots.value[next].index
    return true
  }

  watch(filteredShots, (rows) => {
    if (selectedIndex.value == null) return
    if (!rows.some((s) => s.index === selectedIndex.value)) closeDetail()
  })

  function isFormControl(target: EventTarget | null) {
    return target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  }

  function onDetailKeydown(event: KeyboardEvent) {
    if (!detailOpen.value) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeDetail()
      return
    }
    if (event.key === 'Tab' && isOverlay.value) {
      const controls = [...(detailPane.value?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]') || [])]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (event.target === first || event.target === detailPane.value)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && event.target === last) {
        event.preventDefault()
        first?.focus()
      }
      return
    }
    if (isFormControl(event.target)) return
    if (event.key === 'ArrowLeft' && goToAdjacentShot(-1)) event.preventDefault()
    else if (event.key === 'ArrowRight' && goToAdjacentShot(1)) event.preventDefault()
  }

  let swipeStart: { x: number; y: number } | null = null

  function onDetailPointerDown(event: PointerEvent) {
    if (layout.value !== 'compact' || !detailOpen.value) return
    swipeStart = { x: event.clientX, y: event.clientY }
  }

  function onDetailPointerUp(event: PointerEvent) {
    const start = swipeStart
    swipeStart = null
    if (!start || layout.value !== 'compact' || !detailOpen.value) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) <= Math.abs(dy) * SWIPE_DX_RATIO) return
    goToAdjacentShot(dx < 0 ? 1 : -1)
  }

  function onDetailPointerCancel() {
    swipeStart = null
  }

  onMounted(() => {
    if (typeof ResizeObserver !== 'function' || !paneRoot.value) return
    observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width
      if (width) applyLayout(width)
    })
    observer.observe(paneRoot.value)
    const initialWidth = paneRoot.value.getBoundingClientRect().width
    if (initialWidth) applyLayout(initialWidth)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  function setGuideInset(px: number) { guideInset.value = px }

  return {
    layout, guideLayout, directOpening, detailOpen, isOverlay,
    detailPane, guideInset, setGuideInset,
    applyLayout, selectShot, showDetail, closeDetail,
    selectedPosition, hasPreviousShot, hasNextShot, goToAdjacentShot,
    onDetailKeydown, onDetailPointerDown, onDetailPointerUp, onDetailPointerCancel,
  }
}
