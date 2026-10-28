<script setup>
// 对话框（design-language §7 Dialog / 审计 PG-09）：确认 / 表单共用。
// 焦点陷阱、Esc、aria-modal、body scroll lock 与嵌套层栈由 Reka Dialog 提供；这里只拥有
// WotbTools policy：初始焦点优先级、关闭后焦点回到打开前的元素、手机底部 sheet 视觉与 inline 渲染。
import { inject, nextTick, ref, watch } from 'vue'
import { DialogClose, DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { X } from 'lucide-vue-next'
import AppTooltip from './AppTooltip.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  /** 宽度档：sm 确认（420）· md 表单（560）· lg 复杂表单（760）· xl 数据面板（1120） */
  size: { type: String, default: 'md', validator: v => ['sm', 'md', 'lg', 'xl'].includes(v) },
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
const content = ref(null)

let opener = null
function restoreOpener(panel = content.value?.$el) {
  const activeModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]')
  if (opener?.isConnected && typeof opener.focus === 'function' && (!activeModal || activeModal === panel)) opener.focus()
  opener = null
}

/** 视觉隐藏或对辅助技术隐藏的控件无法聚焦：放进候选会让初始焦点静默落空。 */
function visible(element) {
  return !element.closest('[aria-hidden="true"], [hidden]') && getComputedStyle(element).display !== 'none'
}
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
// 优先聚焦 [autofocus] / [data-autofocus]，其次第一个非关闭按钮的可聚焦元素；都没有时聚焦面板本身
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
// 遮罩点击由 .dialog-scrim 自己处理（click 语义，且可由 closeOnScrim 关闭），Reka 的 outside 判定不参与。
const keepOpen = event => event.preventDefault()
// Reka 在内容卸载、焦点陷阱解除后才触发 close-auto-focus：在这里恢复才不会被陷阱拉回；
// 它默认回到“挂载时的焦点”，会抢走更新的对话框的焦点，所以由 restoreOpener 按层判断。
function onCloseAutoFocus(event) {
  event.preventDefault()
  restoreOpener(event.target)
}

watch(() => props.open, (open) => {
  if (open) opener = document.activeElement
  // keepMounted 的内容不卸载，close-auto-focus 不会触发
  else if (props.keepMounted) nextTick(() => restoreOpener())
}, { immediate: true, flush: 'sync' })
</script>

<template>
  <DialogRoot :open="open" @update:open="onUpdateOpen">
    <DialogPortal :disabled="inline" force-mount>
      <div
        v-if="open || keepMounted"
        v-show="open"
        class="dialog-scrim"
        :class="scrimClass"
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
  /* Reka 模态在打开期间把 body 设为 pointer-events: none；遮罩点击关闭需要它自己恢复命中 */
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

/* 进场：时长 / 缓动全部来自 token，reduced-motion 时 token 为 0 即无动画 */
.dialog-scrim { animation: dialog-scrim-in var(--duration-base) var(--ease-standard); }
.dialog { animation: dialog-in var(--duration-base) var(--ease-standard); }
@keyframes dialog-scrim-in { from { opacity: 0; } }
@keyframes dialog-in { from { opacity: 0; transform: translateY(var(--space-2)) scale(.985); } }

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
  /* 手机底部 sheet 只淡入、不位移：命中目标在进场期间不漂移（真实点击与自动化都不会落在滑动中的旧位置） */
  .dialog { animation-name: dialog-scrim-in; }
  .dialog-actions { justify-content: stretch; }
  .dialog-actions > :deep(*) { flex: 1 1 0; }
}
</style>
