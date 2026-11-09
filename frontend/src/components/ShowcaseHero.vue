<script setup lang="ts">
// Showcase Hero（design-language §2 DC-THM-03…06，D1）：工作区页面在数据区之上的可选主视觉。
// 背景默认是当前主题的主视觉（大屏横版 / 小屏竖版）+ 主题遮罩；传 section 时改用该导航分区的固定 key visual。
// 只放标题、一句说明、关键数字与操作，不放表格、筛选、表单。动效遵守 reduced-motion。
import { computed } from 'vue'
import { sectionHeroStyle, type SectionHeroId } from '../shared/sectionHeroes'

const props = defineProps<{
  kicker?: string
  title: string
  description?: string
  /** 导航分区的固定主视觉；不传则沿用季节主视觉（首页等） */
  section?: SectionHeroId
  /** 紧凑档：横幅只保留 kicker / 标题，操作放到横幅下方工具条，用于工具页与后台 */
  compact?: boolean
}>()

const artStyle = computed(() => (props.section ? sectionHeroStyle(props.section) : undefined))
</script>

<template>
  <div class="showcase-hero-host" :class="{ 'is-compact-host': compact }">
    <section
      class="showcase-hero"
      :class="{ 'is-compact': compact }"
      :data-section="section"
      data-testid="showcase-hero"
    >
      <div
        class="showcase-hero-art"
        :class="{ 'showcase-hero-art--section': section }"
        :style="artStyle"
        aria-hidden="true"
      />
      <div class="showcase-hero-content">
        <div class="showcase-hero-text">
          <p v-if="kicker" class="showcase-hero-kicker">{{ kicker }}</p>
          <h1 class="showcase-hero-title">{{ title }}</h1>
          <p v-if="description && !compact" class="showcase-hero-description">{{ description }}</p>
        </div>
        <div v-if="$slots.stats && !compact" class="showcase-hero-stats"><slot name="stats" /></div>
        <div v-if="$slots.actions && !compact" class="showcase-hero-actions"><slot name="actions" /></div>
      </div>
    </section>
    <div v-if="compact && $slots.actions" class="showcase-hero-toolbar"><slot name="actions" /></div>
  </div>
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

/* 分区主视觉：四套主题共用同一张图，只换遮罩；位置由 sectionHeroes.ts 的唯一映射表驱动 */
.showcase-hero-art--section {
  background: var(--theme-hero-section-scrim, var(--theme-hero-scrim)), var(--hero-image) var(--hero-pos, right center) / cover, var(--color-surface-1);
}

.showcase-hero-content {
  position: relative;
  display: grid;
  gap: var(--space-2);
  max-inline-size: 42rem;
  padding: var(--space-8) var(--space-8) var(--space-6);
}

.showcase-hero-text { display: grid; gap: var(--space-2); }
.showcase-hero-kicker { margin: 0; color: var(--color-accent-text); font: var(--type-caption); font-weight: 600; letter-spacing: .2em; }
.showcase-hero-title { margin: 0; color: var(--color-text-primary); font: var(--type-display); letter-spacing: -0.02em; }
.showcase-hero-description { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
.showcase-hero-stats { display: flex; flex-wrap: wrap; gap: var(--space-6); margin-block-start: var(--space-3); }
.showcase-hero-stats :deep(strong) { display: block; color: var(--color-accent-text); font: var(--type-display); font-variant-numeric: tabular-nums; }
.showcase-hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-block-start: var(--space-3); }

/* 紧凑档：桌面 132px、手机 96px 起，横幅只显示 kicker + 标题；操作在下方工具条 */
.showcase-hero-host.is-compact-host { display: grid; gap: var(--space-2); margin-block-end: var(--space-4); }
.showcase-hero-host.is-compact-host .showcase-hero { margin-block-end: 0; }
.showcase-hero-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.showcase-hero.is-compact .showcase-hero-content {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  max-inline-size: none;
  min-block-size: 132px;
  padding: var(--space-4) var(--space-6);
}
.showcase-hero.is-compact .showcase-hero-title { font: var(--type-h2); }

@media (width < 768px) {
  .showcase-hero-art { background: var(--theme-hero-scrim-portrait), var(--theme-hero-image-portrait) center 70% / cover; }
  .showcase-hero-art--section { background: var(--theme-hero-section-scrim-portrait, var(--theme-hero-scrim-portrait)), var(--hero-image) var(--hero-pos-mobile, center) / cover, var(--color-surface-1); }
  .showcase-hero-content { padding: var(--space-10) var(--space-4) var(--space-4); }
  .showcase-hero-title { font: var(--type-h1); }
  .showcase-hero.is-compact .showcase-hero-content {
    min-block-size: 96px;
    padding: var(--space-3) var(--space-4);
  }
  .showcase-hero.is-compact .showcase-hero-title { font: var(--type-h3); }
  .showcase-hero-toolbar { justify-content: flex-start; }
}
</style>
