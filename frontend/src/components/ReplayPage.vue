<script setup>
import { ref } from 'vue'
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

function prepareClone(doc) {
  // 1. Resolve color-mix() etc to computed values
  const all = doc.querySelectorAll('*')
  for (const el of all) {
    const cs = doc.defaultView.getComputedStyle(el)
    for (const p of ['background', 'background-color', 'color',
      'border-color', 'border-top-color', 'border-bottom-color',
      'border-left-color', 'border-right-color']) {
      const v = cs[p]
      if (v && /color-mix|oklch|oklab|color\(/i.test(v)) {
        el.style.setProperty(p, cs[p])
      }
    }
  }
  // 2. Expand table wrappers so all columns are visible
  for (const wrap of doc.querySelectorAll('.tablewrap')) {
    wrap.style.overflow = 'visible'
    wrap.style.maxWidth = 'none'
    // If the parent is the scroll container, also expand it
    if (wrap.parentElement?.classList.contains('replay-export-root')) {
      wrap.parentElement.style.width = wrap.scrollWidth + 'px'
    }
  }
}

async function downloadResultPng() {
  if (exportingPng.value) return
  const target = getExportTarget(activeTab.value, aggregateRef.value, battleRefs.value)
  if (!target) return

  exportingPng.value = true
  error.value = ''

  try {
    const dims = computeExportDimensions(target)
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(target, {
      scale: dims.scale,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: dims.width,
      height: dims.height,
      onclone: prepareClone
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
          <button class="sm" :disabled="loading" @click="exportXlsx('aggregate')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_aggregate') }}
          </button>
          <button class="ghost sm" :disabled="loading" @click="exportXlsx('each')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_each') }}
          </button>
          <button class="ghost sm" :disabled="exportingPng" @click="downloadResultPng">
            <svg class="ic" viewBox="0 0 24 24" width="16" height="16"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12"/></svg>
            {{ exportingPng ? $t('replay.png_exporting') : $t('action.download_png') }}
          </button>
        </div>
      </div>

      <!-- Aggregate result: isolated ref, v-show hides when inactive -->
      <div v-show="activeTab === 'aggregate' && resp.aggregate.length" ref="aggregateRef" class="replay-export-root replay-export-light">
        <AggregateTable :aggregate="resp.aggregate" :shown-cols="shownAggCols" :agg-stats="aggStats" />
      </div>

      <!-- Single battle: isolated ref for each battle -->
      <div v-for="(b, i) in resp.battles" :key="i" v-show="activeTab === 'b' + i"
           :ref="(el) => setBattleRef(el, i)" class="replay-export-root replay-export-light">
        <BattleTable :battle="b" :shown-cols="shownCols" />
      </div>
    </template>

    <RemoveConfirmModal :pending="pendingRemove" @confirm="confirmRemove" @cancel="cancelRemove" />
    <RatingModal :show="showRating" @close="showRating = false" />
  </div>
</template>

<style scoped>
/**
 * Export-specific styles for PNG capture.
 * Uses explicit colors — no color-mix(), oklch(), oklad(), color().
 */
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
  --exp-warn-bg: #fff3cd;
  --exp-error-bg: #f8d7da;
  --exp-error-text: #721c24;
  --exp-alive: #28a745;
  --exp-destroyed: #dc3545;
}

.replay-export-root {
  background: var(--exp-bg);
  color: var(--exp-text);
  padding: 16px;
  font-size: 13px;
  line-height: 1.5;
}
.replay-export-root :deep(table) {
  border-collapse: collapse;
  width: auto;
  background: var(--exp-bg);
}
.replay-export-root :deep(th) {
  background: var(--exp-header-bg);
  color: var(--exp-text);
  padding: 6px 10px;
  border: 1px solid var(--exp-border);
  white-space: nowrap;
  font-weight: 600;
}
.replay-export-root :deep(td) {
  padding: 5px 10px;
  border: 1px solid var(--exp-border);
  color: var(--exp-text);
}
.replay-export-root :deep(.tablewrap) {
  overflow: visible;
  max-width: none;
}
.replay-export-root :deep(tbody tr.t1 td) {
  background: var(--exp-t1-bg);
}
.replay-export-root :deep(tbody tr.t2 td) {
  background: var(--exp-t2-bg);
}
.replay-export-root :deep(.badge) {
  background: var(--exp-badge-bg);
  color: var(--exp-badge-text);
  padding: 2px 6px;
  border-radius: 3px;
}
</style>
