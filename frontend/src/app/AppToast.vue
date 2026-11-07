<script setup lang="ts">
// 全站 toast 的唯一渲染出口（design-language §10「反馈」）：大屏右下最多 3 条，小屏在顶栏下方，
// 不压工作台底部操作栏；横屏沉浸时只显示警告 / 错误。成功 / 提示 role=status（4 秒消失，悬停或按住暂停）；
// 警告 / 错误 role=alert，不自动消失，带关闭与可选的下一步操作。
import { computed, inject } from 'vue'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-vue-next'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { dismissToast, pauseToast, resumeToast, toasts } from '../composables/useToast.js'
import type { Toast } from '../composables/useToast.js'

const ICONS = { success: CircleCheck, info: Info, warning: TriangleAlert, error: CircleAlert }
// 横屏沉浸（场景铺满）时成功 / 提示不叠在场景上（它们照常进入通知中心或自动过期），只显示需要处理的警告 / 错误
const shellChrome = inject(SHELL_CHROME_KEY, null)
const visibleToasts = computed(() => (shellChrome?.immersive.value ? toasts.value.filter(toast => toast.persistent) : toasts.value))

function runAction(toast: Toast) {
  toast.action?.run()
  dismissToast(toast.id)
}
</script>

<template>
  <div class="app-toasts" data-testid="app-toasts">
    <div
      v-for="toast in visibleToasts"
      :key="toast.id"
      class="app-toast"
      :class="`is-${toast.tone}`"
      :role="toast.persistent ? 'alert' : 'status'"
      :data-testid="`toast-${toast.tone}`"
      @pointerenter="pauseToast(toast.id)"
      @pointerleave="resumeToast(toast.id)"
      @pointerdown="pauseToast(toast.id)"
      @focusin="pauseToast(toast.id)"
      @focusout="resumeToast(toast.id)"
    >
      <component :is="ICONS[toast.tone]" class="app-toast-icon" :size="20" aria-hidden="true" />
      <div class="app-toast-body">
        <strong class="app-toast-title">{{ toast.titleKey ? $t(toast.titleKey) : toast.title }}</strong>
        <p v-if="toast.messageKey || toast.message" class="app-toast-message">{{ toast.messageKey ? $t(toast.messageKey) : toast.message }}</p>
        <p v-if="toast.hintKey" class="app-toast-message">{{ $t(toast.hintKey) }}</p>
      </div>
      <button v-if="toast.action" type="button" class="app-toast-action" data-testid="toast-action" @click="runAction(toast)">
        {{ toast.action.labelKey ? $t(toast.action.labelKey) : toast.action.label }}
      </button>
      <button type="button" class="app-toast-close" :aria-label="$t('app.close')" data-testid="toast-close" @click="dismissToast(toast.id)">
        <X :size="16" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-toasts {
  position: fixed;
  inset-block-end: calc(env(safe-area-inset-bottom) + var(--space-4));
  inset-inline-end: max(var(--space-4), env(safe-area-inset-right));
  z-index: var(--z-toast);
  display: grid;
  gap: var(--space-2);
  inline-size: min(24rem, calc(100% - var(--space-8)));
  pointer-events: none;
}

/* 抽屉外壳（手机竖屏 / 横屏）：顶栏下方，不压工作台底部操作栏 */
@media (width < 768px), (pointer: coarse) and (orientation: landscape) and (height <= 520px) {
  .app-toasts {
    inset-block: calc(var(--header-h) + env(safe-area-inset-top) + var(--space-2)) auto;
    inset-inline: var(--gutter);
    inline-size: auto;
  }
}

.app-toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-inline-start: var(--space-1) solid var(--toast-tone);
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
  box-shadow: var(--elevation-3);
  color: var(--color-text-primary);
  pointer-events: auto;
}

.app-toast.is-success { --toast-tone: var(--color-success); }
.app-toast.is-info { --toast-tone: var(--color-info); }
.app-toast.is-warning { --toast-tone: var(--color-warning); }
.app-toast.is-error { --toast-tone: var(--color-danger); }

.app-toast-icon { flex: none; color: var(--toast-tone); }
.app-toast-body { flex: 1 1 auto; min-inline-size: 0; }
.app-toast-title { display: block; font: var(--type-body); font-weight: 600; overflow-wrap: anywhere; }
.app-toast-message { margin: var(--space-1) 0 0; color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }

.app-toast-action,
.app-toast-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: var(--hit-min-comfortable);
  border-radius: var(--radius-md);
  cursor: pointer;
  font: var(--type-body);
  font-weight: 600;
}

.app-toast-action { padding: 0 var(--space-3); border: 1px solid var(--color-accent); background: transparent; color: var(--color-accent-text); }
.app-toast-close { min-inline-size: var(--hit-min-comfortable); border: 0; background: transparent; color: var(--color-text-secondary); }
.app-toast-action:focus-visible,
.app-toast-close:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (prefers-reduced-motion: no-preference) {
  .app-toast { animation: toast-in var(--duration-base) var(--ease-standard); }
}

@keyframes toast-in { from { opacity: 0; } }
</style>
