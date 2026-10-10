<script setup>
import { ref, computed, watch, nextTick, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import { replayAggregatePlayerCount } from '../utils/replayView.js'
import { useReplay } from '../composables/useReplay.js'
import { useColumns } from '../composables/useColumns.js'
import {
  getExportTarget,
  computeExportDimensions,
  exportPngFilename,
  downloadBlob,
  maxFiniteDimension
} from '../utils/exportReplayPng.js'
import ColumnPicker from './ColumnPicker.vue'
import AggregateTable from './AggregateTable.vue'
import BattleTable from './BattleTable.vue'
import LeagueSummaryTable from './LeagueSummaryTable.vue'
import CwPlayerSummaryTable from './CwPlayerSummaryTable.vue'
import PlayerDetailDrawer from './PlayerDetailDrawer.vue'
import { mergeCwPlayerRows, mergeCwPlayerColumns, CW_DIM_KEYS } from '../utils/playerSummaryMerge.js'
import { BookOpen, Columns3, Download } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import BattlePicker from './BattlePicker.vue'
import MenuButton from './MenuButton.vue'
import SegmentedControl from './SegmentedControl.vue'
import SeriesOverview from './SeriesOverview.vue'
import { battlePickerOptions, buildSeriesOverview } from '../utils/replaySeries.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'

defineOptions({ name: 'ReplayPage' })

const props = defineProps({
  /** 嵌入 Replay Workspace 时的结果 tab：不重复渲染上传器 / Processing 面板。 */
  embedded: { type: Boolean, default: false },
  /** Workspace 直接传入唯一 Replay session；独立使用时为空并回退 useReplay。 */
  replayContext: { type: Object, default: null },
  /** Workspace presentation state（dataViewMode/currentBattleIndex 等）；独立使用时为空。 */
  workspaceContext: { type: Object, default: null },
})
const { locale, t, te } = useI18n()
const replay = props.replayContext || useReplay()
const replayWorkspace = props.workspaceContext
const { files, loading, error, resp, activeTab, aggStats, selectionRevision, exportExcel } = replay
/**
 * 页面级 CW（League）模式：唯一事实源 resp.leagueMode（后端显式标记，普通/混合批次为 false）。
 * Batch contract：leagueMode=true ⟺ 纯 CW 批次，resp.league envelope 始终存在
 * （无论评分场数，playerSummaries 可为空）。
 * Battle contract：battle.league 可能为 null（Rating-ineligible 场次）——该场仍是 CW UI
 * （Player Drawer / Performance metrics / Replay facts 照常，Rating/七维显示 "--"）。
 * useColumns 的 leagueMode 只负责列系统（storage scope / fixed keys / picker）；
 * 页面 tab 存在性 / 统一玩家表 / 默认 activeTab 看这里。
 */
const leagueMode = computed(() => resp.value?.leagueMode === true)

/** 数据子视图轴（Blocker #1/#2）：SUMMARY=汇总视图 / SINGLE=单场视图。 */
const isSummaryView = computed(() =>
  replayWorkspace
    ? replayWorkspace.dataViewMode.value === 'SUMMARY'
    : activeTab.value === 'aggregate')
/** 当前单场 index；SUMMARY 或未选中时为 -1。 */
const currentSingleIndex = computed(() => {
  if (isSummaryView.value) return -1
  if (replayWorkspace) return replayWorkspace.currentBattleIndex.value
  const m = /^b(\d+)$/.exec(activeTab.value)
  return m ? parseInt(m[1], 10) : -1
})
/** 供 useColumns 的 colScope 判定（SUMMARY -> agg/cw，SINGLE -> player）。 */
const dataViewModeRef = computed(() => isSummaryView.value ? 'SUMMARY' : 'SINGLE')

const cols = useColumns(replay.playerCols, replay.aggCols, dataViewModeRef, leagueMode)
const { visibleKeys, aggVisibleKeys, cwVisibleKeys, cwOrder, playerOrder, aggOrder, colScope, showColPicker, pickerScope,
  currentOrder, shownCols, shownAggCols,
  toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder } = cols

// Data presentation owns its hydration: authoritative Processing response is sufficient
// regardless of which capability created the Dataset. Immediate execution also covers
// mounting the Data tab after a READY response already exists.
watch(resp, (result) => {
  if (result) cols.initFromResponse(result)
}, { immediate: true })

/** 数据页视图切换：汇总视图 / 单场视图（单场由工具栏的场次选择器决定）。 */
function setDataView(mode) {
  // 列选择面板按视图分 scope；切换视图时收起，避免面板编辑的列与正在看的表不一致。
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

/** League Rating 模式元数据（resp.league；普通模式 null）。 */
const leagueData = computed(() => resp.value?.league || null)

/**
 * CW 统一玩家表：以 Replay Aggregate（Replay Core 全量玩家/场次）为基底，
 * 按 accountId join League Player Summary（可为空——0 评分场次的 CW 批次仍完整
 * 展示 aggregate 玩家，Rating/七维补 "--"）。列 = league 特有列前置 + aggregate 全部列。
 * 存在性由 leagueMode 决定（CW UI），不依赖 league envelope 内容。
 */
const unifiedRows = computed(() => leagueMode.value
  ? mergeCwPlayerRows(resp.value?.aggregate || [], leagueData.value?.playerSummaries || [])
  : [])
const unifiedAllCols = computed(() => leagueMode.value
  ? mergeCwPlayerColumns(leagueData.value?.playerSummaryColumns || [], resp.value?.aggregateColumns || [])
  : [])
/** 统一表可见列：useColumns cw scope 驱动（可见性 + 顺序 + 持久化）。
 * 只有 nickname + league_rating 固定（cwOrder 已 pin 在前两位），七维/MVP/表现指标/facts 全部用户可隐藏、可拖拽。 */
const unifiedShownCols = computed(() => {
  if (!leagueMode.value) return []
  const byKey = new Map(unifiedAllCols.value.map(c => [c.key, c]))
  return cwOrder.value
    .filter(k => cwVisibleKeys.value.includes(k))
    .map(k => byKey.get(k))
    .filter(Boolean)
})

// ---- Player Detail Drawer（只存 identity，不存 mutable row；刷新后按 accountId 重新 resolve） ----
const selectedPlayerContext = ref(null)

// ---- Player Detail Drawer 导航：跟随当前可见表格顺序，scope 不跨界 ----
const navOrder = ref([])
const navIndex = ref(-1)

function selectPlayer(context) {
  selectedPlayerContext.value = context
  const order = Array.isArray(context.order) ? context.order.map(Number) : []
  navOrder.value = order
  navIndex.value = order.indexOf(Number(context.accountId))
}

function closeDrawer() {
  selectedPlayerContext.value = null
  navOrder.value = []
  navIndex.value = -1
}

/** 前后导航可用性：首位 prev 禁用、末位 next 禁用，不循环。 */
const hasPrevPlayer = computed(() => navOrder.value.length > 0 && navIndex.value > 0)
const hasNextPlayer = computed(() => navOrder.value.length > 0 && navIndex.value >= 0 && navIndex.value < navOrder.value.length - 1)

function goPrevPlayer() {
  const ctx = selectedPlayerContext.value
  if (!ctx || !hasPrevPlayer.value) return
  const target = navOrder.value[navIndex.value - 1]
  selectedPlayerContext.value = { scope: ctx.scope, accountId: target, arenaId: ctx.arenaId }
  navIndex.value = navIndex.value - 1
}

function goNextPlayer() {
  const ctx = selectedPlayerContext.value
  if (!ctx || !hasNextPlayer.value) return
  const target = navOrder.value[navIndex.value + 1]
  selectedPlayerContext.value = { scope: ctx.scope, accountId: target, arenaId: ctx.arenaId }
  navIndex.value = navIndex.value + 1
}

/** Drawer 打开状态：context 存在即打开（默认关闭）。 */
const drawerOpen = computed(() => !!selectedPlayerContext.value)

/** 选中玩家 identity：scope + accountId + arenaId；
 *  Drawer 关闭（closeDrawer / Tab 切换 / selectionRevision）→ null → 表格清除 selected highlight。 */
const selectedPlayer = computed(() => {
  const ctx = selectedPlayerContext.value
  if (!ctx) return null
  return { scope: ctx.scope, accountId: Number(ctx.accountId), arenaId: ctx.arenaId || null }
})

/** 当前 Drawer 的玩家数据（按 context 实时 resolve；排序/响应刷新后仍指向原选手）。 */
const drawerPlayer = computed(() => {
  const ctx = selectedPlayerContext.value
  if (!ctx) return null
  if (ctx.scope === 'summary') {
    const row = unifiedRows.value.find(r => Number(r.accountId) === Number(ctx.accountId))
    if (!row) return null
    return {
      accountId: row.accountId,
      nickname: row.cells.nickname,
      clan: row.cells.clan || '',
      rating: row.cells.league_rating,
      observedMean: row.cells.league_observed_mean,
      dimensionMeans: row.league?.dimensionMeans ?? null,
      mvpCount: row.cells.mvp_count,
      battles: row.cells.battles,
      wins: row.cells.wins,
      mostUsedVehicle: row.league?.mostUsedVehicle ?? null,
      ratedBattles: row.cells?.rated_battles ?? null,
      cells: row.cells,
    }
  }
  const battle = (resp.value?.battles || []).find(b => b.arenaId === ctx.arenaId)
  const row = battle?.players?.find(p => Number(p.accountId) === Number(ctx.accountId))
  if (!row) return null
  return {
    accountId: row.accountId,
    nickname: row.cells.nickname,
    clan: row.cells.clan || '',
    rating: row.cells.league_rating,
    dimensionScores: CW_DIM_KEYS.map(k => row.cells[k]),
    tankId: row.vehicleId ?? null,
    tankName: row.cells?.tank_name ?? '',
    tankBattles: 1,
    cells: row.cells,
  }
})

watch(selectionRevision, () => {
  selectedPlayerContext.value = null
  navOrder.value = []
  navIndex.value = -1
})

watch([isSummaryView, currentSingleIndex], () => {
  selectedPlayerContext.value = null
  navOrder.value = []
  navIndex.value = -1
})

const drawerScopePlayers = computed(() => {
  const ctx = selectedPlayerContext.value
  if (!ctx) return []
  if (ctx.scope === 'summary') return unifiedRows.value
  const battle = (resp.value?.battles || []).find(b => b.arenaId === ctx.arenaId)
  return battle ? battle.players : []
})

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

// ---- 数据工具栏：视图切换 · 场次选择 · 操作（审计 BZ-06 / BZ-09，design-language §7） ----
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

/**
 * 玩家表呈现方式：手机默认卡片列表，可切回表格；平板 / 桌面固定表格（design-language §7 DataTable）。
 * 用户的选择只在本页会话内有效。
 */
const { isCompact } = useBreakpoint()
const layoutChoice = ref('cards')
const dataLayout = computed(() => (isCompact.value ? layoutChoice.value : 'table'))
const layoutOptions = computed(() => [
  { value: 'cards', label: t('workspace.layout_cards'), testid: 'data-layout-cards' },
  { value: 'table', label: t('workspace.layout_table'), testid: 'data-layout-table' },
])

/** 「列 8/20」：让用户知道还有指标收在列面板里（默认只显示核心列，审计 BZ-07）。 */
const columnCounts = computed(() => {
  if (colScope.value === 'cw') return { shown: unifiedShownCols.value.length, total: cwOrder.value.length }
  if (colScope.value === 'agg') return { shown: shownAggCols.value.length, total: aggOrder.value.length }
  return { shown: shownCols.value.length, total: playerOrder.value.length }
})

/** 客户端 xlsx 导出在进行中（exceljs 首次按需加载 + 生成工作簿） */
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
})
const exportingPng = ref(false)
const aggregateRef = ref(null)
const battleRefs = ref([])

