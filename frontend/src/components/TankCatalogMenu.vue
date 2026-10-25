<script setup>
/**
 * 坦克目录菜单（单一实现）：坦克百科列表与装甲查看器选车弹窗共用。
 * 数据面由父级提供已 normalizeTankCache 的车辆（含 search aliases / hp / pen_max）；
 * 本组件只负责搜索（模糊 + 别名）、tier/nation/type 精确筛选、排序、筛选 chips/sheet、
 * 增量卡片网格、空/加载/错误态与选择事件。URL 状态、详情与弹窗壳归父级。
 *
 * layout="page"：随页面文档滚动（坦克百科）；layout="dialog"：结果区在弹窗内滚动
 * （装甲查看器），标题/关闭按钮由 title 属性开启。
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCcw, Search, SearchX, TriangleAlert, X } from 'lucide-vue-next'
import { loadTankIconCrops, tankImageUrl } from '../scene/agentData.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { TYPE_CLS, tankNationLabel, tankTypeLabel } from '../scene/tankMeta.js'
import { selectTanks } from '../utils/tankopediaQuery.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { useIncrementalList } from '../composables/useIncrementalList.js'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import FilterChips from './FilterChips.vue'
import AppSheet from './AppSheet.vue'
import { createReusableTemplate } from '@vueuse/core'

const DEFAULT_FILTERS = Object.freeze({ q: '', tier: '', nation: '', type: '', sort: 'name' })
const SEARCH_DEBOUNCE_MS = 250
const ICON_BOX_ASPECT = 8 / 5 // 与 .tp-media 的 aspect-ratio 一致

const props = defineProps({
  /** normalizeTankCache 的输出（含 aliases / hp / pen_max） */
  tanks: { type: Array, default: () => [] },
  /** loading | ready | error */
  state: { type: String, default: 'ready' },
  error: { type: String, default: '' },
  filters: { type: Object, default: () => ({}) },
  selectedId: { type: [Number, String], default: null },
  /** 非空时渲染弹窗标题栏与关闭按钮 */
  title: { type: String, default: '' },
  /** page | dialog */
  layout: { type: String, default: 'page' },
  pageSize: { type: Number, default: 48 },
  /** 弹窗打开时把焦点交给搜索框 */
  autofocus: { type: Boolean, default: false },
})
const emit = defineEmits(['update:filters', 'select', 'retry', 'close'])

const { t, te } = useI18n()
const { isCompact } = useBreakpoint()

const local = reactive({ ...DEFAULT_FILTERS, ...props.filters })
// 只回灌“外部值真的变了”的字段：父级在详情/无关路由变化时会生成新的 filters 对象，
// 深度 watch 不能因此把用户正在输入的搜索草稿重置为空。
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
  // 父级把已提交的 q 回灌时不重复发事件；输入草稿只防抖提交 URL/父级状态。
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
  // 组件真正卸载（离开百科/装甲页）时 flush 尚未提交的搜索草稿；
  // 列表→详情已改为保持挂载，不会走到这里。
  if (local.q !== (props.filters?.q ?? '') && local.q !== lastExternal.q) emitFilters()
})

const tiers = computed(() => [...new Set(props.tanks.map(tank => tank.tier))].filter(Boolean).sort((a, b) => a - b))
const nations = computed(() => [...new Set(props.tanks.map(tank => tank.nation))].sort())
const types = computed(() => [...new Set(props.tanks.map(tank => tank.type))].sort())
const filtered = computed(() => selectTanks(props.tanks, local))

const { visible, hasMore, loadMore, sentinel } = useIncrementalList(filtered, {
  pageSize: props.pageSize,
  resetKey: () => [local.q, local.tier, local.nation, local.type, local.sort].join('|'),
})
const remaining = computed(() => filtered.value.length - visible.value.length)

const tierLabel = tier => t('agentTanks.tier_n', { tier })
const nationLabel = nation => tankNationLabel(t, te, nation)
const typeLabel = type => tankTypeLabel(t, te, type)
const countText = computed(() => t('agentTanks.count', { shown: filtered.value.length, total: props.tanks.length }))

const hasFilters = computed(() => !!(local.q.trim() || local.tier || local.nation || local.type))
const chips = computed(() => [
  local.tier && { key: 'tier', label: tierLabel(local.tier) },
  local.nation && { key: 'nation', label: nationLabel(local.nation) },
  local.type && { key: 'type', label: typeLabel(local.type) },
].filter(Boolean))

function clearFilters() {
  clearTimeout(searchTimer)
  local.q = ''
  local.tier = ''
  local.nation = ''
  local.type = ''
  emitFilters()
}

