<script setup>
import { ref, computed, watch, nextTick, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import { replayAggregatePlayerCount } from '../utils/replayView.js'
import { useReplay } from '../composables/useReplay.js'
import { useColumns } from '../composables/useColumns.js'
import ColumnPicker from './ColumnPicker.vue'
import AggregateTable from './AggregateTable.vue'
import BattleTable from './BattleTable.vue'
import LeagueSummaryTable from './LeagueSummaryTable.vue'
import CwPlayerSummaryTable from './CwPlayerSummaryTable.vue'
import PlayerDetailDrawer from './PlayerDetailDrawer.vue'
import { mergeCwPlayerRows, mergeCwPlayerColumns } from '../utils/playerSummaryMerge.js'
import { BookOpen, Columns3, Download } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import BattlePicker from './BattlePicker.vue'
import MenuButton from './MenuButton.vue'
import SegmentedControl from './SegmentedControl.vue'
import SeriesOverview from './SeriesOverview.vue'
import { useReplayPngExport } from './replay-workspace/useReplayPngExport.ts'
import { useReplayPlayerDrawer } from './replay-workspace/useReplayPlayerDrawer.ts'
import { battlePickerOptions, buildSeriesOverview } from '../utils/replaySeries.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'

defineOptions({ name: 'ReplayPage' })

const props = defineProps({
  embedded: { type: Boolean, default: false },
  replayContext: { type: Object, default: null },
  workspaceContext: { type: Object, default: null },
  active: { type: Boolean, default: true },
})
const { locale, t, te } = useI18n()
const replay = props.replayContext || useReplay()
const replayWorkspace = props.workspaceContext
const { files, loading, error, resp, activeTab, aggStats, selectionRevision, exportExcel } = replay
const leagueMode = computed(() => resp.value?.leagueMode === true)

const isSummaryView = computed(() =>
  replayWorkspace
    ? replayWorkspace.dataViewMode.value === 'SUMMARY'
    : activeTab.value === 'aggregate')
const currentSingleIndex = computed(() => {
  if (isSummaryView.value) return -1
  if (replayWorkspace) return replayWorkspace.currentBattleIndex.value
  const m = /^b(\d+)$/.exec(activeTab.value)
  return m ? parseInt(m[1], 10) : -1
})
const dataViewModeRef = computed(() => isSummaryView.value ? 'SUMMARY' : 'SINGLE')

const cols = useColumns(replay.playerCols, replay.aggCols, dataViewModeRef, leagueMode)
const { visibleKeys, aggVisibleKeys, cwVisibleKeys, cwOrder, playerOrder, aggOrder, colScope, showColPicker, pickerScope,
  currentOrder, shownCols, shownAggCols,
  toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder } = cols

watch(resp, (result) => {
  if (result) cols.initFromResponse(result)
}, { immediate: true })

function setDataView(mode) {
  showColPicker.value = false
  if (replayWorkspace) {
    replayWorkspace.setDataViewMode(mode)
    return
  }
  if (mode === 'SUMMARY') {
    if (activeTab.value !== 'aggregate') activeTab.value = 'aggregate'
    return
  }
  const idx = currentSingleIndex.value >= 0 ? currentSingleIndex.value : 0
  activeTab.value = `b${idx}`
}

const leagueData = computed(() => resp.value?.league || null)

const unifiedRows = computed(() => leagueMode.value
  ? mergeCwPlayerRows(resp.value?.aggregate || [], leagueData.value?.playerSummaries || [])
  : [])
const unifiedAllCols = computed(() => leagueMode.value
  ? mergeCwPlayerColumns(leagueData.value?.playerSummaryColumns || [], resp.value?.aggregateColumns || [])
  : [])
const unifiedShownCols = computed(() => {
  if (!leagueMode.value) return []
  const byKey = new Map(unifiedAllCols.value.map(c => [c.key, c]))
  return cwOrder.value
    .filter(k => cwVisibleKeys.value.includes(k))
    .map(k => byKey.get(k))
    .filter(Boolean)
})

const {
  selectedPlayerContext, navOrder, navIndex,
  selectPlayer, closeDrawer, hasPrevPlayer, hasNextPlayer, goPrevPlayer, goNextPlayer,
  drawerOpen, selectedPlayer, drawerPlayer, drawerScopePlayers,
} = useReplayPlayerDrawer({ unifiedRows, resp, selectionRevision, isSummaryView, currentSingleIndex })

const showLeagueFailures = ref(false)
const expandedLeagueGroups = ref({})

const ratedBattleCount = computed(() =>
  (resp.value?.battles || []).filter(b => !!b.league).length)

const leagueFailureGroups = computed(() => {
  const groups = {}
  for (const lf of leagueData.value?.failures || []) {
    if (!groups[lf.code]) groups[lf.code] = []
    groups[lf.code].push(lf)
  }
  return groups
})

function toggleLeagueFailures() {
  showLeagueFailures.value = !showLeagueFailures.value
}

function toggleLeagueGroup(code) {
  expandedLeagueGroups.value = { ...expandedLeagueGroups.value, [code]: !expandedLeagueGroups.value[code] }
}

const leagueUnavailableMessage = computed(() => {
  const code = resp.value?.leagueUnavailableCode
  if (!code) return ''
  return t('league.unavailable_mixed')
})
const aggregatePlayerCount = computed(() => replayAggregatePlayerCount(resp.value))

const hasSummaryView = computed(() => !!resp.value && (resp.value.aggregate.length > 0 || leagueMode.value))
const hasSingleView = computed(() => (resp.value?.battles?.length || 0) > 0)
const dataViewOptions = computed(() => [
  { value: 'SUMMARY', label: t('result.aggregate_tab', { count: aggregatePlayerCount.value }), testid: 'data-view-summary' },
  { value: 'SINGLE', label: t('result.single_tab'), testid: 'data-view-single' },
])
const series = computed(() => buildSeriesOverview(resp.value, summaryTeamNames.value, battleTeamNames.value))
const pickerOptions = computed(() => battlePickerOptions(series.value, { t, locale: locale.value, mapLabel }))
const currentSourceId = computed(() => resp.value?.battles?.[currentSingleIndex.value]?.sourceId ?? null)

function selectBattle(sourceId) {
  showColPicker.value = false
  if (replayWorkspace) {
    replayWorkspace.selectBattle(sourceId)
    return
  }
  const index = (resp.value?.battles || []).findIndex(b => String(b.sourceId) === String(sourceId))
  if (index >= 0) activeTab.value = `b${index}`
}

const { isCompact } = useBreakpoint()
const layoutChoice = ref('cards')
const dataLayout = computed(() => (isCompact.value ? layoutChoice.value : 'table'))
const layoutOptions = computed(() => [
  { value: 'cards', label: t('workspace.layout_cards'), testid: 'data-layout-cards' },
  { value: 'table', label: t('workspace.layout_table'), testid: 'data-layout-table' },
])

const columnCounts = computed(() => {
  if (colScope.value === 'cw') return { shown: unifiedShownCols.value.length, total: cwOrder.value.length }
  if (colScope.value === 'agg') return { shown: shownAggCols.value.length, total: aggOrder.value.length }
  return { shown: shownCols.value.length, total: playerOrder.value.length }
})

const exportingExcel = ref(false)
const exportItems = computed(() => [
  { key: 'aggregate', label: t('workspace.export_excel_summary'), disabled: exportingExcel.value, testid: 'export-aggregate' },
  { key: 'each', label: t('workspace.export_excel_each'), disabled: exportingExcel.value, testid: 'export-each' },
  { key: 'png', label: t('workspace.export_png'), testid: 'export-png' },
])

async function onExport(key) {
  if (key === 'png') {
    downloadResultPng()
    return
  }
  if (exportingExcel.value) return
  exportingExcel.value = true
  try {
    await exportExcel(key, teamNamesPayload())
  } catch (e) {
    console.error('[Replay Excel Export] failed', e)
    error.value = t('replay.excel_export_failed')
  } finally {
    exportingExcel.value = false
  }
}
const battleTeamNames = ref({})
const summaryTeamNames = ref({})

function updateBattleTeamName(payload) {
  if (!payload || !payload.arenaId) return
  const key = payload.arenaId + ':' + payload.team
  const name = (payload.name || '').trim()
  const next = { ...battleTeamNames.value }
  if (name) next[key] = name
  else delete next[key]
  battleTeamNames.value = next
}

function updateSummaryTeamName(payload) {
  if (!payload || !payload.teamKey) return
  const name = (payload.name || '').trim()
  const next = { ...summaryTeamNames.value }
  if (name) next[payload.teamKey] = name
  else delete next[payload.teamKey]
  summaryTeamNames.value = next
}

function teamNamesPayload() {
  const battle = battleTeamNames.value
  const summary = summaryTeamNames.value
  if (!Object.keys(battle).length && !Object.keys(summary).length) return null
  return { battle, summary }
}

watch(selectionRevision, () => {
  battleTeamNames.value = {}
  summaryTeamNames.value = {}
  battleSorts.value = []
})
const aggregateRef = ref(null)
const battleRefs = ref([])

function setBattleRef(el, index) {
  battleRefs.value[index] = el
}

const battleSorts = ref([])

function setBattleSort(index, patch) {
  const current = battleSorts.value[index] || { key: '', reverse: false }
  battleSorts.value[index] = { ...current, ...patch }
}

const { exportingPng, downloadResultPng } = useReplayPngExport({
  loading, error, isSummaryView, currentSingleIndex, resp, aggregateRef, battleRefs, t, locale, nextTick,
})

const navigate = inject(NAVIGATE_VIEW_KEY, null)

function openRatingDocs() {
  navigate && navigate('rating-docs')
}

</script>

<template>
  <div :class="props.embedded ? 'replay-data-embedded' : 'layout-data-workspace'">
    <template v-if="files.length || resp">
      <div>
        <template v-if="resp">
        <div class="result-notices">
        <Banner v-if="resp.duplicates.length" tone="warning" data-testid="result-duplicates">
          <p>{{ $t('result.duplicates', { count: resp.duplicates.length }) }}</p>
          <ul class="notice-files"><li v-for="(d, i) in resp.duplicates" :key="i">{{ d[0] }}</li></ul>
        </Banner>
        <Banner v-if="leagueUnavailableMessage" tone="warning" class="league-unavailable" data-testid="league-unavailable">
          <p>{{ leagueUnavailableMessage }}</p>
        </Banner>
        <Banner v-if="leagueData && leagueData.failures?.length" tone="warning" class="league-failure-summary" data-testid="league-failure-summary">
          <div class="league-failure-head">
            <span class="lf-title">{{ $t('league.title') }}</span>
            <span class="lf-rated">{{ $t('league.rated_count', { rated: ratedBattleCount, total: resp.battles.length }) }}</span>
            <span v-if="leagueData.failures?.length" class="lf-unrated">{{ $t('league.unrated_count', { count: resp.battles.length - ratedBattleCount }) }}</span>
            <button v-if="leagueData.failures?.length" class="lf-toggle" data-testid="league-failure-toggle" :aria-expanded="showLeagueFailures"
                    @click="toggleLeagueFailures">
              {{ showLeagueFailures ? $t('league.failure_hide') : $t('league.failure_view') }}
            </button>
          </div>
          <div v-if="showLeagueFailures && leagueData.failures?.length" class="league-failure-detail" data-testid="league-failure-detail">
            <div v-for="(group, code) in leagueFailureGroups" :key="code" class="league-failure-group">
              <button class="lf-group-head" data-testid="league-failure-group" :aria-expanded="!!expandedLeagueGroups[code]"
                      @click="toggleLeagueGroup(code)">
                {{ apiErrorLabel(t, te, { code }) }} · {{ group.length }}
              </button>
              <ul v-if="expandedLeagueGroups[code]" class="lf-group-files" data-testid="league-failure-files">
                <li v-for="lf in group" :key="lf.fileName">
                  {{ lf.fileName }}<template v-if="lf.arenaId"> · {{ lf.arenaId }}</template>
                </li>
              </ul>
            </div>
          </div>
        </Banner>
        </div>

        <div class="data-toolbar" data-testid="data-toolbar" data-tour="data-toolbar">
          <SegmentedControl
            v-if="hasSummaryView && hasSingleView"
            :model-value="isSummaryView ? 'SUMMARY' : 'SINGLE'"
            :options="dataViewOptions"
            :aria-label="$t('workspace.data_view')"
            data-testid="data-view"
            @update:model-value="setDataView"
          />
          <BattlePicker
            v-if="!isSummaryView && pickerOptions.length > 1"
            :visible="active"
            :options="pickerOptions"
            :model-value="currentSourceId"
            :aria-label="$t('workspace.battle_picker')"
            data-testid="battle-picker"
            @update:model-value="selectBattle"
          />
          <div class="data-actions">
            <SegmentedControl
              v-if="isCompact"
              v-model="layoutChoice"
              class="data-layout-toggle"
              :options="layoutOptions"
              :aria-label="$t('workspace.layout')"
              data-testid="data-layout"
            />
            <AppButton v-if="leagueMode" variant="ghost" size="sm" data-testid="league-docs-btn" @click="openRatingDocs">
              <BookOpen :size="16" aria-hidden="true" />{{ $t('workspace.rating_docs') }}
            </AppButton>
            <AppButton variant="ghost" size="sm" data-testid="column-picker-btn" data-tour="data-columns" :aria-expanded="showColPicker" @click="toggleColPicker">
              <Columns3 :size="16" aria-hidden="true" />{{ $t('workspace.columns_count', columnCounts) }}
            </AppButton>
            <Teleport to="body">
              <ColumnPicker data-tour="data-column-options" v-if="showColPicker" :scope="pickerScope" :order="currentOrder"
                :visible="pickerScope === 'agg' ? aggVisibleKeys : pickerScope === 'cw' ? cwVisibleKeys : visibleKeys"
                :fixed-keys="(pickerScope === 'cw' || (pickerScope === 'player' && leagueMode)) ? ['nickname', 'league_rating'] : []"
                @close="showColPicker = false" @toggle="toggleCol"
                @select-all="selectAllCols" @reset="resetCols" @reorder="handleReorder" />
            </Teleport>
            <MenuButton
              :label="exportingPng ? $t('replay.png_exporting') : exportingExcel ? $t('replay.excel_exporting') : $t('workspace.export')"
              :icon="Download"
              :items="exportItems"
              :disabled="loading || exportingPng"
              data-testid="export-menu" data-tour="data-export"
              @select="onExport"
            />
          </div>
        </div>

        <p v-if="!resp.battles.length && !resp.aggregate.length && !leagueData" class="replay-empty-note">{{ $t('replay.no_results') }}</p>

        <div v-show="isSummaryView && (resp.aggregate.length || leagueMode)" ref="aggregateRef">
          <SeriesOverview v-if="series.battles.length > 1" :series="series" @select-battle="selectBattle" />
          <template v-if="!leagueMode && resp.aggregate.length">
            <h2 class="replay-section-title" data-testid="base-aggregate-title">{{ $t('result.base_summary_title') }}</h2>
            <AggregateTable :aggregate="resp.aggregate" :shown-cols="shownAggCols" :agg-stats="aggStats" :layout="dataLayout" />
          </template>
          <template v-if="leagueMode">
            <h2 class="replay-section-title" data-testid="league-summary-title">{{ $t('league.summary.section_title') }}</h2>
            <CwPlayerSummaryTable :title="$t('league.summary.title_player')"
              :rows="unifiedRows" :columns="unifiedShownCols"
              :league-columns="leagueData?.columns || []" :league-mode="true"
              :active="isSummaryView"
              :layout="dataLayout"
              :selected-account-id="selectedPlayer?.accountId ?? null"
              @select-player="selectPlayer" />
            <template v-if="(leagueData?.teamSummaries?.length || 0) > 0">
              <LeagueSummaryTable :title="$t('league.summary.title_team')"
                :rows="leagueData?.teamSummaries || []" :columns="leagueData?.teamSummaryColumns || []"
                :team-names="summaryTeamNames" @update-summary-team-name="updateSummaryTeamName" />
            </template>
            <p v-else class="league-summary-empty" data-testid="league-summary-empty">{{ $t('league.summary.no_rateable') }}</p>
          </template>
        </div>

        <template v-for="(b, i) in resp.battles" :key="i">
          <div v-if="!isSummaryView && currentSingleIndex === i"
               :ref="(el) => setBattleRef(el, i)">
            <BattleTable :battle="b" :shown-cols="shownCols"
              :active="!isSummaryView && currentSingleIndex === i"
              :sort-key="battleSorts[i]?.key || ''"
              :sort-reverse="battleSorts[i]?.reverse || false"
              @update:sort-key="k => setBattleSort(i, { key: k })"
              @update:sort-reverse="r => setBattleSort(i, { reverse: r })"
              :league-mode="leagueMode" :league="b.league" :league-columns="leagueData?.columns || []"
              :team-names="battleTeamNames" @update-team-name="updateBattleTeamName"
              :selected-account-id="selectedPlayer?.accountId ?? null"
              :selected-arena-id="selectedPlayer?.arenaId ?? null"
              :layout="dataLayout"
              @select-player="selectPlayer" />
          </div>
        </template>
        </template>
      </div>

    </template>

    <PlayerDetailDrawer :context="drawerOpen ? selectedPlayerContext : null" :player="drawerPlayer"
                        :league-columns="leagueData?.columns || []"
                        :scope-players="drawerScopePlayers" :has-prev="hasPrevPlayer" :has-next="hasNextPlayer"
                        @close="closeDrawer" @prev="goPrevPlayer" @next="goNextPlayer" />
  </div>
</template>

<style src="./replay-page.css"></style>