function setBattleRef(el, index) {
  if (el) battleRefs.value[index] = el
}

function readTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

const EXPORT_THEME_CSS = {
  light: 'replay-export-light',
  dark: 'replay-export-dark'
}

const EXPORT_BG = {
  light: '#ffffff',
  dark: '#1e1e1e'
}

function createExportClone(target, theme) {
  const clone = target.cloneNode(true)
  clone.classList.add('replay-export-root', EXPORT_THEME_CSS[theme])
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.style.pointerEvents = 'none'
  container.style.zIndex = '-1'
  container.setAttribute('aria-hidden', 'true')
  container.appendChild(clone)
  document.body.appendChild(container)
  return { clone, container }
}

function prepareReplayExportClone(clone) {
  if (!clone) return
  // PNG 总是导出表格：卡片模式下表格只是被隐藏
  for (const el of clone.querySelectorAll('.player-cards')) el.remove()
  for (const el of clone.querySelectorAll('.tablewrap, .scroll-hint')) el.style.display = ''
  for (const el of clone.querySelectorAll('.selected')) {
    el.classList.remove('selected')
  }
  for (const el of clone.querySelectorAll('.sticky-col')) {
    el.style.position = 'static'
    el.style.left = 'auto'
    el.style.right = 'auto'
    el.style.zIndex = 'auto'
  }
}

