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
  background: var(--hero-image) var(--hero-pos, right center) / cover no-repeat;
}


.showcase-hero-content {
  position: relative;
  display: grid;
  gap: var(--space-2);
  max-inline-size: 42rem;
  padding: var(--space-8) var(--space-8) var(--space-6);
}

.showcase-hero-text { display: grid; gap: var(--space-2); }
.showcase-hero-kicker { margin: 0; color: var(--theme-hero-kicker-color, var(--color-accent-text)); font: var(--type-caption); font-weight: 600; letter-spacing: .2em; }
.showcase-hero-title { margin: 0; color: var(--theme-hero-title-color, var(--color-text-primary)); font: var(--type-display); letter-spacing: -0.02em; text-shadow: var(--theme-hero-title-halo, none); }
.showcase-hero-description { margin: 0; color: var(--theme-hero-description-color, var(--color-text-secondary)); font: var(--type-body); }
.showcase-hero-stats { color: var(--theme-hero-description-color, var(--color-text-secondary)); display: flex; flex-wrap: wrap; gap: var(--space-6); margin-block-start: var(--space-3); }
.showcase-hero .showcase-hero-stats :deep(span) { color: inherit; }
.showcase-hero-stats :deep(strong) { display: block; color: var(--theme-hero-stat-color, var(--color-accent-text)); font: var(--type-display); font-variant-numeric: tabular-nums; }
.showcase-hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-block-start: var(--space-3); }

.showcase-hero-host.is-compact-host { display: grid; gap: var(--space-2); margin-block-end: var(--space-4); }
.showcase-hero-host.is-compact-host .showcase-hero { margin-block-end: 0; }
.showcase-hero-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.showcase-hero.is-compact .showcase-hero-title { font: var(--type-h2); }
.showcase-hero.is-compact .showcase-hero-content {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  max-inline-size: none;
  min-block-size: 132px;
  padding: var(--space-4) var(--space-6);
}
.showcase-hero[data-section] .showcase-hero-content {
  --title-fade: clamp(var(--space-12), 12vw, 12rem);
  inline-size: fit-content;
  max-inline-size: min(100%, calc(42rem + var(--title-fade)));
  overflow-wrap: anywhere;
  padding-inline-end: var(--title-fade);
  background: linear-gradient(to right, var(--color-hero-photo-scrim) calc(100% - var(--title-fade)), transparent);
}
@media (width >= 768px) {
  .showcase-hero:not([data-section]) {
    --theme-hero-kicker-color: var(--color-accent-text);
    --theme-hero-title-color: var(--color-text-primary);
    --theme-hero-description-color: var(--color-text-secondary);
    --theme-hero-stat-color: var(--color-accent-text);
  }
  .showcase-hero.is-compact .showcase-hero-art--section {
    background-position: var(--hero-pos-compact, var(--hero-pos, right center));
  }
  .showcase-hero[data-section] { display: grid; }
  .showcase-hero[data-section] .showcase-hero-content {
    align-content: center;
    padding-inline-start: var(--gutter);
  }
}
@media (width >= 768px) and (height >= 700px) {
  .showcase-hero:not([data-section], .is-compact) .showcase-hero-content {
    min-block-size: clamp(240px, 20vw, 384px);
    align-content: center;
  }
  .showcase-hero[data-section] { min-block-size: clamp(132px, min(36vw, 54svh), 480px); }
  .showcase-hero[data-section] .showcase-hero-title { font: var(--type-display-hero); }
}

@media (width < 768px) {
  .showcase-hero-art { background: var(--theme-hero-scrim-portrait), var(--theme-hero-image-portrait) center 70% / cover; }
  .showcase-hero-art--section { background: var(--theme-hero-section-scrim-portrait, var(--theme-hero-scrim-portrait)), var(--hero-image) var(--hero-pos-mobile, center) / cover, var(--color-surface-1); }
  .showcase-hero-title, .showcase-hero-description { text-shadow: var(--theme-hero-text-shadow, none); }
  .showcase-hero-content { padding: var(--space-10) var(--space-4) var(--space-4); }
  .showcase-hero-title { font: var(--type-h1); }
  .showcase-hero.is-compact .showcase-hero-content {
    min-block-size: 96px;
    padding-block: var(--space-3);
    padding-inline-start: var(--space-4);
  }
  .showcase-hero.is-compact .showcase-hero-title { font: var(--type-h3); }
  .showcase-hero-toolbar { justify-content: flex-start; }
}
</style>
