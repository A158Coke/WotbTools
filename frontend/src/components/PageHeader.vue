<script setup lang="ts">
// 页面头部（design-language §9）：compact = 一行标题 + 右侧操作，工作区与设置页使用。
// 本组件**不提供** hero 变体（2026-10-18 定）：首页 hero 是含装饰插槽、主 CTA 与实时数据带的
// 整段落地页板块，与这里的 compact 头部职责不同，且只有一个调用方；塞进来会让本组件同时拥有
// 两套互不相干的布局。首页 hero 由 `HomePage.vue` 自己拥有，装饰插槽规则见 design-language §2。
// kicker 是标题上方的一行分区标签（管理后台列表模板：「管理 · 只读与删除」）；小屏与说明一起隐藏，
// 保持「标题 + 操作」一行（DC-ARC-02）。
withDefaults(defineProps<{
  title: string
  description?: string
  kicker?: string
}>(), { description: '', kicker: '' })
</script>

<template>
  <header class="page-header">
    <div class="page-header-text">
      <p v-if="kicker" class="page-header-kicker">{{ kicker }}</p>
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
.page-header-kicker { margin: 0 0 var(--space-1); color: var(--color-accent-text); font: var(--type-caption); font-weight: 700; }
.page-header-title { margin: 0; color: var(--color-text-primary); font: var(--type-h1); }
.page-header-description { max-width: var(--reading-measure); margin: var(--space-2) 0 0; color: var(--color-text-secondary); font: var(--type-body); }
.page-header-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; min-width: 0; }
@media (width < 768px) {
  /* DC-ARC-02：compact 页头 =「标题 + 右侧操作」一行（≤56px）；kicker 与说明是辅助信息，
     不得占掉首屏。需要保留说明的页面把内容放进页面主体，不要恢复这里。 */
  .page-header { align-items: center; gap: var(--space-3); padding-block: var(--space-1); margin-bottom: var(--space-3); }
  .page-header-kicker,
  .page-header-description { display: none; }
  .page-header-actions { max-width: 100%; }
}
</style>
