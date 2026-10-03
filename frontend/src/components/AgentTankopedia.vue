<script setup>
/**
 * 坦克百科（?view=agent-tankopedia，2026-10-01 起对所有用户公开）：列表 + 详情两态。
 * 数据面：tank_cache.json（列表/概要）+ tank/{id}.json（详情，configs/armor_model/shells）
 * 经 agentData → assetProvider 走配置的 remote asset origin（client-only，无同源回退）。
 *
 * URL 是筛选 / 详情状态的唯一 owner（utils/tankopediaQuery.js 解析与序列化）：
 * q / tier / nation / type / sort 用 replace 写入（不堆历史），?tank= 详情用 push（返回键回到列表），
 * ?config= 记录详情页选中的配置下标并联动装甲查看器入口。
 * 列表增量渲染（审计 3D-18）：首屏一页，滚动到底由 IntersectionObserver 追加，按钮兜底。
 * 装甲查看器（agent-armor）仍仅管理员内测，非管理员不显示入口。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Box, RotateCcw, Search, SearchX, TriangleAlert } from 'lucide-vue-next'
import { fetchTankEncyclopedia, fetchTankData, tankImageUrl } from '../scene/agentData.js'
import { TYPE_CLS, normType, shellLabel, isPremiumShell, fmt, fmtNum } from '../scene/tankMeta.js'
import { useAuth } from '../composables/useAuth.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { useIncrementalList } from '../composables/useIncrementalList.js'
import {
  normalizeTankCache, parseTankopediaQuery, sameTankopediaQuery, selectTanks, withTankopediaState,
} from '../utils/tankopediaQuery.js'
import PageHeader from './PageHeader.vue'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import FilterChips from './FilterChips.vue'

const VIEW = 'agent-tankopedia'
const PAGE_SIZE = 48
const SEARCH_DEBOUNCE_MS = 250
/** 车种枚举 → i18n 键（AT-SPG 含连字符，不直接作键） */
const TYPE_SLUG = { lightTank: 'light', mediumTank: 'medium', heavyTank: 'heavy', 'AT-SPG': 'td' }

const { t, te } = useI18n()
const { isAdmin } = useAuth()
const { isCompact } = useBreakpoint()
const route = useRoute()
const router = useRouter()

// ---------- URL 状态（唯一 owner） ----------
const urlState = computed(() => parseTankopediaQuery(route.query))
const onView = () => route.query?.view === VIEW

function writeState(patch, { push = false } = {}) {
  if (!onView()) return
  const query = withTankopediaState(route.query, { ...urlState.value, ...patch })
  if (sameTankopediaQuery(route.query, query)) return
  router[push ? 'push' : 'replace']({ query })
}

// 搜索框是输入草稿：即时参与筛选，防抖后写进 URL；返回 / 前进带来的 q 变化回填草稿
const searchText = ref(urlState.value.q)
let searchTimer = null
watch(searchText, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => writeState({ q: value }), SEARCH_DEBOUNCE_MS)
})
watch(() => urlState.value.q, (q) => {
  if (q !== searchText.value.trim()) searchText.value = q
})
onBeforeUnmount(() => clearTimeout(searchTimer))

const filterState = computed(() => ({ ...urlState.value, q: searchText.value }))

// ---------- 显示名（审计 3D-16：不直接显示 china / heavyTank 等原始值） ----------
function nationLabel(nation) {
  const key = `agentTanks.nations.${nation}`
  return te(key) ? t(key) : nation
}
function typeLabel(type) {
  const key = `agentTanks.types.${TYPE_SLUG[type] || type}`
  return te(key) ? t(key) : type
}
const tierLabel = tier => t('agentTanks.tier_n', { tier })

// ---------- 列表态 ----------
const cache = ref({})
const listState = ref('loading')   // loading | ready | error
const listError = ref('')

