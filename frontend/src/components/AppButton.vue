<script setup>
// 设计语言 Button（design-language §7）：primary / secondary / ghost / danger × sm / md / lg。
// 每个视图最多一个 primary。传 href 渲染为链接，否则为 <button>。
defineProps({
  variant: { type: String, default: 'secondary', validator: v => ['primary', 'secondary', 'ghost', 'danger'].includes(v) },
  size: { type: String, default: 'md', validator: v => ['sm', 'md', 'lg'].includes(v) },
  href: { type: String, default: '' },
  type: { type: String, default: 'button' },
  block: { type: Boolean, default: false },
})
</script>

<template>
  <a v-if="href" class="app-button" :class="[`is-${variant}`, `is-${size}`, { 'is-block': block }]" :href="href">
    <slot />
  </a>
  <button v-else class="app-button" :class="[`is-${variant}`, `is-${size}`, { 'is-block': block }]" :type="type">
    <slot />
  </button>
</template>

<style scoped>
.app-button {
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
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard);
}

.app-button:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.app-button:disabled { cursor: not-allowed; opacity: .5; }

.is-sm { min-height: var(--control-h-sm); padding: 0 var(--space-3); }
.is-lg { min-height: var(--control-h-lg); padding: 0 var(--space-5); }
.is-block { width: 100%; }

.is-primary { background: var(--color-accent); color: var(--color-on-accent); }
.is-secondary { border-color: var(--color-border-strong); background: var(--color-surface-1); color: var(--color-text-primary); }
.is-ghost { background: transparent; color: var(--color-text-primary); }
.is-danger { border-color: var(--color-danger); background: transparent; color: var(--color-danger); }

@media (hover: hover) {
  .is-primary:hover { background: color-mix(in oklab, var(--color-accent) 88%, var(--color-text-primary)); }
  .is-secondary:hover,
  .is-ghost:hover { background: var(--color-surface-2); }
  .is-danger:hover { background: color-mix(in oklab, var(--color-danger) 14%, var(--color-surface-1)); }
}
</style>
