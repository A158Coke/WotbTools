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
      :class="{ 'is-compact': compact, 'has-section': section }"
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

/* 分区图与文字各占一列；遮罩只装饰剩余空间，不盖住原图。 */
.showcase-hero.has-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  background: var(--theme-hero-section-scrim, var(--theme-hero-scrim)), var(--color-surface-1);
}
.showcase-hero-art--section {
  position: relative;
  inset: auto;
  grid-area: 1 / 2;
  min-inline-size: 0;
  margin: var(--space-2);
  background: var(--hero-image) center / contain no-repeat;
}
.showcase-hero.has-section .showcase-hero-content {
  grid-area: 1 / 1;
  min-inline-size: 0;
  max-inline-size: none;
  overflow-wrap: anywhere;
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
.showcase-hero-title { margin: 0; color: var(--color-text-primary); font: var(--type-display); letter-spacing: -0.02em; text-shadow: var(--theme-hero-title-halo, none); }
.showcase-hero-description { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
.showcase-hero-stats { display: flex; flex-wrap: wrap; gap: var(--space-6); margin-block-start: var(--space-3); }
.showcase-hero-stats :deep(strong) { display: block; color: var(--color-accent-text); font: var(--type-display); font-variant-numeric: tabular-nums; }
.showcase-hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-block-start: var(--space-3); }

/* 紧凑档保留现有高度与外置工具条。图片列在可用空间内 contain，优先完整性和工作区密度。 */
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
@media (width >= 768px) {
  .showcase-hero.is-compact[data-section='replay'] .showcase-hero-content {
    min-block-size: clamp(132px, 20vw, 384px);
  }
}
@media (width >= 768px) and (height < 700px) {
  .showcase-hero.is-compact[data-section='replay'] .showcase-hero-content {
    min-block-size: 132px;
  }
}
.showcase-hero.is-compact .showcase-hero-title { font: var(--type-h2); }

/* 完整档保留既有桌面高度；矮窗回退内容高度。图片实际大小同时受列宽与高度限制。 */
@media (width >= 768px) {
  /* align-content 必须显式置 center：grid 默认 normal(stretch) 会把加高出来的空间
     分摊进 auto 行，kicker/标题/说明被各自拉成 ~100px 的空行（review P1 复现）；
     center 让行保持自然高度、整体在横幅内垂直居中 */
  .showcase-hero:not(.is-compact) .showcase-hero-content {
    min-block-size: clamp(240px, 20vw, 384px);
    align-content: center;
  }
}
@media (width >= 768px) and (height < 700px) {
  .showcase-hero:not(.is-compact) .showcase-hero-content { min-block-size: 0; }
}

@media (width < 768px) {
  .showcase-hero:not(.has-section) .showcase-hero-art { background: var(--theme-hero-scrim-portrait), var(--theme-hero-image-portrait) center 70% / cover; }
  /* 浅色主题（冬季）竖屏遮罩几乎全撤后，横幅文字改白色 + 深色描边保住可读性；
     只在手机断点生效——桌面左侧仍有 90° 白色遮罩，深色标题保持原样 */
  .showcase-hero:not(.has-section) .showcase-hero-kicker { color: var(--theme-hero-kicker-color, var(--color-accent-text)); }
  .showcase-hero:not(.has-section) .showcase-hero-title {
    color: var(--theme-hero-title-color, var(--color-text-primary));
    text-shadow: var(--theme-hero-text-shadow, none);
  }
  .showcase-hero:not(.has-section) .showcase-hero-description {
    color: var(--theme-hero-description-color, var(--color-text-secondary));
    text-shadow: var(--theme-hero-text-shadow, none);
  }
  .showcase-hero:not(.has-section) .showcase-hero-stats { color: var(--theme-hero-description-color, var(--color-text-secondary)); }
  /* 槽内的 stat 标签（.lb-hero-stat-label / .tp-hero-stat-label）显式设了深色，继承打不开，强制跟随容器浅色 */
  .showcase-hero:not(.has-section) .showcase-hero-stats :deep(span) { color: inherit; }
  .showcase-hero:not(.has-section) .showcase-hero-stats :deep(strong) { color: var(--theme-hero-stat-color, var(--color-accent-text)); }
  .showcase-hero-content { padding: var(--space-10) var(--space-4) var(--space-4); }
  .showcase-hero.has-section .showcase-hero-content { padding: var(--space-6) var(--space-4); }
  .showcase-hero-title { font: var(--type-h1); }
  .showcase-hero.is-compact .showcase-hero-content {
    min-block-size: 96px;
    padding: var(--space-3) var(--space-4);
  }
  .showcase-hero.is-compact .showcase-hero-title { font: var(--type-h3); }
  .showcase-hero-toolbar { justify-content: flex-start; }
}
</style>
