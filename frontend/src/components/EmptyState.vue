<script setup>
// 空状态 / 维护中 / 需要登录（design-language §7、§10）：说明为什么是空的 + 下一步操作。
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  /** status：普通说明；alert：需要用户处理的失败态 */
  role: { type: String, default: 'status' },
})
</script>

<template>
  <section class="empty-state" :role="role">
    <component :is="icon" v-if="icon" class="empty-state-icon" :size="40" aria-hidden="true" />
    <h2 class="empty-state-title">{{ title }}</h2>
    <p v-if="description" class="empty-state-description">{{ description }}</p>
    <div v-if="$slots.default" class="empty-state-actions"><slot /></div>
  </section>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-12) var(--space-4);
  border: 1px dashed var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  text-align: center;
}

.empty-state-icon { color: var(--color-text-tertiary); }
.empty-state-title { margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
.empty-state-description { max-width: 52ch; margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
.empty-state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); margin-top: var(--space-2); }
</style>
