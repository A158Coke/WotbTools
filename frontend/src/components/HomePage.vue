<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import * as api from '../api/hall-of-fame.js'
import { ArrowRight, FileDiff, Heart, MessageSquare, Smartphone } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import { useI18n } from 'vue-i18n'
import { mapLabel } from '../utils/helpers.js'
import { RouterLink, useRoute } from 'vue-router'
import { locationForView } from '../app/navigation.js'
import { loadVersionDiffCatalog, versionDiffCatalogState } from '../composables/useVersionDiff.js'
import { FEEDBACK_KEY } from '../shared/feedback.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'

const onboarding = inject(ONBOARDING_KEY, null)
const openFeedback = inject(FEEDBACK_KEY, null)
const { locale } = useI18n()
const route = useRoute()
const androidApp = isAndroidApp()

const topRecord = ref(null)
const recordTotal = ref(null)

const countFormatter = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }))
const topDamageDisplay = computed(() => {
  const damage = Number(topRecord.value?.damageDealt)
  return Number.isFinite(damage) ? formatCount(damage) : '--'
})
const recordTotalDisplay = computed(() => {
  const total = Number(recordTotal.value ?? NaN)
  return Number.isFinite(total) ? formatCount(total) : '--'
})

const latestPair = computed(() => versionDiffCatalogState.value.status === 'ready'
  ? versionDiffCatalogState.value.pairs.at(-1)
  : undefined)
const versionDiffTarget = computed(() => {
  const target = locationForView('agent-version-diff', route)
  return {
    ...target,
    query: { ...target.query, from: latestPair.value?.from.dataset, to: latestPair.value?.to.dataset },
  }
})
onMounted(() => { void loadVersionDiffCatalog() })

const { availability } = useFeatureGate()
watch(() => availability(Feature.HALL_OF_FAME).available, (available) => {
  if (available && !topRecord.value) loadTopDamageRecord()
}, { immediate: true })

async function loadTopDamageRecord() {
  try {
    const res = await api.hofList({ page: 1, size: 1 })
    topRecord.value = res?.items?.[0] ?? null
    recordTotal.value = res?.totalItems ?? null
  } catch {
    topRecord.value = null
    recordTotal.value = null
  }
}
function formatCount(value) { return countFormatter.value.format(Math.round(value)) }
</script>

<template>
  <main class="home-stage">
    <section class="home-hero" data-testid="home-hero">
      <div class="home-hero-inner">
        <h1 class="home-hero-line">WotbTools <span>{{ $t('home.heroTitle') }}</span></h1>
        <div class="home-hero-actions">
          <AppButton v-if="!androidApp" class="home-cta" data-testid="home-android" variant="primary" size="lg" href="/download/android">
            <Smartphone :size="20" aria-hidden="true" />{{ $t('android.nav') }}<ArrowRight class="home-download-arrow" :size="18" aria-hidden="true" />
          </AppButton>
          <RouterLink class="home-sponsor" to="/sponsor" data-testid="home-sponsor">
            <Heart :size="18" aria-hidden="true" />{{ $t('home.sponsorTitle') }}
          </RouterLink>
          <button type="button" class="home-feedback" data-testid="home-feedback" @click="openFeedback?.()">
            <MessageSquare :size="18" aria-hidden="true" />{{ $t('app.feedback') }}
          </button>
        </div>
        <button v-if="onboarding" type="button" class="home-cta-ghost" data-testid="home-onboarding" @click="onboarding.openDirectory()">{{ $t('onboarding.newbie') }}</button>

        <dl class="home-stats">
          <div class="home-stat">
            <dt>{{ $t('home.highestDamageRecord') }}</dt>
            <dd>
              <strong>{{ topDamageDisplay }}</strong>
              <span v-if="topRecord" class="home-stat-meta">
                {{ topRecord.tankName || '—' }}
                · {{ topRecord.nickname || '—' }}
                · {{ mapLabel(topRecord.mapName, locale) || '—' }}
              </span>
            </dd>
          </div>
          <div class="home-stat">
            <dt>{{ $t('home.recordTotal') }}</dt>
            <dd><strong class="is-plain">{{ recordTotalDisplay }}</strong></dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="home-update home-section" aria-labelledby="home-update-title">
      <RouterLink class="home-update-link ui-card surface-glass-1" :to="versionDiffTarget" data-testid="home-version-diff">
        <FileDiff class="home-update-icon" :size="24" aria-hidden="true" />
        <div>
          <h2 id="home-update-title">{{ $t('home.viewVersionChanges') }}</h2>
          <p>{{ $t('home.versionDescription') }}</p>
        </div>
        <p v-if="latestPair" class="home-update-versions" data-testid="home-update-versions">
          {{ latestPair.from.dataset }} → {{ latestPair.to.dataset }}
        </p>
        <ArrowRight class="home-update-icon" :size="18" aria-hidden="true" />
      </RouterLink>
    </section>
  </main>
</template>

<style scoped>
.home-stage {
  position: relative;
  display: grid;
  flex: 1 0 auto;
  grid-template-rows: 1fr auto;
  margin-block-start: calc(-1 * (var(--header-block) + env(safe-area-inset-top)));
  overflow: clip;
  color: var(--color-text-primary);
}

.home-stage::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    linear-gradient(to top, var(--color-canvas), transparent 34%),
    var(--theme-hero-scrim),
    var(--theme-hero-image) right center / cover,
    var(--color-canvas);
}

.home-hero { position: relative; display: grid; }

