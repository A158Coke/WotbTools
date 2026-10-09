<script setup>
// 页面头部（design-language §9）：compact = 一行标题 + 右侧操作，工作区与设置页使用。
// hero 变体属于装饰插槽，随首页 / 名人堂迁移时再加入。
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>

<template>
  <header class="page-header">
    <div class="page-header-text">
      <h1 class="page-header-title">{{ title }}</h1>
      <p v-if="description" class="page-header-description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header-actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding-block: var(--space-2) var(--space-5);
  margin-bottom: var(--space-5);
  border-bottom: 1px solid var(--color-border-subtle);
}

.page-header-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.page-header-title { margin: 0; color: var(--color-text-primary); font: var(--type-h1); }
.page-header-description { max-width: var(--reading-measure); margin: var(--space-2) 0 0; color: var(--color-text-secondary); font: var(--type-body); }
.page-header-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; min-width: 0; }
@media (width < 768px) {
  .page-header { align-items: flex-start; gap: var(--space-3); padding-bottom: var(--space-4); margin-bottom: var(--space-4); }
  .page-header-actions { max-width: 100%; }
}
</style>
