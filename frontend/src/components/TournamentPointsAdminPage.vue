<script setup lang="ts">
import { ref, watch, onScopeDispose, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { Check } from 'lucide-vue-next'
import { useTournamentPointsAdmin, tournamentReviewState, TOURNAMENT_REVIEW_ORDER } from '../composables/useTournamentPointsAdmin.js'
import type { TournamentImageReview } from '../composables/useTournamentPointsAdmin.js'
import { getTournamentEvidence } from '../api/tournament-points.js'
import { apiErrorLabel, formatDateTimeMinute } from '../utils/display.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import PageHeader from './PageHeader.vue'
import Banner from './Banner.vue'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import MenuButton from './MenuButton.vue'
import FileDrop from './FileDrop.vue'
import TournamentEventSelect from './TournamentEventSelect.vue'
import TournamentPointsTable from './TournamentPointsTable.vue'
import TournamentGroupReview from './TournamentGroupReview.vue'
import { createTournamentPointsCsv, localizedDayLabel } from '../utils/tournamentPointsExport.js'
import { downloadBlob } from '../utils/exportReplayPng.js'
import '../styles/tournament-points.css'
const { t, te } = useI18n()
const owner = useTournamentPointsAdmin()
const { allowed, events, eventsLoading, eventId, round, day, config, dayState, previewState, standings, audit, reviews,
  busy, recognizing, progress, error, stale, notice, roundRule, editable, canUpload, canFinalize, reviewError } = owner
const { historicalPreview, historicalRequest, historicalState, historicalFileIssue, canImportHistorical } = owner
const { csvSupported, csvCapabilityError, csvFile, csvPreview, csvFileIssue, csvWorkspaceBusy, canImportCsv, dataSource, dataSourceError } = owner
const { availability } = useFeatureGate()
const { isCompact } = useBreakpoint()
const network = computed(() => availability(Feature.TOURNAMENT_POINTS))
watch(() => network.value.available, value => { owner.networkAvailable.value = value }, { immediate: true })
const files = ref<File[]>([]), expected = ref<number | string>(''), reason = ref(''), correctionCount = ref(1)
const clearClan = ref(''), clearDay = ref<number | null>(null), restore = ref(false)
const dialog = ref<'' | 'finalize' | 'correction' | 'clear' | 'discard'>('')
// 「更多」菜单打开的工作面板：CSV 导入、历史 JSON 导入、修改记录。
const panel = ref<'' | 'csv' | 'historical' | 'audit'>('')
const historicalConfirm = ref(false)
const csvConfirm = ref(false)
const exportingCsv = ref(false)
const csvExportError = ref(false)
const canExportCanonicalCsv = computed(() => allowed.value && network.value.available && !busy.value && !recognizing.value
  && csvSupported.value && !stale.value && !exportingCsv.value && !!dayState.value?.canonicalStandings?.rows.length
  && dayState.value.canonicalStandings?.event.id === eventId.value)
async function exportCanonicalCsv() {
  if (!canExportCanonicalCsv.value || !dayState.value?.canonicalStandings) return
  exportingCsv.value = true; csvExportError.value = false
  try {
    const file = createTournamentPointsCsv(dayState.value.canonicalStandings)
    await downloadBlob(file.blob, file.filename)
  } catch { csvExportError.value = true }
  finally { exportingCsv.value = false }
}
const csvErrorLocation = computed(() => {
  const value = error.value as { errorCode?: string; details?: { rowNumber?: number; column?: string; reason?: string } } | null
  return value?.errorCode === 'TOURNAMENT_CSV_INVALID' ? value.details : null
})
const csvErrorReason = computed(() => {
  const key = 'tournament.csvReasons.' + csvErrorLocation.value?.reason
  return te(key) ? t(key) : t('tournament.csvReasons.invalid')
})
const evidenceUrl = ref(''), evidenceLoading = ref(false)
let evidenceController = new AbortController(), evidenceGeneration = 0
function closeEvidence() {
  evidenceGeneration++; evidenceController.abort()
  evidenceController = new AbortController(); URL.revokeObjectURL(evidenceUrl.value); evidenceUrl.value = ''; evidenceLoading.value = false
}
function clearLocal() { files.value = []; dialog.value = ''; panel.value = ''; historicalConfirm.value = false; csvConfirm.value = false; reason.value = ''; focused.value = null; closeEvidence() }
watch([eventId, round, day, allowed], clearLocal)
watch(config, value => { if (!value) clearLocal() })
watch(csvPreview, value => { if (!value) csvConfirm.value = false })
watch(() => dayState.value?.expectedGroupCount, value => { expected.value = value ?? ''; correctionCount.value = value || 1 })
watch(() => reviews.value.length, length => { if (!length && !recognizing.value) files.value = [] })
function teamChange(review: TournamentImageReview, index: number, key: 'rank' | 'clanTag', value: number | string) {
  review.teams[index] = { ...review.teams[index], [key]: value }; review.complete = false; review.confirmedClans = []
}
function clanConfirm(review: TournamentImageReview, tag: string, checked: boolean) {
  review.confirmedClans = checked ? [...new Set([...review.confirmedClans, tag])] : review.confirmedClans.filter(value => value !== tag)
}
function removeReview(review: TournamentImageReview) {
  URL.revokeObjectURL(review.url); reviews.value = reviews.value.filter(value => value !== review); files.value = files.value.filter(file => file !== review.file)
}
async function openEvidence(evidenceId: string) {
  evidenceGeneration++; evidenceController.abort(); evidenceController = new AbortController()
  const gen = evidenceGeneration, id = eventId.value
  URL.revokeObjectURL(evidenceUrl.value); evidenceUrl.value = ''; evidenceLoading.value = true
  try {
    const blob = await getTournamentEvidence(id!, evidenceId, evidenceController.signal)
    if (gen === evidenceGeneration && id === eventId.value && allowed.value) evidenceUrl.value = URL.createObjectURL(blob)
  } catch (value) { if (gen === evidenceGeneration && allowed.value) error.value = value }
  finally { if (gen === evidenceGeneration) evidenceLoading.value = false }
}
async function confirm() {
  if (dialog.value === 'finalize') await owner.finalize()
  if (dialog.value === 'correction') await owner.correction(correctionCount.value, reason.value)
  if (dialog.value === 'clear') await owner.clearPoints(clearClan.value, clearDay.value, reason.value, restore.value)
  if (dialog.value === 'discard') await owner.discard()
  if (!error.value) { dialog.value = ''; reason.value = '' }
}
function openClear() { clearClan.value = config.value?.clans[0] || ''; clearDay.value = day.value; restore.value = false; dialog.value = 'clear' }
async function selectHistoricalFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await owner.previewHistorical(file)
}
async function confirmHistorical() {
  await owner.publishHistorical()
  if (!error.value) { historicalConfirm.value = false; panel.value = '' }
}
function selectCsvFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) owner.selectCsvFile(file)
}
async function confirmCsv() {
  await owner.publishCsv()
  if (!error.value) { csvConfirm.value = false; panel.value = '' }
}
function dayName(value: number) { return config.value ? localizedDayLabel(config.value.event.dayLabels[value - 1], value, t) : '' }

