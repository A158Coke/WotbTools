<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { useReplay } from '../composables/useReplay.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../utils/api.js'
import FileUploader from './FileUploader.vue'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'
import RatingV2RadarPanel from './RatingV2RadarPanel.vue'

const LOGIN_VIEW = 'rating-v2'

const { t, te } = useI18n()
const { initPromise, tokenParsed, login } = useAuth()
const replay = useReplay()
const {
  files, loading, error, updateFiles, selectionRevision,
  processingJob, processingError, processingActive, processingJobId,
  uploadState, startProcessingJob, cancelProcessing, dismissProcessingJob,
} = replay

const isAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && roles.includes('wotbtools-admin')
})

const authPhase = ref('initializing')
const ready = ref(false)
const denied = ref(false)
const ratingResponse = ref(null)
const ratingLoading = ref(false)
const ratingError = ref('')
const sort = ref(null)
const selectedRow = ref(null)
let requestVersion = 0

const sortedRows = computed(() => {
  const rows = ratingResponse.value?.rows || []
  if (!sort.value) return rows
  const { key, numeric, reverse } = sort.value
  const value = (row) => row.cells?.[key]
  return [...rows].sort((first, second) => {
    const left = value(first)
    const right = value(second)
    if (numeric) {
      const a = Number.parseFloat(String(left ?? '').replace('%', '')) || 0
      const b = Number.parseFloat(String(right ?? '').replace('%', '')) || 0
      return reverse ? b - a : a - b
    }
    const comparison = String(left ?? '').localeCompare(String(right ?? ''))
    return reverse ? -comparison : comparison
  })
})

function setSort(column) {
  const previous = sort.value
  sort.value = previous?.key === column.key
    ? { key: column.key, numeric: column.num, reverse: !previous.reverse }
    : { key: column.key, numeric: column.num, reverse: false }
}

function sortArrow(column) {
  if (sort.value?.key !== column.key) return ''
  return sort.value.reverse ? ' ▼' : ' ▲'
}

async function loadRating(jobId) {
  if (!jobId || !ready.value) return
  const version = ++requestVersion
  ratingLoading.value = true
  ratingError.value = ''
  try {
    const response = await api.ratingV2Admin(jobId)
    if (version !== requestVersion || processingJobId.value !== jobId) return
    ratingResponse.value = response
    selectedRow.value = null
  } catch (cause) {
    if (version !== requestVersion || processingJobId.value !== jobId) return
    ratingError.value = apiErrorLabel(t, te, cause)
    selectedRow.value = null
  } finally {
    if (version === requestVersion) ratingLoading.value = false
  }
}

async function runRating() {
  ratingError.value = ''
  selectedRow.value = null
  await startProcessingJob()
  if (processingJobId.value) await loadRating(processingJobId.value)
}

watch(processingJobId, (jobId) => {
  selectedRow.value = null
  if (jobId) void loadRating(jobId)
})

watch(selectionRevision, () => {
  requestVersion++
  ratingLoading.value = false
  ratingResponse.value = null
  ratingError.value = ''
  sort.value = null
  selectedRow.value = null
})

function selectPlayer(row) {
  selectedRow.value = row
}

function closePlayerRadar() {
  selectedRow.value = null
}

onMounted(async () => {
  let authenticated = false
  try {
    authenticated = Boolean(await initPromise)
  } catch {
    authenticated = false
  }
  if (!authenticated) {
    authPhase.value = 'login'
    login(LOGIN_VIEW)
    return
  }
  if (!isAdmin.value) {
    authPhase.value = 'denied'
    denied.value = true
    return
  }
  authPhase.value = 'ready'
  ready.value = true
})
</script>

