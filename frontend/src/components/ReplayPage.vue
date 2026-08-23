<script setup>
import { ref, nextTick, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapLabel, displayName } from '../utils/helpers.js'
import { setPendingReplayFiles } from '../utils/replayTransfer.js'
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
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import ReplayTaskCard from './ReplayTaskCard.vue'

const { locale, t } = useI18n()
const replay = useReplay()
const { files, loading, error, resp, activeTab, aggStats, pendingRemove, updateFiles,
  processingJob, processingError, processingActive,
  exportJob, exportError, exportActive,
  startProcessingJob, cancelProcessingJob, dismissProcessingJob,
  startExportJob, cancelExportJob, downloadExportResult, dismissExportJob,
  askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove } = replay
const cols = useColumns(replay.playerCols, replay.aggCols, replay.activeTab)
const { visibleKeys, aggVisibleKeys, showColPicker, pickerScope,
  currentOrder, shownCols, shownAggCols,
  toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder } = cols

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
 * Summary context 不渲染这些入口。文件经 replayTransfer 单例跨视图传给 ReconstructionPage。 */
const navigate = inject('navigate', null)
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
 * 先在当前页明确告知（登录后需重新选择回放），确认后再去登录；已登录走 replayTransfer
 * SPA 内跨视图交接（文件不落 localStorage，仅内存 + 服务端不保存回放）。
 */
function requireLoginForBattleAction() {
  if (isAuthenticated()) return true
  const ok = window.confirm(t('replay.login_required_for_battle'))
  if (ok && login) login('replay')
  return false
}

function openBattlePlayback() {
  const f = currentBattleFile()
  if (!f || !navigate) return
  if (!requireLoginForBattleAction()) return
  setPendingReplayFiles([f], 'playback')
  navigate('reconstruction')
}

function openAiReview() {
  const f = currentBattleFile()
  if (!f || !navigate) return
  if (!requireLoginForBattleAction()) return
  setPendingReplayFiles([f], 'ai')
  navigate('reconstruction')
}

async function preview() { await startProcessingJob(cols.initFromResponse) }

function onFileRemoveRequest(f) { askRemoveFile(f) }
</script>

<template>
  <div class="layout-data-workspace">
    <FileUploader :files="files" :loading="loading" :confirm-remove="!!resp"
      @update:files="updateFiles" @preview="preview" @remove-request="onFileRemoveRequest" />

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="resp">
      <div v-if="resp.duplicates.length" class="warn">
        {{ $t('result.duplicates', { count: resp.duplicates.length }) }}
        <span v-for="(d, i) in resp.duplicates" :key="i">{{ d[0] }}</span>
      </div>
      <div v-if="resp.failures.length" class="error">
        {{ $t('result.failures', { count: resp.failures.length }) }}
        <span v-for="(f, i) in resp.failures" :key="i">{{ f[0] }} ({{ f[1] }})</span>
      </div>

      <div class="restoolbar">
        <div class="tabs" :class="{ locked: showColPicker }"
             :title="showColPicker ? $t('action.picker_locked') : ''">
          <button v-if="resp.aggregate.length" :disabled="showColPicker"
                  :class="{ active: activeTab === 'aggregate' }"
                  @click="activeTab = 'aggregate'">{{ $t('result.aggregate_tab', { count: resp.aggregate.length }) }}</button>
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
              @close="showColPicker = false" @toggle="toggleCol"
              @select-all="selectAllCols" @reset="resetCols" @reorder="handleReorder" />
          </span>
          <button class="sm" :disabled="loading || exportingPng || exportActive" @click="startExportJob('aggregate')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_aggregate') }}
          </button>
          <button class="ghost sm" :disabled="loading || exportingPng || exportActive" @click="startExportJob('each')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_each') }}
          </button>
          <button class="ghost sm" :disabled="loading || exportingPng" @click="downloadResultPng">
            <svg class="ic" viewBox="0 0 24 24" width="16" height="16"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12"/></svg>
            {{ exportingPng ? $t('replay.png_exporting') : $t('action.download_png') }}
          </button>
        </div>
      </div>

      <div v-show="activeTab === 'aggregate' && resp.aggregate.length" ref="aggregateRef">
        <AggregateTable :aggregate="resp.aggregate" :shown-cols="shownAggCols" :agg-stats="aggStats" />
      </div>

      <div v-for="(b, i) in resp.battles" :key="i" v-show="activeTab === 'b' + i"
           :ref="(el) => setBattleRef(el, i)">
        <BattleTable :battle="b" :shown-cols="shownCols" />
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