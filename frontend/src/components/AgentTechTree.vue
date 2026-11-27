<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { BookOpen } from 'lucide-vue-next'
import { fetchTankEncyclopedia, loadTankIconCrops, tankImageUrl } from '../scene/agentData.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { tankNationLabel, tankTypeLabel } from '../scene/tankMeta.js'
import { loadTechTree } from '../utils/researchCatalog.js'
import { techTreeGrid, techTreeNations } from '../utils/techTreeLayout.js'
import { locationForView } from '../app/navigation'
import ShowcaseHero from './ShowcaseHero.vue'
import AppButton from './AppButton.vue'
import SegmentedControl from './SegmentedControl.vue'
import TankCatalogIcon from './TankCatalogIcon.vue'
import AgentTechTreeCanvas from './AgentTechTreeCanvas.vue'

const VIEW = 'agent-techtree'
const NATIONS = techTreeNations()

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()

const urlNation = computed(() => (NATIONS.includes(String(route.query.nation)) ? String(route.query.nation) : NATIONS[0]))
function writeState(patch) {
  const next = { ...route.query, view: VIEW, ...patch }
  if (patch.nation != null && !NATIONS.includes(String(patch.nation))) next.nation = NATIONS[0]
  router.replace({ query: next })
}

const nationLabel = nation => tankNationLabel(t, te, nation)

const nationTabs = ref(null)
const focusedNation = ref(urlNation.value)
watch([urlNation, nationTabs], ([nation, tabs]) => {
  focusedNation.value = nation
  tabs?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}, { flush: 'post' })

function onNationKeydown(event) {
  const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')]
  const index = tabs.indexOf(event.target)
  const offsets = { ArrowRight: 1, ArrowLeft: -1 }
  let target
  if (event.key in offsets) target = tabs[(index + offsets[event.key] + tabs.length) % tabs.length]
  if (event.key === 'Home') target = tabs[0]
  if (event.key === 'End') target = tabs.at(-1)
  if (!target) return
  event.preventDefault()
  focusedNation.value = target.dataset.nation
  target.focus()
  target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

const tree = ref(null)
const treeState = ref('loading')
const treeError = ref('')
let treeRequest = 0

async function loadTree(nation) {
  const request = ++treeRequest
  treeState.value = 'loading'
  treeError.value = ''
  tree.value = null
  try {
    const data = await loadTechTree(nation)
    if (request !== treeRequest) return
    tree.value = data
    treeState.value = 'ready'
  } catch (e) {
    if (request !== treeRequest) return
    console.error('tech tree load failed:', e)
    treeError.value = String(e?.message || e)
    treeState.value = 'error'
  }
}
watch(urlNation, nation => loadTree(nation), { immediate: true })

const cache = ref({})
const cacheState = ref('loading')
async function loadCache() {
  cacheState.value = 'loading'
  try {
    cache.value = await fetchTankEncyclopedia()
    cacheState.value = 'ready'
  } catch (e) {
    console.error('tank cache load failed:', e)
    cacheState.value = 'error'
  }
}
onMounted(loadCache)

const summaryOf = node => cache.value?.[String(node.tankId)] || null
const nameOf = node => summaryOf(node)?.name || null

const ICON_ASPECT = 97 / 60
const iconCrops = ref(null)
onMounted(() => {
  loadTankIconCrops().then((crops) => { iconCrops.value = crops })
})
function iconCropStyle(tankId) {
  const transform = tankIconCropTransform(iconCrops.value?.[String(tankId)], ICON_ASPECT)
  return transform ? { transform } : null
}

const costByStem = computed(() => {
  const out = new Map()
  for (const edge of tree.value?.edges || []) {
    const xp = Number(edge?.cost?.xp)
    if (!Number.isFinite(xp)) continue
    const prev = out.get(edge.to)
    if (prev == null || xp < prev) out.set(edge.to, xp)
  }
  return out
})

const grid = computed(() => (tree.value ? techTreeGrid(tree.value) : null))

const PORTRAIT_QUERY = '(width < 768px) and (orientation: portrait)'
const portrait = ref(false)
let portraitQuery = null
const syncPortrait = () => { portrait.value = !!portraitQuery?.matches }
onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  portraitQuery = window.matchMedia(PORTRAIT_QUERY)
  portraitQuery.addEventListener?.('change', syncPortrait)
  syncPortrait()
})
onBeforeUnmount(() => portraitQuery?.removeEventListener?.('change', syncPortrait))

