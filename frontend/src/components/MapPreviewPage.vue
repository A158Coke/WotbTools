<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Map as MapIcon } from 'lucide-vue-next'
import { useAuth } from '../composables/useAuth.js'
import { mapBases } from '../data/mapBases.js'
import { mapGridProfile, profileMatchesVariant } from '../data/mapSemantics.js'
import { mapLabel } from '../utils/helpers.js'
import { Feature } from '../app/featureCapabilities.js'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import EmptyState from './EmptyState.vue'
import ReplayCapabilityAuthGate from './ReplayCapabilityAuthGate.vue'
import SegmentedControl from './SegmentedControl.vue'
import MapPreview3DPane from './MapPreview3DPane.vue'
import MapPreview2DPane from './MapPreview2DPane.vue'
import RotatePrompt from './RotatePrompt.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import { useForcedLandscape } from '../composables/useForcedLandscape.js'
import { useMapPreviewCatalog } from '../composables/useMapPreviewCatalog.js'
import { assaultSelectable, resolveBasesKind } from './mapBasesKind.js'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { authenticated } = useAuth()
const { maps, visibleMaps, showAllMaps, mapQuery, indexFailed, indexLoaded, loadMaps, onThumbError, onFallbackError } = useMapPreviewCatalog(locale, authenticated)

const selected = computed(() => maps.value.find((m) => m.key === route.query.map) || null)
const selectedVariant = computed(() => {
  const variants = selected.value?.variants || []
  const id = Number(route.query.variant)
  return variants.find((v) => v.id === id) || variants[0] || null
})
const selectedName = computed(() => {
  const base = selected.value
  const variant = selectedVariant.value
  if (!base) return ''
  const baseVariantId = base.variants?.[0]?.id
  if (!variant || variant.id === baseVariantId) return base.name
  const key = variant.variantKey || ''
  const localized = key ? mapLabel(key, locale.value) : key
  return localized && localized !== key ? localized : (variant.display || base.name)
})
const selectedBases = computed(() => {
  const entry = selected.value ? mapBases[selected.value.key] : null
  const label = selectedVariant.value?.variant
  return (label && entry?.variants?.[label]) || entry || null
})
const mode = computed(() => (route.query.mode === '3d' ? '3d' : '2d'))

const basesKind = computed(() => resolveBasesKind(selectedBases.value, route.query.bases))
const spawnPoints = computed(() => {
  if (!selected.value) return null
  const profile = mapGridProfile(selected.value.key)
  const variants = selected.value.variants || []
  return profileMatchesVariant(
    profile,
    selectedVariant.value?.variant,
    selectedVariant.value?.id === variants[0]?.id,
  )
    ? (profile?.spawnPoints ?? null)
    : null
})
const basesOptions = computed(() => {
  const bases = selectedBases.value
  if (!bases) return []
  return [
    ...(bases.supremacy?.length
      ? [{ value: 'supremacy', label: t('mapPreview.basesSupremacy'), testid: 'map-bases-supremacy' }]
      : []),
    ...(assaultSelectable(bases)
      ? [{ value: 'encounter', label: t('mapPreview.basesEncounter'), testid: 'map-bases-encounter' }]
      : []),
  ]
})

function openMap(entry) {
  const query = { ...route.query, map: entry.key, mode: mode.value }
  delete query.variant
  router.replace({ query })
}
function setVariant(value) {
  router.replace({ query: { ...route.query, variant: String(value) } })
}
const variantOptions = computed(() => (selected.value?.variants || []).map((v) => ({
  value: String(v.id),
  label: v.display || String(v.id),
  testid: `map-variant-${v.id}`,
})))
const forcedLandscape = useForcedLandscape(computed(() => mode.value === '3d' && !!selected.value))

function setMode(value) {
  router.replace({ query: { ...route.query, mode: value } })
}
function setBases(value) {
  router.replace({ query: { ...route.query, bases: value } })
}
function backToPicker() {
  const query = { ...route.query }
  delete query.map
  delete query.mode
  delete query.bases
  delete query.variant
  router.replace({ query })
}

