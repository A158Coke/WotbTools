<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({ open: Boolean, portrait: Boolean, anchor: Object, host: Object })
const emit = defineEmits(['close'])
const panel = ref(null)
const placement = ref({})
let observer

function measure() {
  if (!props.open || props.portrait || !props.host || !props.anchor || !panel.value) return
  const host = props.host.getBoundingClientRect()
  const anchor = props.anchor.getBoundingClientRect()
  const style = getComputedStyle(props.host)
  const edge = parseFloat(style.getPropertyValue('--space-2')) || 8
  const gap = parseFloat(style.getPropertyValue('--space-1')) || 4
  const originLeft = host.left + props.host.clientLeft
  const originTop = host.top + props.host.clientTop
  const hostWidth = props.host.clientWidth || host.width
  const paddingLeft = parseFloat(style.paddingLeft) || 0
  const paddingTop = parseFloat(style.paddingTop) || 0
  const paddingRight = parseFloat(style.paddingRight) || 0
  const viewportTop = Math.max(host.top, 0)
  const viewportBottom = Math.min(host.bottom, window.innerHeight)
  // 锚点也要先夹进可见交集：宿主整块位于视口之外时（矮横屏把工作台推到首屏下方就是这样），
  // 锚点本身在视口外，按它算「可用空间」会得出一个屏幕外的答案（实测 above=300 而可见只有 111）。
  const anchorTop = Math.min(Math.max(anchor.top, viewportTop), Math.max(viewportTop, viewportBottom))
  const anchorBottom = Math.min(Math.max(anchor.bottom, anchorTop), Math.max(viewportTop, viewportBottom))
  const above = Math.max(0, anchorTop - viewportTop - edge - gap)
  const below = Math.max(0, viewportBottom - anchorBottom - edge - gap)
  // 可见高度不足时 selected 侧会压到 0，此时保留一个下限，避免 max-height 把面板压成不可用。
  const minimumPane = 96
  const abovePane = Math.max(above, Math.min(minimumPane, viewportBottom - viewportTop))
  const belowPane = Math.max(below, Math.min(minimumPane, viewportBottom - viewportTop))
  const abovePreferred = panel.value.scrollHeight <= abovePane || abovePane >= belowPane
  const available = abovePreferred ? abovePane : belowPane
  const width = Math.min(panel.value.offsetWidth, hostWidth - paddingLeft - paddingRight - edge * 2)
  // 面板自身高度也按可见交集收口，保证它始终落在**可见**范围内（而不是宿主范围内）。
  const height = Math.min(panel.value.scrollHeight, available, Math.max(0, viewportBottom - viewportTop))
  const topMin = Math.max(0, paddingTop + edge)
  const topMax = Math.max(topMin, viewportBottom - host.top - height)
  const aboveTop = anchorTop - originTop - gap - height
  const rawTop = abovePreferred ? aboveTop : anchorBottom - originTop + gap
  placement.value = {
    // 面板以 host 的内边距盒为定位基准，故先扣掉左侧内边距再夹到 host 内。
    left: `${Math.max(paddingLeft + edge, Math.min(anchor.right - originLeft - width, hostWidth - paddingRight - width - edge))}px`,
    top: `${Math.min(Math.max(rawTop, topMin), topMax)}px`,
    maxHeight: `${available}px`,
  }
}
function dismiss(event) {
  if (!props.open) return
  if (event.type === 'keydown') { if (event.key === 'Escape') emit('close'); return }
  if (!panel.value?.contains(event.target) && !props.anchor?.contains(event.target)) emit('close')
}

/**
 * 只在元素真的可聚焦时动焦点，并且以「焦点确实落上去了」为准（focus() 对不可聚焦元素是静默 no-op）。
 *
 * 两个关键点：
 *
 * 1. **`preventScroll: true`**。默认的 `focus()` 会把元素滚进视口，而这是一个锚定在 gear 上的
 *    非 modal 浮面：打开它不该改变页面滚动位置。少了这一项，打开 Display 会连带整页滚动一次、
 *    把 `.pb-root` 推出视口，浮面的可用高度随之变化（矮横屏 844×390 上直接表现为浮面落到可见区
 *    之外）。这不是"修 race"，是这次焦点转移本来就不该有的副作用。
 * 2. 可见性用 `getClientRects().length` 判断（不依赖布局引擎，也不需要量尺寸）：gear 在部分
 *    形态下会被隐藏，把焦点丢给一个看不见的按钮会让键盘用户彻底失去落点。
 */
