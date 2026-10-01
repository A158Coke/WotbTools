<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { useReplay } from '../composables/useReplay.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../utils/api.js'
import FileUploader from './FileUploader.vue'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'
import RatingV2RadarPanel from './RatingV2RadarPanel.vue'
import { ChevronDown, ChevronUp } from 'lucide-vue-next'

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
const radarDrawer = ref(null)
const isMobile = ref(false)
const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')
let lastPlayerTrigger = null
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

// 排序方向图标（lucide 取代 ▲▼ 字符，design-language §8）；方向本身由 th 的 aria-sort 表达
function sortIcon(column) {
  if (sort.value?.key !== column.key) return null
  return sort.value.reverse ? ChevronDown : ChevronUp
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

function selectPlayer(row, event) {
  const opening = !selectedRow.value
  lastPlayerTrigger = event?.currentTarget || null
  selectedRow.value = row
  if (opening) {
    void nextTick(() => radarDrawer.value?.querySelector('.rating-v2-radar-close')?.focus())
  }
}

function closePlayerRadar() {
  const trigger = lastPlayerTrigger
  selectedRow.value = null
  lastPlayerTrigger = null
  void nextTick(() => trigger?.focus?.())
}

function trapMobileRadarFocus(event) {
  if (event.key !== 'Tab' || !isMobile.value || !selectedRow.value) return
  const drawer = radarDrawer.value
  if (!drawer) return
  const focusable = [...drawer.querySelectorAll(FOCUSABLE_SELECTOR)]
  if (!focusable.length) {
    event.preventDefault()
    drawer.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  const outside = !drawer.contains(active)
  if (event.shiftKey && (outside || active === first)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (outside || active === last)) {
    event.preventDefault()
    first.focus()
  }
}

function onKeydown(event) {
  if (event.key === 'Escape' && selectedRow.value) {
    closePlayerRadar()
    return
  }
  trapMobileRadarFocus(event)
}

function syncMobile() {
  isMobile.value = window.innerWidth < 768
}

onMounted(async () => {
  syncMobile()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', syncMobile)
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

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', syncMobile)
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
                    {{ t(`ratingV2.labels.${column.key}`) }}
                    <component :is="sortIcon(column)" v-if="sortIcon(column)" class="rating-v2-sort-icon" :size="16" aria-hidden="true" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in sortedRows" :key="`${row.cells.nickname}-${index}`">
                <td v-for="column in ratingResponse.columns" :key="column.key" :class="{ num: column.num }">
                  <button v-if="column.key === 'nickname'" class="rating-v2-player" type="button"
                    :aria-label="t('ratingV2.radar.open', { player: row.cells[column.key] ?? '--' })"
                    :aria-pressed="selectedRow === row"
                    @click="selectPlayer(row, $event)">
                    {{ row.cells[column.key] ?? '--' }}
                  </button>
                  <template v-else>{{ row.cells[column.key] ?? '--' }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p v-else-if="!loading && !processingActive && !ratingLoading && files.length" class="rating-v2-note">
        {{ t('ratingV2.empty') }}
      </p>

      <Teleport to="body">
        <div v-if="selectedRow" class="rating-v2-radar-backdrop"
          :class="{ 'rating-v2-radar-modal': isMobile }"
          @click.self="isMobile ? closePlayerRadar() : null">
          <aside ref="radarDrawer" class="rating-v2-radar-drawer" role="dialog" tabindex="-1"
            :aria-modal="isMobile ? 'true' : undefined" aria-labelledby="rating-v2-radar-title">
            <RatingV2RadarPanel :row="selectedRow" :rows="ratingResponse.rows" @close="closePlayerRadar" />
          </aside>
        </div>
      </Teleport>
    </template>
  </main>
</template>

<style scoped>
/* 设计语言 token（docs/frontend/design-language.md）：只用语义 token，三档断点 */
.rating-v2-page { padding-bottom: var(--space-12); }
.rating-v2-header { margin: var(--space-6) 0 var(--space-4); }
/* 工作区不用 kicker 大写字距样式（§4），保留为普通说明标签 */
.rating-v2-kicker { margin: 0 0 var(--space-1); color: var(--color-accent-text); font: var(--type-caption); font-weight: 600; }
.rating-v2-header h1 { margin: 0; color: var(--color-text-primary); font: var(--type-h1); }

.rating-v2-header p:not(.rating-v2-kicker),
.rating-v2-note,
.rating-v2-hint { color: var(--color-text-secondary); }

.rating-v2-actions,
.rating-v2-results-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin: var(--space-3) 0; }

.rating-v2-run {
  min-height: var(--control-h-lg);
  padding: 0 var(--space-4);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-on-accent);
  font: var(--type-body);
  font-weight: 600;
  cursor: pointer;
}

.rating-v2-run:disabled { cursor: not-allowed; opacity: .5; }

.rating-v2-notice {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin: var(--space-3) 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}

.rating-v2-notice.warn { background: color-mix(in oklab, var(--color-warning) 14%, var(--color-surface-1)); }

.rating-v2-results {
  margin-top: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}

.rating-v2-results-head { justify-content: space-between; margin-top: 0; }
.rating-v2-results-head h2 { margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
.rating-v2-results-head span { color: var(--color-text-secondary); }
.rating-v2-tablewrap { overflow-x: auto; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); }
.rating-v2-tablewrap table { width: max-content; min-width: 100%; border-collapse: collapse; font: var(--type-body); }

.rating-v2-tablewrap th,
.rating-v2-tablewrap td {
  height: var(--row-h);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--color-border-subtle);
  white-space: nowrap;
}

.rating-v2-tablewrap th { padding: 0; background: var(--color-surface-2); }

.rating-v2-sort {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  min-height: var(--row-h);
  padding: 0 var(--space-3);
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-caption);
  font-weight: 600;
  text-align: inherit;
  cursor: pointer;
}

.rating-v2-sort-icon { flex: none; color: var(--color-accent-text); }
.rating-v2-sort:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }

