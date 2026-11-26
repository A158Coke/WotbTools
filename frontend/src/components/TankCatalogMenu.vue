<script setup>
import { romanLevel } from '../utils/tierFormat.js'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCcw, SearchX, Square, SquareCheck, TriangleAlert } from 'lucide-vue-next'
import { loadTankIconCrops, tankImageUrl } from '../scene/agentData.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { TYPE_CLS, tankNationLabel, tankTypeLabel } from '../scene/tankMeta.js'
import { selectTanks, TANKOPEDIA_CATEGORIES } from '../utils/tankopediaQuery.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { useIncrementalList } from '../composables/useIncrementalList.js'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import TankCatalogControls from './TankCatalogControls.vue'
import { useElementSize, useMediaQuery } from '@vueuse/core'
import { BREAKPOINT_MEDIUM, SHELL_DRAWER_QUERY } from '../shared/breakpoints.js'
import TankCatalogIcon from './TankCatalogIcon.vue'
import TankCoverNation from './TankCoverNation.vue'

const DEFAULT_FILTERS = Object.freeze({ q: '', tier: '', nation: '', type: '', category: '', sort: 'name' })
const SEARCH_DEBOUNCE_MS = 250
const ICON_BOX_ASPECT = 8 / 5

const props = defineProps({
  tanks: { type: Array, default: () => [] },
  state: { type: String, default: 'ready' },
  error: { type: String, default: '' },
  filters: { type: Object, default: () => ({}) },
  selectedId: { type: [Number, String], default: null },
  title: { type: String, default: '' },
  layout: { type: String, default: 'page' },
  pageSize: { type: Number, default: 48 },
  multiple: { type: Boolean, default: false },
  autofocus: { type: Boolean, default: false },
  inlineFilters: { type: Boolean, default: false },
})
const emit = defineEmits(['update:filters', 'select', 'confirm', 'retry', 'close'])

const { t, te, locale } = useI18n()
const statFormat = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }))
const formatStat = value => value == null || !Number.isFinite(Number(value)) ? '—' : statFormat.value.format(Number(value))
const { isCompact: compactViewport, isExpanded } = useBreakpoint()
const root = ref(null)
const { width: containerWidth } = useElementSize(root)
const shortTouch = useMediaQuery(SHELL_DRAWER_QUERY)
const isCompact = computed(() => compactViewport.value || shortTouch.value || (containerWidth.value > 0 && containerWidth.value < BREAKPOINT_MEDIUM))
const choiceMode = computed(() => isCompact.value ? 'sheet' : isExpanded.value ? 'inline' : 'menu')
const filtersOpen = ref(false)
const filterPanelOpen = computed(() => props.inlineFilters && props.layout === 'dialog' && isCompact.value && filtersOpen.value)

const local = reactive({ ...DEFAULT_FILTERS, ...props.filters })
const lastExternal = { ...DEFAULT_FILTERS, ...props.filters }
let searchTimer = null

function syncFromProps(next) {
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    const value = next?.[key] ?? DEFAULT_FILTERS[key]
    const previous = lastExternal[key] ?? DEFAULT_FILTERS[key]
    if (value !== previous) local[key] = value
    lastExternal[key] = value
  }
}
watch(() => props.filters, next => syncFromProps(next), { deep: true })

function emitFilters() {
  emit('update:filters', { ...local })
}
watch(() => local.q, (value) => {
  if (value === (props.filters?.q ?? '')) return
  clearTimeout(searchTimer)
  searchTimer = setTimeout(emitFilters, SEARCH_DEBOUNCE_MS)
})
function setFilter(key, value) {
  local[key] = value
  clearTimeout(searchTimer)
  emitFilters()
}
onBeforeUnmount(() => {
  clearTimeout(searchTimer)
  if (local.q !== (props.filters?.q ?? '') && local.q !== lastExternal.q) emitFilters()
})

const tiers = computed(() => [...new Set(props.tanks.map(tank => tank.tier))].filter(Boolean).sort((a, b) => a - b))
const nations = computed(() => [...new Set(props.tanks.map(tank => tank.nation))].sort())
const types = computed(() => [...new Set(props.tanks.map(tank => tank.type))].sort())
const filtered = computed(() => selectTanks(props.tanks, local))