const tanks = computed(() => normalizeTankCache(cache.value))
const tiers = computed(() => [...new Set(tanks.value.map(tank => tank.tier))].filter(Boolean).sort((a, b) => a - b))
const nations = computed(() => [...new Set(tanks.value.map(tank => tank.nation))].sort())
const types = computed(() => [...new Set(tanks.value.map(tank => tank.type))].sort())
const filtered = computed(() => selectTanks(tanks.value, filterState.value))

const { visible, hasMore, loadMore, sentinel } = useIncrementalList(filtered, {
  pageSize: PAGE_SIZE,
  resetKey: () => [filterState.value.q, filterState.value.tier, filterState.value.nation, filterState.value.type, filterState.value.sort].join('|'),
})
const remaining = computed(() => filtered.value.length - visible.value.length)

const hasFilters = computed(() => !!(searchText.value.trim() || urlState.value.tier || urlState.value.nation || urlState.value.type))
const chips = computed(() => [
  urlState.value.tier && { key: 'tier', label: tierLabel(urlState.value.tier) },
  urlState.value.nation && { key: 'nation', label: nationLabel(urlState.value.nation) },
  urlState.value.type && { key: 'type', label: typeLabel(urlState.value.type) },
].filter(Boolean))

function clearFilters() {
  clearTimeout(searchTimer)
  searchText.value = ''
  writeState({ q: '', tier: '', nation: '', type: '' })
}

// 手机筛选 sheet（design-language §9）：与名人堂同一交互
const sheetOpen = ref(false)
let sheetOpener = null
function toggleSheet() {
  if (sheetOpen.value) return closeSheet()
  sheetOpener = document.activeElement
  sheetOpen.value = true
}
function closeSheet() {
  sheetOpen.value = false
  sheetOpener?.focus?.()
  sheetOpener = null
}

async function loadList() {
  listState.value = 'loading'
  listError.value = ''
  try {
    cache.value = await fetchTankEncyclopedia()
    listState.value = 'ready'
  } catch (e) {
    console.error('tankopedia load failed:', e)
    listError.value = String(e?.message || e)
    listState.value = 'error'
  }
}

function openDetail(id) {
  writeState({ tank: id, config: null }, { push: true })
}
function backToList() {
  // In-app back must collapse the detail history entry instead of adding another one.
  // Otherwise list → detail → in-app back → browser Back re-opens the same detail.
  writeState({ tank: null, config: null })
}

// ---------- 详情态（?tank=；数据 = tank/{id}.json + tank_cache 概要） ----------
const detailId = computed(() => urlState.value.tank)
const detail = ref(null)
const detailState = ref('idle')   // idle | loading | ready | error
const detailError = ref('')
let detailRequest = 0

const summary = computed(() => (detailId.value != null ? cache.value?.[String(detailId.value)] || null : null))
const cfgs = computed(() => detail.value?.configs || [])
/** 默认顶级变体（末位），与查看器 defaultCfg 语义一致；URL ?config= 优先 */
const cfgIdx = computed({
  get: () => {
    const count = cfgs.value.length
    if (!count) return 0
    const wanted = urlState.value.config
    return wanted != null && wanted < count ? wanted : count - 1
  },
  set: value => writeState({ config: Number(value) }),
})
const curCfg = computed(() => cfgs.value[cfgIdx.value] || null)
const shells = computed(() => curCfg.value?.shells || detail.value?.shells || [])

/**
 * 俯角/仰角显示回退链：per-tank 数据 → tank_cache 概要 → 当前配置 pitch_limits。
 * 前两者取决于资产包生成时间，配置级 pitch_limits（models.pb 直取）只要配置有数据就有值，
 * 是数据面缺字段时的兜底——与 GunPitchRange 同一约定：dep = max、ele = −min。
 */
const pitchLimits = computed(() => curCfg.value?.pitch_limits || null)
const gunDepression = computed(() =>
  detail.value?.gun_depression ?? summary.value?.gun_depression ?? pitchLimits.value?.max ?? null)
const gunElevation = computed(() => {
  const ele = detail.value?.gun_elevation ?? summary.value?.gun_elevation
  if (ele != null) return ele
  return pitchLimits.value?.min != null ? -pitchLimits.value.min : null
})