const modeOptions = computed(() => [
  { value: '3d', label: t('mapPreview.mode3d'), testid: 'map-mode-3d' },
  { value: '2d', label: t('mapPreview.mode2d'), testid: 'map-mode-2d' },
])
</script>

<template>
  <section class="map-preview" data-testid="map-preview-page">
    <ReplayCapabilityAuthGate
      v-if="!authenticated"
      :icon="MapIcon"
      :title="$t('mapPreview.title')"
      :description="$t('mapPreview.loginRequired')"
      login-destination="map-preview"
    />
    <template v-else>
      <ShowcaseHero v-if="!selected" compact section="maps" :kicker="$t('mapPreview.kicker')" :title="$t('mapPreview.title')">
        <template v-if="indexLoaded && maps.length" #actions>
          <div class="map-picker-tools">
            <input
              v-model="mapQuery"
              type="search"
              class="map-picker-search"
              :placeholder="$t('mapPreview.searchPlaceholder')"
              :aria-label="$t('mapPreview.searchPlaceholder')"
              data-testid="map-search"
            >
            <button
              type="button"
              role="switch"
              class="map-picker-switch"
              :aria-checked="showAllMaps"
              data-testid="map-show-all"
              @click="showAllMaps = !showAllMaps"
            >
              <span class="map-picker-switch-track" aria-hidden="true">
                <span class="map-picker-switch-thumb" />
              </span>
              <span>{{ $t('mapPreview.showAllMaps') }}</span>
            </button>
          </div>
        </template>
      </ShowcaseHero>
      <EmptyState
        v-if="indexFailed"
        role="alert"
        :icon="MapIcon"
        :title="$t('mapPreview.loadFailed')"
      >
        <AppButton data-testid="map-retry" @click="loadMaps">{{ $t('mapPreview.retry') }}</AppButton>
      </EmptyState>
      <EmptyState
        v-else-if="indexLoaded && !maps.length"
        :icon="MapIcon"
        :title="$t('mapPreview.empty')"
      />

      <div v-else-if="!selected" class="map-picker">
        <p v-if="mapQuery.trim() && !visibleMaps.length" class="map-picker-empty" data-testid="map-search-empty">{{ $t('mapPreview.searchEmpty') }}</p>
        <ul class="map-grid" data-testid="map-grid">
          <li v-for="m in visibleMaps" :key="m.key">
            <button
              type="button"
              class="map-card"
              :data-testid="`map-card-${m.key}`"
              @click="openMap(m)"
            >
              <span class="map-card-thumb">
                <img
                  v-if="m.thumb"
                  :src="m.thumb"
                  alt=""
                  loading="lazy"
                  :data-testid="`map-thumb-${m.key}`"
                  @error="onThumbError(m)"
                />
                <img
                  v-else-if="m.thumbFallback"
                  :src="m.thumbFallback"
                  @error="onFallbackError(m)"
                  alt=""
                  loading="lazy"
                  :data-testid="`map-thumb-fallback-${m.key}`"
                />
                <MapIcon v-else class="map-card-thumb-fallback" aria-hidden="true" />
              </span>
              <span class="map-card-name">{{ m.name }}</span>
              <span class="map-card-badge">{{ $t('mapPreview.twoDBadge') }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div v-else class="map-stage">
        <header class="map-stage-head">
          <AppButton variant="ghost" size="sm" data-testid="map-back" @click="backToPicker">
            <ArrowLeft aria-hidden="true" />
            {{ $t('mapPreview.backToPicker') }}
          </AppButton>
          <h1 class="map-stage-name">{{ selectedName }}</h1>
          <SegmentedControl
            v-if="variantOptions.length > 1"
            class="map-variant-switch"
            :model-value="selectedVariant ? String(selectedVariant.id) : ''"
            :options="variantOptions"
            :aria-label="$t('mapPreview.variantsSwitch')"
            @update:model-value="setVariant"
          />
          <SegmentedControl
            v-if="basesOptions.length"
            class="map-bases-switch"
            :model-value="basesKind === 'assault' ? 'encounter' : basesKind"
            :options="basesOptions"
            :aria-label="$t('mapPreview.basesSwitch')"
            @update:model-value="setBases"
          />
          <SegmentedControl
            class="map-mode-switch"
            :model-value="mode"
            :options="modeOptions"
            :aria-label="$t('mapPreview.title')"
            @update:model-value="setMode"
          />
        </header>
        <RotatePrompt
          v-if="forcedLandscape.blocked.value"
          class="map-rotate-prompt"
          :device="forcedLandscape.device.value"
          :action-label="$t('mapPreview.mode2d')"
          @action="setMode('2d')"
        />
        <div v-show="mode === '3d'" class="map-stage-pane">
          <MapPreview3DPane :map-id="selectedVariant?.id ?? selected.mapId" :map-name="selectedName" :map-key="selected.key" :bases-kind="basesKind" :spawn-points="spawnPoints" :active="mode === '3d'" />
        </div>
        <div v-show="mode === '2d'" class="map-stage-pane">
          <MapPreview2DPane :map-key="selected.key" :basemap="selected.basemap" :bases="selectedBases" :bases-kind="basesKind" :variant="selectedVariant?.variant ?? null" :variant-is-base="selectedVariant?.id === selected.variants?.[0]?.id" :active="mode === '2d'" />
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.map-rotate-prompt { position: fixed; inset: calc(var(--header-block) + env(safe-area-inset-top)) 0 0; z-index: var(--z-sticky); background: var(--color-canvas); }
.map-preview {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.map-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}

.map-picker-tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.map-picker-search {
  inline-size: calc(var(--space-12) * 6);
  max-inline-size: 100%;
  min-height: var(--control-h-lg);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}
.map-picker-search:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.map-picker-empty { margin: var(--space-4) 0; color: var(--color-text-secondary); font: var(--type-body); }
@media (width < 768px) {
  .map-picker-tools, .map-picker-search { inline-size: 100%; }
}

.map-picker-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-lg);
  padding: var(--space-1);
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  cursor: pointer;
}

