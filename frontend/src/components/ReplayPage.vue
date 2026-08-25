<script setup>
import { ref, computed, watch, nextTick, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapLabel, displayName, fileKey } from '../utils/helpers.js'
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
import CwPlayerSummaryTable from './CwPlayerSummaryTable.vue'
import PlayerDetailDrawer from './PlayerDetailDrawer.vue'
import { mergeCwPlayerRows, mergeCwPlayerColumns, CW_DIM_KEYS } from '../utils/playerSummaryMerge.js'
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import ReplayTaskCard from './ReplayTaskCard.vue'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'
import AiReviewPanel from './AiReviewPanel.vue'
import BattlePlaybackPanel from './BattlePlaybackPanel.vue'

const { locale, t, te } = useI18n()
const replay = useReplay()
const { files, loading, error, resp, activeTab, aggStats, pendingRemove, updateFiles, selectionRevision,
  processingJob, processingError, processingActive,
  uploadState, cancelProcessing,
  requestDirectAction,
  exportJob, exportError, exportActive,
  startProcessingJob, dismissProcessingJob,
  startExportJob, cancelExportJob, downloadExportResult, dismissExportJob,
  askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove } = replay
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

const cols = useColumns(replay.playerCols, replay.aggCols, replay.activeTab, leagueMode)
const { visibleKeys, aggVisibleKeys, cwVisibleKeys, cwOrder, showColPicker, pickerScope,
  currentOrder, shownCols, shownAggCols,
  toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder } = cols

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

function selectPlayer(context) {
  selectedPlayerContext.value = context
}

function closeDrawer() {
  selectedPlayerContext.value = null
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
    // 统一玩家表行：优先 unifiedRows（含 league join），按 accountId 查找
    const row = unifiedRows.value.find(r => Number(r.cells.account_id) === Number(ctx.accountId))
    if (!row) return null
    return {
      accountId: row.cells.account_id,
      nickname: row.cells.nickname,
      clan: row.cells.clan || '',
      rating: row.cells.league_rating,
      ratingMedian: row.cells.league_rating,
      // Summary Radar 七维 = league playerSummary 的 dimensionMeans（rated-battle 算术平均；
      // 与 Table 的 dimensionMedians 严格分离）。aggregate-only 玩家（row.league null）→
      // undefined → Radar 轴 unavailable（"--"），不冒充 0。
      dimensionMeans: row.league?.dimensionMeans ?? null,
      mvpCount: row.cells.mvp_count,
      battles: row.cells.battles,
      wins: row.cells.wins,
      cells: row.cells,
    }
  }
  // scope === 'battle'：该场 BattleTable 玩家行
  const battle = (resp.value?.battles || []).find(b => b.arenaId === ctx.arenaId)
  const row = battle?.players?.find(p => Number(p.cells.account_id) === Number(ctx.accountId))
  if (!row) return null
  return {
    accountId: row.cells.account_id,
    nickname: row.cells.nickname,
    clan: row.cells.clan || '',
    rating: row.cells.league_rating,
    // Battle Radar 七维 = 本场 league_*_score（禁止命名/复用跨场 dimensionMedians/Means）
    dimensionScores: CW_DIM_KEYS.map(k => row.cells[k]),
    cells: row.cells,
  }
})

/** selection 变化（上传/删除/替换/clear/新 batch）→ 关闭 Drawer 防旧数据污染。 */
watch(selectionRevision, () => {
  selectedPlayerContext.value = null
})

/** Tab 切换（汇总 ↔ Battle 或 Battle ↔ Battle）→ 关闭 Drawer 避免上下文混淆。 */
watch(activeTab, () => {
  selectedPlayerContext.value = null
})

// ---- League Rating 校验失败展示（neutral/warning 语义 + 可展开汇总，
//      不把 league failure 显示成红色「文件解析失败」，不默认铺满超长文件名）----
const showLeagueFailures = ref(false)
const expandedLeagueGroups = ref({})

