/**
 * ReplayShotsPane —— 检视面板 / 直达复现 / 键盘与滑动交互（拆分自 ReplayShotsPane.vue，行为原样）。
 * 列表 / 详情分档由**容器宽度**决定（design-language §9：expanded 常驻、medium 推开式、
 * compact 全屏），不看视口——工作台可能被侧栏或抽屉挤窄。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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
export function useShotsDetail({ shots, filteredShots, selectedIndex, paneRoot, onboarding, availability3d, openInViewer, rowHas3d }) {
  const layout = ref('expanded')
  const guideLayout = computed(() => guideInset.value > 0 ? 'compact' : layout.value)
  /** compact 直达复现：手机上点一发直接进入射击复现（design-language §9「射击分析」）；导航期间不弹出检视面板 */
  const directOpening = ref(false)
  const detailOpen = computed(() => selectedIndex.value != null && !directOpening.value)
  const isOverlay = computed(() => guideLayout.value === 'compact')

  let observer = null
  const detailPane = ref(null)
  let lastTrigger = null
  const guideInset = ref(0)

  function applyLayout(width) {
    layout.value = width >= 900 ? 'expanded' : width >= 600 ? 'medium' : 'compact'
  }

  function selectShot(index, event) {
    const shot = shots.value.find(s => s.index === index)
    // compact：点一发直接进入射击复现。新手教程引导中保留检视面板，教程的「从这一发打开」步骤仍有目标。
    // 3D 复现需要在线能力；射击检视是本地能力——3D 当前不可用（离线等）时退回本地详情，不能让这一发无处可看。
    if (layout.value === 'compact' && !onboarding?.guideActive?.value && shot && rowHas3d(shot)
      && availability3d().available) {
      selectedIndex.value = index
      directOpening.value = true
      const trigger = event?.currentTarget ?? null
      // 只有真的导航走了才清选择；等待期间断网 / 第二次能力检查拒绝 / 出错时退回本地检视面板
      void openInViewer(shot).catch(() => false).then((navigated) => {
        directOpening.value = false
        if (selectedIndex.value !== index) return
        if (navigated) selectedIndex.value = null
        else showDetail(trigger)
      })
      return
    }
    selectedIndex.value = index
    showDetail(event?.currentTarget ?? null)
  }

  function showDetail(trigger) {
    lastTrigger = trigger
    if (isOverlay.value) nextTick(() => detailPane.value?.focus?.())
  }

  function closeDetail() {
    selectedIndex.value = null
    if (lastTrigger?.focus) lastTrigger.focus()
  }

  /**
   * 上一发 / 下一发：**只在当前筛选结果内**移动（`filteredShots` 而不是 `shots`）。
   * 边界不循环——第一发没有上一发，最后一发没有下一发，对应按钮同时 disabled。
   */
  const selectedPosition = computed(() =>
    filteredShots.value.findIndex((s) => s.index === selectedIndex.value))
  const hasPreviousShot = computed(() => selectedPosition.value > 0)
  const hasNextShot = computed(() =>
    selectedPosition.value >= 0 && selectedPosition.value < filteredShots.value.length - 1)

  function goToAdjacentShot(step) {
    const position = selectedPosition.value
    if (position < 0) return false
    const next = position + step
    if (next < 0 || next >= filteredShots.value.length) return false
    selectedIndex.value = filteredShots.value[next].index
    return true
  }

  /**
   * 筛选把当前这一发筛掉了 → 关闭详情，不要留一个"列表里已经没有、详情还开着"的状态。
   * （导航本身只在筛选结果内移动，所以这是筛选变化时唯一的不一致入口。）
   */
  watch(filteredShots, (rows) => {
    if (selectedIndex.value == null) return
    if (!rows.some((s) => s.index === selectedIndex.value)) closeDetail()
  })

  /** 键盘：方向键等价于上一发 / 下一发；表单控件聚焦时不劫持 */
  function isFormControl(target) {
    return !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  }

  function onDetailKeydown(event) {
    if (!detailOpen.value) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeDetail()
      return
    }
    if (event.key === 'Tab' && isOverlay.value) {
      const controls = [...(detailPane.value?.querySelectorAll('button:not(:disabled), summary, [tabindex="0"]') || [])]
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

  /**
   * compact 全屏详情里的左右滑动切换（Pointer Events，无手势依赖）：
   * 只在 compact + 详情打开时生效；横向位移要足够大且明显压过纵向位移，避免和纵向滚动打架。
   */
  let swipeStart = null

  function onDetailPointerDown(event) {
    if (layout.value !== 'compact' || !detailOpen.value) return
    swipeStart = { x: event.clientX, y: event.clientY }
  }

  function onDetailPointerUp(event) {
    const start = swipeStart
    swipeStart = null
    if (!start || layout.value !== 'compact' || !detailOpen.value) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) <= Math.abs(dy) * SWIPE_DX_RATIO) return
    goToAdjacentShot(dx < 0 ? 1 : -1)
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

  function setGuideInset(px) { guideInset.value = px }

  return {
    layout, guideLayout, directOpening, detailOpen, isOverlay,
    detailPane, guideInset, setGuideInset,
    applyLayout, selectShot, showDetail, closeDetail,
    selectedPosition, hasPreviousShot, hasNextShot, goToAdjacentShot,
    onDetailKeydown, onDetailPointerDown, onDetailPointerUp,
  }
}