.map-picker-switch:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
  border-radius: var(--radius-md);
}

.map-picker-switch-track {
  box-sizing: content-box;
  display: flex;
  flex: none;
  align-items: center;
  width: calc(var(--control-check) * 2 + var(--space-2));
  padding: var(--space-1);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-3);
}

.map-picker-switch-thumb {
  width: var(--control-check);
  height: var(--control-check);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-text-primary);
  transition: transform var(--duration-fast);
}

.map-picker-switch[aria-checked='true'] .map-picker-switch-track {
  background: var(--color-info);
  border-color: var(--color-info);
}

.map-picker-switch[aria-checked='true'] .map-picker-switch-thumb {
  background: var(--color-surface-1);
  transform: translateX(calc(var(--control-check) + var(--space-2)));
}

.map-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3);
}

.map-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: inherit;
  cursor: pointer;
  text-align: start;
}

.map-card:hover {
  border-color: var(--color-border-strong);
}

.map-card:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}

.map-card-thumb {
  display: block;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
}

.map-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.map-card-thumb-fallback {
  width: 100%;
  height: 100%;
  padding: var(--space-6);
  color: var(--color-text-tertiary);
}

.map-card-name {
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.map-card-badge {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-end: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-3);
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption-xs);
  line-height: var(--line-height-caption-xs);
}

.map-stage {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.map-stage-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
}

.map-stage-name {
  font-size: var(--font-size-h3);
  line-height: var(--line-height-h3);
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-bases-switch,
.map-mode-switch {
  flex-shrink: 0;
}

.map-bases-switch {
  margin-inline-start: auto;
}

.map-stage-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
</style>