// 比赛日条：当前选中日用其真实状态；其余日只能从 standings.days[].published 推出「已最终确认」，
// 草稿与空白在不加载该日的情况下无法区分，统一显示「未最终确认」（DC-STA-03：未知不冒充已知）。
const matchDays = computed(() => {
  const event = config.value?.event
  if (!event) return []
  return Array.from({ length: event.roundCount * event.daysPerRound }, (_, index) => {
    const r = Math.floor(index / event.daysPerRound) + 1, d = index % event.daysPerRound + 1
    const current = r === round.value && d === day.value
    const published = dayState.value?.standings.days.find(item => item.roundNumber === r && item.dayNumber === d)?.published
    const status = current && dayState.value ? dayState.value.status : published ? 'FINALIZED' : 'UNKNOWN'
    return { round: r, day: d, current, status, label: `${t('tournament.round', { number: r })} · ${dayName(d)}` }
  })
})
function matchDayStatus(status: string) { return t(status === 'UNKNOWN' ? 'tournament.notFinalized' : 'tournament.' + status) }
function selectMatchDay(r: number, d: number) { round.value = r; day.value = d }

const reviewCards = computed(() => {
  if (!config.value || !dayState.value) return []
  const saved = dayState.value.groups
  return reviews.value.map((review, index) => {
    const duplicate = saved.some(group => group.groupNumber === review.groupNumber)
      || reviews.value.slice(0, index).some(previous => previous.result && previous.groupNumber === review.groupNumber)
    return { review, index, duplicate, state: tournamentReviewState(review, config.value!, round.value, day.value, duplicate) }
  }).sort((a, b) => TOURNAMENT_REVIEW_ORDER.indexOf(a.state) - TOURNAMENT_REVIEW_ORDER.indexOf(b.state) || a.index - b.index)
})
const reviewedCount = computed(() => reviewCards.value.filter(card => card.state === 'reviewed').length)
const issueCount = computed(() => reviewCards.value.filter(card => card.state === 'issue').length)
const recognizedCount = computed(() => reviews.value.filter(review => review.result).length)