// 手机筛选 sheet（与 HoF 同一交互）：容器 / 焦点陷阱 / Esc / 遮罩由 AppSheet 提供；
// 桌面 / 平板的普通筛选行不拦截 Escape，由外层选车弹窗关闭。
const sheetOpen = ref(false)
let sheetOpener = null
// 筛选行：桌面内联，手机放进 AppSheet；同一份模板只写一次
const [DefineFilters, ReuseFilters] = createReusableTemplate()
function toggleSheet() {
  if (sheetOpen.value) return closeSheet()
  sheetOpener = document.activeElement
  sheetOpen.value = true
}
function closeSheet() {
  sheetOpen.value = false
  const opener = sheetOpener
  sheetOpener = null
  nextTick(() => opener?.focus?.())
}

function hideBrokenImage(event) {
  // 封面缺失：保留固定比例的占位框，不显示破图标
  event.target.hidden = true
}

// 封面图展示裁剪：客户端图标是原始画布，按逐车内容框缩放定位；数据缺失时回退 contain。
const iconCrops = ref(null)
loadTankIconCrops().then((crops) => { iconCrops.value = crops })
function iconCropStyle(id) {
  const transform = tankIconCropTransform(iconCrops.value?.[String(id)], ICON_BOX_ASPECT)
  return transform ? { transform } : null
}

function isSelected(tank) {
  return props.selectedId != null && String(tank.id) === String(props.selectedId)
}
function choose(tank) {
  emit('select', tank)
}

const searchInput = ref(null)
if (props.autofocus) nextTick(() => searchInput.value?.focus?.())
</script>

<template>
  <section class="tank-catalog-menu" :class="{ 'is-dialog': layout === 'dialog' }" data-testid="tank-catalog-menu">
    <div v-if="title" class="tc-dialog-head">
      <span id="tp-title">{{ title }}</span>
      <span id="tp-count" class="tp-count" data-testid="tank-count" aria-live="polite">{{ countText }}</span>
      <button id="tp-close" type="button" :title="t('armor.close')" :aria-label="t('armor.close')" @click="emit('close')">
        <X :size="20" aria-hidden="true" />
      </button>
    </div>

    <div class="tp-search-row">
      <label class="tp-search">
        <Search :size="16" class="tp-search-icon" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="local.q"
          id="tp-search"
          type="search"
          data-testid="tank-search" data-tour="tankopedia-search"
          :aria-label="t('agentTanks.search_label')"
          :placeholder="t('agentTanks.search_ph')"
          autocomplete="off"
          enterkeyhint="search"
        >
      </label>
      <FilterChips data-tour="tankopedia-filters" v-if="isCompact" :chips="chips" :open="sheetOpen" @toggle="toggleSheet" @remove="key => setFilter(key, '')" />
      <span v-if="!title" id="tp-count" class="tp-count" data-testid="tank-count" aria-live="polite">{{ countText }}</span>
    </div>

    <DefineFilters>
    <div
      class="tp-filters"
      :class="{ 'is-sheet': isCompact }"
      data-testid="tank-filters" data-tour="tankopedia-filters"
    >
      <div v-if="isCompact" class="tp-sheet-head">
        <strong>{{ t('filters.title') }}</strong>
        <AppButton size="sm" variant="primary" data-testid="filter-sheet-done" @click="closeSheet">{{ t('filters.done') }}</AppButton>
      </div>
      <label class="tp-field">
        <span class="tp-field-label">{{ t('agentTanks.tier') }}</span>
        <select id="tp-tier" data-testid="filter-tier" :value="local.tier" @change="setFilter('tier', $event.target.value)">
          <option value="">{{ t('agentTanks.all') }}</option>
          <option v-for="tier in tiers" :key="tier" :value="String(tier)">{{ tierLabel(tier) }}</option>
        </select>
      </label>
      <label class="tp-field">
        <span class="tp-field-label">{{ t('agentTanks.nation') }}</span>
        <select id="tp-nation" data-testid="filter-nation" :value="local.nation" @change="setFilter('nation', $event.target.value)">
          <option value="">{{ t('agentTanks.all') }}</option>
          <option v-for="nation in nations" :key="nation" :value="nation">{{ nationLabel(nation) }}</option>
        </select>
      </label>
      <label class="tp-field">
        <span class="tp-field-label">{{ t('agentTanks.type') }}</span>
        <select id="tp-type" data-testid="filter-type" :value="local.type" @change="setFilter('type', $event.target.value)">
          <option value="">{{ t('agentTanks.all') }}</option>
          <option v-for="type in types" :key="type" :value="type">{{ typeLabel(type) }}</option>
        </select>
      </label>
      <label class="tp-field">
        <span class="tp-field-label">{{ t('agentTanks.sort') }}</span>
        <select id="tp-sort" data-testid="filter-sort" :value="local.sort" @change="setFilter('sort', $event.target.value)">
          <option value="name">{{ t('agentTanks.sort_name') }}</option>
          <option value="tier">{{ t('agentTanks.sort_tier') }}</option>
          <option value="hp">{{ t('agentTanks.sort_hp') }}</option>
          <option value="pen">{{ t('agentTanks.sort_pen') }}</option>
        </select>
      </label>
    </div>
    </DefineFilters>
    <AppSheet v-if="isCompact" :open="sheetOpen" :title="t('filters.title')" @close="closeSheet"><ReuseFilters /></AppSheet>
    <ReuseFilters v-else />

    <div id="tp-grid" class="tp-results" :class="{ 'is-dialog-results': layout === 'dialog' }">
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
                'is-premium': tank.is_premium,
                'is-collector': tank.is_collector,
                sel: isSelected(tank),
              }"
              :data-tank-id="tank.id"
              data-testid="tank-card"
              @click="choose(tank)"
            >
              <span class="tp-media">
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
                <span class="tp-pill" :class="TYPE_CLS[tank.type] || 't-unknown'">{{ typeLabel(tank.type) }}</span>
              </span>
              <span class="tp-card-stats">
                <span><span class="tp-stat-label">{{ t('agentTanks.hp') }}</span>{{ tank.hp ?? '-' }}</span>
                <span><span class="tp-stat-label">{{ t('agentTanks.pen') }}</span>{{ tank.pen_max ?? '-' }}</span>
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

