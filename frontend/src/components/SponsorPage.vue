<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { loadSponsorMethods } from '../utils/sponsor-config.js'

const { t } = useI18n()
const methods = ref([])
const failedTypes = ref(new Set())
const visibleMethods = computed(() => methods.value.filter(method => !failedTypes.value.has(method.type)))

onMounted(async () => {
  methods.value = await loadSponsorMethods()
})

function hideUnavailableImage(type) {
  failedTypes.value = new Set([...failedTypes.value, type])
}
</script>

<template>
  <main class="sponsor-page layout-content">
    <header class="sponsor-hero">
      <p class="sponsor-kicker">{{ t('sponsor.eyebrow') }}</p>
      <h1>{{ t('sponsor.title') }}</h1>
      <p>{{ t('sponsor.intro') }}</p>
    </header>

    <div class="sponsor-grid">
      <section class="panel sponsor-card">
        <h2>{{ t('sponsor.aboutTitle') }}</h2>
        <p>{{ t('sponsor.description') }}</p>
        <p>{{ t('sponsor.voluntary') }}</p>
        <p class="sponsor-note">{{ t('sponsor.note') }}</p>
      </section>

      <section class="panel sponsor-card" aria-labelledby="sponsor-methods-title">
        <h2 id="sponsor-methods-title">{{ t('sponsor.methodsTitle') }}</h2>
        <p v-if="visibleMethods.length === 0" class="sponsor-unconfigured" role="status" data-testid="sponsor-unconfigured">
          {{ t('sponsor.unconfigured') }}
        </p>
        <div v-else class="sponsor-methods" data-testid="sponsor-methods">
          <div v-for="method in visibleMethods" :key="method.type" class="sponsor-method">
            <img
              :src="method.image"
              :alt="t(`sponsor.${method.type}`)"
              loading="lazy"
              decoding="async"
              @error="hideUnavailableImage(method.type)"
            >
            <span>{{ t(`sponsor.${method.type}`) }}</span>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.sponsor-page {
  width: min(980px, calc(100vw - 40px));
  max-width: 980px;
  padding-block: 36px 48px;
  background-color: var(--bg);
  background-image: linear-gradient(rgb(8 12 15 / .62), rgb(8 12 15 / .78)), url('/sponsor-bg.png');
  background-position: center;
  background-size: cover;
  border-radius: var(--radius-lg);
}

.sponsor-page.layout-content {
  width: min(980px, calc(100vw - 40px)) !important;
  max-width: 980px !important;
}

:global(html[data-ui-profile="classic"] .sponsor-page) {
  background-image: none;
}

.sponsor-hero {
  margin: 0 auto 24px;
  text-align: center;
}

.sponsor-kicker {
  color: var(--accent);
  font-size: var(--font-xs);
  font-weight: 800;
  letter-spacing: .16em;
}

.sponsor-hero h1 {
  margin: 8px 0;
  color: var(--text-heading);
  font-size: clamp(2rem, 5vw, 3rem);
}

.sponsor-hero > p:last-child {
  max-width: 680px;
  margin: 0 auto;
  color: var(--text-sub);
  line-height: 1.7;
}

.sponsor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.sponsor-card {
  min-width: 0;
  padding: var(--space-5);
  background: color-mix(in srgb, var(--bg-card) 94%, transparent);
  color: var(--text);
}

.sponsor-card h2 {
  margin-bottom: var(--space-3);
  color: var(--text-heading);
}

.sponsor-card p {
  margin: 0 0 var(--space-3);
  color: var(--text-sub);
  line-height: 1.7;
}

.sponsor-card .sponsor-note {
  margin: var(--space-4) 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
  font-size: .86rem;
}

.sponsor-unconfigured {
  padding-block: var(--space-6);
  text-align: center;
}

.sponsor-methods {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.sponsor-method {
  min-width: 0;
  text-align: center;
}

.sponsor-method img {
  display: block;
  width: min(100%, 240px);
  aspect-ratio: 1;
  margin-inline: auto;
  object-fit: contain;
  border-radius: var(--radius-md);
  background: #fff;
  padding: 5px;
}

.sponsor-method span {
  display: block;
  margin-top: var(--space-2);
  color: var(--text-sub);
  font-size: .84rem;
}

@media (width < 768px) {
  .sponsor-page.layout-content {
    width: min(980px, calc(100vw - 40px)) !important;
    padding-block: 28px 36px;
  }

  .sponsor-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .sponsor-card {
    padding: var(--space-4);
  }
}
</style>
