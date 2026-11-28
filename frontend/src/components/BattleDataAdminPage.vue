<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../api/admin-battle-data.js'
import { mapCoverage, spawnSideKey, spawnTables, type SpawnMode } from '../app/battleDataCoverage.js'
import { mapLabel } from '../utils/helpers.js'
import AdminDetailDrawer from './AdminDetailDrawer.vue'
import AdminFilterBar from './AdminFilterBar.vue'
import AppButton from './AppButton.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import SegmentedControl from './SegmentedControl.vue'
import SearchableSelect from './SearchableSelect.vue'
import { isRowControlClick, rowOpenTarget } from './adminListRow'
import './admin-list.css'

const { t, te, locale } = useI18n()
const countFormat = computed(() => new Intl.NumberFormat(locale.value))
const percentFormat = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const gate = useFeatureGate()
const availability = computed(() => gate.availability(Feature.ADMIN_BATTLE_DATA))
const summary = ref<api.Summary | null>(null)
const battles = ref<api.BattlePage['items']>([])
const nextCursor = ref<string | null>(null)
const detail = ref<api.BattleDetail | null>(null)
const selectedBattle = ref<api.BattlePage['items'][number] | null>(null)
const returnFocus = ref<HTMLElement | null>(null)
const range = ref('7d')
const spawnMode = ref<SpawnMode>('ALL')
const filters = ref({ arenaId: '', mapKey: '', arenaBonusType: '', clientVersion: '', winnerTeam: '', from: '', to: '' })
type FilterDraft = typeof filters.value
type AppliedSnapshot = { filters: FilterDraft; baseInterval: api.Query; query: api.Query }
const applied = ref<AppliedSnapshot | null>(null)
const currentInterval = ref<api.Query>({})
const summaryInterval = ref<api.Query>({})
const refreshed = ref<string | null>(null)
const loading = ref(false)
const moreLoading = ref(false)
const detailLoading = ref(false)
const summaryError = ref('')
const listError = ref('')
const detailError = ref('')
let summaryGeneration = 0, listGeneration = 0, detailGeneration = 0
const coverage = computed(() => mapCoverage(summary.value?.maps || []))
const modeRows = computed(() => [1, 7].map(key => ({ key, count: summary.value?.modes.find(row => row.key === key)?.count ?? 0 })))
const winnerRows = computed(() => [0, 1, 2].map(key => ({ key, count: summary.value?.winnerTeams.find(row => row.key === key)?.count ?? 0 })))
const observedMapCount = computed(() => summary.value?.maps.length ?? 0)
const spawnGroups = computed(() => spawnTables(coverage.value, summary.value?.spawnStats ?? [], spawnMode.value).map(table => ({
  ...table,
  rows: [...table.rows].sort((a, b) => b.battles - a.battles || mapName(a.key).localeCompare(mapName(b.key), locale.value)),
})))
const rangeOptions = computed(() => [
  { value: '24h', label: '24h', testid: 'range-24h', disabled: !availability.value.available || loading.value },
  { value: '7d', label: '7d', testid: 'range-7d', disabled: !availability.value.available || loading.value },
  { value: '30d', label: '30d', testid: 'range-30d', disabled: !availability.value.available || loading.value },
  { value: 'all', label: t('battleDataAdmin.all'), testid: 'range-all', disabled: !availability.value.available || loading.value },
])
const spawnModes = computed(() => [
  { value: 'ALL', label: t('battleDataAdmin.all'), testid: 'spawn-mode-all' },
  { value: 'RANDOM', label: mode(1), testid: 'spawn-mode-random' },
  { value: 'RATING', label: mode(7), testid: 'spawn-mode-rating' },
])
const modeFilterOptions = computed(() => [
  { value: 'all', label: t('battleDataAdmin.all'), testid: 'mode-filter-all' },
  { value: '1', label: mode(1), testid: 'mode-filter-random' },
  { value: '7', label: mode(7), testid: 'mode-filter-rating' },
])
const modeFilter = computed({
  get: () => filters.value.arenaBonusType || 'all',
  set: (value: string) => { filters.value.arenaBonusType = value === 'all' ? '' : value },
})
const winnerOptions = computed(() => [
  { value: 'all', label: t('battleDataAdmin.all') },
  ...[0, 1, 2].map(n => ({ value: String(n), label: winner(n) })),
])
const winnerFilter = computed({
  get: () => filters.value.winnerTeam || 'all',
  set: (value: string) => { filters.value.winnerTeam = value === 'all' ? '' : value },
})
const mapOptions = computed(() => {
  const keys = new Set([...coverage.value.reviewed, ...coverage.value.other].map(row => row.key))
  if (filters.value.mapKey) keys.add(filters.value.mapKey)
  return [...keys].map(value => ({ value, label: mapName(value) })).sort((a, b) => a.label.localeCompare(b.label, locale.value))
})
const reviewedZeroCount = computed(() => coverage.value.reviewed.filter(row => row.count === 0).length)
const trendRows = computed(() => {
  const data = summary.value
  if (!data || (!data.daily.length && typeof summaryInterval.value.from !== 'string')) return []
  const counts = new Map(data.daily.map(row => [row.key, row.count]))
  const start = typeof summaryInterval.value.from === 'string' ? Date.parse(summaryInterval.value.from) : Date.parse(`${data.daily[0].key}T00:00:00Z`)
  const requestedEnd = typeof summaryInterval.value.to === 'string' ? Date.parse(summaryInterval.value.to) : Date.parse(data.asOf)
  const end = Math.min(requestedEnd, Date.parse(data.asOf))
  const day = 86400000
  const rows: { key: string; count: number }[] = []
  for (let cursor = Math.floor(start / day) * day; cursor < end; cursor += day) {
    const key = new Date(cursor).toISOString().slice(0, 10)
    rows.push({ key, count: counts.get(key) ?? 0 })
  }
  return rows
})
const trendMax = computed(() => Math.max(1, ...trendRows.value.map(row => row.count)))
const kpis = computed(() => {
  const data = summary.value
  if (!data) return []
  return [
    { label: t('battleDataAdmin.total'), value: data.totalBattles },
    { label: t('battleDataAdmin.last24'), value: data.last24Hours },
    { label: t('battleDataAdmin.last7'), value: data.last7Days },
    { label: t('battleDataAdmin.last30'), value: data.last30Days },
    { label: t('battleDataAdmin.mapsObserved'), value: data.distinctMaps },
    { label: t('battleDataAdmin.versions'), value: data.distinctClientVersions },
  ]
})
const versionRows = computed(() => {
  const rows = summary.value?.clientVersions ?? []
  const head = rows.slice(0, 5).map(row => ({ key: row.key, count: row.count, latest: row.latestReceivedAt as string | null }))
  const rest = rows.slice(5)
  return rest.length ? [...head, { key: t('battleDataAdmin.otherVersions'), count: rest.reduce((sum, row) => sum + row.count, 0), latest: null }] : head
})
const filterChips = computed(() => {
  const f = applied.value?.filters
  if (!f) return []
  const chips: { key: string; label: string }[] = []
  if (f.mapKey) chips.push({ key: 'mapKey', label: `${t('battleDataAdmin.map')}: ${mapName(f.mapKey)}` })
  if (f.arenaBonusType) chips.push({ key: 'arenaBonusType', label: `${t('battleDataAdmin.mode')}: ${mode(Number(f.arenaBonusType))}` })
  if (f.clientVersion.trim()) chips.push({ key: 'clientVersion', label: `${t('battleDataAdmin.version')}: ${f.clientVersion.trim()}` })
  if (f.winnerTeam) chips.push({ key: 'winnerTeam', label: `${t('battleDataAdmin.winner')}: ${winner(Number(f.winnerTeam))}` })
  if (f.arenaId.trim()) chips.push({ key: 'arenaId', label: `${t('battleDataAdmin.arenaId')}: ${f.arenaId.trim()}` })
  if (f.from) chips.push({ key: 'from', label: `${t('battleDataAdmin.from')}: ${f.from}` })
  if (f.to) chips.push({ key: 'to', label: `${t('battleDataAdmin.to')}: ${f.to}` })
  return chips
})
function explain(error: unknown) { return apiErrorLabel(t, te, error) }
function utc(input: string) { return input ? new Date(`${input}Z`).toISOString() : undefined }
function rangeQuery() {
  if (range.value === 'all') return {}
  let days = 30
  if (range.value === '24h') days = 1
  else if (range.value === '7d') days = 7
  const now = Date.now()
  return { from: new Date(now - days * 86400000).toISOString(), to: new Date(now).toISOString() }
}
function snapshot(draft: FilterDraft, interval: api.Query): AppliedSnapshot {
  const query = { ...interval, arenaId: draft.arenaId.trim(), mapKey: draft.mapKey.trim(),
    arenaBonusType: draft.arenaBonusType, clientVersion: draft.clientVersion.trim(), winnerTeam: draft.winnerTeam,
    ...(draft.from ? { from: utc(draft.from) } : {}), ...(draft.to ? { to: utc(draft.to) } : {}) }
  return { filters: { ...draft }, baseInterval: { ...interval }, query }
}
function acceptList(next: AppliedSnapshot, page: api.BattlePage) {
  applied.value = next
  battles.value = page.items
  nextCursor.value = page.nextCursor
}
async function refresh() {
  if (!gate.requireFeature(Feature.ADMIN_BATTLE_DATA)) return
  const generation = ++summaryGeneration
  const currentListGeneration = ++listGeneration
  loading.value = true; moreLoading.value = false; summaryError.value = ''; listError.value = ''
  nextCursor.value = null
  const interval = rangeQuery()
  currentInterval.value = interval
  let next: AppliedSnapshot
  try { next = snapshot(filters.value, interval) } catch { listError.value = t('battleDataAdmin.error'); loading.value = false; return }
  const [a, b] = await Promise.allSettled([api.getSummary(interval), api.getBattles(next.query)])
  if (generation !== summaryGeneration) return
  if (a.status === 'fulfilled') { summary.value = a.value; summaryInterval.value = interval; refreshed.value = new Date().toISOString() } else summaryError.value = explain(a.reason)
  if (currentListGeneration === listGeneration) {
    if (b.status === 'fulfilled') acceptList(next, b.value)
    else listError.value = explain(b.reason)
  }
  loading.value = false
}
function onRangeChange(value: string) {
  if (value === range.value || !availability.value.available || loading.value) return
  range.value = value
  void refresh()
}
async function applyFilters(draft: FilterDraft = filters.value, interval: api.Query = currentInterval.value) {
  if (!gate.requireFeature(Feature.ADMIN_BATTLE_DATA)) return
  const generation = ++listGeneration
  listError.value = ''; moreLoading.value = true
  try {
    const next = snapshot(draft, interval)
    const page = await api.getBattles(next.query)
    if (generation !== listGeneration) return
    acceptList(next, page)
  } catch (error) { if (generation === listGeneration) listError.value = explain(error) }
  finally { if (generation === listGeneration) moreLoading.value = false }
}
const removeDisabled = computed(() => !applied.value || loading.value || moreLoading.value || !availability.value.available)
function removeFilterChip(key: string) {
  const last = applied.value
  if (removeDisabled.value || !last || !Object.hasOwn(last.filters, key)) return
  filters.value[key as keyof FilterDraft] = ''
  void applyFilters({ ...last.filters, [key]: '' }, last.baseInterval)
}
async function loadMore() {
  if (!applied.value || !nextCursor.value || loading.value || moreLoading.value || !gate.requireFeature(Feature.ADMIN_BATTLE_DATA)) return
  const generation = ++listGeneration
  moreLoading.value = true; listError.value = ''
  try {
    const page = await api.getBattles({ ...applied.value.query, cursor: nextCursor.value })
    if (generation !== listGeneration) return
    battles.value = [...battles.value, ...page.items]; nextCursor.value = page.nextCursor
  } catch (error) { if (generation === listGeneration) listError.value = explain(error) }
  finally { if (generation === listGeneration) moreLoading.value = false }
}
async function openDetail(battle: api.BattlePage['items'][number], event?: Event) {
  if (!gate.requireFeature(Feature.ADMIN_BATTLE_DATA)) return
  const generation = ++detailGeneration
  returnFocus.value = event ? rowOpenTarget(event) : null
  detail.value = null; detailError.value = ''; detailLoading.value = true; selectedBattle.value = battle
  try { const value = await api.getBattle(battle.id); if (generation === detailGeneration) detail.value = value }
  catch (error) { if (generation === detailGeneration) detailError.value = explain(error) }
  finally { if (generation === detailGeneration) detailLoading.value = false }
}
function onRowClick(battle: api.BattlePage['items'][number], event: Event) { if (!isRowControlClick(event)) void openDetail(battle, event) }
function closeDetail() { ++detailGeneration; selectedBattle.value = null; detailLoading.value = false }
function time(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  const absolute = new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date)
  const delta = date.getTime() - Date.now()
  const magnitude = Math.abs(delta)
  let amount: number
  let unit: Intl.RelativeTimeFormatUnit
  if (magnitude < 3_600_000) { amount = Math.round(delta / 60_000); unit = 'minute' }
  else if (magnitude < 86_400_000) { amount = Math.round(delta / 3_600_000); unit = 'hour' }
  else { amount = Math.round(delta / 86_400_000); unit = 'day' }
  const relative = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }).format(amount, unit)
  return `${absolute} UTC (${relative})`
}
function share(count: number) { return summary.value?.windowBattles ? percentFormat.value.format(count / summary.value.windowBattles) : percentFormat.value.format(0) }
function sharePct(count: number) { return summary.value?.windowBattles ? `${Math.min(100, 100 * count / summary.value.windowBattles)}%` : '0%' }
function mode(n: number) { return t(n === 1 ? 'battleDataAdmin.random' : 'battleDataAdmin.rating') }
function mapName(key: string) { return mapLabel(key, locale.value) }
function sideName(side: api.Summary['spawnStats'][number]['side']) { return t(`battleDataAdmin.side.${spawnSideKey(side)}`) }
function rate(count: number, battles: number) { return battles ? percentFormat.value.format(count / battles) : '—' }
function winner(n: number) {
  if (n === 0) return t('battleDataAdmin.draw')
  if (n === 1) return t('battleDataAdmin.team1')
  return t('battleDataAdmin.team2')
}
type SpawnRow = ReturnType<typeof spawnTables>[number]['rows'][number]
function spawnSegments(row: SpawnRow) {
  const [first, second] = row.sides
  return { first: first?.wins ?? 0, draw: row.draws, second: second?.wins ?? 0 }
}
function segPct(count: number, battles: number) { return battles ? `${100 * count / battles}%` : '0%' }
function spawnBarLabel(axis: readonly [string, string] | readonly string[], row: SpawnRow) {
  const segments = spawnSegments(row)
  return t('battleDataAdmin.spawnBar', {
    first: sideName(axis[0] as never), firstRate: rate(segments.first, row.battles),
    drawRate: rate(segments.draw, row.battles),
    second: sideName(axis[1] as never), secondRate: rate(segments.second, row.battles),
  })
}
let initialAttempted = false
watch(availability, (state) => {
  if (!initialAttempted && state.available) { initialAttempted = true; void refresh() }
}, { immediate: true })
onBeforeUnmount(() => { ++summaryGeneration; ++listGeneration; ++detailGeneration })
</script>

