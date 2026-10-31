<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../api/admin-battle-data.js'
import { mapCoverage, spawnSideKey, spawnTables, type SpawnMode } from '../app/battleDataCoverage.js'
import { mapLabel } from '../utils/helpers.js'
import AppDialog from './AppDialog.vue'
import SegmentedControl from './SegmentedControl.vue'

const { t, te, locale } = useI18n()
const gate = useFeatureGate()
const availability = computed(() => gate.availability(Feature.ADMIN_BATTLE_DATA))
const summary = ref<api.Summary | null>(null)
const spawnStats = ref<api.SpawnStats | null>(null)
const battles = ref<api.BattlePage['items']>([])
const nextCursor = ref<string | null>(null)
const detail = ref<api.BattleDetail | null>(null)
const dialogOpen = ref(false)
const range = ref('7d')
const spawnMode = ref<SpawnMode>('ALL')
const filters = ref({ arenaId: '', mapKey: '', arenaBonusType: '', clientVersion: '', winnerTeam: '', from: '', to: '' })
const applied = ref<api.Query>({})
const currentInterval = ref<api.Query>({})
const summaryInterval = ref<api.Query>({})
const refreshed = ref<string | null>(null)
const loading = ref(false)
const moreLoading = ref(false)
const detailLoading = ref(false)
const summaryError = ref('')
const spawnError = ref('')
const listError = ref('')
const detailError = ref('')
let summaryGeneration = 0, listGeneration = 0, detailGeneration = 0
const coverage = computed(() => mapCoverage(summary.value?.maps || []))
const modeRows = computed(() => [1, 7].map(key => ({ key, count: summary.value?.modes.find(row => row.key === key)?.count ?? 0 })))
const winnerRows = computed(() => [0, 1, 2].map(key => ({ key, count: summary.value?.winnerTeams.find(row => row.key === key)?.count ?? 0 })))
const observedMapCount = computed(() => summary.value?.maps.length ?? 0)
const spawnGroups = computed(() => (spawnStats.value ? spawnTables(coverage.value, spawnStats.value, spawnMode.value) : []).map(table => ({
  ...table,
  rows: [...table.rows].sort((a, b) => b.battles - a.battles || mapName(a.key).localeCompare(mapName(b.key), locale.value)),
})))
const spawnModes = computed(() => [
  { value: 'ALL', label: t('battleDataAdmin.all'), testid: 'spawn-mode-all' },
  { value: 'RANDOM', label: mode(1), testid: 'spawn-mode-random' },
  { value: 'RATING', label: mode(7), testid: 'spawn-mode-rating' },
])
const mapOptions = computed(() => {
  // Advanced from/to reach outside the summary window, so the universe cannot be limited to that window.
  const keys = new Set([...coverage.value.reviewed, ...coverage.value.other].map(row => row.key))
  if (filters.value.mapKey) keys.add(filters.value.mapKey)
  return [...keys].sort((a, b) => mapName(a).localeCompare(mapName(b), locale.value))
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
function filterQuery(base: api.Query) {
  return { ...base, arenaId: filters.value.arenaId.trim(), mapKey: filters.value.mapKey.trim(),
    arenaBonusType: filters.value.arenaBonusType, clientVersion: filters.value.clientVersion.trim(), winnerTeam: filters.value.winnerTeam,
    ...(filters.value.from ? { from: utc(filters.value.from) } : {}), ...(filters.value.to ? { to: utc(filters.value.to) } : {}) }
}
async function refresh() {
  if (!gate.requireFeature(Feature.ADMIN_BATTLE_DATA)) return
  const generation = ++summaryGeneration
  const currentListGeneration = ++listGeneration
  loading.value = true; moreLoading.value = false; summaryError.value = ''; spawnError.value = ''; listError.value = ''
  // Invalidate the previous page before the replacement request settles: the old cursor/filter must not
  // be able to append a stale page while summary/list are switching ranges.
  nextCursor.value = null
  applied.value = {}
  const interval = rangeQuery()
  currentInterval.value = interval
  let query: api.Query
  try { query = filterQuery(interval) } catch { listError.value = t('battleDataAdmin.error'); loading.value = false; return }
  const [a, b, c] = await Promise.allSettled([api.getSummary(interval), api.getBattles(query), api.getSpawnStats(interval)])
  if (generation !== summaryGeneration) return
  if (a.status === 'fulfilled') { summary.value = a.value; summaryInterval.value = interval; refreshed.value = new Date().toISOString() } else summaryError.value = explain(a.reason)
  // Spawn stats are a separate read: a backend without them must not take the rest of the page down.
  if (c.status === 'fulfilled') spawnStats.value = c.value
  else { spawnStats.value = null; spawnError.value = explain(c.reason) }
  if (currentListGeneration === listGeneration) {
    if (b.status === 'fulfilled') { applied.value = query; battles.value = b.value.items; nextCursor.value = b.value.nextCursor } else listError.value = explain(b.reason)
  }
  loading.value = false
}
async function applyFilters() {
  if (!gate.requireFeature(Feature.ADMIN_BATTLE_DATA)) return
  const generation = ++listGeneration
  listError.value = ''; moreLoading.value = true
  try {
    const next = filterQuery(currentInterval.value)
    const page = await api.getBattles(next)
    if (generation !== listGeneration) return
    applied.value = next; battles.value = page.items; nextCursor.value = page.nextCursor
  } catch (error) { if (generation === listGeneration) listError.value = explain(error) }
  finally { if (generation === listGeneration) moreLoading.value = false }
}
async function loadMore() {
  if (!nextCursor.value || loading.value || moreLoading.value || !gate.requireFeature(Feature.ADMIN_BATTLE_DATA)) return
  const generation = ++listGeneration
  moreLoading.value = true; listError.value = ''
  try {
    const page = await api.getBattles({ ...applied.value, cursor: nextCursor.value })
    if (generation !== listGeneration) return
    battles.value = [...battles.value, ...page.items]; nextCursor.value = page.nextCursor
  } catch (error) { if (generation === listGeneration) listError.value = explain(error) }
  finally { if (generation === listGeneration) moreLoading.value = false }
}
async function openDetail(id: string) {
  if (!gate.requireFeature(Feature.ADMIN_BATTLE_DATA)) return
  const generation = ++detailGeneration
  detail.value = null; detailError.value = ''; detailLoading.value = true; dialogOpen.value = true
  try { const value = await api.getBattle(id); if (generation === detailGeneration) detail.value = value }
  catch (error) { if (generation === detailGeneration) detailError.value = explain(error) }
  finally { if (generation === detailGeneration) detailLoading.value = false }
}
function closeDetail() { ++detailGeneration; dialogOpen.value = false; detailLoading.value = false }
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
function share(count: number) { return summary.value?.windowBattles ? `${(100 * count / summary.value.windowBattles).toFixed(1)}%` : '0%' }
function mode(n: number) { return t(n === 1 ? 'battleDataAdmin.random' : 'battleDataAdmin.rating') }
function mapName(key: string) { return mapLabel(key, locale.value) }
function sideName(side: api.SpawnStats['items'][number]['side']) { return t(`battleDataAdmin.side.${spawnSideKey(side)}`) }
function rate(count: number, battles: number) { return battles ? `${(100 * count / battles).toFixed(1)}%` : '—' }
function winner(n: number) {
  if (n === 0) return t('battleDataAdmin.draw')
  if (n === 1) return t('battleDataAdmin.team1')
  return t('battleDataAdmin.team2')
}
let initialAttempted = false
watch(availability, (state) => {
  if (!initialAttempted && state.available) { initialAttempted = true; void refresh() }
}, { immediate: true })
onBeforeUnmount(() => { ++summaryGeneration; ++listGeneration; ++detailGeneration })
</script>

<template>
  <section class="battle-admin">
    <header class="page-head"><div><h1>{{ t('battleDataAdmin.title') }}</h1><p>{{ t('battleDataAdmin.description') }}</p></div>
      <div class="page-actions"><label>{{ t('battleDataAdmin.range') }} <select v-model="range" :disabled="!availability.available || loading" @change="refresh"><option value="24h">24h</option><option value="7d">7d</option><option value="30d">30d</option><option value="all">{{ t('battleDataAdmin.all') }}</option></select></label>
        <button type="button" :disabled="!availability.available || loading" @click="refresh">{{ t('battleDataAdmin.refresh') }}</button></div></header>
    <ul class="notice"><li>{{ t('battleDataAdmin.acceptedNotice') }}</li><li>{{ t('battleDataAdmin.biasNotice') }}</li></ul>
    <p v-if="!availability.pending && !availability.available" data-testid="battle-offline">{{ t(availability.messageKey!) }}</p>
    <p v-if="loading">{{ t('battleDataAdmin.loading') }}</p><p v-if="summaryError" role="alert">{{ t('battleDataAdmin.error') }} {{ summaryError }}</p>
    <template v-if="summary">
      <h2>{{ t('battleDataAdmin.overview') }}</h2><div class="kpis">
        <div v-for="[label,value] in [[t('battleDataAdmin.total'),summary.totalBattles],[t('battleDataAdmin.last24'),summary.last24Hours],[t('battleDataAdmin.last7'),summary.last7Days],[t('battleDataAdmin.last30'),summary.last30Days],[t('battleDataAdmin.mapsObserved'),summary.distinctMaps],[t('battleDataAdmin.versions'),summary.distinctClientVersions]]" :key="String(label)"><span>{{ label }}</span><strong>{{ value }}</strong></div>
      </div>
      <p class="meta">{{ t('battleDataAdmin.window') }}: {{ summary.windowBattles }} · {{ t('battleDataAdmin.latest') }}: {{ time(summary.latestReceivedAt) }}<template v-if="refreshed"> · {{ t('battleDataAdmin.lastRefresh') }}: {{ time(refreshed) }}</template></p>
      <p v-if="summary.totalBattles === 0">{{ t('battleDataAdmin.empty') }}</p>
      <div class="insights"><section><h2>{{ t('battleDataAdmin.trend') }}</h2><ul class="trend"><li v-for="row in trendRows" :key="row.key" class="trend-row"><span>{{ row.key }}</span><span class="trend-track"><span class="bar" :style="{ '--bar-share': `${Math.max(0, 100 * row.count / Math.max(1, ...trendRows.map(x => x.count)))}%` }" /></span><span>{{ row.count }}</span></li></ul></section>
        <div class="distributions"><section><h2>{{ t('battleDataAdmin.modes') }}</h2><p v-for="row in modeRows" :key="row.key">{{ mode(row.key) }}: {{ row.count }} ({{ share(row.count) }})</p></section>
          <section><h2>{{ t('battleDataAdmin.winners') }}</h2><p v-for="row in winnerRows" :key="row.key">{{ winner(row.key) }}: {{ row.count }} ({{ share(row.count) }})</p></section>
          <section><h2>{{ t('battleDataAdmin.schema') }}</h2><p v-for="row in summary.schemaVersions" :key="row.key">v{{ row.key }}: {{ row.count }}</p></section>
          <section><h2>{{ t('battleDataAdmin.versions') }}</h2><p v-for="row in summary.clientVersions" :key="row.key">{{ row.key }}: {{ row.count }} ({{ share(row.count) }}) · {{ time(row.latestReceivedAt) }}</p></section></div></div>
      <div class="section-head"><h2>{{ t('battleDataAdmin.spawnStats') }}</h2><SegmentedControl v-model="spawnMode" :options="spawnModes" :ariaLabel="t('battleDataAdmin.mode')" /></div>
      <p class="meta">{{ t('battleDataAdmin.spawnRateNote') }}</p>
      <p class="meta">{{ t('battleDataAdmin.reviewedMaps') }}: {{ coverage.reviewed.length }} · {{ t('battleDataAdmin.mapsObserved') }}: {{ observedMapCount }} · {{ t('battleDataAdmin.reviewedZero') }}: {{ reviewedZeroCount }}</p>
      <p v-if="spawnError" role="alert">{{ t('battleDataAdmin.error') }} {{ spawnError }}</p>
      <div v-for="table in spawnGroups" :key="table.axis[0]" class="table-wrap"><table data-testid="spawn-stats"><thead><tr><th>{{ t('battleDataAdmin.map') }}</th><th class="num">{{ t('battleDataAdmin.sample') }}</th><th v-for="side in table.axis" :key="side" class="num">{{ t('battleDataAdmin.sideWinRate', { side: sideName(side) }) }}</th><th class="num">{{ t('battleDataAdmin.drawRate') }}</th><th>{{ t('battleDataAdmin.latestData') }}</th></tr></thead><tbody>
        <tr v-for="row in table.rows" :key="row.key"><td><span class="map-name">{{ mapName(row.key) }}</span><small class="raw-key">{{ row.key }}<template v-if="row.observedOnly"> · {{ t('battleDataAdmin.observedOnly') }}</template></small></td><td class="num">{{ row.battles }}</td>
          <td v-for="side in row.sides" :key="side.side" class="num" :title="t('battleDataAdmin.outcomes', { wins: side.wins, draws: side.draws, losses: side.losses })">{{ side.battles ? `${rate(side.wins, side.battles)} · ${side.wins}/${side.battles}` : '—' }}</td>
          <td class="num">{{ rate(row.draws, row.battles) }}</td><td>{{ time(row.latest) }}</td></tr></tbody></table></div>
    </template>
    <h2>{{ t('battleDataAdmin.recent') }}</h2><form class="filters" @submit.prevent="applyFilters">
      <div class="filter-row"><label>{{ t('battleDataAdmin.map') }}<select v-model="filters.mapKey" data-testid="map-filter"><option value="">{{ t('battleDataAdmin.allMaps') }}</option><option v-for="key in mapOptions" :key="key" :value="key">{{ mapName(key) }}</option></select></label>
        <label>{{ t('battleDataAdmin.mode') }}<select v-model="filters.arenaBonusType"><option value="">{{ t('battleDataAdmin.all') }}</option><option value="1">{{ mode(1) }}</option><option value="7">{{ mode(7) }}</option></select></label>
        <label>{{ t('battleDataAdmin.version') }}<input v-model="filters.clientVersion" /></label><label>{{ t('battleDataAdmin.winner') }}<select v-model="filters.winnerTeam"><option value="">{{ t('battleDataAdmin.all') }}</option><option value="0">{{ winner(0) }}</option><option value="1">{{ winner(1) }}</option><option value="2">{{ winner(2) }}</option></select></label></div>
      <details><summary>{{ t('battleDataAdmin.advanced') }}</summary><div class="filter-row"><label>{{ t('battleDataAdmin.arenaId') }}<input v-model="filters.arenaId" /></label><label>{{ t('battleDataAdmin.from') }}<input v-model="filters.from" type="datetime-local" /></label><label>{{ t('battleDataAdmin.to') }}<input v-model="filters.to" type="datetime-local" /></label></div></details>
      <button :disabled="!availability.available || moreLoading">{{ t('battleDataAdmin.apply') }}</button></form>
    <p v-if="listError" role="alert">{{ t('battleDataAdmin.error') }} {{ listError }}</p><p v-if="!loading && !battles.length && summary?.totalBattles">{{ t('battleDataAdmin.emptyFilter') }}</p>
    <div class="table-wrap"><table data-testid="recent-battles"><thead><tr><th>{{ t('battleDataAdmin.received') }}</th><th>{{ t('battleDataAdmin.arenaId') }}</th><th>{{ t('battleDataAdmin.mode') }}</th><th>{{ t('battleDataAdmin.map') }}</th><th>{{ t('battleDataAdmin.version') }}</th><th>{{ t('battleDataAdmin.winner') }}</th><th>{{ t('battleDataAdmin.spawn') }}</th><th /></tr></thead><tbody>
      <tr v-for="battle in battles" :key="battle.id"><td>{{ time(battle.receivedAt) }}</td><td>{{ battle.arenaId }}</td><td>{{ mode(battle.arenaBonusType) }}</td><td><span class="map-name">{{ mapName(battle.mapKey) }}</span><small class="raw-key">{{ battle.mapKey }}</small></td><td>{{ battle.clientVersion }}</td><td>{{ winner(battle.winnerTeam) }}</td><td>{{ sideName(battle.team1Spawn) }} / {{ sideName(battle.team2Spawn) }}</td><td><button :disabled="!availability.available" @click="openDetail(battle.id)">{{ t('battleDataAdmin.view') }}</button></td></tr></tbody></table></div>
    <button v-if="nextCursor || (loading && battles.length)" :disabled="!availability.available || loading || moreLoading || !nextCursor" @click="loadMore">{{ t('battleDataAdmin.loadMore') }}</button>
    <AppDialog :open="dialogOpen" :title="t('battleDataAdmin.detail')" size="lg" @close="closeDetail">
      <p v-if="detailLoading">{{ t('battleDataAdmin.loading') }}</p><p v-if="detailError" role="alert">{{ t('battleDataAdmin.detailError') }} {{ detailError }}</p>
      <template v-if="detail"><dl><template v-for="[key,value] in [[t('battleDataAdmin.arenaId'),detail.battle.arenaId],[t('battleDataAdmin.received'),time(detail.battle.receivedAt)],[t('battleDataAdmin.schemaVersion'),detail.battle.schemaVersion],[t('battleDataAdmin.mode'),mode(detail.battle.arenaBonusType)],[t('battleDataAdmin.mapId'),detail.battle.mapId],[t('battleDataAdmin.map'),`${mapName(detail.battle.mapKey)} (${detail.battle.mapKey})`],[t('battleDataAdmin.version'),detail.battle.clientVersion],[t('battleDataAdmin.winner'),winner(detail.battle.winnerTeam)],[t('battleDataAdmin.team1'),sideName(detail.battle.team1Spawn)],[t('battleDataAdmin.team2'),sideName(detail.battle.team2Spawn)]]" :key="String(key)"><dt>{{ key }}</dt><dd>{{ value }}</dd></template></dl>
        <p v-if="detail.vehicles.length !== 14 || detail.vehicles.filter(v => v.team === 1).length !== 7 || detail.vehicles.filter(v => v.team === 2).length !== 7" role="alert">{{ t('battleDataAdmin.invalidRows') }}</p>
        <section v-for="team in [1,2]" :key="team"><h3>{{ winner(team) }} · {{ t('battleDataAdmin.spawn') }}: {{ sideName(team === 1 ? detail.battle.team1Spawn : detail.battle.team2Spawn) }}</h3><ul><li v-for="row in detail.vehicles.filter(v => v.team === team)" :key="row.slot">{{ t('battleDataAdmin.slot') }} {{ row.slot }} · {{ t('battleDataAdmin.vehicle') }} #{{ row.vehicleId }}</li></ul></section></template>
    </AppDialog>
  </section>
</template>
<style scoped>
.battle-admin { max-inline-size: var(--content-max); margin-inline: auto; padding: var(--space-6); }
.page-head, .page-actions, .section-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-4); }
.notice { display: grid; gap: var(--space-1); margin: 0; padding: var(--space-3); padding-inline-start: var(--space-6); border-inline-start: var(--space-1) solid var(--color-warning); background: var(--color-surface-1); }
.meta, .raw-key { color: var(--color-text-secondary); }
.kpis, .distributions, .filter-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--metric-card-min), 1fr)); gap: var(--space-3); }
.insights { display: grid; gap: var(--space-4); }
.insights > *, .filter-row > * { min-inline-size: 0; }
.filters { display: grid; gap: var(--space-3); justify-items: start; margin-block-end: var(--space-3); }
.filter-row, .filters details { inline-size: 100%; }
.filters input, .filters select { inline-size: 100%; }
.map-name, .raw-key { display: block; }
.kpis > div { display: grid; gap: var(--space-1); padding: var(--space-3); border: var(--border-width) solid var(--color-border-subtle); border-radius: var(--radius-md); }
.filters label { display: grid; gap: var(--space-1); }
.filters details .filter-row { margin-block-start: var(--space-2); }
.table-wrap { overflow-x: auto; margin-block-end: var(--space-3); }
table { width: 100%; border-collapse: collapse; }
th, td { padding: var(--space-2); border-bottom: var(--border-width) solid var(--color-border-subtle); text-align: start; }
th.num, td.num { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
.trend { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.trend-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--space-2); }
.trend-track { display: block; block-size: var(--space-1); background: var(--color-surface-2); }
.bar { display: block; block-size: 100%; inline-size: var(--bar-share, 0%); background: var(--color-accent); }
@media (width >= 1200px) { .insights { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-1) var(--space-4); }
dd { margin: 0; overflow-wrap: anywhere; }
</style>
