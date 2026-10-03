<script setup>
// 短文本徽章（design-language §7 Badge：中性 / 状态 / 阵营，≤ 6 个字）。
// 只承载一个词的结论（击穿 / 未穿 / APCR…），细节与解释放在可悬停的标题或检视面板里。
defineProps({
  text: { type: String, required: true },
  /** neutral | success | danger | warning | info */
  tone: { type: String, default: 'neutral' },
})

const TONE_CLASS = Object.freeze({
  success: 'is-success',
  danger: 'is-danger',
  warning: 'is-warning',
  info: 'is-info',
  neutral: '',
})
</script>

<template>
  <span class="badge" :class="TONE_CLASS[tone] || ''">{{ text }}</span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  white-space: nowrap;
}

.badge.is-success { border-color: color-mix(in oklab, var(--color-success) 40%, var(--color-border-subtle)); color: var(--color-success); }
.badge.is-danger { border-color: color-mix(in oklab, var(--color-danger) 40%, var(--color-border-subtle)); color: var(--color-danger); }
.badge.is-warning { border-color: color-mix(in oklab, var(--color-warning) 40%, var(--color-border-subtle)); color: var(--color-warning); }
.badge.is-info { border-color: color-mix(in oklab, var(--color-info) 40%, var(--color-border-subtle)); color: var(--color-info); }
</style>