<template>
  <section class="battle-admin admin-page">
    <ShowcaseHero compact section="admin" :kicker="t('battleDataAdmin.kicker')" :title="t('battleDataAdmin.title')">
      <template #actions>
        <SegmentedControl :model-value="range" :options="rangeOptions" :ariaLabel="t('battleDataAdmin.range')" data-testid="range-control" @update:model-value="onRangeChange" />
        <AppButton size="sm" :disabled="!availability.available || loading" data-testid="battle-refresh" @click="refresh">{{ t('battleDataAdmin.refresh') }}</AppButton>
      </template>
    </ShowcaseHero>
    <div class="admin-list-note"><strong>{{ t('battleDataAdmin.noteLabel') }}</strong><ul><li>{{ t('battleDataAdmin.acceptedNotice') }}</li><li>{{ t('battleDataAdmin.biasNotice') }}</li></ul></div>
    <p v-if="!availability.pending && !availability.available" class="admin-list-status" data-testid="battle-offline">{{ t(availability.messageKey!) }}</p>
    <p v-if="loading" class="admin-list-status" role="status">{{ t('battleDataAdmin.loading') }}</p>
    <p v-if="summaryError" class="admin-list-status is-error" role="alert">{{ t('battleDataAdmin.error') }} {{ summaryError }}</p>
    <template v-if="summary">
      <h2 class="battle-h2">{{ t('battleDataAdmin.overview') }}</h2>
      <div class="kpis">
        <div v-for="item in kpis" :key="item.label" class="kpi"><span>{{ item.label }}</span><strong>{{ countFormat.format(item.value) }}</strong></div>
      </div>
      <p class="admin-list-muted battle-meta">{{ t('battleDataAdmin.window') }}: {{ countFormat.format(summary.windowBattles) }} · {{ t('battleDataAdmin.latest') }}: {{ time(summary.latestReceivedAt) }}<template v-if="refreshed"> · {{ t('battleDataAdmin.lastRefresh') }}: {{ time(refreshed) }}</template></p>
      <p v-if="summary.totalBattles === 0" class="admin-list-empty">{{ t('battleDataAdmin.empty') }}</p>
      <div class="insights">
        <section class="battle-card">
          <h2 class="battle-h2">{{ t('battleDataAdmin.trend') }}</h2>
          <ul class="trend" data-testid="battle-trend">
            <li v-for="row in trendRows" :key="row.key" class="trend-col">
              <span class="trend-count">{{ countFormat.format(row.count) }}</span>
              <span class="trend-track"><span class="bar" :style="{ '--bar-share': `${100 * row.count / trendMax}%` }" /></span>
              <span class="trend-date" aria-hidden="true">{{ row.key.slice(5) }}</span>
              <span class="battle-visually-hidden">{{ row.key }}</span>
            </li>
          </ul>
        </section>
        <div class="distributions">
          <section class="battle-card">
            <h2 class="battle-h2">{{ t('battleDataAdmin.modes') }}</h2>
            <p v-for="row in modeRows" :key="row.key" class="share-row"><span>{{ mode(row.key) }}: {{ countFormat.format(row.count) }} ({{ share(row.count) }})</span><span class="share-track" aria-hidden="true"><span class="share-fill" :style="{ '--share': sharePct(row.count) }" /></span></p>
          </section>
          <section class="battle-card">
            <h2 class="battle-h2">{{ t('battleDataAdmin.winners') }}</h2>
            <p v-for="row in winnerRows" :key="row.key" class="share-row"><span>{{ winner(row.key) }}: {{ countFormat.format(row.count) }} ({{ share(row.count) }})</span><span class="share-track" aria-hidden="true"><span class="share-fill" :style="{ '--share': sharePct(row.count) }" /></span></p>
          </section>
          <section class="battle-card">
            <h2 class="battle-h2">{{ t('battleDataAdmin.schema') }}</h2>
            <p v-for="row in summary.schemaVersions" :key="row.key" class="share-row"><span>v{{ row.key }}: {{ countFormat.format(row.count) }}</span></p>
          </section>
          <section class="battle-card">
            <h2 class="battle-h2">{{ t('battleDataAdmin.versions') }}</h2>
            <p v-for="row in versionRows" :key="row.key" class="share-row"><span>{{ row.key }}: {{ countFormat.format(row.count) }} ({{ share(row.count) }})<template v-if="row.latest"> · {{ time(row.latest) }}</template></span><span class="share-track" aria-hidden="true"><span class="share-fill" :style="{ '--share': sharePct(row.count) }" /></span></p>
          </section>
        </div>
      </div>
      <div class="section-head"><h2 class="battle-h2">{{ t('battleDataAdmin.spawnStats') }}</h2><SegmentedControl v-model="spawnMode" :options="spawnModes" :ariaLabel="t('battleDataAdmin.mode')" /></div>
      <p class="admin-list-muted battle-meta">{{ t('battleDataAdmin.spawnRateNote') }}</p>
      <p class="admin-list-muted battle-meta">{{ t('battleDataAdmin.reviewedMaps') }}: {{ countFormat.format(coverage.reviewed.length) }} · {{ t('battleDataAdmin.mapsObserved') }}: {{ countFormat.format(observedMapCount) }} · {{ t('battleDataAdmin.reviewedZero') }}: {{ countFormat.format(reviewedZeroCount) }}</p>
      <div v-for="table in spawnGroups" :key="table.axis[0]" class="admin-list-table-wrap battle-table-gap">
        <table class="admin-list-table" data-testid="spawn-stats">
          <thead><tr>
            <th>{{ t('battleDataAdmin.map') }}</th><th class="is-num">{{ t('battleDataAdmin.sample') }}</th>
            <th v-for="side in table.axis" :key="side" class="is-num">{{ t('battleDataAdmin.sideWinRate', { side: sideName(side) }) }}</th>
            <th class="is-num">{{ t('battleDataAdmin.drawRate') }}</th><th>{{ t('battleDataAdmin.latestData') }}</th>
            <th>{{ t('battleDataAdmin.spawnSides', { first: sideName(table.axis[0]), second: sideName(table.axis[1]) }) }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="row in table.rows" :key="row.key">
              <td class="cell-primary is-wrap"><span class="map-name">{{ mapName(row.key) }}</span><small class="raw-key">{{ row.key }}<template v-if="row.observedOnly"> · {{ t('battleDataAdmin.observedOnly') }}</template></small></td>
              <td class="is-num" :data-label="t('battleDataAdmin.sample')">{{ countFormat.format(row.battles) }}</td>
              <td v-for="(side, index) in row.sides" :key="side.side" class="is-num" :data-label="t('battleDataAdmin.sideWinRate', { side: sideName(table.axis[index]) })" :title="t('battleDataAdmin.outcomes', { wins: countFormat.format(side.wins), draws: countFormat.format(side.draws), losses: countFormat.format(side.losses) })">{{ side.battles ? `${rate(side.wins, side.battles)} · ${countFormat.format(side.wins)}/${countFormat.format(side.battles)}` : '—' }}</td>
              <td class="is-num" :data-label="t('battleDataAdmin.drawRate')">{{ rate(row.draws, row.battles) }}</td>
              <td :data-label="t('battleDataAdmin.latestData')">{{ time(row.latest) }}</td>
              <td class="spawn-cell" :data-label="t('battleDataAdmin.spawnSides', { first: sideName(table.axis[0]), second: sideName(table.axis[1]) })">
                <span v-if="row.battles" class="spawn-bar" role="img" :aria-label="spawnBarLabel(table.axis, row)" :title="spawnBarLabel(table.axis, row)">
                  <span class="spawn-seg is-first" :style="{ '--seg': segPct(spawnSegments(row).first, row.battles) }" />
                  <span class="spawn-seg is-draw" :style="{ '--seg': segPct(spawnSegments(row).draw, row.battles) }" />
                  <span class="spawn-seg is-second" :style="{ '--seg': segPct(spawnSegments(row).second, row.battles) }" />
                </span>
                <span v-else class="admin-list-muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <h2 class="battle-h2">{{ t('battleDataAdmin.recent') }}</h2>
    <form class="filters" @submit.prevent="applyFilters()">
      <AdminFilterBar :chips="filterChips" :remove-disabled="removeDisabled" :done-button="false" @remove="removeFilterChip">
        <template #default="{ close, compact }">
          <div class="admin-list-field"><label for="map-filter">{{ t('battleDataAdmin.map') }}</label>
            <SearchableSelect v-model="filters.mapKey" input-id="map-filter" :label="t('battleDataAdmin.map')"
              :options="mapOptions" :empty-label="t('battleDataAdmin.allMaps')" :inline="compact" />
          </div>
          <div class="admin-list-field"><span>{{ t('battleDataAdmin.mode') }}</span>
            <SegmentedControl v-model="modeFilter" :options="modeFilterOptions" :ariaLabel="t('battleDataAdmin.mode')" />
          </div>
          <label class="admin-list-field">{{ t('battleDataAdmin.version') }}<input v-model="filters.clientVersion" class="admin-list-input" data-testid="version-filter" /></label>
          <div class="admin-list-field"><span>{{ t('battleDataAdmin.winner') }}</span>
            <SegmentedControl v-model="winnerFilter" :options="winnerOptions" :ariaLabel="t('battleDataAdmin.winner')" wrap data-testid="winner-filter" />
          </div>
          <details class="filters-advanced"><summary>{{ t('battleDataAdmin.advanced') }}</summary>
            <div class="filters-advanced-fields">
              <label class="admin-list-field">{{ t('battleDataAdmin.arenaId') }}<input v-model="filters.arenaId" class="admin-list-input" /></label>
              <label class="admin-list-field">{{ t('battleDataAdmin.from') }}<input v-model="filters.from" type="datetime-local" class="admin-list-input" /></label>
              <label class="admin-list-field">{{ t('battleDataAdmin.to') }}<input v-model="filters.to" type="datetime-local" class="admin-list-input" /></label>
            </div>
          </details>
          <AppButton v-if="compact" variant="primary" block type="button" data-testid="battle-sheet-apply" :disabled="!availability.available || moreLoading" @click="applyFilters(); close()">{{ t('battleDataAdmin.apply') }}</AppButton>
        </template>
        <template #actions>
          <AppButton variant="primary" type="submit" data-testid="battle-apply" :disabled="!availability.available || moreLoading">{{ t('battleDataAdmin.apply') }}</AppButton>
        </template>
      </AdminFilterBar>
    </form>
    <p v-if="listError" class="admin-list-status is-error" role="alert">{{ t('battleDataAdmin.error') }} {{ listError }}</p>
    <p v-if="!loading && !battles.length && summary?.totalBattles" class="admin-list-empty">{{ t('battleDataAdmin.emptyFilter') }}</p>
    <div class="admin-list-table-wrap">
      <table class="admin-list-table" data-testid="recent-battles">
        <thead><tr><th>{{ t('battleDataAdmin.received') }}</th><th>{{ t('battleDataAdmin.arenaId') }}</th><th>{{ t('battleDataAdmin.mode') }}</th><th>{{ t('battleDataAdmin.map') }}</th><th>{{ t('battleDataAdmin.version') }}</th><th>{{ t('battleDataAdmin.winner') }}</th><th>{{ t('battleDataAdmin.spawn') }}</th></tr></thead>
        <tbody>
          <tr v-for="battle in battles" :key="battle.id" class="is-clickable" :class="{ 'is-active': selectedBattle?.id === battle.id }" @click="onRowClick(battle, $event)">
            <td class="cell-primary"><button type="button" class="admin-list-open" data-testid="battle-row-open" :disabled="!availability.available" @click="openDetail(battle, $event)">{{ time(battle.receivedAt) }}</button></td>
            <td class="admin-list-mono" :data-label="t('battleDataAdmin.arenaId')">{{ battle.arenaId }}</td>
            <td :data-label="t('battleDataAdmin.mode')">{{ mode(battle.arenaBonusType) }}</td>
            <td class="is-wrap" :data-label="t('battleDataAdmin.map')"><span class="map-name">{{ mapName(battle.mapKey) }}</span><small class="raw-key">{{ battle.mapKey }}</small></td>
            <td :data-label="t('battleDataAdmin.version')">{{ battle.clientVersion }}</td>
            <td :data-label="t('battleDataAdmin.winner')">{{ winner(battle.winnerTeam) }}</td>
            <td :data-label="t('battleDataAdmin.spawn')">{{ sideName(battle.team1Spawn) }} / {{ sideName(battle.team2Spawn) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="nextCursor || (loading && battles.length)" class="admin-list-pagination">
      <AppButton :disabled="!availability.available || loading || moreLoading || !nextCursor" :loading="moreLoading" @click="loadMore">{{ t('battleDataAdmin.loadMore') }}</AppButton>
    </div>

    <AdminDetailDrawer :open="!!selectedBattle" :title="t('battleDataAdmin.detail')" :return-focus-to="returnFocus" @close="closeDetail">
      <p v-if="detailLoading" class="admin-list-muted" role="status">{{ t('battleDataAdmin.loading') }}</p>
      <p v-if="detailError" class="admin-list-error" role="alert">{{ t('battleDataAdmin.detailError') }} {{ detailError }}</p>
      <template v-if="detail">
        <section class="admin-list-section">
          <dl class="admin-list-dl">
            <template v-for="[key, value] in [[t('battleDataAdmin.arenaId'), detail.battle.arenaId], [t('battleDataAdmin.received'), time(detail.battle.receivedAt)], [t('battleDataAdmin.schemaVersion'), detail.battle.schemaVersion], [t('battleDataAdmin.mode'), mode(detail.battle.arenaBonusType)], [t('battleDataAdmin.mapId'), detail.battle.mapId], [t('battleDataAdmin.map'), `${mapName(detail.battle.mapKey)} (${detail.battle.mapKey})`], [t('battleDataAdmin.version'), detail.battle.clientVersion], [t('battleDataAdmin.winner'), winner(detail.battle.winnerTeam)], [t('battleDataAdmin.team1'), sideName(detail.battle.team1Spawn)], [t('battleDataAdmin.team2'), sideName(detail.battle.team2Spawn)]]" :key="String(key)"><dt>{{ key }}</dt><dd>{{ value }}</dd></template>
          </dl>
        </section>
        <p v-if="detail.vehicles.length !== 14 || detail.vehicles.filter(v => v.team === 1).length !== 7 || detail.vehicles.filter(v => v.team === 2).length !== 7" class="admin-list-warn" role="alert">{{ t('battleDataAdmin.invalidRows') }}</p>
        <section v-for="team in [1, 2]" :key="team" class="admin-list-section">
          <h3 class="admin-list-section-title">{{ winner(team) }} · {{ t('battleDataAdmin.spawn') }}: {{ sideName(team === 1 ? detail.battle.team1Spawn : detail.battle.team2Spawn) }}</h3>
          <ul class="battle-vehicles"><li v-for="row in detail.vehicles.filter(v => v.team === team)" :key="row.slot">{{ t('battleDataAdmin.slot') }} {{ row.slot }} · {{ t('battleDataAdmin.vehicle') }} #{{ row.vehicleId }}</li></ul>
        </section>
      </template>
    </AdminDetailDrawer>
  </section>
</template>

<style scoped>
.battle-admin { max-inline-size: var(--content-max); margin-inline: auto; }
.battle-h2 { margin: var(--space-5) 0 var(--space-2); font: var(--type-h3); }
.battle-meta, .share-row { font-variant-numeric: tabular-nums; }
.battle-meta { margin: 0 0 var(--space-3); }
.battle-visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.battle-table-gap + .battle-table-gap { margin-block-start: var(--space-4); }
.section-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-4); }
.map-name, .raw-key { display: block; }
.raw-key { color: var(--color-text-secondary); font: var(--type-caption); }

.kpis, .distributions { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--metric-card-min), 1fr)); gap: var(--space-3); }
.kpi { display: grid; gap: var(--space-1); padding: var(--space-3) var(--space-4); border: var(--border-width) solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); }
.kpi > span { color: var(--color-text-secondary); font: var(--type-caption); }
.kpi > strong { font: var(--type-h2); font-variant-numeric: tabular-nums; }
.insights { display: grid; gap: var(--space-4); margin-block-start: var(--space-4); }
.insights > * { min-inline-size: 0; }
.battle-card { padding: var(--space-3) var(--space-4); border: var(--border-width) solid var(--color-card-border); border-radius: var(--radius-lg); background: var(--color-card); }
.battle-card .battle-h2 { margin-block-start: 0; }

