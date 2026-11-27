<script setup lang="ts">
import { computed } from 'vue'
import { sectionHeroStyle, type SectionHeroId } from '../shared/sectionHeroes'

const props = defineProps<{
  kicker?: string
  title: string
  description?: string
  section?: SectionHeroId
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

.showcase-hero-art--section {
  background: var(--theme-hero-section-scrim, var(--theme-hero-scrim)), var(--hero-image) var(--hero-pos, right center) / cover, var(--color-surface-1);
}

.showcase-hero.is-compact .showcase-hero-art--section {
  background: var(--theme-hero-section-scrim, var(--theme-hero-scrim)), var(--hero-image) var(--hero-pos-compact, var(--hero-pos, right center)) / cover, var(--color-surface-1);
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
  .showcase-hero.is-compact[data-section='admin'] {
    background: linear-gradient(to right, var(--color-surface-1), var(--color-surface-3));
  }
  .showcase-hero.is-compact[data-section='admin'] .showcase-hero-art {
    inset-inline-start: auto;
    aspect-ratio: 16 / 9;
    background: var(--hero-image) right center / contain no-repeat;
    mask-image: linear-gradient(to right, transparent, currentColor 32%);
  }
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

@media (width >= 768px) {
  .showcase-hero:not(.is-compact) .showcase-hero-content {
    min-block-size: clamp(240px, 20vw, 384px);
    align-content: center;
  }
}
@media (width >= 768px) and (height < 700px) {
  .showcase-hero:not(.is-compact) .showcase-hero-content { min-block-size: 0; }
}

@media (width < 768px) {
  .showcase-hero-art { background: var(--theme-hero-scrim-portrait), var(--theme-hero-image-portrait) center 70% / cover; }
  .showcase-hero-art--section { background: var(--theme-hero-section-scrim-portrait, var(--theme-hero-scrim-portrait)), var(--hero-image) var(--hero-pos-mobile, center) / cover, var(--color-surface-1); }
  .showcase-hero-kicker { color: var(--theme-hero-kicker-color, var(--color-accent-text)); }
  .showcase-hero-title {
    color: var(--theme-hero-title-color, var(--color-text-primary));
    text-shadow: var(--theme-hero-text-shadow, none);
  }
  .showcase-hero-description {
    color: var(--theme-hero-description-color, var(--color-text-secondary));
    text-shadow: var(--theme-hero-text-shadow, none);
  }
  .showcase-hero-stats { color: var(--theme-hero-description-color, var(--color-text-secondary)); }
  .showcase-hero-stats :deep(span) { color: inherit; }
  .showcase-hero-stats :deep(strong) { color: var(--theme-hero-stat-color, var(--color-accent-text)); }
  .showcase-hero-content { padding: var(--space-10) var(--space-4) var(--space-4); }
  .showcase-hero-title { font: var(--type-h1); }
  .showcase-hero.is-compact .showcase-hero-content {
    min-block-size: 96px;
    padding: var(--space-3) var(--space-4);
  }
  .showcase-hero.is-compact .showcase-hero-art--section {
    background: var(--theme-hero-section-scrim-portrait, var(--theme-hero-scrim-portrait)), var(--hero-image) var(--hero-pos-mobile, center) / cover, var(--color-surface-1);
  }
  .showcase-hero.is-compact .showcase-hero-title { font: var(--type-h3); }
  .showcase-hero-toolbar { justify-content: flex-start; }
}
/* 管理页的长标题也覆盖在底图上，遮罩的实色区随文字宽度延伸。 */
.showcase-hero.is-compact[data-section='admin'] .showcase-hero-content {
  --hero-text-surface: var(--color-surface-1-glass);
  inline-size: fit-content;
  max-inline-size: 100%;
  padding-inline-end: var(--space-12);
  background: linear-gradient(to right, var(--hero-text-surface) calc(100% - var(--space-12)), transparent);
}
@media (width < 768px) {
  .showcase-hero.is-compact[data-section='admin'] .showcase-hero-content {
    --hero-text-surface: var(--color-hero-photo-scrim);
  }
}
</style>