.rating-v2-tablewrap th.num,
.rating-v2-tablewrap td.num { text-align: right; font-variant-numeric: tabular-nums; }

.rating-v2-tablewrap th.num .rating-v2-sort { justify-content: flex-end; }

.rating-v2-player {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.rating-v2-player[aria-pressed="true"] { color: var(--color-accent-text); text-decoration: underline; text-underline-offset: 3px; }
.rating-v2-player:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .rating-v2-sort:hover { background: var(--color-surface-3); }
  .rating-v2-player:hover { color: var(--color-accent-text); text-decoration: underline; text-underline-offset: 3px; }
}

/* 抽屉（design-language §7 Drawer）：桌面 / 平板为右侧非模态面板，手机为模态全宽面板。
 * ponytail: V2 局部复用稳定抽屉视觉，避免耦合 V5 业务 Drawer；出现第三个同类抽屉时再抽中性 shell。 */
.rating-v2-radar-backdrop { position: fixed; inset: 0; z-index: var(--z-drawer); background: none; pointer-events: none; }

.rating-v2-radar-drawer {
  position: fixed;
  top: calc(var(--header-h) + var(--space-2));
  right: var(--space-2);
  bottom: var(--space-2);
  width: min(560px, calc(100% - var(--space-4)));
  padding: var(--space-4);
  overflow-y: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
  box-shadow: var(--elevation-3);
  pointer-events: auto;
  animation: rating-v2-drawer-in var(--duration-slow) var(--ease-standard);
}

.rating-v2-radar-drawer :deep(.rating-v2-radar-panel) { margin: 0; padding: 0; border: 0; background: transparent; }

@keyframes rating-v2-drawer-in {
  from { transform: translateX(30px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@media (width < 1200px) {
  .rating-v2-radar-backdrop { z-index: var(--z-dialog); }
  .rating-v2-radar-drawer { top: var(--space-2); }
}

@media (width < 768px) {
  .rating-v2-page { padding-bottom: var(--space-8); }
  .rating-v2-actions { align-items: stretch; }
  .rating-v2-run { width: 100%; }
  .rating-v2-radar-backdrop.rating-v2-radar-modal { background: var(--color-scrim); pointer-events: auto; }
  .rating-v2-radar-drawer { left: var(--space-2); width: auto; padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom)); }
}

@media (prefers-reduced-motion: reduce) {
  .rating-v2-radar-drawer { animation: none; }
}
</style>
