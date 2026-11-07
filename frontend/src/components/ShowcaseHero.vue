<script setup lang="ts">
// Showcase Hero（design-language §2 DC-THM-03…06，D1）：工作区页面在数据区之上的可选主视觉。
// 背景是当前主题的主视觉（大屏横版 / 小屏竖版）+ 主题遮罩，文字落在遮罩压出的纯色区；
// 只放标题、一句说明、关键数字与操作，不放表格、筛选、表单。动效遵守 reduced-motion。
defineProps<{ kicker?: string, title: string, description?: string }>()
</script>

<template>
  <section class="showcase-hero" data-testid="showcase-hero">
    <div class="showcase-hero-art" aria-hidden="true" />
    <div class="showcase-hero-content">
      <p v-if="kicker" class="showcase-hero-kicker">{{ kicker }}</p>
      <h1 class="showcase-hero-title">{{ title }}</h1>
      <p v-if="description" class="showcase-hero-description">{{ description }}</p>
      <div v-if="$slots.stats" class="showcase-hero-stats"><slot name="stats" /></div>
      <div v-if="$slots.actions" class="showcase-hero-actions"><slot name="actions" /></div>
    </div>
  </section>
</template>

<style scoped>
.showcase-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  margin-block-end: var(--space-5);
  border: 1px solid var(--color-border-subtle);
  border-block-end: 2px solid var(--color-accent);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}

.showcase-hero-art {
  position: absolute;
  inset: 0;
  background: var(--theme-hero-scrim), var(--theme-hero-image) right center / cover;
}

.showcase-hero-content {
  position: relative;
  display: grid;
  gap: var(--space-2);
  max-inline-size: 42rem;
  padding: var(--space-8) var(--space-8) var(--space-6);
}

.showcase-hero-kicker { margin: 0; color: var(--color-accent-text); font: var(--type-caption); font-weight: 600; letter-spacing: .2em; }
.showcase-hero-title { margin: 0; color: var(--color-text-primary); font: var(--type-display); letter-spacing: -0.02em; }
.showcase-hero-description { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
.showcase-hero-stats { display: flex; flex-wrap: wrap; gap: var(--space-6); margin-block-start: var(--space-3); }
.showcase-hero-stats :deep(strong) { display: block; color: var(--color-accent-text); font: var(--type-display); font-variant-numeric: tabular-nums; }
.showcase-hero-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-block-start: var(--space-3); }

@media (width < 768px) {
  .showcase-hero-art { background: var(--theme-hero-scrim-portrait), var(--theme-hero-image-portrait) center 70% / cover; }
  .showcase-hero-content { padding: var(--space-10) var(--space-4) var(--space-4); }
  .showcase-hero-title { font: var(--type-h1); }
}
</style>
