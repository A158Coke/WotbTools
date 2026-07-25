<script setup>
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapLabel } from '../utils/helpers.js'
import { useReplay } from '../composables/useReplay.js'
import { useColumns } from '../composables/useColumns.js'
import {
  getExportTarget,
  computeExportDimensions,
  exportPngFilename,
  downloadBlob
} from '../utils/exportReplayPng.js'
import FileUploader from './FileUploader.vue'
import ColumnPicker from './ColumnPicker.vue'
import AggregateTable from './AggregateTable.vue'
import BattleTable from './BattleTable.vue'
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import RatingModal from './RatingModal.vue'

const { locale, t } = useI18n()
const replay = useReplay()
const { files, loading, error, resp, activeTab, aggStats, pendingRemove,
  askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove } = replay
const cols = useColumns(replay.playerCols, replay.aggCols, replay.activeTab)
const { visibleKeys, aggVisibleKeys, showColPicker, pickerScope,
  currentOrder, shownCols, shownAggCols,
  toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder } = cols

const showRating = ref(false)
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
  }
}

function waitForLayout() {
  return new Promise(resolve => {
    nextTick(() => requestAnimationFrame(resolve))
  })
}

function measureExportClone(clone) {
  return {
    width: clone.scrollWidth || clone.getBoundingClientRect().width || 800,
    height: clone.scrollHeight || clone.getBoundingClientRect().height || 600
  }
}

function cleanupExportClone(container) {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container)
  }
}

async function downloadResultPng() {
  if (exportingPng.value || loading.value) return
  const target = getExportTarget(activeTab.value, aggregateRef.value, battleRefs.value)
  if (!target) return

  const theme = readTheme()
  let cloneCtx = null

  exportingPng.value = true
  error.value = ''

  try {
    cloneCtx = createExportClone(target, theme)
    expandExportTables(cloneCtx.clone)
    await waitForLayout()
    const dims = computeExportDimensions(cloneCtx.clone)

    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(cloneCtx.clone, {
      scale: dims.scale,
      useCORS: true,
      backgroundColor: EXPORT_BG[theme],
      width: dims.width,
      height: dims.height
    })

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('toBlob returned null')

    const battleIdx = parseInt(activeTab.value.replace('b', ''), 10)
    const mapName = !isNaN(battleIdx) && resp.value?.battles?.[battleIdx]?.mapName
      ? mapLabel(resp.value.battles[battleIdx].mapName, locale.value)
      : undefined
    const filename = exportPngFilename(activeTab.value, isNaN(battleIdx) ? 0 : battleIdx, mapName)
    await downloadBlob(blob, filename)
  } catch (e) {
    error.value = t('replay.png_export_failed')
  } finally {
    if (cloneCtx) cleanupExportClone(cloneCtx.container)
    exportingPng.value = false
  }
}

async function preview() { await replay.doPreview(cols.initFromResponse) }
async function exportXlsx(mode) { await replay.doExport(mode) }
function onFileRemoveRequest(f) { askRemoveFile(f) }
</script>

<template>
  <div class="wrap">
    <FileUploader :files="files" :loading="loading" :confirm-remove="!!resp"
      @update:files="files = $event" @preview="preview" @remove-request="onFileRemoveRequest" />

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
          <button class="ghost sm" @click="showRating = true">
            <svg class="ic" viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9.6 9.4a2.4 2.4 0 0 1 4.4 1.3c0 1.6-2 1.9-2 3.3M12 17h.01" /></svg>{{ $t('rating_help.btn') }}
          </button>
          <span class="dropdown">
            <button class="ghost sm" @click="toggleColPicker">
              <svg class="ic" viewBox="0 0 24 24"><path d="M4 4h16v16H4zM10 4v16" /></svg>{{ $t('action.select_cols') }} v
            </button>
            <ColumnPicker v-if="showColPicker" :scope="pickerScope" :order="currentOrder"
              :visible="pickerScope === 'agg' ? aggVisibleKeys : visibleKeys"
              @close="showColPicker = false" @toggle="toggleCol"
              @select-all="selectAllCols" @reset="resetCols" @reorder="handleReorder" />
          </span>
          <button class="sm" :disabled="loading || exportingPng" @click="exportXlsx('aggregate')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_aggregate') }}
          </button>
          <button class="ghost sm" :disabled="loading || exportingPng" @click="exportXlsx('each')">
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

    <RemoveConfirmModal :pending="pendingRemove" @confirm="confirmRemove" @cancel="cancelRemove" />
    <RatingModal :show="showRating" @close="showRating = false" />
  </div>
</template>

<style scoped>
.replay-export-light {
  --exp-bg: #ffffff;
  --exp-card-bg: #f8f9fa;
  --exp-text: #1a1a1a;
  --exp-text-sub: #666666;
  --exp-border: #dee2e6;
  --exp-header-bg: #e9ecef;
  --exp-t1-bg: #e3f2fd;
  --exp-t2-bg: #fce4ec;
  --exp-badge-bg: #fff3cd;
  --exp-badge-text: #856404;
  --exp-alive: #28a745;
  --exp-destroyed: #dc3545;
}

.replay-export-dark {
  --exp-bg: #1e1e1e;
  --exp-card-bg: #2d2d2d;
  --exp-text: #e0e0e0;
  --exp-text-sub: #999999;
  --exp-border: #444444;
  --exp-header-bg: #333333;
  --exp-t1-bg: #1a3a5c;
  --exp-t2-bg: #5c2a3a;
  --exp-badge-bg: #5a4a10;
  --exp-badge-text: #ffd700;
  --exp-alive: #4caf50;
  --exp-destroyed: #ef5350;
}

.replay-export-root {
  background: var(--exp-bg);
  color: var(--exp-text);
  padding: 16px;
  font-size: 13px;
  line-height: 1.5;
  width: max-content;
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
.replay-export-root .rbadge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 44px;
  min-height: 22px;
  text-align: center;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 800;
  background: var(--exp-badge-bg);
  color: var(--exp-badge-text);
  font-variant-numeric: tabular-nums;
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
