<script setup>
// 设计语言 Button（design-language §7）：primary / secondary / ghost / danger × sm / md / lg。
// 每个视图最多一个 primary。传 href 渲染为链接，否则为 <button>。
// 状态（§10「反馈」）：按下缩到 97% 并加深；loading 时保持宽度、显示转圈并 aria-busy；
// confirmed 时显示确认态（调用方通常用 useConfirmFlash 维持 2 秒）。主操作按下给一次触感与轻点击音。
import { haptic } from '../composables/useHaptics.js'
import { playSound } from '../composables/useSound.js'

const props = defineProps({
  variant: { type: String, default: 'secondary', validator: v => ['primary', 'secondary', 'ghost', 'danger'].includes(v) },
  size: { type: String, default: 'md', validator: v => ['sm', 'md', 'lg'].includes(v) },
  href: { type: String, default: '' },
  type: { type: String, default: 'button' },
  block: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  confirmed: { type: Boolean, default: false },
})

function onPress() {
  if (props.variant !== 'primary') return
  void haptic('primary')
  playSound('click')
}
</script>

<template>
  <a v-if="href" class="app-button" :class="[`is-${variant}`, `is-${size}`, { 'is-block': block }]" :href="href" @click="onPress">
    <slot />
  </a>
  <button
    v-else
    class="app-button"
    :class="[`is-${variant}`, `is-${size}`, { 'is-block': block, 'is-loading': loading, 'is-confirmed': confirmed }]"
    :type="type"
    :aria-busy="loading ? 'true' : undefined"
    @click="onPress"
  >
    <span class="app-button-content"><slot /></span>
    <span v-if="loading" class="app-button-spinner" aria-hidden="true" />
  </button>
</template>

<style scoped>
.app-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: var(--control-h-md);
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font: var(--type-body);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}

/* display: contents：子元素仍是按钮的直接 flex 项，既有布局（space-between 等）不变；visibility 照常继承 */
.app-button-content { display: contents; }

.app-button:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.app-button:disabled { cursor: not-allowed; opacity: .5; }

/* 按下：缩到 97% 并加深（视觉反馈始终存在，触感 / 音效只是加强） */
.app-button:active:not(:disabled) { transform: scale(.97); filter: brightness(.88); }

/* 加载：内容占位保持宽度，转圈叠在中间 */
.app-button.is-loading { cursor: progress; }
.app-button.is-loading .app-button-content { visibility: hidden; }
.app-button-spinner {
  position: absolute;
  inset: 0;
  margin: auto;
  inline-size: var(--space-4);
  block-size: var(--space-4);
  border: 2px solid currentColor;
  border-inline-end-color: transparent;
  border-radius: var(--radius-full);
}

@media (prefers-reduced-motion: no-preference) {
  .app-button-spinner { animation: app-button-spin 900ms linear infinite; }
}

@keyframes app-button-spin { to { transform: rotate(360deg); } }

.is-sm { min-height: var(--control-h-sm); padding: 0 var(--space-3); }
.is-lg { min-height: var(--control-h-lg); padding: 0 var(--space-5); }
.is-block { width: 100%; }

.is-primary { background: var(--color-accent); color: var(--color-on-accent); }
.is-secondary { border-color: var(--color-border-strong); background: var(--color-surface-1); color: var(--color-text-primary); }
.is-ghost { background: transparent; color: var(--color-text-primary); }
.is-danger { border-color: var(--color-danger); background: transparent; color: var(--color-danger); }
.app-button.is-confirmed { border-color: var(--color-success); background: color-mix(in oklab, var(--color-success) 16%, var(--color-surface-1)); color: var(--color-success); }

@media (hover: hover) {
  .is-primary:hover { background: color-mix(in oklab, var(--color-accent) 88%, var(--color-text-primary)); }
  .is-secondary:hover,
  .is-ghost:hover { background: var(--color-surface-2); }
  .is-danger:hover { background: color-mix(in oklab, var(--color-danger) 14%, var(--color-surface-1)); }
}
</style>
