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
  const above = Math.max(0, anchor.top - viewportTop - edge - gap)
  const below = Math.max(0, viewportBottom - anchor.bottom - edge - gap)
  const abovePreferred = panel.value.scrollHeight <= above || above >= below
  const available = abovePreferred ? above : below
  const width = Math.min(panel.value.offsetWidth, hostWidth - paddingLeft - paddingRight - edge * 2)
  const height = Math.min(panel.value.scrollHeight, available)
  placement.value = {
    // 面板以 host 的内边距盒为定位基准，故先扣掉左侧内边距再夹到 host 内。
    left: `${Math.max(paddingLeft + edge, Math.min(anchor.right - originLeft - width, hostWidth - paddingRight - width - edge))}px`,
    top: `${Math.max(paddingTop + edge, abovePreferred ? anchor.top - originTop - gap - height : anchor.bottom - originTop + gap)}px`,
    maxHeight: `${available}px`,
  }
}
function dismiss(event) {
  if (!props.open) return
  if (event.type === 'keydown') { if (event.key === 'Escape') emit('close'); return }
  if (!panel.value?.contains(event.target) && !props.anchor?.contains(event.target)) emit('close')
}
watch(() => [props.open, props.portrait, props.host, props.anchor], async () => {
  await nextTick()
  observer?.disconnect()
  if (props.open && observer) {
    for (const el of [props.host, props.anchor, panel.value]) if (el) observer.observe(el)
  }
  measure()
}, { flush: 'post' })
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(measure)
  window.addEventListener('resize', measure)
  window.addEventListener('scroll', measure, true)
  document.addEventListener('pointerdown', dismiss, true)
  document.addEventListener('keydown', dismiss)
  nextTick(() => {
    if (props.open && observer) for (const el of [props.host, props.anchor, panel.value]) if (el) observer.observe(el)
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
  <section v-if="open" ref="panel" class="pb-display-surface" :class="{ 'pb-display-portrait': portrait }" :style="portrait ? undefined : placement" role="dialog" :aria-label="$t('recon.map.playback.panel_display')" data-testid="display-panel" @pointerdown.stop @click.stop>
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
</style>