/* 弹窗内（装甲页）所有控件 ≥44px，包括 FilterChips / AppButton 等子组件内部按钮。 */
.tank-catalog-menu.is-dialog :deep(button),
.tank-catalog-menu.is-dialog :deep(select),
.tank-catalog-menu.is-dialog :deep(input) {
  min-block-size: 44px;
}

.tc-dialog-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: none;
}

#tp-title {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--type-h3);
}

#tp-close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: 44px;
  block-size: 44px;
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
}

.tp-count { color: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; }
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

/* ---------- 搜索与筛选 ---------- */
.tp-search-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); flex: none; }

.tp-search { position: relative; flex: 1 1 280px; max-inline-size: 420px; }
.tp-search-icon { position: absolute; inset-block-start: 50%; inset-inline-start: var(--space-3); color: var(--color-text-tertiary); transform: translateY(-50%); pointer-events: none; }

.tp-search input,
.tp-field select {
  inline-size: 100%;
  min-block-size: var(--control-h-md);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}

.tp-search input { padding: 0 var(--space-3) 0 var(--space-8); }
.tp-field select { padding: 0 var(--space-2); }

.tp-search input:focus-visible,
.tp-field select:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.tp-search input::placeholder { color: var(--color-text-tertiary); }

.tp-filters { display: flex; flex-wrap: wrap; gap: var(--space-3); flex: none; }

.tp-field { display: grid; gap: var(--space-1); min-inline-size: 140px; }
.tp-field-inline { max-inline-size: 360px; }
.tp-field-label { color: var(--color-text-secondary); font: var(--type-caption); }

/* 手机筛选 sheet：容器 / 遮罩 / 安全区由 AppSheet 提供，这里只负责 sheet 内的两列网格 */
.tp-filters.is-sheet {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.tp-sheet-head {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  color: var(--color-text-primary);
  font: var(--type-h3);
}

.is-sheet .tp-field { min-inline-size: 0; }

/* ---------- 结果区与卡片网格 ---------- */
.tp-results { min-block-size: 0; }
.tp-results.is-dialog-results {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.tp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
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
  padding: var(--space-2) var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard);
}

.tp-card:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tp-card.is-premium { border-color: color-mix(in oklab, var(--color-warning) 45%, var(--color-border-subtle)); }
.tp-card.is-collector:not(.is-premium) { border-color: color-mix(in oklab, var(--color-info) 55%, var(--color-border-subtle)); }
.tp-card.sel { border-color: var(--color-accent); box-shadow: var(--elevation-2); }

@media (hover: hover) {
  .tp-card:hover { border-color: var(--color-accent); background: var(--color-surface-2); }
}

.tp-media {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 8 / 5;
  inline-size: 100%;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
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
  background: var(--color-surface-3);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  white-space: nowrap;
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
  text-align: center;
}

.tp-stat-label { display: block; color: var(--color-text-tertiary); font: var(--type-caption); }

.tp-card.is-skeleton { cursor: default; }
.tp-skeleton-line { display: block; block-size: var(--space-3); border-radius: var(--radius-sm); background: var(--color-surface-2); }
.tp-skeleton-line.is-short { inline-size: 60%; }

.tp-more { display: flex; justify-content: center; padding-block: var(--space-4); }

/* 平板：卡片稍窄 */
@media (768px <= width < 1200px) {
  .tp-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}

/* 手机：两列卡片；筛选进 sheet */
@media (width < 768px) {
  .tp-search { flex-basis: 100%; max-inline-size: none; }
  .tp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
}
</style>