function expandExportTables(clone) {
  for (const wrap of clone.querySelectorAll('.tablewrap')) {
    wrap.style.overflow = 'visible'
    wrap.style.maxWidth = 'none'
    wrap.style.width = 'max-content'
  }
}

function measureExportClone(clone) {
  const naturalRootW = maxFiniteDimension(
    clone.scrollWidth,
    clone.getBoundingClientRect().width
  )

  let maxDescendantW = 0
  for (const wrap of clone.querySelectorAll('.tablewrap')) {
    const wrapW = maxFiniteDimension(wrap.scrollWidth, wrap.getBoundingClientRect().width)
    if (wrapW > maxDescendantW) maxDescendantW = wrapW
    for (const tbl of wrap.querySelectorAll('table')) {
      const tblW = maxFiniteDimension(tbl.scrollWidth, tbl.getBoundingClientRect().width)
      if (tblW > maxDescendantW) maxDescendantW = tblW
    }
  }
  for (const child of clone.children) {
    const csw = maxFiniteDimension(child.scrollWidth, child.getBoundingClientRect().width)
    if (csw > maxDescendantW) maxDescendantW = csw
  }

  const cs = clone.ownerDocument.defaultView.getComputedStyle(clone)
  const padLeft = parseFloat(cs.paddingLeft) || 0
  const padRight = parseFloat(cs.paddingRight) || 0
  const borderLeft = parseFloat(cs.borderLeftWidth) || 0
  const borderRight = parseFloat(cs.borderRightWidth) || 0
  const hExtra = padLeft + padRight + borderLeft + borderRight

  const requiredW = maxDescendantW > naturalRootW
    ? maxDescendantW + hExtra
    : naturalRootW

  clone.style.width = Math.ceil(requiredW) + 'px'

  const finalW = maxFiniteDimension(clone.scrollWidth, clone.getBoundingClientRect().width)
  const finalH = maxFiniteDimension(clone.scrollHeight, clone.getBoundingClientRect().height)

  return { width: Math.ceil(finalW), height: Math.ceil(finalH) }
}