.trend { display: flex; align-items: stretch; gap: var(--space-1); margin: 0; padding: 0; overflow-x: auto; list-style: none; }
.trend-col { position: relative; display: grid; flex: 1 0 var(--space-6); grid-template-rows: auto var(--chart-bar-h) auto; justify-items: center; gap: var(--space-1); min-inline-size: var(--space-6); font: var(--type-caption); font-variant-numeric: tabular-nums; }
.trend-count { color: var(--color-text-secondary); }
.trend-track { display: flex; align-items: end; inline-size: 100%; block-size: var(--chart-bar-h); background: var(--color-surface-2); border-radius: var(--radius-sm); overflow: hidden; }
.bar { display: block; inline-size: 100%; block-size: var(--bar-share, 0%); background: var(--color-accent); border-radius: var(--radius-sm); }
.trend-date { color: var(--color-text-secondary); }

.share-row { display: grid; gap: var(--space-1); margin: 0 0 var(--space-2); }
.share-track { display: block; block-size: var(--space-1); border-radius: var(--radius-full); corner-shape: round; background: var(--color-surface-2); overflow: hidden; }
.share-fill { display: block; inline-size: var(--share, 0%); block-size: 100%; background: var(--color-accent); }

.spawn-cell { min-inline-size: calc(var(--control-h-md) * 4); }
.spawn-bar { box-sizing: border-box; display: flex; inline-size: 100%; min-inline-size: calc(var(--control-h-md) * 3); block-size: var(--space-3); border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-full); corner-shape: round; background: var(--color-surface-3); overflow: hidden; }
.spawn-seg { display: block; inline-size: var(--seg, 0%); block-size: 100%; }
.spawn-seg.is-first { background: var(--color-danger); }
.spawn-seg.is-draw { background: var(--color-border-strong); }
.spawn-seg.is-second { background: var(--color-info); }

.filters { margin: 0; }
.filters-advanced { flex: 1 0 100%; }
.filters-advanced-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--form-field-min), 1fr)); gap: var(--space-3); margin-block-start: var(--space-2); }
.battle-vehicles { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }

@media (width < 768px) {
  .admin-list-table tbody td.spawn-cell { flex-direction: column; gap: var(--space-1); }
}
@media (width >= 1200px) { .insights { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
</style>