/** 已评分场数（battle.league != null ⟺ 该场完成 Rating；identity 绑定，不依赖数组 index）。 */
const ratedBattleCount = computed(() =>
  (resp.value?.battles || []).filter(b => !!b.league).length)

/** 死亡时间 UNKNOWN 的阵亡玩家数（backend authoritative ratingQuality；
 *  非阻断 quality limitation——这些玩家照常评分，仅存活/互换维度按 0 分保守计算）。 */
const unknownDeathTimeCount = computed(() =>
  leagueData.value?.ratingQuality?.unknownDeathTimePlayers || 0)

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

/** 混合批次（普通 + 训练赛/联赛混传）League Rating 不可用提示。 */
const leagueUnavailableMessage = computed(() => {
  const code = resp.value?.leagueUnavailableCode
  if (!code) return ''
  return t('league.unavailable_mixed')
})
/**
 * 汇总 tab 的真实基础选手数量：一律来自 Replay Core 的 resp.aggregate。
 * League Rating 的选手数属于 League 区块，不得混入基础汇总人数。
 */
const aggregatePlayerCount = computed(() => replayAggregatePlayerCount(resp.value))
/**
 * 两种独立的战队名称 override（禁止扁平混合）：
 * - battleTeamNames：{arenaId:team} → 名（单场显示 / 单场 PNG / 单场与 each Excel）
 * - summaryTeamNames：{teamKey} → 名（批次战队汇总显示 / aggregate Excel 战队汇总）
 * 仅当前页面内存；批次 rename 不得反向写入所有 {arenaId:team}。
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
 * Team override 绑定当前 replay selection：任何 selection 变化
 * （add/remove/replace/clear/remove battle/folder，全部经 updateFiles → selectionRevision++）
 * 都使两组 override 同时失效；同一 selection 单纯重新 Processing 不清空（不依赖
 * startProcessingJob / Processing lifecycle）。
 */
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
    // PNG = 当前视图（所见即所得）：克隆当前 DOM 即得到当前 ColumnPicker 可见列与顺序、
    // 当前排序与战队名称覆盖，不做任何全量列替换（XLSX 才是完整数据导出，与前端偏好解耦）。
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


/** Battle context actions：具体 battle 才出现「战局回放 / AI 复盘」。
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
/** 当前 workspace 文件对应的 Dataset 引用（{processingJobId, sourceId}；换文件即失效）。 */
const datasetRef = ref(null)
/**
 * Workspace Dataset 请求 generation（BLOCKER 1）：每次目标变化（workspaceFile 或新的
 * ensureDatasetFor 调用）自增；requestDirectAction 是异步的，返回后必须校验 revision +
 * target file identity 仍属于当前 generation，否则直接丢弃——绝不让 A 的迟到响应把
 * datasetRef 绑到已切走的 B 上（data correctness，不是 UI cosmetic）。
 */
let workspaceDatasetRevision = 0

/**
 * 目标文件变化 → 旧 dataset 引用立即失效（清空，UI 不残留旧引用）。revision 的递增
 * 只由 ensureDatasetFor 负责（每次请求前 ++）；这里不能 ++——Vue 的 pre-flush watcher
 * 会在「请求发起后、await 续体前」运行，把当前请求自己误判成 stale（BLOCKER 1 竞态测试
 * 暴露：workspaceFile 变化 → flush → revision 被顶掉 → 新 dataset 被丢弃）。清空旧值
 * 只是即时 UI 失效；真正的 ownership 由 ensureDatasetFor 的 revision + fileKey 校验保证。
 */
watch(workspaceFile, () => {
  datasetRef.value = null
})

/**
 * 确保目标 source READY 后返回 Dataset 引用（自动创建/复用 Processing Job，plan §40）。
 * 写入 datasetRef 前必须确认：请求发起时的 revision 仍是最新、当前 workspaceFile 的
 * fileKey 仍等于目标文件。任何 stale 结果（成功或失败）一律 discard——不写 datasetRef、
 * 不写 processingError、不修改当前 workspace 状态。
 */