const { visible, hasMore, loadMore, sentinel } = useIncrementalList(filtered, {
  pageSize: props.pageSize,
  resetKey: () => [local.q, local.tier, local.nation, local.type, local.category, local.sort].join('|'),
})
const draft = ref(new Set())
const selectedHere = computed(() => filtered.value.reduce((n, tank) => n + Number(draft.value.has(tank.id)), 0))
function selectFiltered(select) {
  const next = new Set(draft.value)
  for (const tank of filtered.value) {
    if (select) next.add(tank.id)
    else next.delete(tank.id)
  }
  draft.value = next
}
function confirmSelection() {
  const byId = new Map(props.tanks.map(tank => [tank.id, tank]))
  emit('confirm', [...draft.value].map(id => byId.get(id)).filter(Boolean))
}
const remaining = computed(() => filtered.value.length - visible.value.length)

const tierLabel = tier => romanLevel(tier)
const nationLabel = nation => tankNationLabel(t, te, nation)
const typeLabel = type => tankTypeLabel(t, te, type)
const countText = computed(() => t('agentTanks.count', { shown: filtered.value.length, total: props.tanks.length }))

const tierOptions = computed(() => [
  { value: '', label: t('agentTanks.all') },
  ...tiers.value.map(tier => ({ value: String(tier), label: tierLabel(tier) })),
])
const nationOptions = computed(() => [
  { value: '', label: t('agentTanks.all') },
  ...nations.value.map(nation => ({ value: nation, label: nationLabel(nation) })),
])
const categoryOptions = computed(() => [
  { value: '', label: t('agentTanks.all') },
  ...TANKOPEDIA_CATEGORIES.map(value => ({ value, label: t('agentTanks.categories.' + value) })),
])
const typeOptions = computed(() => [
  { value: '', label: t('agentTanks.all') },
  ...types.value.map(type => ({ value: type, label: typeLabel(type) })),
])
const sortOptions = computed(() => [
  { value: 'name', label: t('agentTanks.sort_name') },
  { value: 'tier', label: t('agentTanks.sort_tier') },
  ...(props.multiple ? [{ value: 'speed', label: t('agentTanks.speed_fwd') }] : [
    { value: 'hp', label: t('agentTanks.sort_hp') }, { value: 'pen', label: t('agentTanks.sort_pen') },
  ]),
])

const hasFilters = computed(() => !!(local.q.trim() || local.tier || local.nation || local.type || local.category))
const chips = computed(() => [
  local.tier && { key: 'tier', label: tierLabel(local.tier) },
  local.nation && { key: 'nation', label: nationLabel(local.nation) },
  local.type && { key: 'type', label: typeLabel(local.type) },
  local.category && { key: 'category', label: t('agentTanks.categories.' + local.category) },
].filter(Boolean))

function clearFilters() {
  clearTimeout(searchTimer)
  local.q = ''
  local.tier = ''
  local.nation = ''
  local.type = ''
  local.category = ''
  emitFilters()
}

function hideBrokenImage(event) {
  event.target.hidden = true
}

const iconCrops = ref(null)
loadTankIconCrops().then((crops) => { iconCrops.value = crops })
function iconCropStyle(id) {
  const transform = tankIconCropTransform(iconCrops.value?.[String(id)], ICON_BOX_ASPECT)
  return transform ? { transform } : null
}

function isSelected(tank) {
  if (props.multiple) return draft.value.has(tank.id)
  return props.selectedId != null && String(tank.id) === String(props.selectedId)
}
function choose(tank) {
  if (props.multiple) {
    if (draft.value.has(tank.id)) draft.value.delete(tank.id)
    else draft.value.add(tank.id)
  } else emit('select', tank)
}

</script>