function waitForLayout() {
  return new Promise(resolve => {
    nextTick(() => requestAnimationFrame(resolve))
  })
}

function cleanupExportClone(container) {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container)
  }
}

async function downloadResultPng() {
  if (exportingPng.value || loading.value) return

  const exportSummary = isSummaryView.value
  const exportBattleIdx = exportSummary ? NaN : currentSingleIndex.value
  const exportTab = exportSummary ? 'aggregate' : `b${exportBattleIdx}`
  const exportTheme = readTheme()
  const exportLocale = locale.value
  const exportMapName = !exportSummary && resp.value?.battles?.[exportBattleIdx]?.mapName
    ? mapLabel(resp.value.battles[exportBattleIdx].mapName, exportLocale)
    : undefined

  const target = getExportTarget(exportTab, aggregateRef.value, battleRefs.value)
  if (!target) return

  let cloneCtx = null

  exportingPng.value = true
  error.value = ''

  try {
    cloneCtx = createExportClone(target, exportTheme)
    prepareReplayExportClone(cloneCtx.clone)
    expandExportTables(cloneCtx.clone)
    await waitForLayout()
    const measured = measureExportClone(cloneCtx.clone)
    const dims = computeExportDimensions(measured)

    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(cloneCtx.clone, {
      scale: dims.scale,
      useCORS: true,
      backgroundColor: EXPORT_BG[exportTheme],
      width: dims.width,
      height: dims.height
    })

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Replay PNG export: canvas.toBlob returned null')

    const filename = exportPngFilename(exportTab, isNaN(exportBattleIdx) ? 0 : exportBattleIdx, exportMapName)
    await downloadBlob(blob, filename)
  } catch (e) {
    console.error('[Replay PNG Export] failed', e)
    error.value = t('replay.png_export_failed')
  } finally {
    if (cloneCtx) cleanupExportClone(cloneCtx.container)
    exportingPng.value = false
  }
}

