<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../api/admin-battle-data.js'
import { mapCoverage } from '../app/battleDataCoverage.js'
import AppDialog from './AppDialog.vue'

const { t, te, locale } = useI18n()
const gate = useFeatureGate()
const availability = computed(() => gate.availability(Feature.ADMIN_BATTLE_DATA))
const summary = ref<api.Summary | null>(null)
const battles = ref<api.BattlePage['items']>([])
const nextCursor = ref<string | null>(null)
const detail = ref<api.BattleDetail | null>(null)
const dialogOpen = ref(false)
const range = ref('7d')
const filters = ref({ arenaId: '', mapKey: '', arenaBonusType: '', clientVersion: '', winnerTeam: '', from: '', to: '' })
const applied = ref<api.Query>({})
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
  loading.value = true; moreLoading.value = false; summaryError.value = ''; listError.value = ''
  // Invalidate the previous page before the replacement request settles: the old cursor/filter must not
  // be able to append a stale page while summary/list are switching ranges.
  nextCursor.value = null
  applied.value = {}
  const interval = rangeQuery()
  currentInterval.value = interval
  let query: api.Query
  try { query = filterQuery(interval) } catch { listError.value = t('battleDataAdmin.error'); loading.value = false; return }
  const [a, b] = await Promise.allSettled([api.getSummary(interval), api.getBattles(query)])
  if (generation !== summaryGeneration) return
  if (a.status === 'fulfilled') { summary.value = a.value; summaryInterval.value = interval; refreshed.value = new Date().toISOString() } else summaryError.value = explain(a.reason)
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
      <button type="button" :disabled="!availability.available || loading" @click="refresh">{{ t('battleDataAdmin.refresh') }}</button></header>
    <p class="notice">{{ t('battleDataAdmin.acceptedNotice') }}</p><p class="notice bias">{{ t('battleDataAdmin.biasNotice') }}</p>
    <p v-if="!availability.pending && !availability.available" data-testid="battle-offline">{{ t(availability.messageKey!) }}</p>
    <label>{{ t('battleDataAdmin.range') }} <select v-model="range" :disabled="!availability.available || loading" @change="refresh"><option value="24h">24h</option><option value="7d">7d</option><option value="30d">30d</option><option value="all">{{ t('battleDataAdmin.all') }}</option></select></label>
    <p v-if="refreshed">{{ t('battleDataAdmin.lastRefresh') }}: {{ time(refreshed) }}</p>
    <p v-if="loading">{{ t('battleDataAdmin.loading') }}</p><p v-if="summaryError" role="alert">{{ t('battleDataAdmin.error') }} {{ summaryError }}</p>
    <template v-if="summary">
      <h2>{{ t('battleDataAdmin.overview') }}</h2><div class="kpis">
        <div v-for="[label,value] in [[t('battleDataAdmin.total'),summary.totalBattles],[t('battleDataAdmin.last24'),summary.last24Hours],[t('battleDataAdmin.last7'),summary.last7Days],[t('battleDataAdmin.last30'),summary.last30Days],[t('battleDataAdmin.window'),summary.windowBattles],[t('battleDataAdmin.mapsObserved'),summary.distinctMaps],[t('battleDataAdmin.versions'),summary.distinctClientVersions]]" :key="String(label)"><span>{{ label }}</span><strong>{{ value }}</strong></div>
        <div><span>{{ t('battleDataAdmin.latest') }}</span><strong>{{ time(summary.latestReceivedAt) }}</strong></div>
      </div>
      <p v-if="summary.totalBattles === 0">{{ t('battleDataAdmin.empty') }}</p>
      <h2>{{ t('battleDataAdmin.trend') }}</h2><ul class="trend"><li v-for="row in trendRows" :key="row.key" class="trend-row"><span>{{ row.key }}</span><span class="trend-track"><span class="bar" :style="{ '--bar-share': `${Math.max(0, 100 * row.count / Math.max(1, ...trendRows.map(x => x.count)))}%` }" /></span><span>{{ row.count }}</span></li></ul>
      <div class="distributions"><section><h2>{{ t('battleDataAdmin.modes') }}</h2><p v-for="row in modeRows" :key="row.key">{{ mode(row.key) }}: {{ row.count }} ({{ share(row.count) }})</p></section>
        <section><h2>{{ t('battleDataAdmin.winners') }}</h2><p v-for="row in winnerRows" :key="row.key">{{ winner(row.key) }}: {{ row.count }} ({{ share(row.count) }})</p></section>
        <section><h2>{{ t('battleDataAdmin.schema') }}</h2><p v-for="row in summary.schemaVersions" :key="row.key">v{{ row.key }}: {{ row.count }}</p></section>
        <section><h2>{{ t('battleDataAdmin.versions') }}</h2><p v-for="row in summary.clientVersions" :key="row.key">{{ row.key }}: {{ row.count }} ({{ share(row.count) }}) · {{ time(row.latestReceivedAt) }}</p></section></div>
      <h2>{{ t('battleDataAdmin.maps') }}</h2><p class="coverage-summary">{{ t('battleDataAdmin.reviewedMaps') }}: {{ coverage.reviewed.length }} · {{ t('battleDataAdmin.mapsObserved') }}: {{ observedMapCount }} · {{ t('battleDataAdmin.reviewedZero') }}: {{ reviewedZeroCount }}</p><div class="table-wrap"><table><thead><tr><th>{{ t('battleDataAdmin.map') }}</th><th>{{ t('battleDataAdmin.count') }}</th><th>{{ t('battleDataAdmin.share') }}</th><th>{{ t('battleDataAdmin.latest') }}</th></tr></thead><tbody>
        <tr v-for="row in coverage.reviewed" :key="row.key"><td>{{ row.key }}</td><td>{{ row.count }}</td><td>{{ share(row.count) }}</td><td>{{ time(row.latest) }}</td></tr>
        <tr v-for="row in coverage.other" :key="row.key"><td>{{ row.key }} ({{ t('battleDataAdmin.observedOnly') }})</td><td>{{ row.count }}</td><td>{{ share(row.count) }}</td><td>{{ time(row.latestReceivedAt) }}</td></tr></tbody></table></div>
      <details><summary>{{ t('battleDataAdmin.unknown') }} ({{ coverage.unresolved.length }})</summary><p>{{ coverage.unresolved.join(', ') }}</p></details>
    </template>
    <h2>{{ t('battleDataAdmin.recent') }}</h2><form class="filters" @submit.prevent="applyFilters">
      <label>{{ t('battleDataAdmin.arenaId') }}<input v-model="filters.arenaId" /></label><label>{{ t('battleDataAdmin.map') }}<input v-model="filters.mapKey" /></label>
      <label>{{ t('battleDataAdmin.mode') }}<select v-model="filters.arenaBonusType"><option value="">{{ t('battleDataAdmin.all') }}</option><option value="1">{{ mode(1) }}</option><option value="7">{{ mode(7) }}</option></select></label>
      <label>{{ t('battleDataAdmin.version') }}<input v-model="filters.clientVersion" /></label><label>{{ t('battleDataAdmin.winner') }}<select v-model="filters.winnerTeam"><option value="">{{ t('battleDataAdmin.all') }}</option><option value="0">{{ winner(0) }}</option><option value="1">{{ winner(1) }}</option><option value="2">{{ winner(2) }}</option></select></label>
      <label>{{ t('battleDataAdmin.from') }}<input v-model="filters.from" type="datetime-local" /></label><label>{{ t('battleDataAdmin.to') }}<input v-model="filters.to" type="datetime-local" /></label>
      <button :disabled="!availability.available || moreLoading">{{ t('battleDataAdmin.apply') }}</button></form>
    <p v-if="listError" role="alert">{{ t('battleDataAdmin.error') }} {{ listError }}</p><p v-if="!loading && !battles.length && summary?.totalBattles">{{ t('battleDataAdmin.emptyFilter') }}</p>
    <div class="table-wrap"><table data-testid="recent-battles"><thead><tr><th>{{ t('battleDataAdmin.received') }}</th><th>{{ t('battleDataAdmin.arenaId') }}</th><th>{{ t('battleDataAdmin.mode') }}</th><th>{{ t('battleDataAdmin.map') }}</th><th>{{ t('battleDataAdmin.version') }}</th><th>{{ t('battleDataAdmin.winner') }}</th><th>{{ t('battleDataAdmin.spawn') }}</th><th /></tr></thead><tbody>
      <tr v-for="battle in battles" :key="battle.id"><td>{{ time(battle.receivedAt) }}</td><td>{{ battle.arenaId }}</td><td>{{ mode(battle.arenaBonusType) }}</td><td>{{ battle.mapKey }}</td><td>{{ battle.clientVersion }}</td><td>{{ winner(battle.winnerTeam) }}</td><td>{{ battle.team1Spawn }} / {{ battle.team2Spawn }}</td><td><button :disabled="!availability.available" @click="openDetail(battle.id)">{{ t('battleDataAdmin.view') }}</button></td></tr></tbody></table></div>
    <button v-if="nextCursor || (loading && battles.length)" :disabled="!availability.available || loading || moreLoading || !nextCursor" @click="loadMore">{{ t('battleDataAdmin.loadMore') }}</button>
    <AppDialog :open="dialogOpen" :title="t('battleDataAdmin.detail')" size="lg" @close="closeDetail">
      <p v-if="detailLoading">{{ t('battleDataAdmin.loading') }}</p><p v-if="detailError" role="alert">{{ t('battleDataAdmin.detailError') }} {{ detailError }}</p>
      <template v-if="detail"><dl><template v-for="[key,value] in [[t('battleDataAdmin.arenaId'),detail.battle.arenaId],[t('battleDataAdmin.received'),time(detail.battle.receivedAt)],[t('battleDataAdmin.schemaVersion'),detail.battle.schemaVersion],[t('battleDataAdmin.mode'),mode(detail.battle.arenaBonusType)],[t('battleDataAdmin.mapId'),detail.battle.mapId],[t('battleDataAdmin.map'),detail.battle.mapKey],[t('battleDataAdmin.version'),detail.battle.clientVersion],[t('battleDataAdmin.winner'),winner(detail.battle.winnerTeam)],[t('battleDataAdmin.team1'),detail.battle.team1Spawn],[t('battleDataAdmin.team2'),detail.battle.team2Spawn]]" :key="String(key)"><dt>{{ key }}</dt><dd>{{ value }}</dd></template></dl>
        <p v-if="detail.vehicles.length !== 14 || detail.vehicles.filter(v => v.team === 1).length !== 7 || detail.vehicles.filter(v => v.team === 2).length !== 7" role="alert">{{ t('battleDataAdmin.invalidRows') }}</p>
        <section v-for="team in [1,2]" :key="team"><h3>{{ winner(team) }} · {{ t('battleDataAdmin.spawn') }}: {{ team === 1 ? detail.battle.team1Spawn : detail.battle.team2Spawn }}</h3><ul><li v-for="row in detail.vehicles.filter(v => v.team === team)" :key="row.slot">{{ t('battleDataAdmin.slot') }} {{ row.slot }} · {{ t('battleDataAdmin.vehicle') }} #{{ row.vehicleId }}</li></ul></section></template>
    </AppDialog>
  </section>
</template>
<style scoped>
.battle-admin { max-inline-size: var(--content-max); margin-inline: auto; padding: var(--space-6); }
.page-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-4); }
.notice { padding: var(--space-3); border-inline-start: var(--space-1) solid var(--color-accent); background: var(--color-surface-1); }
.bias { border-color: var(--color-warning); }
.kpis, .distributions, .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--metric-card-min), 1fr)); gap: var(--space-3); }
.kpis > div { display: grid; gap: var(--space-1); padding: var(--space-3); border: var(--border-width) solid var(--color-border-subtle); border-radius: var(--radius-md); }
.filters label { display: grid; gap: var(--space-1); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: var(--space-2); border-bottom: var(--border-width) solid var(--color-border-subtle); text-align: start; }
.trend { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.trend-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--space-2); }
.trend-track { display: block; block-size: var(--space-1); background: var(--color-surface-2); }
.bar { display: block; block-size: 100%; inline-size: var(--bar-share, 0%); background: var(--color-accent); }
dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-1) var(--space-4); }
dd { margin: 0; overflow-wrap: anywhere; }
</style>
