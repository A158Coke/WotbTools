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
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-6);
}

.page-header-text { min-width: 0; }
.page-header-title { margin: 0; color: var(--color-text-primary); font: var(--type-h1); }
.page-header-description { margin: var(--space-1) 0 0; color: var(--color-text-secondary); font: var(--type-body); }
.page-header-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
</style>
