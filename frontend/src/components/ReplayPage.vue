<script setup>
import { ref, computed, watch, nextTick, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapLabel, displayName } from '../utils/helpers.js'
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
import FileUploader from './FileUploader.vue'
import ColumnPicker from './ColumnPicker.vue'
import AggregateTable from './AggregateTable.vue'
import BattleTable from './BattleTable.vue'
import LeagueSummaryTable from './LeagueSummaryTable.vue'
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import ReplayTaskCard from './ReplayTaskCard.vue'
import AiReviewPanel from './AiReviewPanel.vue'
import BattlePlaybackPanel from './BattlePlaybackPanel.vue'

const { locale, t, te } = useI18n()
const replay = useReplay()
const { files, loading, error, resp, activeTab, aggStats, pendingRemove, updateFiles, selectionRevision,
  processingJob, processingError, processingActive,
  exportJob, exportError, exportActive,
  startProcessingJob, cancelProcessingJob, dismissProcessingJob,
  startExportJob, cancelExportJob, downloadExportResult, dismissExportJob,
  askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove } = replay
const cols = useColumns(replay.playerCols, replay.aggCols, replay.activeTab)
const { visibleKeys, aggVisibleKeys, showColPicker, pickerScope,
  currentOrder, shownCols, shownAggCols,
  toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder } = cols

/** League Rating 模式元数据（resp.league；普通模式 null）。 */
const leagueData = computed(() => resp.value?.league || null)

// ---- League Rating 校验失败展示（plan §16/§17/§18：neutral/warning 语义 + 可展开汇总，
//      不把 league failure 显示成红色「文件解析失败」，不默认铺满超长文件名）----
const showLeagueFailures = ref(false)
const expandedLeagueGroups = ref({})

/** 已评分场数（battle.league != null ⟺ 该场完成 Rating；identity 绑定，不依赖数组 index）。 */
const ratedBattleCount = computed(() =>
  (resp.value?.battles || []).filter(b => !!b.league).length)

/** League 校验失败按稳定 code 分组（保持首次出现顺序；code 文案走 api_errors 三语）。 */
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

/** 混合批次（普通 + 训练赛/联赛混传）League Rating 不可用提示（plan §21）。 */
const leagueUnavailableMessage = computed(() => {
  const code = resp.value?.leagueUnavailableCode
  if (!code) return ''
  return t('league.unavailable_mixed')
})
/**
 * 页面级 League 模式（P0：resp.league 是唯一事实源，不再由 playerColumns 是否含
 * league_rating 间接推断）。useColumns 的 leagueMode 只负责列系统（storage scope /
 * fixed keys / picker），页面 tab 存在性 / LeagueSummaryTable / 默认 activeTab 一律看这里。
 */
const leagueMode = computed(() => !!leagueData.value)
/** 汇总 tab 的真实选手数量：League 汇总使用 playerSummaries，普通模式使用 aggregate。 */
const aggregatePlayerCount = computed(() => replayAggregatePlayerCount(resp.value))
/**
 * 两种独立的战队名称 override（PR #123 Blocker 2，禁止扁平混合）：
 * - battleTeamNames：{arenaId:team} → 名（单场显示 / 单场 PNG / 单场与 each Excel）
 * - summaryTeamNames：{teamKey} → 名（批次战队汇总显示 / aggregate Excel 战队汇总）
 * 仅当前页面内存（plan §12）；批次 rename 不得反向写入所有 {arenaId:team}。
 */
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

/** Export Job 的战队名称覆盖 payload（无覆盖 → null；multipart field 传递，不拼 URL query）。 */
function teamNamesPayload() {
  const battle = battleTeamNames.value
  const summary = summaryTeamNames.value
  if (!Object.keys(battle).length && !Object.keys(summary).length) return null
  return { battle, summary }
}

/**
 * Team override 属于当前 replay selection（PR #123 Blocker 2）：任何 selection 变化
 * （add/remove/replace/clear/remove battle/folder，全部经 updateFiles → selectionRevision++）
 * 都使两组 override 同时失效；同一 selection 单纯重新 Processing 不清空（不依赖
 * startProcessingJob / Processing lifecycle）。
 */