<template>
  <section ref="root" class="tank-catalog-menu" :class="{ 'is-dialog': layout === 'dialog' }" data-testid="tank-catalog-menu">
    <TankCatalogControls
      :title="title"
      :count-text="countText"
      :multiple="multiple"
      :draft-count="draft.size"
      :selected-here="selectedHere"
      :filtered-count="filtered.length"
      :is-compact="isCompact"
      :filters-open="filtersOpen"
      :inline-filters="inlineFilters"
      :has-filters="hasFilters"
      :chips="chips"
      :filters="local"
      :choice-mode="choiceMode"
      :layout="layout"
      :autofocus="autofocus"
      :nation-options="nationOptions"
      :tier-options="tierOptions"
      :type-options="typeOptions"
      :category-options="categoryOptions"
      :sort-options="sortOptions"
      @query-input="value => { local.q = value }"
      @update:filters-open="filtersOpen = $event"
      @set-filter="setFilter"
      @clear-filters="clearFilters"
      @select-filtered="selectFiltered"
      @confirm-selection="confirmSelection"
      @close="emit('close')"
    />

    <div v-show="!filterPanelOpen" id="tp-grid" class="tp-results" :class="{ 'is-dialog-results': layout === 'dialog' }">
      <EmptyState
        v-if="state === 'error'"
        role="alert"
        data-testid="tank-list-error"
        :icon="TriangleAlert"
        :title="t('agentTanks.error_title')"
        :description="error || t('agentTanks.error_desc')"
      >
        <AppButton variant="primary" data-testid="tank-list-retry" @click="emit('retry')">
          <RotateCcw :size="16" aria-hidden="true" />
          {{ t('agentTanks.retry') }}
        </AppButton>
      </EmptyState>

      <div v-else-if="state === 'loading'" class="tp-grid" aria-busy="true" data-testid="tank-skeleton">
        <span class="tp-visually-hidden" role="status">{{ t('agentTanks.loading') }}</span>
        <div v-for="n in 12" :key="n" class="tp-card is-skeleton" aria-hidden="true">
          <span class="tp-media"></span>
          <span class="tp-skeleton-line"></span>
          <span class="tp-skeleton-line is-short"></span>
        </div>
      </div>

      <EmptyState
        v-else-if="!filtered.length"
        data-testid="tank-empty"
        :icon="SearchX"
        :title="t('agentTanks.empty_title')"
        :description="t('agentTanks.empty_desc')"
      >
        <AppButton v-if="hasFilters" data-testid="tank-clear-filters" @click="clearFilters">{{ t('agentTanks.clear_filters') }}</AppButton>
      </EmptyState>

      <template v-else>
        <ul class="tp-grid" data-testid="tank-grid" data-tour="tankopedia-list">
          <li v-for="tank in visible" :key="tank.id">
            <button
              type="button"
              class="tp-card tank-card"
              :class="{
                'is-premium': tank.category === 'premium',
                'is-collector': tank.category === 'collector',
                sel: isSelected(tank),
              }"
              :aria-pressed="multiple ? isSelected(tank) : undefined"
              :data-tank-id="tank.id"
              data-testid="tank-card"
              @click="choose(tank)"
            >
              <span class="tp-media">
                <TankCoverNation :nation="tank.nation" />
                <img
                  :src="tankImageUrl(tank.id)"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width="160"
                  height="100"
                  :style="iconCropStyle(tank.id)"
                  @error="hideBrokenImage"
                >
              </span>
              <span class="tp-card-name" :title="tank.name">{{ tank.name }}</span>
              <span class="tp-badges">
                <span class="tp-pill is-tier">{{ tierLabel(tank.tier) }}</span>
                <span class="tp-pill">{{ nationLabel(tank.nation) }}</span>
                <span class="tp-pill" :class="TYPE_CLS[tank.type] || 't-unknown'"><TankCatalogIcon kind="type" :value="tank.type" />{{ typeLabel(tank.type) }}</span>
              </span>
              <span v-if="multiple" class="tp-card-stats">
                <span><span class="tp-stat-label">{{ t('agentTanks.speed_fwd') }}</span>{{ formatStat(tank.speed) }} km/h</span>
                <component :is="isSelected(tank) ? SquareCheck : Square" class="tc-pick-mark" :size="16" aria-hidden="true" />
              </span>
              <span v-else class="tp-card-stats">
                <span><span class="tp-stat-label">{{ t('agentTanks.hp') }}</span>{{ formatStat(tank.hp) }}</span>
                <span><span class="tp-stat-label">{{ t('agentTanks.pen') }}</span>{{ formatStat(tank.pen_max) }}</span>
              </span>
            </button>
          </li>
        </ul>
        <div v-if="hasMore" :ref="sentinel" class="tp-more" data-testid="tank-more">
          <AppButton data-testid="tank-load-more" @click="loadMore">{{ t('agentTanks.load_more', { n: remaining }) }}</AppButton>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.tc-pick-mark { color: var(--color-accent); }