.home-hero-inner { position: relative; display: flex; flex-direction: column; justify-content: center; inline-size: 100%; max-inline-size: var(--layout-content-max); margin-inline: auto; padding: calc(var(--header-block) + env(safe-area-inset-top) + var(--space-12)) var(--space-12) var(--space-10); }

.home-hero h1 { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2) var(--space-4); margin: 0; color: var(--color-text-primary); font: var(--type-display-hero); letter-spacing: -0.03em; }
.home-hero h1 span { color: var(--color-accent-text); font: var(--type-h2); letter-spacing: 0; }

.home-hero-actions { display: flex; gap: var(--space-4); flex-wrap: wrap; align-items: center; margin-top: var(--space-6); }
.home-cta { padding-inline: var(--space-8); }
.home-cta-ghost { align-self: flex-start; min-height: var(--control-h-lg); padding: 0 var(--space-2); border: 0; background: none; color: var(--color-text-primary); font: var(--type-body); cursor: pointer; }
.home-cta-ghost:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.home-stats {
  display: grid;
  grid-template-columns: minmax(0, max-content) max-content;
  align-self: flex-start;
  gap: var(--space-6);
  max-inline-size: min(100%, 30rem);
  margin: var(--space-8) 0 0;
}
.home-stat { min-width: 0; }
.home-stat dt { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; letter-spacing: .12em; }
.home-stat dd { margin: var(--space-1) 0 0; }
.home-stat strong { display: block; color: var(--color-accent-text); font: var(--type-display); font-variant-numeric: tabular-nums; }
.home-stat strong.is-plain { color: var(--color-text-primary); }
.home-stat-meta { display: block; margin-top: var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }

.home-sponsor, .home-feedback {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-block-size: var(--hit-min-comfortable);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--theme-glass);
  color: var(--color-text-primary);
  font: var(--type-body);
  text-decoration: none;
  cursor: pointer;
}
.home-sponsor:focus-visible,
.home-feedback:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.home-section { inline-size: 100%; max-inline-size: var(--layout-content-max); margin-inline: auto; padding-inline: var(--space-12); }
.home-update { position: relative; margin-block: 0 var(--space-8); }
.home-update-link {
  display: grid;
  border-inline-start: var(--space-1) solid var(--color-accent);
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5);
  color: var(--color-text-primary);
  text-decoration: none;
}
.home-update h2 { margin: 0; font: var(--type-h2); }
.home-update p { margin: var(--space-1) 0 0; color: var(--color-text-secondary); line-height: var(--line-height-prose); }
.home-update .home-update-versions { margin: 0; color: var(--color-accent-text); font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.home-update-link > svg:last-child { grid-column: 4; grid-row: 1; }
.home-update-icon { flex: none; color: var(--color-accent-text); }
.home-update-link:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .home-sponsor:hover, .home-feedback:hover { text-decoration: underline; }
  .home-sponsor:hover, .home-feedback:hover, .home-update-link:hover { border-color: var(--color-accent); }
}

@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .home-update-link > svg:last-child, .home-download-arrow { transition: transform var(--duration-base) var(--ease-standard); }
  .home-cta { transition: box-shadow var(--duration-base) var(--ease-standard); }
  .home-update-link:hover > svg:last-child, .home-cta:hover .home-download-arrow { transform: translateX(var(--space-1)); }
  .home-cta:hover { box-shadow: 0 0 0 var(--space-2) color-mix(in oklab, var(--color-accent) 22%, transparent); }
}

@keyframes home-rise { from { transform: translateY(var(--home-rise-travel)); } }
@media (prefers-reduced-motion: no-preference) {
  .home-hero-line { animation: home-rise var(--home-enter-duration) var(--ease-standard) backwards; }
  .home-hero-inner { animation: home-rise var(--home-enter-duration) var(--ease-standard) backwards; }
}
@supports (animation-timeline: scroll()) {
  @media (prefers-reduced-motion: no-preference) and (width >= 768px) {
    .home-stage::before { animation: home-parallax linear both; animation-timeline: scroll(root block); animation-range: 0 var(--home-parallax-range); }
  }
}
@keyframes home-parallax {
  from { transform: scale(var(--home-parallax-scale)) translateY(0); }
  to { transform: scale(var(--home-parallax-scale)) translateY(var(--home-parallax-shift)); }
}

@media (768px <= width < 1200px) {
  .home-hero-inner { padding: calc(var(--header-block) + env(safe-area-inset-top) + var(--space-10)) var(--space-10) var(--space-10); }
  .home-section { padding-inline: var(--space-10); }
}

@media (width < 768px) {
  .home-stage::before {
    background:
      linear-gradient(to top, var(--color-canvas), transparent 34%),
      var(--theme-hero-scrim-portrait),
      var(--theme-hero-image-portrait) center 72% / cover,
      var(--color-canvas);
  }
  .home-hero-inner { justify-content: center; padding: calc(var(--header-block) + env(safe-area-inset-top) + var(--space-6)) var(--gutter) var(--space-8); }
  .home-hero h1 { font-size: var(--home-hero-title-size-compact); }
  .home-hero-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); margin-top: var(--space-5); }
  .home-cta { grid-column: 1 / -1; }
  .home-sponsor, .home-feedback { justify-content: center; text-align: center; }
  .home-stats { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--space-4); margin-block-start: var(--space-6); }
  .home-stat strong { font: var(--type-display); }
  .home-section { padding-inline: var(--gutter); }
  .home-update-link { column-gap: var(--space-3); row-gap: var(--space-2); grid-template-columns: auto minmax(0, 1fr) auto; padding: var(--space-4); }
  .home-update-versions { grid-column: 2; }
  .home-update-link > svg:last-child { grid-column: 3; grid-row: 1; }
}
</style>
