<script setup>
import { inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { DialogClose, DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { acquireDialogLayer, DIALOG_INLINE_KEY, releaseDialogLayer } from '../shared/dialog.js'
import { X } from 'lucide-vue-next'
import AppTooltip from './AppTooltip.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  size: { type: String, default: 'md', validator: v => ['sm', 'md', 'lg', 'xl', 'viewport'].includes(v) },
  closeOnScrim: { type: Boolean, default: true },
  tone: { type: String, default: 'default', validator: v => ['default', 'danger'].includes(v) },
  keepMounted: { type: Boolean, default: false },
  scrimClass: { type: String, default: '' },
})
const emit = defineEmits(['close'])
defineOptions({ inheritAttrs: false })

const inline = inject(DIALOG_INLINE_KEY, false)
const content = ref(null)
const layer = ref(0)

let opener = null
function restoreOpener(panel = content.value?.$el) {
  const activeModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]')
  if (opener?.isConnected && typeof opener.focus === 'function' && (!activeModal || activeModal === panel)) opener.focus()
  opener = null
}

function visible(element) {
  return !element.closest('[aria-hidden="true"], [hidden]') && getComputedStyle(element).display !== 'none'
}
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
function focusInitial(event) {
  event.preventDefault()
  const panel = content.value?.$el
  if (!panel) return
  const items = [...panel.querySelectorAll(FOCUSABLE)].filter(visible)
  const preferred = items.find(el => el.matches('[autofocus], [data-autofocus]'))
  ;(preferred || items.find(el => !el.classList.contains('dialog-close')) || panel).focus()
}

function onUpdateOpen(value) {
  if (!value) emit('close')
}
const keepOpen = event => event.preventDefault()
function onCloseAutoFocus(event) {
  event.preventDefault()
  restoreOpener(event.target)
}

function syncLayer(open) {
  if (open && !layer.value) layer.value = acquireDialogLayer()
  else if (!open && layer.value) { layer.value = 0; releaseDialogLayer() }
}

watch(() => props.open, (open) => {
  syncLayer(open)
  if (open) opener = document.activeElement
  else if (props.keepMounted) nextTick(() => restoreOpener())
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => syncLayer(false))
</script>

<template>
  <DialogRoot :open="open" @update:open="onUpdateOpen">
    <DialogPortal :disabled="inline" force-mount>
      <div
        v-if="open || keepMounted"
        v-show="open"
        class="dialog-scrim"
        :class="scrimClass"
        :style="{ zIndex: `calc(var(--z-dialog) + ${layer})` }"
        data-testid="dialog-scrim"
        @click.self="closeOnScrim && emit('close')"
      >
        <DialogContent
          ref="content"
          class="dialog"
          :class="[`is-${size}`, `is-${tone}`]"
          :force-mount="keepMounted || undefined"
          aria-modal="true"
          aria-describedby=""
          v-bind="$attrs"
          @open-auto-focus="focusInitial"
          @close-auto-focus="onCloseAutoFocus"
          @interact-outside="keepOpen"
        >
          <header class="dialog-head">
            <DialogTitle class="dialog-title">{{ title }}</DialogTitle>
            <AppTooltip :label="$t('app.close')">
              <DialogClose class="dialog-close" :aria-label="$t('app.close')">
                <X :size="20" aria-hidden="true" />
              </DialogClose>
            </AppTooltip>
          </header>
          <div class="dialog-body"><slot /></div>
          <footer v-if="$slots.actions" class="dialog-actions"><slot name="actions" /></footer>
        </DialogContent>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.dialog-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: var(--color-scrim);
  pointer-events: auto;
}

.dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: 100%;
  max-height: calc(100dvh - var(--space-8));
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-3);
  color: var(--color-text-primary);
  outline: 0;
}

.is-sm { max-width: 420px; }
.is-md { max-width: 560px; }
.is-lg { max-width: 760px; }
.is-xl { max-width: 1120px; }
.is-viewport { max-width: none; height: calc(100dvh - var(--space-8)); }

.dialog-head { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-4) var(--space-2) var(--space-5); }
.dialog-title { flex: 1 1 auto; min-width: 0; margin: 0; font: var(--type-h3); }
.is-danger .dialog-title { color: var(--color-danger); }

.dialog-close {
  display: inline-grid;
  place-items: center;
  flex: none;
  min-width: var(--control-h-md);
  min-height: var(--control-h-md);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.dialog-close:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.dialog-body { min-height: 0; padding: var(--space-2) var(--space-5) var(--space-4); overflow-y: auto; font: var(--type-body); }
.dialog-body :deep(p) { margin: 0 0 var(--space-2); color: var(--color-text-secondary); }

.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5) var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
}

.dialog-scrim { animation: dialog-scrim-in var(--duration-base) var(--ease-standard); }
.dialog { animation: dialog-in var(--duration-base) var(--ease-standard); }
@keyframes dialog-scrim-in { from { opacity: 0; } }
@keyframes dialog-in { from { opacity: 0; transform: translateY(var(--space-2)) scale(.985); } }

@media (hover: hover) {
  .dialog-close:hover { background: var(--color-surface-2); color: var(--color-text-primary); }
}

@media (width < 768px) {
  .dialog-scrim { place-items: end stretch; padding: 0; }
  .dialog {
    max-width: none;
    max-height: 90dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .dialog { animation-name: dialog-scrim-in; }
  .dialog-actions { justify-content: stretch; }
  .dialog-actions > :deep(*) { flex: 1 1 0; }
}
</style>
