<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapLabel } from '../utils/helpers.js'
import { useReplay } from '../composables/useReplay.js'
import { useColumns } from '../composables/useColumns.js'
import FileUploader from './FileUploader.vue'
import ColumnPicker from './ColumnPicker.vue'
import AggregateTable from './AggregateTable.vue'
import BattleTable from './BattleTable.vue'
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import RatingModal from './RatingModal.vue'

const { locale } = useI18n()
const replay = useReplay()
const { files, loading, error, resp, activeTab, aggStats, pendingRemove,
  askRemoveBattle, cancelRemove } = replay
const cols = useColumns(replay.playerCols, replay.aggCols, replay.activeTab)
const { visibleKeys, aggVisibleKeys, showColPicker, pickerScope,
  currentOrder, shownCols, shownAggCols,
  toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder } = cols

const showRating = ref(false)

async function preview() { await replay.doPreview(cols.initFromResponse) }
async function exportXlsx(mode) { await replay.doExport(mode) }
function confirmRemoveBattle() { replay.confirmRemoveBattle(cols.initFromResponse) }
</script>

<template>
  <div class="wrap">
    <FileUploader :files="files" :loading="loading" @update:files="files = $event" @preview="preview" />

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
        </div>
      </div>

      <div v-show="activeTab === 'aggregate' && resp.aggregate.length">
        <AggregateTable :aggregate="resp.aggregate" :shown-cols="shownAggCols" :agg-stats="aggStats" />
      </div>

      <div v-for="(b, i) in resp.battles" :key="i" v-show="activeTab === 'b' + i">
        <BattleTable :battle="b" :shown-cols="shownCols" />
      </div>
    </template>

    <RemoveConfirmModal :pending="pendingRemove" @confirm="confirmRemoveBattle" @cancel="cancelRemove" />
    <RatingModal :show="showRating" @close="showRating = false" />
  </div>
</template>