watch(selectionRevision, () => {
  battleTeamNames.value = {}
  summaryTeamNames.value = {}
})

/** PNG 导出用：League 模式全列表格（不受当前可见列限制）。 */
function leagueExportTable(battle) {
  const colsList = resp.value?.league?.columns || []
  const allKeys = colsList.map(c => c.key)
  const headers = allKeys.map(k => '<th>' + t('player_labels.' + k) + '</th>').join('')
  const body = battle.players.map(row => {
    const tds = allKeys.map(k => {
      const raw = row.cells ? row.cells[k] : ''
      let text = raw == null ? '' : String(raw)
      const max = Number((colsList.find(c => c.key === k) || {}).max) || 0
      if (max > 0) {
        const v = Number(raw) || 0
        text = Math.round(v) + ' / ' + max + ' \u00B7 ' + (Math.round(1000 * v / max) / 10) + '%'
      }
      return '<td>' + escapeHtml(text) + '</td>'
    }).join('')
    return '<tr class="' + (row.team === 1 ? 't1' : 't2') + '">' + tds + '</tr>'
  }).join('')
  return '<table><thead><tr>' + headers + '</tr></thead><tbody>' + body + '</tbody></table>'
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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

function expandExportTables(clone) {
  for (const wrap of clone.querySelectorAll('.tablewrap')) {
    wrap.style.overflow = 'visible'
    wrap.style.maxWidth = 'none'
    wrap.style.width = 'max-content'
  }
}

function measureExportClone(clone) {
  // Read the clone's natural scroll width (includes padding in normal flow)
  const naturalRootW = maxFiniteDimension(
    clone.scrollWidth,
    clone.getBoundingClientRect().width
  )

  // Find the widest descendant content (tablewrap / table / direct children)
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

  // When the required width comes from descendants (not root's own scroll),
  // we must add the root's horizontal padding and border so they are not clipped.
  const cs = clone.ownerDocument.defaultView.getComputedStyle(clone)
  const padLeft = parseFloat(cs.paddingLeft) || 0
  const padRight = parseFloat(cs.paddingRight) || 0
  const borderLeft = parseFloat(cs.borderLeftWidth) || 0
  const borderRight = parseFloat(cs.borderRightWidth) || 0
  const hExtra = padLeft + padRight + borderLeft + borderRight

  // naturalRootW already includes padding. When descendant dictates the width,
  // add hExtra so padding+border are not clipped.
  const requiredW = maxDescendantW > naturalRootW
    ? maxDescendantW + hExtra
    : naturalRootW

  clone.style.width = Math.ceil(requiredW) + 'px'

  // Re-read final layout after width is set (height may have changed due to reflow)
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

  // Save immutable export context before any async operation
  const exportTab = activeTab.value
  const exportTheme = readTheme()
  const exportLocale = locale.value
  const exportBattleIdx = exportTab === 'aggregate' ? NaN : parseInt(exportTab.replace('b', ''), 10)
  const exportMapName = !isNaN(exportBattleIdx) && resp.value?.battles?.[exportBattleIdx]?.mapName
    ? mapLabel(resp.value.battles[exportBattleIdx].mapName, exportLocale)
    : undefined

  const target = getExportTarget(exportTab, aggregateRef.value, battleRefs.value)
  if (!target) return

  let cloneCtx = null

  exportingPng.value = true
  error.value = ''

  try {
    cloneCtx = createExportClone(target, exportTheme)
    expandExportTables(cloneCtx.clone)
    // League 模式：导出完整超宽表格（全部 Rating 维度 + 原始字段），不受当前可见列限制
    if (leagueData.value) {
      const battle = resp.value?.battles?.[exportBattleIdx]
      if (battle) {
        const fullTable = leagueExportTable(battle)
        for (const wrap of cloneCtx.clone.querySelectorAll('.tablewrap')) {
          wrap.innerHTML = fullTable
        }
      }
    }
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
    if (!blob) throw new Error('toBlob returned null')

    const filename = exportPngFilename(exportTab, isNaN(exportBattleIdx) ? 0 : exportBattleIdx, exportMapName)
    await downloadBlob(blob, filename)
  } catch (e) {
    error.value = t('replay.png_export_failed')
  } finally {
    if (cloneCtx) cleanupExportClone(cloneCtx.container)
    exportingPng.value = false
  }
}


/** Battle context actions（plan §13/§21）：具体 battle 才出现「战局回放 / AI 复盘」。
 * Summary context 不渲染这些入口。单页 Workspace：点击后原地切到对应面板，目标文件
 * 直接复用当前 selection 内文件——不跨视图跳转、不重新上传、不重复解析。 */
const isAuthenticated = inject('isAuthenticated', () => false)
const login = inject('login', null)

function currentBattleFile() {
  if (activeTab.value === 'aggregate') return null
  const idx = parseInt(activeTab.value.replace('b', ''), 10)
  const battle = resp.value?.battles?.[idx]
  if (!battle) return null
  return files.value.find(f => displayName(f) === battle.sourceName) || null
}

/**
 * Battle context actions 需登录（/api/replay/analyze 与 /api/replay/map-overview 均走
 * authedFetch）。未登录点击不静默跳转：文件只存在内存，Keycloak 整页跳转会清空——
 * 先在当前页明确告知（登录后需重新选择回放），确认后再去登录。
 */
function requireLoginForBattleAction() {
  if (isAuthenticated()) return true
  const ok = window.confirm(t('replay.login_required_for_battle'))
  if (ok && login) login('replay')
  return false
}

// ---- Workspace（解析结果 / AI 复盘 / 战局回放 原地切换；v-show 保持各面板状态）----
const workspaceTab = ref('results')
const workspaceFile = ref(null)
const playbackSeek = ref(null)

function openWorkspacePlayback(file) {
  workspaceFile.value = file
  playbackSeek.value = null
  workspaceTab.value = 'playback'
}

function openWorkspaceAi(file) {
  workspaceFile.value = file
  workspaceTab.value = 'ai'
}

/**
 * Workspace 一级 tab 切换统一入口（results / ai / playback）。
 * 目标解析规则（唯一事实源）：
 * - 已显式选择 workspaceFile → 直接沿用（单纯切 tab 不清空，AI 进度/地图状态由 v-show 保持）；
 * - 未选择且 files 恰有 1 个 → 自动以该唯一文件为目标：复用 selection 内原始 File reference
 *   （不重新上传、不重新解析、不复制对象）；与 FileUploader / battle toolbar 快捷入口统一走
 *   登录门禁（未登录 confirm + login，不切换、不设置 target、不自动发 API 请求）；
 * - 未选择且 files 多个 → 保持 null（空态），禁止静默 fallback 到 files[0]（多文件必须显式选目标）。
 */
function selectWorkspaceTab(tab) {
  if (tab === 'ai' || tab === 'playback') {
    if (!workspaceFile.value && files.value.length === 1) {
      if (!requireLoginForBattleAction()) return
      workspaceFile.value = files.value[0]
    }
  }
  workspaceTab.value = tab
}

/** FileUploader 直接入口（单文件 / 显式选择）上抛：原地切到对应面板。 */
function onWorkspaceAction({ file, mode }) {
  if (mode === 'playback') openWorkspacePlayback(file)
  else openWorkspaceAi(file)
}

function openBattlePlayback() {
  const f = currentBattleFile()
  if (!f) return
  if (!requireLoginForBattleAction()) return
  openWorkspacePlayback(f)
}

function openAiReview() {
  const f = currentBattleFile()
  if (!f) return
  if (!requireLoginForBattleAction()) return
  openWorkspaceAi(f)
}

/** AI 报告时间链接：切到战局回放面板并 seek（BattlePlaybackPanel 自动加载/展开地图）。
 * 先置 null 再 nextTick 写回：连续点击同一时间戳也能重新触发子组件 watch。 */
async function onAiSeek(sec) {
  workspaceTab.value = 'playback'
  playbackSeek.value = null
  await nextTick()
  playbackSeek.value = sec
}

async function preview() {
  workspaceTab.value = 'results'
  await startProcessingJob(cols.initFromResponse)
}

function onFileRemoveRequest(f) { askRemoveFile(f) }

// 文件集合变化后目标文件可能已被移除/清空：失效 workspaceFile（面板回到空态），不静默沿用旧文件。
watch(files, (next) => {
  if (workspaceFile.value && !next.includes(workspaceFile.value)) {
    workspaceFile.value = null
  }
})
</script>

<template>
  <div class="layout-data-workspace">
    <FileUploader :files="files" :loading="loading" :confirm-remove="!!resp"
      @update:files="updateFiles" @preview="preview" @remove-request="onFileRemoveRequest"
      @workspace-action="onWorkspaceAction" />

    <p v-if="error" class="error">{{ error }}</p>

    <!-- Workspace：有文件（解析前也能直接进 AI/回放）或已有解析结果时可见；
         resp 依赖 files 才存在，故 files.length || resp 与真实状态机一致。 -->
    <template v-if="files.length || resp">
      <div class="workspace-tabs tabs" role="tablist" aria-label="Workspace">
        <button data-testid="workspace-results-tab" :class="{ active: workspaceTab === 'results' }" @click="selectWorkspaceTab('results')">{{ $t('workspace.tab_results') }}</button>
        <button data-testid="workspace-ai-tab" :class="{ active: workspaceTab === 'ai' }" @click="selectWorkspaceTab('ai')">{{ $t('action.ai_review') }}</button>
        <button data-testid="workspace-playback-tab" :class="{ active: workspaceTab === 'playback' }" @click="selectWorkspaceTab('playback')">{{ $t('action.battle_playback') }}</button>
      </div>

      <div v-show="workspaceTab === 'results'">
        <p v-if="!resp" class="replay-empty-note">{{ $t('workspace.results_hint') }}</p>
        <template v-if="resp">
        <div v-if="resp.duplicates.length" class="warn">
          {{ $t('result.duplicates', { count: resp.duplicates.length }) }}
          <span v-for="(d, i) in resp.duplicates" :key="i">{{ d[0] }}</span>
        </div>
        <div v-if="resp.failures.length" class="error">
          {{ $t('result.failures', { count: resp.failures.length }) }}
          <span v-for="(f, i) in resp.failures" :key="i">{{ f[0] }} ({{ f[1] }})</span>
        </div>
        <div v-if="leagueUnavailableMessage" class="warn league-unavailable" data-testid="league-unavailable">
          {{ leagueUnavailableMessage }}
        </div>
        <div v-if="leagueData?.failures?.length" class="warn league-failure-summary" data-testid="league-failure-summary">
          <div class="league-failure-head">
            <span class="lf-title">{{ $t('league.title') }}</span>
            <span class="lf-rated">{{ $t('league.rated_count', { rated: ratedBattleCount, total: resp.battles.length }) }}</span>
            <span class="lf-unrated">{{ $t('league.unrated_count', { count: resp.battles.length - ratedBattleCount }) }}</span>
            <button class="lf-toggle" data-testid="league-failure-toggle" :aria-expanded="showLeagueFailures"
                    @click="toggleLeagueFailures">
              {{ showLeagueFailures ? $t('league.failure_hide') : $t('league.failure_view') }}
            </button>
          </div>
          <div v-if="showLeagueFailures" class="league-failure-detail" data-testid="league-failure-detail">
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
        </div>

        <div class="restoolbar">
          <div class="tabs" :class="{ locked: showColPicker }"
               :title="showColPicker ? $t('action.picker_locked') : ''">
            <button v-if="resp.aggregate.length || leagueMode" :disabled="showColPicker"
                    :class="{ active: activeTab === 'aggregate' }"
                    @click="activeTab = 'aggregate'">{{ $t('result.aggregate_tab', { count: aggregatePlayerCount }) }}</button>
            <button v-for="(b, i) in resp.battles" :key="i" :disabled="showColPicker"
                    :class="{ active: activeTab === 'b' + i }"
                    @click="activeTab = 'b' + i">{{ mapLabel(b.mapName, locale) }} #{{ i + 1 }}
              <span class="tabx" :title="$t('modal.remove_title')" @click.stop="askRemoveBattle(b, i)">&times;</span>
            </button>
          </div>
          <div class="resactions">
            <template v-if="activeTab !== 'aggregate'">
              <button class="battle-action" data-testid="battle-playback-btn" @click="openBattlePlayback">
                <svg class="ic" viewBox="0 0 24 24"><path d="M3 5l6 3-6 3zM15 5l6 3-6 3zM9 8h6M9 8v8M9 16l6-3M9 13l6-3" /></svg>{{ $t('action.battle_playback') }}
              </button>
              <button class="battle-action primary" data-testid="battle-ai-btn" @click="openAiReview">
                <svg class="ic" viewBox="0 0 24 24"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z" /></svg>{{ $t('action.ai_review') }}
              </button>
            </template>
            <span class="dropdown">
              <button class="ghost sm" @click="toggleColPicker">
                <svg class="ic" viewBox="0 0 24 24"><path d="M4 4h16v16H4zM10 4v16" /></svg>{{ $t('action.select_cols') }} v
              </button>
              <ColumnPicker v-if="showColPicker" :scope="pickerScope" :order="currentOrder"
                :visible="pickerScope === 'agg' ? aggVisibleKeys : visibleKeys"
                :fixed-keys="pickerScope === 'player' && leagueMode ? ['nickname', 'league_rating'] : []"
                @close="showColPicker = false" @toggle="toggleCol"
                @select-all="selectAllCols" @reset="resetCols" @reorder="handleReorder" />
            </span>
            <button class="sm" :disabled="loading || exportingPng || exportActive" @click="startExportJob('aggregate', teamNamesPayload())">
              <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_aggregate') }}
            </button>
            <button class="ghost sm" :disabled="loading || exportingPng || exportActive" @click="startExportJob('each', teamNamesPayload())">
              <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_each') }}
            </button>
            <button class="ghost sm" :disabled="loading || exportingPng" @click="downloadResultPng">
              <svg class="ic" viewBox="0 0 24 24" width="16" height="16"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12"/></svg>
              {{ exportingPng ? $t('replay.png_exporting') : $t('action.download_png') }}
            </button>
          </div>
        </div>

        <p v-if="!resp.battles.length && !resp.aggregate.length && !leagueData" class="replay-empty-note">{{ $t('replay.no_results') }}</p>

        <div v-show="activeTab === 'aggregate' && (resp.aggregate.length || leagueMode)" ref="aggregateRef">
          <template v-if="leagueMode">
            <LeagueSummaryTable :title="$t('league.summary.title_player')" type="player"
              :rows="leagueData?.playerSummaries || []" :columns="leagueData?.playerSummaryColumns || []"
              :team-names="summaryTeamNames" @update-summary-team-name="updateSummaryTeamName" />
            <LeagueSummaryTable :title="$t('league.summary.title_team')" type="team"
              :rows="leagueData?.teamSummaries || []" :columns="leagueData?.teamSummaryColumns || []"
              :team-names="summaryTeamNames" @update-summary-team-name="updateSummaryTeamName" />
          </template>
          <AggregateTable v-else :aggregate="resp.aggregate" :shown-cols="shownAggCols" :agg-stats="aggStats" />
        </div>

        <div v-for="(b, i) in resp.battles" :key="i" v-show="activeTab === 'b' + i"
             :ref="(el) => setBattleRef(el, i)">
          <BattleTable :battle="b" :shown-cols="shownCols"
            :league="b.league" :league-columns="leagueData?.columns || []"
            :team-names="battleTeamNames" @update-team-name="updateBattleTeamName" />
        </div>
        </template>
      </div>

      <div v-show="workspaceTab === 'ai'" data-test="workspace-ai-panel">
        <AiReviewPanel :file="workspaceFile" login-view="replay" @seek="onAiSeek" />
      </div>
      <div v-show="workspaceTab === 'playback'" data-test="workspace-playback-panel">
        <!-- active=进入战局回放 capability 时面板才自动加载地图；AI 复盘期间保持挂载但不发请求 -->
        <BattlePlaybackPanel :file="workspaceFile" :active="workspaceTab === 'playback'" :seek-to="playbackSeek" login-view="replay" />
      </div>
    </template>

    <ReplayTaskCard v-if="processingJob && !exportJob" :job="processingJob" :error="processingError"
      kind="processing"
      @cancel="cancelProcessingJob" @dismiss="dismissProcessingJob" />
    <ReplayTaskCard v-if="exportJob" :job="exportJob" :error="exportError"
      kind="export"
      @cancel="cancelExportJob" @download="downloadExportResult" @dismiss="dismissExportJob" />

    <RemoveConfirmModal :pending="pendingRemove" @confirm="confirmRemove" @cancel="cancelRemove" />
  </div>
</template>

<style>
/* Workspace 一级能力切换（解析结果 / AI 复盘 / 战局回放）：复用全局 .tabs 视觉 */
.workspace-tabs { margin-top: 16px; }
.battle-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 14px;
  border: 1px solid var(--border-ghost);
  border-radius: 7px;
  background: var(--bg-card);
  color: var(--text-label);
  cursor: pointer;
  font-size: .82rem;
  font-family: inherit;
  font-weight: 700;
  white-space: nowrap;
}
.battle-action:hover { border-color: var(--accent); color: var(--accent-dark); background: var(--bg-blue-light); }
.battle-action.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}
.battle-action.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--accent-text); }
.replay-empty-note { padding: 18px 4px; color: var(--text-muted); font-size: .85rem; }
/* League Rating 校验失败汇总（plan §17/§18）：warning 语义，可展开，不铺满超长文件名 */
.league-failure-summary { margin-top: 10px; padding: 10px 14px; }
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
  border: 1px solid rgba(224,160,45,.5);
  border-radius: 6px;
  background: transparent;
  color: var(--warn-text);
  cursor: pointer;
  font-size: .78rem;
  font-family: inherit;
}
.lf-toggle:hover { background: rgba(224,160,45,.16); }
.league-failure-detail { margin-top: 8px; border-top: 1px solid rgba(224,160,45,.25); padding-top: 8px; }
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
.lf-group-head:hover { background: rgba(224,160,45,.14); color: var(--warn-text); }
.lf-group-files {
  margin: 2px 0 6px;
  padding: 2px 8px 2px 22px;
  color: var(--text-muted);
  font-size: .78rem;
  word-break: break-word;
}
.league-unavailable { margin-top: 10px; padding: 8px 14px; font-size: .85rem; }
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
/* PNG 导出：取消 sticky 定位，避免固定列覆盖其他列（plan §19） */
.replay-export-root .sticky-col {
  position: static !important;
}
/* PNG 导出：League 概览与汇总表样式（深色/浅色均可读） */
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
.replay-export-root .mcards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.replay-export-root .mc {
  background: var(--exp-card-bg);
  border: 1px solid var(--exp-border);
  border-radius: 8px;
  padding: 14px 16px;
  text-align: center;
}
.replay-export-root .mc .k {
  font-size: .78rem;
  color: var(--exp-text-sub);
  margin-bottom: 4px;
}
.replay-export-root .mc .v {
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
  background: var(--exp-header-bg);
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
  background: var(--exp-t1-bg);
}
.replay-export-root tbody tr.t2 td {
  background: var(--exp-t2-bg);
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
.replay-export-root .scroll-hint {
  display: none;
}
</style>