.tank-catalog-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-block-size: 0;
}

.tank-catalog-menu.is-dialog {
  block-size: 100%;
  padding: var(--space-3);
}

.tank-catalog-menu.is-dialog :deep(button),
.tank-catalog-menu.is-dialog :deep(select),
.tank-catalog-menu.is-dialog :deep(input) {
  min-block-size: var(--scene-hit);
}

.tp-muted { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.tp-status { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }

.tp-visually-hidden {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.tp-pill { display: inline-flex; align-items: center; gap: var(--space-1); }

.tp-results { min-block-size: 0; }
.tp-results.is-dialog-results {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.tp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--tank-card-min)), 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.tp-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  inline-size: 100%;
  block-size: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard);
}

.tp-card:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tp-card.is-premium { background: color-mix(in oklab, var(--color-warning) 36%, var(--color-surface-1)); }
.tp-card.is-collector:not(.is-premium) { background: color-mix(in oklab, var(--color-info) 36%, var(--color-surface-1)); }
.tp-card.is-premium .tp-card-name { color: color-mix(in oklab, var(--color-warning) 90%, var(--color-text-primary)); }
.tp-card.is-collector:not(.is-premium) .tp-card-name { color: color-mix(in oklab, var(--color-info) 90%, var(--color-text-primary)); }
.tp-card.is-premium .tp-stat-label,
.tp-card.is-collector:not(.is-premium) .tp-stat-label { color: var(--color-text-primary); }
.tp-card.sel { border-color: var(--color-accent); box-shadow: var(--elevation-2); }

@media (hover: hover) {
  .tp-card:hover { border-color: var(--color-accent); background: var(--color-surface-2); }
  .tp-card.is-premium:hover { background: color-mix(in oklab, var(--color-warning) 46%, var(--color-surface-1)); }
  .tp-card.is-collector:not(.is-premium):hover { background: color-mix(in oklab, var(--color-info) 46%, var(--color-surface-1)); }
}

.tp-media {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 8 / 5;
  inline-size: 100%;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: transparent;
}

.tp-media img {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
}

.tp-card-name {
  display: -webkit-box;
  min-block-size: calc(var(--line-height-body) * 2);
  overflow: hidden;
  font-weight: 600;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.tp-badges { display: flex; flex-wrap: wrap; gap: var(--space-1); }

.tp-pill {
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-3);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.tp-pill.is-tier,
.tp-pill.is-premium { background: color-mix(in oklab, var(--color-warning) 16%, var(--color-surface-1)); color: var(--color-warning); }
.tp-pill.t-light { background: color-mix(in oklab, var(--color-success) 16%, var(--color-surface-1)); color: var(--color-success); }
.tp-pill.t-medium { background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1)); color: var(--color-accent-text); }
.tp-pill.t-heavy { background: color-mix(in oklab, var(--color-danger) 16%, var(--color-surface-1)); color: var(--color-danger); }
.tp-pill.t-td { background: color-mix(in oklab, var(--color-info) 16%, var(--color-surface-1)); color: var(--color-info); }
.tp-pill.is-shell { background: color-mix(in oklab, var(--color-info) 14%, var(--color-surface-1)); color: var(--color-info); }
.tp-pill.is-shell.is-premium { background: color-mix(in oklab, var(--color-warning) 16%, var(--color-surface-1)); color: var(--color-warning); }

.tp-card-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-1);
  margin-block-start: auto;
  padding-block-start: var(--space-2);
  border-block-start: 1px solid var(--color-border-subtle);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: start;
}

.tp-stat-label { display: block; color: var(--color-text-tertiary); font: var(--type-caption); }

.tp-card.is-skeleton { cursor: default; }
.tp-skeleton-line { display: block; block-size: var(--space-3); border-radius: var(--radius-sm); background: var(--color-surface-2); }
.tp-skeleton-line.is-short { inline-size: 60%; }

.tp-more { display: flex; justify-content: center; padding-block: var(--space-4); }

@media (width < 768px) {
  .tp-card { padding: var(--space-2); }
  .tp-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
}
</style>
