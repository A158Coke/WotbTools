<script setup>
// 对话框（design-language §7 Dialog / 审计 PG-09）：确认 / 表单共用。
// role=dialog + aria-modal；焦点陷阱，Esc 关闭，关闭后焦点回到打开前的元素；
// 手机上变为底部 sheet；高度按 dvh 计算并留出安全区。取代 window.confirm 与各页自写的 modal-overlay。
import { inject, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { X } from 'lucide-vue-next'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  /** 宽度档：sm 确认（420）· md 表单（560）· lg 复杂表单（760） */
  size: { type: String, default: 'md', validator: v => ['sm', 'md', 'lg'].includes(v) },
  /** 点遮罩是否关闭（表单有未保存内容时可关掉） */
  closeOnScrim: { type: Boolean, default: true },
  /** 危险操作：标题前显示警示色 */
  tone: { type: String, default: 'default', validator: v => ['default', 'danger'].includes(v) },
  /** 关闭时只隐藏、不卸载（表单草稿、正在读取的文件需要跨开关保留） */
  keepMounted: { type: Boolean, default: false },
  /** 遮罩层额外 class（页面样式 / 测试定位用） */
  scrimClass: { type: String, default: '' },
})
const emit = defineEmits(['close'])
// data-testid 等属性落在对话框面板上，而不是 Teleport
defineOptions({ inheritAttrs: false })

const inline = inject(DIALOG_INLINE_KEY, false)
const panel = ref(null)

// Multiple dialogs can overlap (for example an editor dialog opening useConfirm()).
// Store the shared count on <body> so every AppDialog instance participates in the same lock.
const BODY_LOCK_DATASET_KEY = 'dialogLockCount'
function acquireBodyLock() {
  if (typeof document === 'undefined') return
  const body = document.body
  const next = (Number(body.dataset[BODY_LOCK_DATASET_KEY]) || 0) + 1
  body.dataset[BODY_LOCK_DATASET_KEY] = String(next)
  body.classList.add('dialog-open')
}
function releaseBodyLock() {
  if (typeof document === 'undefined') return
  const body = document.body
  const next = Math.max(0, (Number(body.dataset[BODY_LOCK_DATASET_KEY]) || 0) - 1)
  if (next === 0) {
    delete body.dataset[BODY_LOCK_DATASET_KEY]
    body.classList.remove('dialog-open')
  } else {
    body.dataset[BODY_LOCK_DATASET_KEY] = String(next)
  }
}

const bodyLockHeld = ref(false)
const titleId = `dialog-title-${useId()}`
let opener = null

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
function focusables() {
  return [...(panel.value?.querySelectorAll(FOCUSABLE) || [])]
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const items = focusables()
  if (!items.length) { event.preventDefault(); panel.value?.focus(); return }
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    opener = document.activeElement
    await nextTick()
    // 优先聚焦第一个输入或主按钮之外的第一个可聚焦元素；没有时聚焦面板本身
    const items = focusables()
    const preferred = panel.value?.querySelector('[autofocus], [data-autofocus]')
    ;(preferred || items.find(el => el.tagName !== 'BUTTON' || !el.classList.contains('dialog-close')) || panel.value)?.focus()
    if (!bodyLockHeld.value) {
      acquireBodyLock()
      bodyLockHeld.value = true
    }
  } else {
    if (bodyLockHeld.value) {
      releaseBodyLock()
      bodyLockHeld.value = false
    }
    if (opener && typeof opener.focus === 'function') opener.focus()
    opener = null
  }
}, { immediate: true })

onBeforeUnmount(() => {
  if (bodyLockHeld.value) {
    releaseBodyLock()
    bodyLockHeld.value = false
  }
})
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <div
      v-if="open || keepMounted"
      v-show="open"
      class="dialog-scrim"
      :class="scrimClass"
      data-testid="dialog-scrim"
      @click.self="closeOnScrim && emit('close')"
    >
      <div
        ref="panel"
        class="dialog"
        :class="[`is-${size}`, `is-${tone}`]"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        v-bind="$attrs"
        @keydown="onKeydown"
      >
        <header class="dialog-head">
          <h2 :id="titleId" class="dialog-title">{{ title }}</h2>
          <button type="button" class="dialog-close" :aria-label="$t('app.close')" @click="emit('close')">
            <X :size="20" aria-hidden="true" />
          </button>
        </header>
        <div class="dialog-body"><slot /></div>
        <footer v-if="$slots.actions" class="dialog-actions"><slot name="actions" /></footer>
      </div>
    </div>
  </Teleport>
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

@media (hover: hover) {
  .dialog-close:hover { background: var(--color-surface-2); color: var(--color-text-primary); }
}

/* 手机：底部 sheet，留出底部安全区 */
@media (width < 768px) {
  .dialog-scrim { place-items: end stretch; padding: 0; }
  .dialog {
    max-width: none;
    max-height: 90dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .dialog-actions { justify-content: stretch; }
  .dialog-actions > :deep(*) { flex: 1 1 0; }
}
</style>
