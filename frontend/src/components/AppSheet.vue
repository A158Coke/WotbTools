<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import { DrawerContent, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerTitle } from 'reka-ui'
import { DIALOG_INLINE_KEY } from '../shared/dialog'

const props = defineProps<{
  open: boolean
  returnFocusTo?: HTMLElement | null
  portalTo?: HTMLElement | null
  title: string
  visibleTitle?: boolean
  side?: 'bottom' | 'start' | 'end'
}>()
const emit = defineEmits<{ close: [] }>()
defineOptions({ inheritAttrs: false })

const inline = inject(DIALOG_INLINE_KEY, false)

const opener = ref<HTMLElement | null>(null)
watch(() => props.open, (open) => {
  if (open) opener.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
}, { immediate: true, flush: 'sync' })
const finalFocus = computed(() => props.returnFocusTo ?? opener.value ?? undefined)

const SWIPE = { bottom: 'down', start: 'left', end: 'right' } as const
const swipeDirection = computed(() => SWIPE[props.side ?? 'bottom'])

function onUpdateOpen(value: boolean) {
  if (!value) emit('close')
}

const contentEl = ref<{ $el?: HTMLElement } | null>(null)
watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  const el = contentEl.value?.$el
  if (!el) return
  el.style.setProperty('--drawer-swipe-movement-x', '0px')
  el.style.setProperty('--drawer-swipe-movement-y', '0px')
  el.removeAttribute('data-swipe-dismissed')
})
</script>

<template>
  <DrawerRoot :open="open" :swipe-direction="swipeDirection" @update:open="onUpdateOpen">
    <DrawerPortal :to="portalTo ?? undefined" :disabled="inline" force-mount>
      <DrawerOverlay class="sheet-scrim" data-testid="sheet-scrim" />
      <DrawerContent ref="contentEl" class="sheet" :class="{ 'is-start': side === 'start', 'is-end': side === 'end' }" :final-focus="finalFocus" v-bind="$attrs">
        <DrawerTitle class="sheet-title" :class="{ 'is-hidden': !visibleTitle }">{{ title }}</DrawerTitle>
        <div class="sheet-body"><slot /></div>
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>

<style scoped>
.sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  background: var(--color-scrim);
}
.sheet-scrim[data-state="open"] { animation: sheet-scrim-in var(--duration-slow) var(--ease-standard); }

.sheet {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-sheet);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  max-height: 80dvh;
  padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--color-surface-3);
  box-shadow: var(--elevation-3);
  color: var(--color-text-primary);
  outline: 0;
  transform: translateY(var(--drawer-swipe-movement-y, 0px));
}
.sheet.is-start {
  top: 0;
  right: auto;
  width: var(--nav-drawer-w);
  max-height: none;
  padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom) env(safe-area-inset-left);
  border-inline-end: 1px solid var(--color-border-subtle);
  border-radius: 0;
  background: var(--color-surface-1);
  box-sizing: content-box;
  transform: translateX(var(--drawer-swipe-movement-x, 0px));
}
.sheet.is-start .sheet-body { padding-inline-end: 0; overflow-y: auto; }
.sheet.is-end {
  top: 0;
  left: auto;
  width: var(--detail-drawer-w);
  max-height: none;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) 0;
  border-inline-start: 1px solid var(--color-border-subtle);
  border-radius: 0;
  background: var(--color-surface-1);
  transform: translateX(var(--drawer-swipe-movement-x, 0px));
}
.sheet.is-end .sheet-body { display: flex; flex-direction: column; padding-inline-end: 0; overflow: hidden; }
.sheet[data-state="open"] { animation: sheet-in var(--duration-slow) var(--ease-standard); }
.sheet[data-state="closed"] { animation: sheet-out calc(var(--duration-slow) * var(--drawer-swipe-strength, 1)) var(--ease-standard) forwards; }
.sheet.is-start[data-state="closed"] { animation-name: sheet-out-start; }
.sheet.is-end[data-state="closed"] { animation-name: sheet-out-end; }
.sheet-scrim[data-state="closed"] { animation: sheet-scrim-out var(--duration-slow) var(--ease-standard) forwards; }

.sheet-title { margin: 0 0 var(--space-3); font: var(--type-h3); }
.sheet-title.is-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.sheet-body { min-height: 0; overflow-y: auto; padding-inline-end: var(--space-3); }

@keyframes sheet-scrim-in { from { opacity: 0; } }
@keyframes sheet-in { from { opacity: 0; } }
@keyframes sheet-out { to { transform: translateY(calc(var(--drawer-swipe-movement-y, 0px) + 100%)); } }
@keyframes sheet-out-start { to { transform: translateX(calc(var(--drawer-swipe-movement-x, 0px) - 100%)); } }
@keyframes sheet-out-end { to { transform: translateX(calc(var(--drawer-swipe-movement-x, 0px) + 100%)); } }
@keyframes sheet-scrim-out { to { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .sheet[data-state="closed"],
  .sheet-scrim[data-state="closed"] { animation: none; }
}
</style>