async function loadDetail(id) {
  const request = ++detailRequest
  if (id == null) {
    detail.value = null
    detailState.value = 'idle'
    return
  }
  detailState.value = 'loading'
  detailError.value = ''
  detail.value = null
  try {
    const data = await fetchTankData(id)
    if (request !== detailRequest) return
    detail.value = data
    detailState.value = 'ready'
  } catch (e) {
    if (request !== detailRequest) return
    detailError.value = String(e?.message || e)
    detailState.value = 'error'
  }
}
watch(detailId, id => loadDetail(id))

function open3d() {
  // 审计 3D-09：在当前标签页打开装甲查看器（携带实际搭载配置下标），返回走浏览器历史
  router.push({ query: { view: 'agent-armor', tank: String(detailId.value), config: String(cfgIdx.value) } })
}

function hideBrokenImage(event) {
  // 封面缺失：保留固定比例的占位框，不显示破图标
  event.target.hidden = true
}

onMounted(() => {
  loadList()
  if (detailId.value != null) loadDetail(detailId.value)   // 详情直达（刷新 / 分享链接）
})
</script>

<template>
  <section class="tankopedia" data-testid="tankopedia">
    <!-- ================= 详情态 ================= -->
    <template v-if="detailId != null">
      <div class="tp-detail-nav">
        <AppButton variant="ghost" size="sm" data-testid="tank-back" @click="backToList">
          <ArrowLeft :size="16" aria-hidden="true" />
          {{ t('agentTanks.back') }}
        </AppButton>
      </div>

      <p v-if="detailState === 'loading'" class="tp-status" role="status">{{ t('agentTanks.loading') }}</p>
      <EmptyState
        v-else-if="detailState === 'error'"
        role="alert"
        data-testid="tank-detail-error"
        :icon="TriangleAlert"
        :title="t('agentTanks.detail_error_title')"
        :description="detailError || t('agentTanks.error_desc')"
      >
        <AppButton variant="primary" @click="loadDetail(detailId)">
          <RotateCcw :size="16" aria-hidden="true" />
          {{ t('agentTanks.retry') }}
        </AppButton>
      </EmptyState>

      <template v-else-if="detail">
        <header class="tp-detail-head">
          <span class="tp-media tp-media-lg">
            <img :src="tankImageUrl(detailId)" alt="" width="320" height="200" decoding="async" @error="hideBrokenImage">
          </span>
          <div class="tp-detail-title">
            <h1>{{ detail.name }}</h1>
            <div class="tp-badges">
              <span class="tp-pill is-tier">{{ tierLabel(detail.tier) }}</span>
              <span class="tp-pill">{{ nationLabel(detail.nation) }}</span>
              <span class="tp-pill" :class="TYPE_CLS[detail.type] || 't-unknown'">{{ typeLabel(detail.type) }}</span>
              <span v-if="summary?.is_premium" class="tp-pill is-premium">{{ t('agentTanks.premium') }}</span>
            </div>
          </div>
        </header>

        <!-- 装甲查看器入口：装甲数值 / 热力 / 等效判定以查看器为准（唯一装甲事实源） -->
        <section v-if="isAdmin" class="tp-card-section" data-testid="tank-open3d-card">
          <h2 class="tp-section-title">{{ t('agentTanks.open3d_title') }}</h2>
          <label v-if="cfgs.length > 1" class="tp-field tp-field-inline">
            <span class="tp-field-label">{{ t('agentTanks.select_config') }}</span>
            <select v-model.number="cfgIdx" data-testid="tank-config">
              <option v-for="(c, i) in cfgs" :key="i" :value="i">{{ c.label }}<template v-if="c.turret_name && c.turret_name !== c.label"> ({{ c.turret_name }})</template></option>
            </select>
          </label>
          <div>
            <AppButton variant="primary" data-testid="tank-open3d" @click="open3d">
              <Box :size="16" aria-hidden="true" />
              {{ t('agentTanks.open3d') }}
            </AppButton>
          </div>
          <p class="tp-muted">{{ t('agentTanks.open3d_hint') }}</p>
        </section>

        <section class="tp-card-section">
          <h2 class="tp-section-title">{{ t('agentTanks.shells') }}</h2>
          <div class="tp-table-wrap">
            <table class="tp-table">
              <thead>
                <tr>
                  <th scope="col">{{ t('agentTanks.shell') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.pen') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.dmg') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.pen_far') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.velocity') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, i) in shells" :key="i">
                  <td><span class="tp-pill is-shell" :class="{ 'is-premium': isPremiumShell(s) }">{{ shellLabel(s) || normType(s.type) }}</span></td>
                  <td class="is-num">{{ fmtNum(s.penetration) }}</td>
                  <td class="is-num">{{ fmtNum(s.damage) }}</td>
                  <td class="is-num">{{ fmtNum(s.penetration_far) }}</td>
                  <td class="is-num">{{ fmtNum(s.velocity) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="tp-card-section">
          <h2 class="tp-section-title">{{ t('agentTanks.mobility') }}</h2>
          <dl class="tp-stats">
            <div><dt>{{ t('agentTanks.hp') }}</dt><dd>{{ fmtNum(detail.hp, 0) }}</dd></div>
            <div><dt>{{ t('agentTanks.speed_fwd') }}</dt><dd>{{ fmtNum(detail.speed_forward ?? summary?.speed_forward ?? detail.speed) }} km/h</dd></div>
            <div><dt>{{ t('agentTanks.speed_rev') }}</dt><dd>{{ fmtNum(detail.speed_reverse ?? summary?.speed_reverse) }} km/h</dd></div>
            <div><dt>{{ t('agentTanks.view_range') }}</dt><dd>{{ fmtNum(curCfg?.view_range ?? summary?.view_range, 0) }} m</dd></div>
            <div><dt>{{ t('agentTanks.hull_traverse') }}</dt><dd>{{ fmt(summary?.hull_traverse, 1) }} °/s</dd></div>
            <div><dt>{{ t('agentTanks.turret_traverse') }}</dt><dd>{{ fmt(curCfg?.turret_traverse_speed ?? summary?.turret_traverse_speed, 0) }} °/s</dd></div>
            <div><dt>{{ t('agentTanks.gun_dep_ele') }}</dt><dd>{{ fmtNum(gunDepression) }}° / {{ fmtNum(gunElevation) }}°</dd></div>
            <div v-if="curCfg?.reload_time != null"><dt>{{ t('agentTanks.reload') }}</dt><dd>{{ fmt(curCfg.reload_time, 1) }} s</dd></div>
            <div v-if="curCfg?.dpm != null"><dt>{{ t('agentTanks.dpm') }}</dt><dd>{{ fmt(curCfg.dpm, 0) }}</dd></div>
            <div v-if="curCfg?.aim_time != null"><dt>{{ t('agentTanks.aim_time') }}</dt><dd>{{ fmt(curCfg.aim_time, 1) }} s</dd></div>
          </dl>
        </section>
      </template>
    </template>

    <!-- ================= 列表态 ================= -->
    <template v-else>
      <PageHeader :title="t('agentTanks.title')" :description="t('agentTanks.hint')">
        <template v-if="listState === 'ready'" #actions>
          <span class="tp-count" data-testid="tank-count" aria-live="polite">{{ t('agentTanks.count', { shown: filtered.length, total: tanks.length }) }}</span>
        </template>
      </PageHeader>

      <div class="tp-search-row">
        <label class="tp-search">
          <Search :size="16" class="tp-search-icon" aria-hidden="true" />
          <input
            v-model="searchText"
            type="search"
            data-testid="tank-search"
            :aria-label="t('agentTanks.search_label')"
            :placeholder="t('agentTanks.search_ph')"
            autocomplete="off"
            enterkeyhint="search"
          >
        </label>
        <FilterChips v-if="isCompact" :chips="chips" :open="sheetOpen" @toggle="toggleSheet" @remove="key => writeState({ [key]: '' })" />
      </div>

      <div v-if="isCompact && sheetOpen" class="tp-sheet-scrim" aria-hidden="true" @click="closeSheet"></div>
      <div
        v-if="!isCompact || sheetOpen"
        class="tp-filters"
        :class="{ 'is-sheet': isCompact }"
        :role="isCompact ? 'dialog' : undefined"
        :aria-label="isCompact ? t('filters.title') : undefined"
        data-testid="tank-filters"
        @keydown.esc="isCompact && closeSheet()"
      >
        <div v-if="isCompact" class="tp-sheet-head">
          <strong>{{ t('filters.title') }}</strong>
          <AppButton size="sm" variant="primary" @click="closeSheet">{{ t('filters.done') }}</AppButton>
        </div>
        <label class="tp-field">
          <span class="tp-field-label">{{ t('agentTanks.tier') }}</span>
          <select data-testid="filter-tier" :value="urlState.tier" @change="writeState({ tier: $event.target.value })">
            <option value="">{{ t('agentTanks.all') }}</option>
            <option v-for="tier in tiers" :key="tier" :value="String(tier)">{{ tierLabel(tier) }}</option>
          </select>
        </label>
        <label class="tp-field">
          <span class="tp-field-label">{{ t('agentTanks.nation') }}</span>
          <select data-testid="filter-nation" :value="urlState.nation" @change="writeState({ nation: $event.target.value })">
            <option value="">{{ t('agentTanks.all') }}</option>
            <option v-for="n in nations" :key="n" :value="n">{{ nationLabel(n) }}</option>
          </select>
        </label>
        <label class="tp-field">
          <span class="tp-field-label">{{ t('agentTanks.type') }}</span>
          <select data-testid="filter-type" :value="urlState.type" @change="writeState({ type: $event.target.value })">
            <option value="">{{ t('agentTanks.all') }}</option>
            <option v-for="tv in types" :key="tv" :value="tv">{{ typeLabel(tv) }}</option>
          </select>
        </label>
        <label class="tp-field">
          <span class="tp-field-label">{{ t('agentTanks.sort') }}</span>
          <select data-testid="filter-sort" :value="urlState.sort" @change="writeState({ sort: $event.target.value })">
            <option value="name">{{ t('agentTanks.sort_name') }}</option>
            <option value="tier">{{ t('agentTanks.sort_tier') }}</option>
            <option value="hp">{{ t('agentTanks.sort_hp') }}</option>
            <option value="pen">{{ t('agentTanks.sort_pen') }}</option>
          </select>
        </label>
      </div>

      <EmptyState
        v-if="listState === 'error'"
        role="alert"
        data-testid="tank-list-error"
        :icon="TriangleAlert"
        :title="t('agentTanks.error_title')"
        :description="t('agentTanks.error_desc')"
      >
        <AppButton variant="primary" data-testid="tank-list-retry" @click="loadList">
          <RotateCcw :size="16" aria-hidden="true" />
          {{ t('agentTanks.retry') }}
        </AppButton>
      </EmptyState>

      <div v-else-if="listState === 'loading'" class="tp-grid" aria-busy="true" data-testid="tank-skeleton">
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
        <ul class="tp-grid" data-testid="tank-grid">
          <li v-for="tank in visible" :key="tank.id">
            <button
              type="button"
              class="tp-card"
              :class="{ 'is-premium': tank.is_premium, 'is-collector': tank.is_collector }"
              data-testid="tank-card"
              @click="openDetail(tank.id)"
            >
              <span class="tp-media">
                <img :src="tankImageUrl(tank.id)" alt="" loading="lazy" decoding="async" width="160" height="100" @error="hideBrokenImage">
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
    </template>
  </section>
</template>

<style scoped>
.tankopedia {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--gutter) var(--space-12);
  color: var(--color-text-primary);
}

.tankopedia :deep(.page-header) { margin-bottom: 0; }

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
.tp-search-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }

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