const navigate = inject(NAVIGATE_VIEW_KEY, null)

function openRatingDocs() {
  navigate && navigate('rating-docs')
}

</script>

<template>
  <div :class="props.embedded ? 'replay-data-embedded' : 'layout-data-workspace'">
    <template v-if="files.length || resp">
      <div>
        <p v-if="!resp" class="replay-empty-note">{{ $t('workspace.results_hint') }}</p>
        <template v-if="resp">
        <div class="result-notices">
        <Banner v-if="resp.duplicates.length" tone="warning" data-testid="result-duplicates">
          <p>{{ $t('result.duplicates', { count: resp.duplicates.length }) }}</p>
          <ul class="notice-files"><li v-for="(d, i) in resp.duplicates" :key="i">{{ d[0] }}</li></ul>
        </Banner>
        <Banner v-if="resp.failures.length" tone="danger" data-testid="result-failures">
          <p>{{ $t('result.failures', { count: resp.failures.length }) }}</p>
          <ul class="notice-files"><li v-for="(f, i) in resp.failures" :key="i">{{ f[0] }} ({{ f[1] }})</li></ul>
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

        <div v-for="(b, i) in resp.battles" :key="i" v-show="!isSummaryView && currentSingleIndex === i"
             :ref="(el) => setBattleRef(el, i)">
          <BattleTable :battle="b" :shown-cols="shownCols"
            :active="!isSummaryView && currentSingleIndex === i"
            :league-mode="leagueMode" :league="b.league" :league-columns="leagueData?.columns || []"
            :team-names="battleTeamNames" @update-team-name="updateBattleTeamName"
            :selected-account-id="selectedPlayer?.accountId ?? null"
            :selected-arena-id="selectedPlayer?.arenaId ?? null"
            :layout="dataLayout"
            @select-player="selectPlayer" />
        </div>
        </template>
      </div>

    </template>

    <PlayerDetailDrawer :context="drawerOpen ? selectedPlayerContext : null" :player="drawerPlayer"
                        :league-columns="leagueData?.columns || []"
                        :scope-players="drawerScopePlayers" :has-prev="hasPrevPlayer" :has-next="hasNextPlayer"
                        @close="closeDrawer" @prev="goPrevPlayer" @next="goNextPlayer" />
  </div>
</template>

<style>
.replay-section-title {
  margin: 18px 0 8px;
  font-size: .92rem;
  font-weight: 800;
  color: var(--text-heading);
  letter-spacing: .01em;
}
.replay-section-title:first-child { margin-top: 4px; }
.league-summary-empty {
  margin: 8px 2px 16px;
  padding: 14px 16px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text-sub);
  font-size: .85rem;
  background: color-mix(in srgb, var(--bg-card) 82%, transparent);
}
.replay-empty-note { padding: 18px 4px; color: var(--text-muted); font-size: .85rem; }
.result-notices { display: grid; gap: var(--space-2); margin-bottom: var(--space-3); }
.result-notices:empty { display: none; }
.notice-files { margin: var(--space-1) 0 0; padding-inline-start: var(--space-5); color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }
.data-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-4); }
.data-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-inline-start: auto; }
@media (width < 768px) {
  .data-toolbar > .segmented { width: 100%; }
  .data-actions { width: 100%; justify-content: flex-end; }
  .data-layout-toggle { margin-inline-end: auto; }
}
.league-failure-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  font-size: .85rem;
}
.lf-title { font-weight: 700; color: var(--warn-text); }
.lf-rated, .lf-unrated { font-variant-numeric: tabular-nums; }
.lf-unrated { color: var(--warn-text); }
.lf-toggle {
  margin-left: auto;
  padding: 3px 10px;
  border: 1px solid color-mix(in oklab, var(--color-warning) 50%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--warn-text);
  cursor: pointer;
  font-size: .78rem;
  font-family: inherit;
}
.lf-toggle:hover { background: color-mix(in oklab, var(--color-warning) 16%, transparent); }
.league-failure-detail { margin-top: 8px; border-top: 1px solid color-mix(in oklab, var(--color-warning) 25%, transparent); padding-top: 8px; }
.league-failure-group { margin-bottom: 4px; }
.lf-group-head {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-label);
  cursor: pointer;
  font-size: .8rem;
  font-family: inherit;
}
.lf-group-head:hover { background: color-mix(in oklab, var(--color-warning) 14%, transparent); color: var(--warn-text); }
.lf-group-files {
  margin: 2px 0 6px;
  padding: 2px 8px 2px 22px;
  color: var(--text-muted);
  font-size: .78rem;
  word-break: break-word;
}
.replay-export-root.replay-export-light {
  --exp-bg: #ffffff;
  --exp-card-bg: #f8f9fa;
  --exp-text: #1a1a1a;
  --exp-text-sub: #666666;
  --exp-border: #dee2e6;
  --exp-header-bg: #e9ecef;
  --exp-t1-bg: #e3f2fd;
  --exp-t2-bg: #fce4ec;
  --exp-alive: #28a745;
  --exp-destroyed: #dc3545;
}