// 小屏一次核对一组：focused 指向当前卡片对应的 review（排序随状态变化，按身份而不是下标追踪）。
const focused = ref<TournamentImageReview | null>(null)
const openCards = computed(() => reviewCards.value.filter(card => card.state !== 'reviewed'))
const focusedCard = computed(() => openCards.value.find(card => card.review === focused.value) ?? openCards.value[0] ?? null)
const focusedPosition = computed(() => focusedCard.value ? t('tournament.reviewPosition', { current: openCards.value.indexOf(focusedCard.value) + 1, total: openCards.value.length }) : '')
const visibleCards = computed(() => isCompact.value ? (focusedCard.value ? [focusedCard.value] : []) : reviewCards.value)
const compactReviewing = computed(() => isCompact.value && !!focusedCard.value)
function skipReview() {
  const cards = openCards.value, current = focusedCard.value
  if (!current || cards.length < 2) return
  focused.value = cards[(cards.indexOf(current) + 1) % cards.length].review
}
function confirmFocused() {
  const current = focusedCard.value
  if (!current?.review.result) return
  const next = openCards.value.find(card => card !== current)
  Object.assign(current.review, { complete: true })
  focused.value = next?.review ?? null
}

// 五步进度：只由当前日的真实状态与本地核对状态推出。
const steps = computed(() => {
  const state = dayState.value
  if (!state) return []
  const saved = ['DRAFT', 'CORRECTION', 'FINALIZED'].includes(state.status) && !reviews.value.length
  const done = [
    !!state.expectedGroupCount,
    reviews.value.length ? recognizedCount.value === reviews.value.length : state.groups.length > 0,
    reviews.value.length ? !reviewError.value && reviewedCount.value === reviewCards.value.length : state.groups.length > 0,
    saved,
    state.status === 'FINALIZED',
  ]
  const subs = [
    state.expectedGroupCount ? t('tournament.stepExpected', { count: state.expectedGroupCount }) : t('tournament.stepTodo'),
    reviews.value.length ? t('tournament.stepRecognized', { done: recognizedCount.value, total: reviews.value.length }) : t('tournament.stepSavedGroups', { count: state.groups.length }),
    reviews.value.length ? t('tournament.stepReviewed', { done: reviewedCount.value, total: reviewCards.value.length }) : t(state.groups.length ? 'tournament.stepReviewedSaved' : 'tournament.stepTodo'),
    previewState.value ? t('tournament.stepPreviewed') : t('tournament.' + state.status),
    t(state.status === 'FINALIZED' ? 'tournament.FINALIZED' : 'tournament.stepFinalizeHint'),
  ]
  const current = done.indexOf(false)
  return ['expected', 'upload', 'review', 'save', 'finalize'].map((key, index) => ({
    key, done: done[index], current: index === current, title: t('tournament.steps.' + key), sub: subs[index],
  }))
})

// 「最终确认」不可用时说明原因（与 canFinalize 同一组条件，按出现顺序取第一条）。
const finalizeBlocker = computed(() => {
  const state = dayState.value
  if (!state || canFinalize.value || busy.value || recognizing.value || stale.value) return ''
  if (!roundRule.value?.complete) return t('tournament.rulesMissing')
  if (!state.expectedGroupCount) return t('tournament.finalizeNeedsExpected')
  if (reviewError.value) return t('tournament.' + reviewError.value)
  if (reviews.value.length && !previewState.value) return t('tournament.finalizeNeedsPreview')
  const candidate = reviews.value.length ? previewState.value : state
  if (!reviews.value.length && !['DRAFT', 'CORRECTION'].includes(state.status)) return t('tournament.finalizeNeedsGroups')
  if (candidate && candidate.groups.length !== candidate.expectedGroupCount) return t('tournament.countMismatch')
  return ''
})