.tp-filters { display: flex; flex-wrap: wrap; gap: var(--space-3); }

.tp-field { display: grid; gap: var(--space-1); min-inline-size: 140px; }
.tp-field-inline { max-inline-size: 360px; }
.tp-field-label { color: var(--color-text-secondary); font: var(--type-caption); }

.tp-sheet-scrim { position: fixed; inset: 0; z-index: var(--z-sheet); background: var(--color-scrim); }

.tp-filters.is-sheet {
  position: fixed;
  inset-inline: 0;
  inset-block-end: 0;
  z-index: var(--z-sheet);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  max-block-size: 80dvh;
  padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
  overflow-y: auto;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--color-surface-3);
  box-shadow: var(--elevation-3);
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

/* ---------- 卡片网格 ---------- */
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
/* 收藏车：蓝框（`--color-info` 是本组件既有的中性蓝；主题测试要求 Agent 组件只用
 * 已定义 token，故不写裸色）。与金币车警告色边框区分开：上游数据两者互斥
 * （tanks.pb field13：1=金币 2=收藏），但 consumer 不依赖上游保证——异常双 true 时
 * **premium 优先**，由 `:not(.is-premium)` 显式确定，而不是靠规则先后顺序。 */
.tp-card.is-collector:not(.is-premium) { border-color: color-mix(in oklab, var(--color-info) 55%, var(--color-border-subtle)); }