function focusIfPossible(element) {
  if (!element || typeof element.focus !== 'function' || element === document.activeElement) return false
  if (element.getClientRects && element.getClientRects().length === 0) return false
  element.focus({ preventScroll: true })
  return document.activeElement === element
}
/**
 * 非 modal 的锚定设置面也要有键盘落点：打开时进入面内（优先关闭按钮），关闭时把焦点还给 gear。
 * 只记录「这一轮是不是我们把焦点搬进面里的」，所以面不是自己打开的就不还回去；
 * gear 不可见（宽度/高度为 0）时 focusIfPossible 返回 false，此时不把焦点搬出去 —— 不给键盘用户
 * 一个看不见的落点。
 */
let focusMovedIn = false
function syncFocus(open) {
  if (open) {
    focusMovedIn = focusIfPossible(panel.value?.querySelector('[data-testid="display-close"]'))
      || focusIfPossible(panel.value)
    return
  }
  if (focusMovedIn) focusIfPossible(props.anchor)
  focusMovedIn = false
}
watch(() => [props.open, props.portrait, props.host, props.anchor], async () => {
  await nextTick()
  observer?.disconnect()
  if (props.open && observer) {
    for (const el of [props.host, props.anchor, panel.value]) if (el) observer.observe(el)
  }
  measure()
}, { flush: 'post' })
// 焦点与定位分开：定位走上面那个（量完就写），焦点只在开合那一刻动一次。
watch(() => props.open, (open) => syncFocus(open), { flush: 'post' })
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(measure)
  window.addEventListener('resize', measure)
  window.addEventListener('scroll', measure, true)
  document.addEventListener('pointerdown', dismiss, true)
  document.addEventListener('keydown', dismiss)
  nextTick(() => {
    if (props.open && observer) for (const el of [props.host, props.anchor, panel.value]) if (el) observer.observe(el)
    // 挂载时就已经是打开状态（宿主 v-if 挂载即打开）不会触发上面的 watch，这里补一次落点。
    if (props.open) syncFocus(true)
    measure()
  })
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', measure)
  window.removeEventListener('scroll', measure, true)
  document.removeEventListener('pointerdown', dismiss, true)
  document.removeEventListener('keydown', dismiss)
})
</script>

<template>
  <section v-if="open" ref="panel" class="pb-display-surface" :class="{ 'pb-display-portrait': portrait }" :style="portrait ? undefined : placement" role="dialog" tabindex="-1" :aria-label="$t('recon.map.playback.panel_display')" data-testid="display-panel" data-tour="playback-display-options" @pointerdown.stop @click.stop>
    <slot />
  </section>
</template>

<style scoped>
.pb-display-surface {
  position: absolute;
  z-index: var(--pb-z-modal);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  inline-size: min(100% - var(--space-4), clamp(18rem, 32cqw, 28rem));
  padding: var(--space-3);
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  box-shadow: var(--elevation-3);
}
/* 竖屏是流内的一块面，顺序由宿主自己决定：2D 的 `.pb-main` 竖屏下就是普通文档流
   （源码顺序已把 Display 排在传输控件之后），3D 的 `.portrait-flow` 才有显式 order 阶梯。
   这里**不能**统一写死 order —— 那会把 2D 的面推到竖屏里很高的详情 / 名册块之后，
   变成「点了 gear 却什么都不发生」。 */
.pb-display-portrait { position: static; inline-size: 100%; max-block-size: 60dvh; }
/* tabindex="-1" 只是给键盘落点用的（打开时焦点进入面内），程序化聚焦不画焦点环 */
.pb-display-surface:focus { outline: none; }
</style>