<template>
  <main class="layout-data-workspace rating-v2-page">
    <header class="rating-v2-header">
      <p class="rating-v2-kicker">{{ t('ratingV2.kicker') }}</p>
      <h1>{{ t('ratingV2.title') }}</h1>
      <p>{{ t('ratingV2.description') }}</p>
    </header>

    <p v-if="authPhase === 'login'" class="rating-v2-note">{{ t('ratingV2.login') }}</p>
    <p v-else-if="denied" class="rating-v2-note">{{ t('ratingV2.denied') }}</p>

    <template v-else-if="ready">
      <FileUploader
        :files="files"
        :loading="loading"
        :confirm-remove="false"
        :show-workspace-actions="false"
        :show-preview="false"
        @update:files="updateFiles" />

      <div v-if="files.length" class="rating-v2-actions">
        <button class="rating-v2-run" data-testid="rating-v2-run"
          :disabled="loading || processingActive || ratingLoading"
          @click="runRating">
          {{ ratingLoading ? t('ratingV2.calculating') : t('ratingV2.run') }}
        </button>
        <span class="rating-v2-hint">{{ t('ratingV2.readyDatasetHint') }}</span>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="ratingError" class="error">{{ ratingError }}</p>

      <ReplayProcessingPanel
        v-if="uploadState || processingJob"
        :upload-state="uploadState"
        :job="processingJob"
        :error="processingError"
        @cancel="cancelProcessing"
        @dismiss="dismissProcessingJob" />

      <section v-if="ratingResponse?.duplicates?.length" class="rating-v2-notice warn">
        <strong>{{ t('result.duplicates', { count: ratingResponse.duplicates.length }) }}</strong>
        <span v-for="(item, index) in ratingResponse.duplicates" :key="`duplicate-${index}`">{{ item[0] }}</span>
      </section>

      <section v-if="ratingResponse?.failures?.length" class="rating-v2-notice error">
        <strong>{{ t('result.failures', { count: ratingResponse.failures.length }) }}</strong>
        <span v-for="(item, index) in ratingResponse.failures" :key="`failure-${index}`">{{ item[0] }} · {{ item[1] }}</span>
      </section>

      <section v-if="ratingResponse?.rows?.length" class="rating-v2-results">
        <div class="rating-v2-results-head">
          <h2>{{ t('ratingV2.results') }}</h2>
          <span>{{ t('ratingV2.rows', { count: ratingResponse.rows.length }) }}</span>
        </div>
        <div class="rating-v2-tablewrap">
          <table>
            <thead>
              <tr>
                <th v-for="column in ratingResponse.columns" :key="column.key" :class="{ num: column.num }"
                  :aria-sort="sort?.key === column.key ? (sort.reverse ? 'descending' : 'ascending') : 'none'">
                  <button class="rating-v2-sort" type="button" @click="setSort(column)">
                    {{ t(`ratingV2.labels.${column.key}`) }}{{ sortArrow(column) }}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in sortedRows" :key="`${row.cells.account_id || row.cells.nickname}-${index}`">
                <td v-for="column in ratingResponse.columns" :key="column.key" :class="{ num: column.num }">
                  <button v-if="column.key === 'nickname'" class="rating-v2-player" type="button"
                    :aria-label="t('ratingV2.radar.open', { player: row.cells[column.key] ?? '--' })"
                    :aria-pressed="selectedRow === row"
                    @click="selectPlayer(row)">
                    {{ row.cells[column.key] ?? '--' }}
                  </button>
                  <template v-else>{{ row.cells[column.key] ?? '--' }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <RatingV2RadarPanel v-if="selectedRow" :row="selectedRow" :rows="ratingResponse.rows" @close="closePlayerRadar" />
      </section>

      <p v-else-if="!loading && !processingActive && !ratingLoading && files.length" class="rating-v2-note">
        {{ t('ratingV2.empty') }}
      </p>
    </template>
  </main>
</template>

<style scoped>
.rating-v2-page { padding-bottom: 48px; }
.rating-v2-header { margin: 22px 0 16px; }
.rating-v2-kicker { margin: 0 0 4px; color: var(--accent); font-size: .74rem; font-weight: 800; letter-spacing: .14em; }
.rating-v2-header h1 { margin: 0; color: var(--text-heading); font-size: 1.3rem; }
.rating-v2-header p:not(.rating-v2-kicker), .rating-v2-note, .rating-v2-hint { color: var(--text-muted); }
.rating-v2-actions, .rating-v2-results-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 14px 0; }
.rating-v2-run { min-height: 38px; padding: 8px 16px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: var(--accent-text); cursor: pointer; font: inherit; font-weight: 800; }
.rating-v2-run:disabled { cursor: not-allowed; opacity: .55; }
.rating-v2-notice { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; }
.rating-v2-notice.warn { background: color-mix(in srgb, var(--accent) 10%, var(--bg-card)); }
.rating-v2-results { margin-top: 18px; padding: 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); }
.rating-v2-results-head { justify-content: space-between; margin-top: 0; }
.rating-v2-results-head h2 { margin: 0; color: var(--text-heading); font-size: 1rem; }
.rating-v2-results-head span { color: var(--text-muted); font-size: .85rem; }
.rating-v2-tablewrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
.rating-v2-tablewrap table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: .82rem; }
.rating-v2-tablewrap th, .rating-v2-tablewrap td { padding: 8px 10px; border-bottom: 1px solid var(--border-light); white-space: nowrap; }
.rating-v2-tablewrap th { padding: 0; background: var(--bg-card2); }
.rating-v2-sort { width: 100%; padding: 8px 10px; border: 0; background: transparent; color: var(--text-heading); cursor: pointer; font: inherit; font-weight: 700; text-align: inherit; }
.rating-v2-sort:hover, .rating-v2-sort:focus-visible { background: var(--bg-card-hover); outline: 1px solid var(--accent); outline-offset: -1px; }
.rating-v2-tablewrap th.num, .rating-v2-tablewrap td.num { text-align: right; font-variant-numeric: tabular-nums; }
.rating-v2-player { padding: 0; border: 0; background: transparent; color: var(--text-heading); cursor: pointer; font: inherit; font-weight: 700; text-align: left; }
.rating-v2-player:hover, .rating-v2-player:focus-visible, .rating-v2-player[aria-pressed="true"] { color: var(--accent); outline: none; text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 767px) {
  .rating-v2-page { padding-bottom: 28px; }
  .rating-v2-actions { align-items: stretch; }
  .rating-v2-run { width: 100%; }
  .rating-v2-tablewrap td { padding: 7px 8px; font-size: .76rem; }
  .rating-v2-sort { padding: 7px 8px; font-size: .76rem; }
}
</style>