.replay-export-root.replay-export-dark {
  --exp-bg: #1e1e1e;
  --exp-card-bg: #2d2d2d;
  --exp-text: #e0e0e0;
  --exp-text-sub: #999999;
  --exp-border: #444444;
  --exp-header-bg: #333333;
  --exp-t1-bg: #1a3a5c;
  --exp-t2-bg: #5c2a3a;
  --exp-alive: #4caf50;
  --exp-destroyed: #ef5350;
}

.replay-export-root {
  background: var(--exp-bg);
  color: var(--exp-text);
  padding: 16px;
  font-size: 13px;
  line-height: 1.5;
  max-width: none;
}
.replay-export-root .sticky-col {
  position: static !important;
  left: auto !important;
  right: auto !important;
  z-index: auto !important;
}
.replay-export-root .league-overview {
  border: 1px solid var(--exp-border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 16px;
}
.replay-export-root .league-team {
  border: 1px solid var(--exp-border);
  border-radius: 7px;
  padding: 8px 10px;
  margin-bottom: 6px;
}
.replay-export-root .league-team.league-win {
  background: var(--exp-t1-bg);
}
.replay-export-root .team-name-input {
  border: 1px dashed var(--exp-border);
  color: var(--exp-text);
}
.replay-export-root .league-mvp {
  color: var(--exp-text);
}
.replay-export-root .mvp-badge {
  background: var(--exp-header-bg);
  color: var(--exp-text);
}
.replay-export-root .league-summary-title {
  color: var(--exp-text);
}
/* StatStrip 的 scoped 规则与这里同特异性，导出样式多带一层 .mcards 以确定性胜出 */
.replay-export-root .mcards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.replay-export-root .mcards .mc {
  background: var(--exp-card-bg);
  border: 1px solid var(--exp-border);
  border-radius: 8px;
  padding: 14px 16px;
  text-align: center;
}
.replay-export-root .mcards .mc .k {
  font-size: .78rem;
  color: var(--exp-text-sub);
  margin-bottom: 4px;
}
.replay-export-root .mcards .mc .v {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--exp-text);
  font-variant-numeric: tabular-nums;
}
.replay-export-root .tablewrap {
  overflow: visible;
  max-width: none;
  border: 1px solid var(--exp-border);
  border-radius: 8px;
}
.replay-export-root table {
  border-collapse: collapse;
  width: auto;
  background: var(--exp-bg);
}
.replay-export-root th {
  background: var(--exp-header-bg) !important;
  color: var(--exp-text);
  padding: 6px 10px;
  border: 1px solid var(--exp-border);
  white-space: nowrap;
  font-weight: 600;
}
.replay-export-root td {
  padding: 5px 10px;
  border: 1px solid var(--exp-border);
  color: var(--exp-text);
}
.replay-export-root tbody tr.t1 td {
  background: var(--exp-t1-bg) !important;
}
.replay-export-root tbody tr.t2 td {
  background: var(--exp-t2-bg) !important;
}
.replay-export-root .alive {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  background: var(--exp-alive);
  color: var(--exp-bg);
}
.replay-export-root .dead {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  background: var(--exp-destroyed);
  color: var(--exp-bg);
}
.replay-export-root * {
  animation: none !important;
  transition: none !important;
  backdrop-filter: none !important;
  filter: none !important;
}
.replay-export-root .league-summary-empty {
  background: var(--exp-card-bg) !important;
  color: var(--exp-text-sub) !important;
}
.replay-export-root .scroll-hint {
  display: none;
}
</style>