const moreItems = computed(() => [
  { key: 'refresh', label: t('tournament.refresh'), disabled: busy.value || recognizing.value || eventsLoading.value, testid: 'tournament-admin-refresh' },
  ...(config.value && csvSupported.value ? [{ key: 'csv', label: t('tournament.csvImport'), testid: 'tournament-admin-csv' }] : []),
  ...(config.value && (historicalState.value?.canImport || historicalPreview.value) ? [{ key: 'historical', label: t('tournament.historicalImport'), testid: 'tournament-admin-historical' }] : []),
  { key: 'export-csv', label: t(exportingCsv.value ? 'tournament.exporting' : 'tournament.exportCsv'), disabled: !canExportCanonicalCsv.value, testid: 'tournament-admin-export-csv' },
  ...(dayState.value?.status === 'FINALIZED' ? [{ key: 'correction', label: t('tournament.correction'), disabled: busy.value || stale.value, testid: 'tournament-admin-correction' }] : []),
  ...(dayState.value?.published ? [{ key: 'clear', label: t('tournament.clearPoints'), disabled: busy.value || recognizing.value || stale.value || dayState.value.status === 'CORRECTION', testid: 'tournament-admin-clear' }] : []),
  ...(config.value ? [{ key: 'audit', label: t('tournament.audit'), testid: 'tournament-admin-audit' }] : []),
])
function selectMore(key: string) {
  if (key === 'refresh') { void owner.loadSelection(); void owner.loadEvents() }
  else if (key === 'export-csv') void exportCanonicalCsv()
  else if (key === 'correction') dialog.value = 'correction'
  else if (key === 'clear') openClear()
  else if (key === 'csv' || key === 'historical' || key === 'audit') panel.value = key
}
onScopeDispose(clearLocal)
</script>
<template>
  <div class="tournament-page tournament-stack tournament-admin" :class="{ 'is-compact-review': compactReviewing }">
    <PageHeader :title="$t('tournament.adminTitle')" :description="$t('tournament.adminSelectionHint')"><template #actions>
      <TournamentEventSelect v-if="allowed" v-model="eventId" compact :events="events" :disabled="busy || recognizing || eventsLoading" />
      <RouterLink class="tournament-header-link" :to="{ path: '/', query: { view: 'tournament-points' } }">{{ $t('tournament.publicBoard') }}</RouterLink>
      <RouterLink class="tournament-header-link" :to="{ path: '/', query: { view: 'tournament-points-config' } }">{{ $t('tournament.configure') }}</RouterLink>
      <MenuButton v-if="allowed" :label="$t('tournament.more')" :items="moreItems" data-testid="tournament-admin-more" @select="selectMore" />
    </template></PageHeader>
    <Banner v-if="!allowed" tone="danger">{{ $t('tournament.adminRequired') }}</Banner>
    <template v-else>
      <Banner v-if="!network.available">{{ $t(network.messageKey || 'featureOffline.tournamentPoints') }}</Banner>
      <Banner v-if="error && !panel" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
      <Banner v-if="csvExportError" role="status">{{ $t('tournament.exportFailed') }}</Banner>
      <Banner v-else-if="notice">{{ $t('tournament.' + notice) }}</Banner>
      <Banner v-if="reviews.length">{{ $t('tournament.unsaved') }}</Banner>
      <Banner v-if="dataSourceError" tone="warning" data-testid="tournament-data-source-error">{{ $t('tournament.dataSourceLoadFailed') }} {{ apiErrorLabel(t, te, dataSourceError) }}</Banner>
      <Banner v-if="csvCapabilityError" tone="warning" data-testid="tournament-csv-capability-error">{{ $t('tournament.csvCapabilityLoadFailed') }} {{ apiErrorLabel(t, te, csvCapabilityError) }}</Banner>
      <div v-if="dataSource?.csvImported && dataSource.attribution" class="tournament-actions" data-testid="tournament-data-source">
        <span>{{ $t('tournament.dataSource') }}</span><AppButton :href="dataSource.attribution.url" target="_blank" rel="noopener noreferrer" size="sm">{{ dataSource.attribution.name }}</AppButton>
      </div>
      <p v-if="busy || eventsLoading" role="status">{{ $t('tournament.loading') }}</p>
      <EmptyState v-if="!eventId && !busy && !eventsLoading && !error && network.available" :title="$t(events.length ? 'tournament.selectEvent' : 'tournament.noEvents')" :description="$t(events.length ? 'tournament.adminSelectionHint' : 'tournament.noEventsHint')" data-testid="tournament-admin-empty">
        <RouterLink v-if="!events.length" :to="{ path: '/', query: { view: 'tournament-points-config' } }">{{ $t('tournament.newEvent') }}</RouterLink>
      </EmptyState>
      <nav v-if="config" class="tournament-day-strip" :aria-label="$t('tournament.matchDay')" data-testid="tournament-day-strip">
        <button v-for="item in matchDays" :key="`${item.round}-${item.day}`" type="button" class="tournament-day-chip" :class="`is-${item.status.toLowerCase()}`"
          :aria-pressed="item.current" :disabled="busy || recognizing" :data-testid="`match-day-${item.round}-${item.day}`" @click="selectMatchDay(item.round, item.day)">
          <strong>{{ item.label }}</strong><span class="tournament-day-status">{{ matchDayStatus(item.status) }}</span>
        </button>
      </nav>
      <template v-if="dayState && config">
        <ol class="tournament-steps" :aria-label="$t('tournament.stepsLabel')" data-testid="tournament-steps">
          <li v-for="(step, index) in steps" :key="step.key" class="tournament-step" :class="{ 'is-done': step.done, 'is-current': step.current }" :aria-current="step.current ? 'step' : undefined">
            <span class="tournament-step-mark" aria-hidden="true"><Check v-if="step.done" :size="14" /><template v-else>{{ index + 1 }}</template></span>
            <span class="tournament-step-text"><strong>{{ step.title }}</strong><span>{{ step.sub }}</span></span>
          </li>
        </ol>
        <Banner v-if="historicalState?.historical">{{ $t('tournament.historicalSource') }}</Banner>
        <Banner v-if="!roundRule?.complete" tone="warning">{{ $t('tournament.rulesMissing') }}</Banner>
        <Banner v-else-if="dayState.status === 'FINALIZED'">{{ $t('tournament.locked') }}</Banner>
        <section v-else-if="!compactReviewing" class="tournament-card" aria-labelledby="tournament-setup-heading">
          <h2 id="tournament-setup-heading">{{ $t('tournament.setupTitle') }}</h2>
          <div class="tournament-toolbar"><label class="tournament-field"><span>{{ $t('tournament.expectedGroups') }}</span><input v-model="expected" type="number" inputmode="numeric" min="1" max="10000" :disabled="!editable" data-testid="expected-group-count" /></label><AppButton :disabled="!editable || !Number.isInteger(Number(expected)) || Number(expected) < 1 || Number(expected) > 10000" @click="owner.setExpected(Number(expected))">{{ $t('tournament.saveExpected') }}</AppButton></div>
          <p class="tournament-muted">{{ $t('tournament.expectedHint') }}</p>
          <FileDrop :files="files" purpose="image" :disabled="!canUpload" :loading="recognizing || busy" @update:files="files = $event" />
          <div class="tournament-actions"><AppButton :disabled="!canUpload || !files.length" @click="owner.recognize(files)">{{ $t('tournament.recognize') }}</AppButton><AppButton v-if="recognizing" @click="owner.cancelRecognition">{{ $t('tournament.stop') }}</AppButton><span v-if="recognizing" role="status">{{ $t('tournament.recognizing', { current: progress, total: files.length }) }}</span></div>
        </section>
        <!-- 手机核对模式会隐藏上面的上传区：识别仍在进行时，进度与「停止」必须留在可见位置 -->
        <div v-if="compactReviewing && recognizing" class="tournament-actions" data-testid="tournament-recognition-status">
          <span role="status">{{ $t('tournament.recognizing', { current: progress, total: files.length }) }}</span>
          <AppButton data-testid="tournament-stop-recognition" @click="owner.cancelRecognition">{{ $t('tournament.stop') }}</AppButton>
        </div>
        <section v-if="reviews.length" class="tournament-stack tournament-review-area" aria-labelledby="tournament-review-heading" data-testid="tournament-review-area">
          <div class="tournament-section-heading">
            <div><h2 id="tournament-review-heading">{{ $t('tournament.review') }}</h2><p class="tournament-muted">{{ $t('tournament.reviewHint') }} {{ $t('tournament.reviewSortHint') }}</p></div>
            <span role="status">{{ $t('tournament.reviewSummary', { done: reviewedCount, total: reviewCards.length }) }}<template v-if="issueCount"> · <span class="tournament-review-issues">{{ $t('tournament.reviewIssues', { count: issueCount }) }}</span></template></span>
          </div>
          <p v-if="isCompact && !focusedCard" class="tournament-muted" role="status">{{ $t('tournament.reviewAllDone') }}</p>
          <div class="tournament-review-grid">
            <TournamentGroupReview v-for="card in visibleCards" :key="card.review.url" :review="card.review" :clans="config.clans" :duplicate="card.duplicate" :state="card.state" :position="isCompact ? focusedPosition : ''" :disabled="busy || recognizing || stale"
              @change="Object.assign(card.review, $event)" @team-change="(index, key, value) => teamChange(card.review, index, key, value)" @clan-confirm="(tag, checked) => clanConfirm(card.review, tag, checked)" @retry="owner.recognize([card.review.file], card.review)" @remove="removeReview(card.review)" />
          </div>
          <Banner v-if="reviewError" tone="warning">{{ $t('tournament.' + reviewError) }}</Banner>
        </section>
        <section v-if="dayState.groups.length && !compactReviewing" class="tournament-card" aria-labelledby="tournament-saved-heading">
          <h2 id="tournament-saved-heading">{{ $t('tournament.savedGroups') }}</h2>
          <div v-for="group in dayState.groups" :key="group.groupNumber" class="tournament-actions">
            <strong>{{ $t('tournament.group', { number: group.groupNumber }) }}</strong><span>{{ group.teams.map(team => team.rank + ': ' + team.clanTag).join(' · ') }}</span>
            <AppButton size="sm" :disabled="evidenceLoading || busy" @click="openEvidence(group.evidenceId)">{{ $t('tournament.evidence') }}</AppButton>
          </div>
        </section>
        <section v-if="standings && !compactReviewing" class="tournament-stack tournament-admin-preview">
          <h2>{{ $t('tournament.previewTitle') }}</h2><p class="tournament-muted">{{ $t('tournament.draftHint') }}</p>
          <TournamentPointsTable :standings="standings" grouped />
          <p class="tournament-muted" data-testid="tournament-csv-hint">{{ $t('tournament.csvExportHint') }}</p>
        </section>
        <div v-if="compactReviewing" class="tournament-sticky-bar tournament-review-bar" role="group" :aria-label="$t('tournament.review')" data-testid="tournament-review-bar">
          <AppButton :disabled="openCards.length < 2" data-testid="review-skip" @click="skipReview">{{ $t('tournament.reviewSkip') }}</AppButton>
          <AppButton variant="primary" :disabled="busy || recognizing || stale || !focusedCard?.review.result" data-testid="review-confirm-next" @click="confirmFocused">{{ $t('tournament.reviewConfirmNext') }}</AppButton>
        </div>
        <div v-else class="tournament-sticky-bar" role="group" :aria-label="$t('tournament.dayActions')" data-testid="tournament-day-actions">
          <span class="tournament-sticky-status">
            <span class="tournament-status" :class="{ 'is-finalized': dayState.status === 'FINALIZED' }">{{ $t('tournament.' + dayState.status) }}</span>
            <template v-if="!historicalState?.historical"> {{ $t('tournament.count', { actual: previewState?.groups.length ?? dayState.groups.length, expected: dayState.expectedGroupCount ?? '—' }) }}</template>
            <span v-if="finalizeBlocker" id="tournament-finalize-blocker" class="tournament-finalize-blocker" data-testid="finalize-blocker"> · {{ finalizeBlocker }}</span>
          </span>
          <AppButton v-if="['DRAFT', 'CORRECTION'].includes(dayState.status)" variant="ghost" :disabled="busy || recognizing || stale" data-testid="discard-points-draft" @click="dialog = 'discard'">{{ $t('tournament.discard') }}</AppButton>
          <AppButton v-if="reviews.length" :disabled="!editable || !!reviewError" data-testid="points-preview" @click="owner.preview">{{ $t('tournament.preview') }}</AppButton>
          <AppButton v-if="dayState.status !== 'FINALIZED'" :disabled="!editable || !!reviewError || !reviews.length" data-testid="save-points-draft" @click="owner.saveDraft">{{ $t('tournament.saveDraft') }}</AppButton>
          <AppButton v-if="dayState.status !== 'FINALIZED'" variant="primary" :disabled="!canFinalize" :aria-describedby="finalizeBlocker ? 'tournament-finalize-blocker' : undefined" data-testid="finalize-points" @click="dialog = 'finalize'">{{ $t('tournament.finalize') }}</AppButton>
        </div>
      </template>
    </template>
    <AppDialog :open="panel === 'csv' && allowed && !!config" :title="$t('tournament.csvImport')" size="lg" :close-on-scrim="false" data-testid="csv-import" class="tournament-admin" @close="!busy && (panel = '')">
      <div class="tournament-stack tournament-import">
        <p class="tournament-muted">{{ $t('tournament.csvHint') }}</p>
        <Banner v-if="error && !csvConfirm" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
        <Banner v-if="csvWorkspaceBusy" tone="warning">{{ $t('tournament.csvWorkspaceBusy') }}</Banner>
        <label class="tournament-field"><span>{{ $t('tournament.csvFile') }}</span><input type="file" accept=".csv,text/csv" :disabled="!canImportCsv" data-testid="csv-file" @change="selectCsvFile" /></label>
        <Banner v-if="csvFileIssue" tone="danger">{{ $t('tournament.' + csvFileIssue) }}</Banner>
        <p v-if="csvFile" class="tournament-source-name">{{ csvFile.name }}</p>
        <p v-if="csvErrorLocation">{{ $t('tournament.csvErrorLocation', { row: csvErrorLocation.rowNumber ?? '—', column: csvErrorLocation.column ?? '—', reason: csvErrorReason }) }}</p>
        <template v-if="csvPreview">
          <p>{{ $t('tournament.historicalSummary', { rows: csvPreview.sourceRowCount, clans: csvPreview.clanCount, blanks: csvPreview.missingCellCount }) }}</p>
          <ul class="tournament-csv-changes"><li>{{ $t('tournament.csvClanChanges', { added: csvPreview.changes.addedClans, changed: csvPreview.changes.changedClans, removed: csvPreview.changes.removedClans }) }}</li><li>{{ $t('tournament.csvScoreChanges', { added: csvPreview.changes.addedScores, changed: csvPreview.changes.changedScores, removed: csvPreview.changes.removedScores }) }}</li><li>{{ $t('tournament.csvPreservedClears', { count: csvPreview.changes.preservedClears }) }}</li></ul>
          <Banner tone="warning">{{ $t('tournament.csvReplaceWarning') }}</Banner>
          <TournamentPointsTable :standings="csvPreview.standings" grouped />
        </template>
      </div>
      <template #actions>
        <AppButton :disabled="busy" @click="panel = ''">{{ $t('tournament.cancel') }}</AppButton>
        <AppButton v-if="!csvPreview" :disabled="!canImportCsv || !csvFile" data-testid="csv-preview" @click="owner.previewCsv">{{ $t('tournament.csvPreview') }}</AppButton>
        <AppButton v-else variant="primary" :disabled="!canImportCsv" data-testid="csv-publish" @click="csvConfirm = true">{{ $t('tournament.csvPublish') }}</AppButton>
      </template>
    </AppDialog>
    <AppDialog :open="panel === 'historical' && allowed && !!config" :title="$t('tournament.historicalImport')" size="lg" :close-on-scrim="false" data-testid="historical-import" class="tournament-admin" @close="!busy && (panel = '')">
      <div class="tournament-stack tournament-import">
        <p class="tournament-muted">{{ $t('tournament.historicalHint') }}</p>
        <Banner v-if="error && !historicalConfirm" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
        <label class="tournament-field"><span>{{ $t('tournament.historicalFile') }}</span><input type="file" accept=".json,application/json" :disabled="!canImportHistorical" data-testid="historical-file" @change="selectHistoricalFile" /></label>
        <Banner v-if="historicalFileIssue" tone="danger">{{ $t('tournament.' + historicalFileIssue) }}</Banner>
        <template v-if="historicalPreview">
          <p>{{ historicalRequest?.sourceName }}</p>
          <p>{{ $t('tournament.historicalSummary', { rows: historicalPreview.sourceRowCount, clans: historicalPreview.clanCount, blanks: historicalPreview.missingCellCount }) }}</p>
          <TournamentPointsTable :standings="historicalPreview.standings" grouped />
        </template>
      </div>
      <template #actions>
        <AppButton :disabled="busy" @click="panel = ''">{{ $t('tournament.cancel') }}</AppButton>
        <AppButton v-if="historicalPreview" variant="primary" :disabled="!canImportHistorical" data-testid="historical-publish" @click="historicalConfirm = true">{{ $t('tournament.historicalPublish') }}</AppButton>
      </template>
    </AppDialog>
    <AppDialog :open="panel === 'audit' && allowed" :title="$t('tournament.audit')" data-testid="tournament-audit" @close="panel = ''">
      <p v-if="!audit.length" class="tournament-muted">{{ $t('tournament.auditEmpty') }}</p>
      <ol v-else class="tournament-audit"><li v-for="entry in audit" :key="entry.id"><time>{{ formatDateTimeMinute(entry.createdAt) }}</time> · {{ entry.actor }} · {{ $t('tournament.auditActions.' + entry.action) }}<template v-if="entry.roundNumber"> · {{ $t('tournament.round', { number: entry.roundNumber }) }}</template><template v-if="entry.dayNumber"> · {{ $t('tournament.day', { number: entry.dayNumber }) }}</template><p v-if="entry.reason">{{ entry.reason }}</p></li></ol>
    </AppDialog>
    <AppDialog :open="csvConfirm && allowed && !!csvPreview" :title="$t('tournament.csvPublish')" @close="!busy && (csvConfirm = false)">
      <Banner v-if="error" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
      <p>{{ $t('tournament.csvConfirm') }}</p>
      <p v-if="csvPreview">{{ csvPreview.standings.event.year }} · {{ $t('tournament.regions.' + csvPreview.standings.event.region) }} · {{ $t('tournament.seasons.' + csvPreview.standings.event.season) }}</p>
      <Banner tone="warning">{{ $t('tournament.csvReplaceWarning') }}</Banner>
      <template #actions><AppButton :disabled="busy" data-testid="csv-cancel" @click="csvConfirm = false">{{ $t('tournament.cancel') }}</AppButton><AppButton variant="primary" :disabled="!canImportCsv || !csvPreview" data-testid="csv-confirm" @click="confirmCsv">{{ $t('tournament.csvPublish') }}</AppButton></template>
    </AppDialog>
    <AppDialog :open="historicalConfirm && allowed && !!historicalPreview" :title="$t('tournament.historicalPublish')" @close="!busy && (historicalConfirm = false)">
      <Banner v-if="error" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
      <p>{{ $t('tournament.historicalConfirm') }}</p>
      <p v-if="historicalPreview">{{ historicalPreview.standings.event.year }} · {{ $t('tournament.regions.' + historicalPreview.standings.event.region) }} · {{ $t('tournament.seasons.' + historicalPreview.standings.event.season) }}</p>
      <template #actions><AppButton :disabled="busy" @click="historicalConfirm = false">{{ $t('tournament.cancel') }}</AppButton><AppButton variant="primary" :disabled="!canImportHistorical || !historicalPreview" @click="confirmHistorical">{{ $t('tournament.historicalPublish') }}</AppButton></template>
    </AppDialog>
    <AppDialog :open="!!dialog" :title="$t(dialog === 'finalize' ? 'tournament.finalizeTitle' : dialog === 'correction' ? 'tournament.correctionTitle' : dialog === 'clear' ? 'tournament.clearTitle' : 'tournament.discard')" :tone="dialog === 'clear' || dialog === 'discard' ? 'danger' : 'default'" @close="!busy && (dialog = '')">
      <p>{{ $t(dialog === 'finalize' ? 'tournament.finalizeHint' : dialog === 'correction' ? 'tournament.correctionHint' : dialog === 'clear' ? 'tournament.clearHint' : 'tournament.discardHint') }}</p>
      <Banner v-if="error" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
      <div class="tournament-stack">
        <label v-if="dialog === 'correction'" class="tournament-field"><span>{{ $t('tournament.expectedGroups') }}</span><input v-model.number="correctionCount" type="number" inputmode="numeric" min="1" max="10000" /></label>
        <template v-if="dialog === 'clear'">
          <label class="tournament-field"><span>{{ $t('tournament.clan') }}</span><select v-model="clearClan"><option v-for="tag in config?.clans" :key="tag" :value="tag">{{ tag }}</option></select></label>
          <label class="tournament-field"><span>{{ $t('tournament.clearScope') }}</span><select v-model="clearDay"><option :value="null">{{ $t('tournament.wholeRound') }}</option><option v-for="value in config?.event.daysPerRound" :key="value" :value="value">{{ $t('tournament.day', { number: value }) }}</option></select></label>
          <label class="tournament-check"><input v-model="restore" type="checkbox" />{{ $t('tournament.restore') }}</label>
        </template>
        <label v-if="dialog === 'correction' || dialog === 'clear'" class="tournament-field"><span>{{ $t('tournament.reason') }}</span><textarea v-model="reason" maxlength="500" required /></label>
      </div>
      <template #actions><AppButton :disabled="busy" @click="dialog = ''">{{ $t('tournament.cancel') }}</AppButton>
        <AppButton :variant="dialog === 'clear' || dialog === 'discard' ? 'danger' : 'primary'" :disabled="busy || (dialog === 'finalize' && !canFinalize) || (['correction', 'clear'].includes(dialog) && !reason.trim()) || (dialog === 'correction' && (!Number.isInteger(correctionCount) || correctionCount < 1 || correctionCount > 10000))" @click="confirm">
          {{ $t(dialog === 'finalize' ? 'tournament.finalize' : dialog === 'correction' ? 'tournament.startCorrection' : dialog === 'clear' ? 'tournament.clearConfirm' : 'tournament.discard') }}
        </AppButton>
      </template>
    </AppDialog>
    <AppDialog :open="!!evidenceUrl || evidenceLoading" :title="$t('tournament.evidence')" size="lg" @close="closeEvidence">
      <p v-if="evidenceLoading" role="status">{{ $t('tournament.loading') }}</p><img v-else :src="evidenceUrl" :alt="$t('tournament.evidence')" class="tournament-evidence-image" />
    </AppDialog>
  </div>
</template>
<style scoped>.tournament-evidence-image { width: 100%; height: auto; }</style>