@media (hover: hover) {
  .tp-card:hover { border-color: var(--color-accent); background: var(--color-surface-2); }
}

/* 固定比例的图片框：懒加载图片到达前后都不引起布局位移 */
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

/* 图片必须**绝对定位铺满**，不能让它在网格里按 `block-size:100%` 自适应。
 *
 * 容器是 `display:grid` + `place-items:center`：网格区域按内容 sizing，`block-size:100%`
 * 解不出确定高度，于是 img 退回**固有比例**——封面图是逐车紧裁的（高固定、宽 84~190），
 * 窄于 8:5 的车会算得比容器更高（实测列表卡片 164.8×103 的框里 img 是 164.8×133.5，
 * 详情 hero 240×150 里是 240×156.9），多出来的部分被容器的 `overflow:hidden`
 * **从下方裁掉**（履带/车体下缘被切）。
 * 绝对定位后 img 盒恒等于容器盒，`contain` 完整装下整张图，不再裁切。 */
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

/* ---------- 详情态 ---------- */
.tp-detail-nav { display: flex; }

.tp-detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.tp-media-lg { flex: 0 0 240px; inline-size: 240px; }
.tp-detail-title { display: grid; gap: var(--space-2); min-inline-size: 0; }
.tp-detail-title h1 { margin: 0; font: var(--type-h1); overflow-wrap: anywhere; }