async function ensureDatasetFor(file) {
  if (!file) return null
  const revision = ++workspaceDatasetRevision
  const targetKey = fileKey(file)
  try {
    const ref = await requestDirectAction(file, workspaceTab.value)
    const current = workspaceFile.value
    if (revision !== workspaceDatasetRevision || !current || fileKey(current) !== targetKey) {
      // stale response：不属于当前 workspace generation，直接丢弃。
      return null
    }
    datasetRef.value = ref
    return ref
  } catch (e) {
    const current = workspaceFile.value
    if (revision === workspaceDatasetRevision && current && fileKey(current) === targetKey) {
      // 仅当前 generation 的失败才允许写错误；stale 错误不得污染新 selection。
      datasetRef.value = null
      processingError.value = e?.message || String(e)
    }
    return null
  }
}

async function openWorkspacePlayback(file) {
  workspaceTab.value = 'playback'
  workspaceFile.value = file
  playbackSeek.value = null
  await ensureDatasetFor(file)
}

async function openWorkspaceAi(file) {
  workspaceTab.value = 'ai'
  workspaceFile.value = file
  await ensureDatasetFor(file)
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
async function selectWorkspaceTab(tab) {
  if (tab === 'ai' || tab === 'playback') {
    if (!workspaceFile.value && files.value.length === 1) {
      if (!requireLoginForBattleAction()) return
      workspaceFile.value = files.value[0]
      await ensureDatasetFor(files.value[0])
    }
  }
  workspaceTab.value = tab
}

/** FileUploader 直接入口（单文件 / 显式选择）上抛：原地切到对应面板。 */
async function onWorkspaceAction({ file, mode }) {
  if (!requireLoginForBattleAction()) return
  if (mode === 'playback') openWorkspacePlayback(file)
  else openWorkspaceAi(file)
}

async function openBattlePlayback() {
  const f = currentBattleFile()
  if (!f) return
  if (!requireLoginForBattleAction()) return
  openWorkspacePlayback(f)
}

async function openAiReview() {
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

    <!-- 主操作区 inline 进度面板（plan §32/§35）：不依赖 files/resp 渲染条件，
         与 Export 任务卡各自独立，不再互斥隐藏（BLOCKER H）。 -->
    <ReplayProcessingPanel
      v-if="uploadState || processingJob"
      :upload-state="uploadState"
      :job="processingJob"
      :error="processingError"
      @cancel="cancelProcessing"
      @dismiss="dismissProcessingJob" />

    <!-- Workspace：有文件（解析前也能直接进 AI/回放）或已有解析结果时可见；
         resp 依赖 files 才存在，故 files.length || resp 与真实状态机一致。 -->
    <template v-if="files.length || resp">
      <div class="workspace-tabs" role="tablist" aria-label="Workspace">
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
        <div v-if="leagueData && (leagueData.failures?.length || unknownDeathTimeCount > 0)" class="warn league-failure-summary" data-testid="league-failure-summary">
          <div class="league-failure-head">
            <span class="lf-title">{{ $t('league.title') }}</span>
            <span class="lf-rated">{{ $t('league.rated_count', { rated: ratedBattleCount, total: resp.battles.length }) }}</span>
            <span v-if="leagueData.failures?.length" class="lf-unrated">{{ $t('league.unrated_count', { count: resp.battles.length - ratedBattleCount }) }}</span>
            <button v-if="leagueData.failures?.length" class="lf-toggle" data-testid="league-failure-toggle" :aria-expanded="showLeagueFailures"
                    @click="toggleLeagueFailures">
              {{ showLeagueFailures ? $t('league.failure_hide') : $t('league.failure_view') }}
            </button>
          </div>
          <div v-if="unknownDeathTimeCount > 0" class="league-quality-warning" data-testid="league-quality-warning">
            {{ $t('league.death_time_unknown_warning', { count: unknownDeathTimeCount }) }}
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
                :visible="pickerScope === 'agg' ? aggVisibleKeys : pickerScope === 'cw' ? cwVisibleKeys : visibleKeys"
                :fixed-keys="(pickerScope === 'cw' || (pickerScope === 'player' && leagueMode)) ? ['nickname', 'league_rating'] : []"
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
          <!-- 普通模式：基础 Replay Aggregate（Standard Replay 保持原语义）。 -->
          <template v-if="!leagueMode && resp.aggregate.length">
            <h2 class="replay-section-title" data-testid="base-aggregate-title">{{ $t('result.base_summary_title') }}</h2>
            <AggregateTable :aggregate="resp.aggregate" :shown-cols="shownAggCols" :agg-stats="aggStats" />
          </template>
          <!-- CW 模式：统一玩家主表（Replay Aggregate ∪ League Rating 按 accountId，
               缺失 League 补 "--"）+ 战队独立表。不允许再出现两张平级玩家表。 -->
          <template v-if="leagueMode">
            <h2 class="replay-section-title" data-testid="league-summary-title">{{ $t('league.summary.section_title') }}</h2>
            <CwPlayerSummaryTable :title="$t('league.summary.title_player')"
              :rows="unifiedRows" :columns="unifiedShownCols"
              :league-columns="leagueData?.columns || []" :league-mode="true"
              :active="activeTab === 'aggregate'"
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

        <div v-for="(b, i) in resp.battles" :key="i" v-show="activeTab === 'b' + i"
             :ref="(el) => setBattleRef(el, i)">
          <BattleTable :battle="b" :shown-cols="shownCols"
            :active="activeTab === 'b' + i"
            :league-mode="leagueMode" :league="b.league" :league-columns="leagueData?.columns || []"
            :team-names="battleTeamNames" @update-team-name="updateBattleTeamName"
            :selected-account-id="selectedPlayer?.accountId ?? null"
            :selected-arena-id="selectedPlayer?.arenaId ?? null"
            @select-player="selectPlayer" />
        </div>
        </template>
      </div>

      <div v-show="workspaceTab === 'ai'" data-test="workspace-ai-panel">
        <AiReviewPanel :file="workspaceFile" :processing-job-id="datasetRef?.processingJobId ?? null"
          :source-id="datasetRef?.sourceId ?? null" login-view="replay" @seek="onAiSeek" />
      </div>
      <div v-show="workspaceTab === 'playback'" data-test="workspace-playback-panel">
        <!-- active=进入战局回放 capability 时面板才自动加载地图；AI 复盘期间保持挂载但不发请求 -->
        <BattlePlaybackPanel :file="workspaceFile" :processing-job-id="datasetRef?.processingJobId ?? null"
          :source-id="datasetRef?.sourceId ?? null" :active="workspaceTab === 'playback'"
          :seek-to="playbackSeek" login-view="replay" />
      </div>
    </template>

    <ReplayTaskCard v-if="exportJob" :job="exportJob" :error="exportError"
      kind="export"
      @cancel="cancelExportJob" @download="downloadExportResult" @dismiss="dismissExportJob" />

    <RemoveConfirmModal :pending="pendingRemove" @confirm="confirmRemove" @cancel="cancelRemove" />
    <PlayerDetailDrawer :context="drawerOpen ? selectedPlayerContext : null" :player="drawerPlayer"
                        :league-columns="leagueData?.columns || []"
                        @close="closeDrawer" />
  </div>
</template>

<style>
/* Workspace 一级能力切换（解析结果 / AI 复盘 / 战局回放）：紧凑单行一级导航。
   视觉样式在 showcase-workspaces.css（.layout-data-workspace .workspace-tabs），
   不复用 restoolbar 的 battle 分栏 .tabs。 */
/* 汇总 Tab 双区块：基础 Replay Aggregate 与 League Rating 汇总并列，
   各自独立标题，League Rating 是附加分析不是替代品。 */
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
/* League Rating 校验失败汇总：warning 语义，可展开，不铺满超长文件名 */
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
/* 死亡时间 UNKNOWN 质量提示（非阻断 warning；不是 failure） */
.league-quality-warning { margin-top: 8px; font-size: .85rem; color: var(--warn-text); }
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
/* PNG 导出：取消 sticky 定位，避免固定列覆盖其他列 */
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