const TYPE_FILTERS = ['all', 'heavyTank', 'mediumTank', 'lightTank', 'AT-SPG']
const typeFilter = ref('all')
const typeOptions = computed(() => TYPE_FILTERS.map(value => ({
  value,
  label: value === 'all' ? t('research.all_types') : tankTypeLabel(t, te, value),
  testid: `techtree-type-${value}`,
})))
const tierRows = computed(() => {
  if (!portrait.value || !tree.value) return null
  const rows = new Map()
  for (const node of tree.value.nodes || []) {
    if (typeFilter.value !== 'all' && summaryOf(node)?.type !== typeFilter.value) continue
    if (!rows.has(node.tier)) rows.set(node.tier, [])
    rows.get(node.tier).push(node)
  }
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([tier, nodes]) => ({ tier, nodes: nodes.sort((a, b) => a.y - b.y || a.x - b.x) }))
})
function openResearch(node) {
  if (!node?.tankId) return
  const dest = locationForView('agent-tankopedia', route)
  const query = { ...dest.query, view: 'agent-tankopedia', tank: String(node.tankId) }
  for (const key of ['nation', 'config', 'engine', 'track', 'shell']) delete query[key]
  router.push({ path: dest.path, query })
}
function openTankopedia() {
  const dest = locationForView('agent-tankopedia', route)
  router.push({ path: dest.path, query: { ...dest.query, view: 'agent-tankopedia' } })
}

onMounted(() => {
  const id = Number(route.query.tank)
  if (!Number.isInteger(id) || id <= 0) return
  const dest = locationForView('agent-tankopedia', route)
  const query = { ...dest.query, view: 'agent-tankopedia', tank: String(id) }
  delete query.nation
  router.replace({ path: dest.path, query })
})
</script>

<template>
  <section class="techtree" data-testid="techtree">
    <ShowcaseHero compact section="techtree" :kicker="t('nav.groups.reference')" :title="t('research.title')">
      <template #actions>
        <AppButton variant="secondary" data-testid="techtree-tankopedia" @click="openTankopedia">
          <BookOpen :size="18" aria-hidden="true" />
          {{ t('nav.tankopedia') }}
        </AppButton>
      </template>
    </ShowcaseHero>

    <p v-if="cacheState === 'error'" class="tt-status" role="status">{{ t('research.cache_unavailable') }}</p>

    <div class="tt-filters" :class="{ 'is-sticky': tierRows }">
    <div ref="nationTabs" class="tt-tabs" role="tablist" @keydown="onNationKeydown" :aria-label="t('research.nation_tabs')">
        <button
          v-for="nation in NATIONS"
          :key="nation"
          type="button"
          role="tab"
          class="tt-tab"
          :class="{ 'is-on': nation === urlNation }"
          :tabindex="nation === focusedNation ? 0 : -1"
          :data-nation="nation"
          @focus="focusedNation = nation"
          :aria-selected="nation === urlNation ? 'true' : 'false'"
          :data-testid="`techtree-nation-${nation}`"
          @click="writeState({ nation, tank: null })"
        >
          <TankCatalogIcon kind="nation" :value="nation" />{{ nationLabel(nation) }}
        </button>
      </div>
      <SegmentedControl
        v-if="tierRows"
        presentation="tiles"
        :model-value="typeFilter"
        :options="typeOptions"
        :aria-label="t('research.type_filter')"
        data-testid="techtree-type-filter"
        @update:model-value="value => typeFilter = value"
      >
        <template #option="{ option }"><TankCatalogIcon kind="type" :value="option.value" />{{ option.label }}</template>
      </SegmentedControl>
    </div>

    <AgentTechTreeCanvas
      :state="treeState"
      :error="treeError"
      :tier-rows="tierRows"
      :grid="grid"
      :nation="urlNation"
      :summaries="cache"
      :cost-by-stem="costByStem"
      :image-url="tankImageUrl"
      :icon-style="iconCropStyle"
      @retry="loadTree(urlNation)"
      @select-node="openResearch"
    />  </section>
</template>

<style scoped>
.techtree {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--gutter) var(--space-12);
  color: var(--color-text-primary);
  min-inline-size: 0;
  block-size: calc(100dvh - var(--header-h) - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  min-block-size: 0;
}

.techtree :deep(.showcase-hero-host) { flex: none; }
.tt-status { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }

.tt-tab { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1); }
.tt-tabs { display: flex; flex: none; flex-wrap: wrap; gap: var(--space-1); }
.tt-tab {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font: var(--type-body);
  cursor: pointer;
}
.tt-tab:hover { border-color: var(--color-border-strong); color: var(--color-text-primary); }
.tt-tab.is-on { border-color: var(--color-accent); color: var(--color-accent-text); background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface-1)); }
.tt-tab:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.tt-filters { display: grid; flex: none; gap: var(--space-2); }
.tt-filters.is-sticky .tt-tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
.tt-filters.is-sticky .tt-tab { flex: none; min-block-size: var(--hit-min-comfortable); }
@media (width < 768px) {
  .techtree {
    gap: var(--space-3);
    padding-block: var(--space-4);
  }
  .tt-tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
  }
  .tt-tabs::-webkit-scrollbar { display: none; }
  .tt-tab { flex: 0 0 auto; }
}

@media (orientation: landscape) and (height <= 520px) {
  .techtree :deep(.showcase-hero) { display: none; }
  .techtree :deep(.showcase-hero-host) { gap: 0; margin-block-end: 0; }
}

@media (height <= 520px) {
  .techtree {
    gap: var(--space-2);
    padding-block: var(--space-3);
  }
}
</style>