.tp-card-section {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.tp-section-title { margin: 0; font: var(--type-h3); }

.tp-table-wrap { overflow-x: auto; }
.tp-table { inline-size: 100%; border-collapse: collapse; font: var(--type-body); font-variant-numeric: tabular-nums; }
.tp-table th { padding: var(--space-1) var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; text-align: start; white-space: nowrap; }
.tp-table td { padding: var(--space-2); border-block-start: 1px solid var(--color-border-subtle); }
.tp-table .is-num { text-align: end; }

.tp-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-2);
  margin: 0;
}

.tp-stats > div { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); }
.tp-stats dt { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-stats dd { margin: 0; font: var(--type-h3); font-variant-numeric: tabular-nums; }

/* 平板：卡片稍窄，详情头部封面缩小 */
@media (768px <= width < 1200px) {
  .tp-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .tp-media-lg { flex-basis: 200px; inline-size: 200px; }
}

/* 手机：两列卡片；筛选进 sheet；详情头部改为上下排列 */
@media (width < 768px) {
  .tankopedia { gap: var(--space-3); padding-block-start: var(--space-4); }
  .tp-search { flex-basis: 100%; max-inline-size: none; }
  .tp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
  .tp-detail-head { flex-direction: column; align-items: stretch; gap: var(--space-3); }
  .tp-media-lg { flex-basis: auto; inline-size: 100%; }
  .tp-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
