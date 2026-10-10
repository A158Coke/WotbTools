<script setup>
import { computed, inject, onMounted, ref } from 'vue'
import * as api from '../utils/api.js'
import { ArrowRight, Compass } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import cardReplayImg from '../assets/showcase/home/card-replay-parser-v1.webp'
import cardAiReviewImg from '../assets/showcase/home/card-ai-review-v1.webp'
import cardBattlePlaybackImg from '../assets/showcase/home/card-battle-playback-v1.webp'
import cardHofImg from '../assets/showcase/home/card-hall-of-fame-v1.webp'
import cardSponsorImg from '../assets/showcase/home/card-sponsor-v1.webp'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { RouterLink } from 'vue-router'
import { ONBOARDING_KEY } from '../shared/onboarding.js'

const onboarding = inject(ONBOARDING_KEY, null)

const topRecord = ref(null)
const topDamageDisplay = computed(() => {
  const damage = Number(topRecord.value?.damageDealt)
  return Number.isFinite(damage) ? formatDamage(damage) : '--'
})

onMounted(loadTopDamageRecord)

async function loadTopDamageRecord() {
  try {
    const res = await api.hofList({ page: 1, size: 1 })
    topRecord.value = res?.items?.[0] ?? null
  } catch {
    topRecord.value = null
  }
}
function formatDamage(value) { return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') }
</script>

<template>
  <main class="homepage-showcase layout-wide">
    <section class="showcase-hero">
      <div class="hero-copy">
        <h1>{{ $t('app.title') }}</h1>
        <p class="hero-subtitle">{{ $t('app.subtitle') }}</p>
        <div class="hero-actions">
          <AppButton v-if="onboarding" class="hero-btn hero-guide" size="lg" data-testid="home-onboarding" aria-describedby="home-onboarding-hint" @click="onboarding.start()"><Compass :size="18" aria-hidden="true" />{{ $t('onboarding.newbie') }}</AppButton>
          <AppButton class="hero-btn primary" variant="primary" size="lg" href="/?view=replay">{{ $t('home.replayParse') }}<ArrowRight :size="16" aria-hidden="true" /></AppButton>
          <AppButton class="hero-btn secondary" size="lg" href="/?view=ai-review">{{ $t('home.aiReview') }}</AppButton>
          <AppButton class="hero-btn secondary" size="lg" href="/?view=battle-playback">{{ $t('home.battlePlayback') }}</AppButton>
          <AppButton v-if="!isAndroidApp()" class="hero-btn secondary" size="lg" href="/download/android">{{ $t('android.nav') }}</AppButton>
        </div>
        <p v-if="onboarding" id="home-onboarding-hint" class="hero-guide-hint">{{ $t('onboarding.newbieHint') }}</p>
      </div>
      <aside class="record-card">
        <span>{{ $t('home.highestDamageRecord') }}</span>
        <strong>{{ topDamageDisplay }}</strong>
        <div v-if="topRecord" class="record-meta">
          <b>{{ topRecord.tankName || topRecord.vehicleName || '—' }}</b>
          <small>{{ topRecord.nickname || topRecord.playerNickname || '—' }}</small>
          <small>{{ topRecord.map || topRecord.mapName || '—' }}</small>
        </div>
      </aside>
    </section>

    <section class="feature-grid" aria-label="WotBTools">
      <a class="feature-card feature-primary" href="/?view=replay">
        <div class="feature-visual"><img :src="cardReplayImg" width="840" height="560" loading="lazy" decoding="async" alt="" aria-hidden="true"></div>
        <div class="feature-copy"><h2>{{ $t('home.replayParse') }}</h2><p>{{ $t('home.replayParseDesc') }}</p><span class="feature-action">{{ $t('home.replayParse') }} <ArrowRight :size="16" aria-hidden="true" /></span></div>
      </a>
      <a class="feature-card" href="/?view=ai-review">
        <div class="feature-visual"><img :src="cardAiReviewImg" width="840" height="560" loading="lazy" decoding="async" alt="" aria-hidden="true"></div>
        <div class="feature-copy"><h2>{{ $t('home.aiReview') }}</h2><p>{{ $t('home.aiReviewDesc') }}</p><span class="feature-action">{{ $t('home.aiReview') }} <ArrowRight :size="16" aria-hidden="true" /></span></div>
      </a>
      <a class="feature-card" href="/?view=battle-playback">
        <div class="feature-visual"><img :src="cardBattlePlaybackImg" width="840" height="560" loading="lazy" decoding="async" alt="" aria-hidden="true"></div>
        <div class="feature-copy"><h2>{{ $t('home.battlePlayback') }}</h2><p>{{ $t('home.battlePlaybackDesc') }}</p><span class="feature-action">{{ $t('home.battlePlayback') }} <ArrowRight :size="16" aria-hidden="true" /></span></div>
      </a>
      <a class="feature-card" href="/?view=hof">
        <div class="feature-visual"><img :src="cardHofImg" width="840" height="560" loading="lazy" decoding="async" alt="" aria-hidden="true"></div>
        <div class="feature-copy"><h2>{{ $t('hof.btn') }}</h2><p>{{ $t('home.hofDesc') }}</p><span class="feature-action">{{ $t('hof.btn') }} <ArrowRight :size="16" aria-hidden="true" /></span></div>
      </a>
      <RouterLink class="feature-card" to="/sponsor">
        <div class="feature-visual"><img :src="cardSponsorImg" width="840" height="560" loading="lazy" decoding="async" alt="" aria-hidden="true"></div>
        <div class="feature-copy"><h2>{{ $t('home.sponsorTitle') }}</h2><p>{{ $t('home.sponsorDesc') }}</p><span class="feature-action">{{ $t('home.sponsorTag') }} <ArrowRight :size="16" aria-hidden="true" /></span></div>
      </RouterLink>
    </section>

    <section class="home-bottom">
      <div class="bottom-panel analysis-panel">
        <h2 class="analysis-title">{{ $t('home.analysisTitle') }}</h2>
        <p class="analysis-desc">{{ $t('home.analysisDesc') }}</p>
        <div class="panel-actions"><AppButton class="mini-action" href="/?view=replay">{{ $t('home.uploadReplay') }}</AppButton></div>
      </div>
      <div class="bottom-panel quick-panel"><h2>{{ $t('app.title') }}</h2><a href="/?view=history">{{ $t('history.btn') }} <ArrowRight :size="16" aria-hidden="true" /></a><a href="/?view=technical-evolution">{{ $t('technicalEvolution.btn') }} <ArrowRight :size="16" aria-hidden="true" /></a><a href="/?view=contact">{{ $t('contact.nav') }} <ArrowRight :size="16" aria-hidden="true" /></a><a v-if="!isAndroidApp()" href="/download/android">{{ $t('android.nav') }} <ArrowRight :size="16" aria-hidden="true" /></a><a href="https://github.com/A158Coke/WotbTools/issues/new" target="_blank" rel="noopener">{{ $t('app.feedback') }} <ArrowRight :size="16" aria-hidden="true" /></a><RouterLink to="/sponsor">{{ $t('home.sponsorTitle') }} <ArrowRight :size="16" aria-hidden="true" /></RouterLink></div>
    </section>
  </main>
</template>

<style scoped>
.homepage-showcase {
  display: grid;
  gap: var(--space-6);
  color: var(--color-text-primary);
}

/* Keep hero content and the live record in normal flow: long translations cannot overlap. */
.showcase-hero {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}
.hero-copy { min-width: 0; }
.showcase-hero h1 { margin: 0; color: var(--color-text-primary); font: var(--type-display); }
.hero-subtitle { margin: var(--space-3) 0 0; color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
.hero-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-6); }
.hero-btn { white-space: normal; text-align: center; }
.hero-guide { border-color: var(--color-accent); color: var(--color-accent-text); }
.hero-guide-hint { margin: var(--space-2) 0 0; color: var(--color-text-secondary); font: var(--type-caption); }
.record-card { min-width: 0; padding-inline-start: var(--space-6); border-inline-start: 1px solid var(--color-border-subtle); }
.record-card > span { display: block; color: var(--color-text-secondary); font: var(--type-caption); }
.record-card > strong { display: block; margin: var(--space-2) 0; color: var(--color-accent-text); font: var(--type-display); font-variant-numeric: tabular-nums; }
.record-meta { display: grid; gap: var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }
.record-meta b { color: var(--color-text-primary); }
.record-meta small { font: inherit; }

.feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
.feature-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  text-decoration: none;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.feature-visual { aspect-ratio: 3 / 1; overflow: hidden; background: var(--color-surface-2); }
.feature-visual img { width: 100%; height: 100%; object-fit: cover; object-position: center; }
.feature-copy { display: flex; flex: 1; flex-direction: column; align-items: start; padding: var(--space-5); }
.feature-copy h2 { margin: 0 0 var(--space-2); color: var(--color-text-primary); font: var(--type-h3); }
.feature-copy p { margin: 0 0 var(--space-4); color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
.feature-action { display: inline-flex; align-items: center; gap: var(--space-2); margin-top: auto; color: var(--color-accent-text); font: var(--type-caption); font-weight: 600; }
.feature-action svg { flex: none; }
.feature-card:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.home-bottom { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--space-4); }
.bottom-panel { min-width: 0; padding: var(--space-5); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); }
.analysis-title, .quick-panel h2 { margin: 0 0 var(--space-3); color: var(--color-text-primary); font: var(--type-h3); }
.analysis-desc { margin: 0; color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
.panel-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-4); }
.quick-panel a { display: flex; align-items: center; gap: var(--space-3); min-height: var(--control-h-md); padding-block: var(--space-2); border-top: 1px solid var(--color-border-subtle); color: var(--color-text-secondary); font: var(--type-body); text-decoration: none; }
.quick-panel a svg { flex: none; margin-inline-start: auto; }
.quick-panel a:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .feature-card:hover { border-color: var(--color-accent); text-decoration: none; }
  .quick-panel a:hover { color: var(--color-accent-text); text-decoration: none; }
}
@media (768px <= width < 1200px) {
  .showcase-hero { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
  .feature-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (width < 768px) {
  .showcase-hero { grid-template-columns: minmax(0, 1fr); gap: var(--space-5); padding: var(--space-5); }
  .hero-actions { display: grid; grid-template-columns: minmax(0, 1fr); }
  .record-card { padding-inline-start: 0; padding-top: var(--space-4); border-inline-start: 0; border-top: 1px solid var(--color-border-subtle); }
  .feature-grid, .home-bottom { grid-template-columns: minmax(0, 1fr); }
}
</style>
