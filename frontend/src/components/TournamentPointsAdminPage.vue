<script setup lang="ts">
import { ref, watch, onScopeDispose, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { useTournamentPointsAdmin } from '../composables/useTournamentPointsAdmin.js'
import type { TournamentImageReview } from '../composables/useTournamentPointsAdmin.js'
import { getTournamentEvidence } from '../api/tournament-points.js'
import { apiErrorLabel, formatDateTimeMinute } from '../utils/display.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import PageHeader from './PageHeader.vue'
import Banner from './Banner.vue'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import FileDrop from './FileDrop.vue'
import TournamentEventSelect from './TournamentEventSelect.vue'
import TournamentPointsTable from './TournamentPointsTable.vue'
import TournamentGroupReview from './TournamentGroupReview.vue'
import '../styles/tournament-points.css'
const { t, te } = useI18n()
const owner = useTournamentPointsAdmin()
const { allowed, events, eventId, round, day, config, dayState, previewState, standings, audit, reviews,
  busy, recognizing, progress, error, stale, notice, roundRule, editable, canUpload, canFinalize, reviewError } = owner
const { historicalPreview, historicalRequest, historicalState, historicalFileIssue, canImportHistorical } = owner
const { availability } = useFeatureGate()
const network = computed(() => availability(Feature.TOURNAMENT_POINTS))
const files = ref<File[]>([]), expected = ref<number | string>(''), reason = ref(''), correctionCount = ref(1)
const clearClan = ref(''), clearDay = ref<number | null>(null), restore = ref(false)
const dialog = ref<'' | 'finalize' | 'correction' | 'clear' | 'discard'>('')
const historicalConfirm = ref(false)
const evidenceUrl = ref(''), evidenceLoading = ref(false)
let evidenceController = new AbortController(), evidenceGeneration = 0
function closeEvidence() {
  evidenceGeneration++; evidenceController.abort()
  evidenceController = new AbortController(); URL.revokeObjectURL(evidenceUrl.value); evidenceUrl.value = ''; evidenceLoading.value = false
}
function clearLocal() { files.value = []; dialog.value = ''; historicalConfirm.value = false; reason.value = ''; closeEvidence() }
watch([eventId, round, day, allowed], clearLocal)
watch(config, value => { if (!value) clearLocal() })
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
  if (!error.value) historicalConfirm.value = false
}
onScopeDispose(clearLocal)
</script>
<template>
  <div class="tournament-page tournament-stack">
    <PageHeader :title="$t('tournament.adminTitle')"><template #actions>
      <RouterLink :to="{ path: '/', query: { view: 'tournament-points-config' } }">{{ $t('tournament.configure') }}</RouterLink>
      <RouterLink :to="{ path: '/', query: { view: 'tournament-points' } }">{{ $t('tournament.publicBoard') }}</RouterLink>
      <AppButton :disabled="busy || recognizing" @click="owner.loadSelection(); owner.loadEvents()">{{ $t('tournament.refresh') }}</AppButton>
    </template></PageHeader>
    <Banner v-if="!allowed" tone="danger">{{ $t('tournament.adminRequired') }}</Banner>
    <template v-else>
      <Banner v-if="!network.available">{{ $t(network.messageKey || 'featureOffline.tournamentPoints') }}</Banner>
      <Banner v-if="error" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
      <Banner v-else-if="notice">{{ $t('tournament.' + notice) }}</Banner>
      <Banner v-if="reviews.length">{{ $t('tournament.unsaved') }}</Banner>
      <TournamentEventSelect v-model="eventId" :events="events" :disabled="busy || recognizing" />
      <p v-if="busy" role="status">{{ $t('tournament.loading') }}</p>
      <p v-if="!events.length && !busy" class="tournament-muted">{{ $t('tournament.noEvents') }}</p>
      <section v-if="config && (historicalState?.canImport || historicalPreview)" class="tournament-card tournament-stack" data-testid="historical-import">
        <h2>{{ $t('tournament.historicalImport') }}</h2>
        <p class="tournament-muted">{{ $t('tournament.historicalHint') }}</p>
        <label class="tournament-field"><span>{{ $t('tournament.historicalFile') }}</span><input type="file" accept=".json,application/json" :disabled="!canImportHistorical" data-testid="historical-file" @change="selectHistoricalFile" /></label>
        <Banner v-if="historicalFileIssue" tone="danger">{{ $t('tournament.' + historicalFileIssue) }}</Banner>
        <template v-if="historicalPreview">
          <p>{{ historicalRequest?.sourceName }}</p>
          <p>{{ $t('tournament.historicalSummary', { rows: historicalPreview.sourceRowCount, clans: historicalPreview.clanCount, blanks: historicalPreview.missingCellCount }) }}</p>
          <TournamentPointsTable :standings="historicalPreview.standings" />
          <AppButton variant="primary" :disabled="!canImportHistorical" data-testid="historical-publish" @click="historicalConfirm = true">{{ $t('tournament.historicalPublish') }}</AppButton>
        </template>
      </section>
      <div v-if="config" class="tournament-toolbar">
        <label class="tournament-field"><span>{{ $t('tournament.rounds') }}</span><select v-model.number="round"><option v-for="value in config.event.roundCount" :key="value" :value="value">{{ $t('tournament.round', { number: value }) }}</option></select></label>
        <label class="tournament-field"><span>{{ $t('tournament.days') }}</span><select v-model.number="day"><option v-for="value in config.event.daysPerRound" :key="value" :value="value">{{ config.event.dayLabels[value - 1] }}</option></select></label>
      </div>
      <template v-if="dayState && config">
        <div class="tournament-actions"><span>{{ $t('tournament.' + dayState.status) }}</span><span v-if="!historicalState?.historical">{{ $t('tournament.count', { actual: previewState?.groups.length ?? dayState.groups.length, expected: dayState.expectedGroupCount ?? '—' }) }}</span></div>
        <Banner v-if="historicalState?.historical">{{ $t('tournament.historicalSource') }}</Banner>
        <Banner v-if="!roundRule?.complete" tone="warning">{{ $t('tournament.rulesMissing') }}</Banner>
        <Banner v-else-if="dayState.status === 'FINALIZED'">{{ $t('tournament.locked') }}</Banner>
        <section v-else class="tournament-card">
          <h2>{{ $t('tournament.expectedGroups') }}</h2>
          <div class="tournament-toolbar"><label class="tournament-field"><span>{{ $t('tournament.expectedGroups') }}</span><input v-model="expected" type="number" min="1" max="10000" :disabled="!editable" data-testid="expected-group-count" /></label><AppButton :disabled="!editable || !Number.isInteger(Number(expected)) || Number(expected) < 1 || Number(expected) > 10000" @click="owner.setExpected(Number(expected))">{{ $t('tournament.saveExpected') }}</AppButton></div>
          <p class="tournament-muted">{{ $t('tournament.expectedHint') }}</p>
          <FileDrop :files="files" purpose="image" :disabled="!canUpload" :loading="recognizing || busy" :show-preview="false" @update:files="files = $event" />
          <div class="tournament-actions"><AppButton :disabled="!canUpload || !files.length" @click="owner.recognize(files)">{{ $t('tournament.recognize') }}</AppButton><AppButton v-if="recognizing" @click="owner.cancelRecognition">{{ $t('tournament.stop') }}</AppButton><span v-if="recognizing" role="status">{{ $t('tournament.recognizing', { current: progress, total: files.length }) }}</span></div>
        </section>
        <template v-if="reviews.length">
          <h2>{{ $t('tournament.review') }}</h2><p class="tournament-muted">{{ $t('tournament.reviewHint') }}</p>
          <TournamentGroupReview v-for="(review, index) in reviews" :key="review.url" :review="review" :clans="config.clans" :duplicate="dayState.groups.some(group => group.groupNumber === review.groupNumber) || reviews.slice(0, index).some(previous => previous.result && previous.groupNumber === review.groupNumber)" :disabled="busy || recognizing || stale"
            @change="Object.assign(review, $event)" @team-change="(index, key, value) => teamChange(review, index, key, value)" @clan-confirm="(tag, checked) => clanConfirm(review, tag, checked)" @retry="owner.recognize([review.file], review)" @remove="removeReview(review)" />
          <Banner v-if="reviewError" tone="warning">{{ $t('tournament.' + reviewError) }}</Banner>
          <AppButton :disabled="!editable || !!reviewError" @click="owner.preview" data-testid="points-preview">{{ $t('tournament.preview') }}</AppButton>
        </template>
        <section v-if="dayState.groups.length" class="tournament-card">
          <h2>{{ $t('tournament.review') }}</h2>
          <div v-for="group in dayState.groups" :key="group.groupNumber" class="tournament-actions">
            <strong>{{ $t('tournament.group', { number: group.groupNumber }) }}</strong><span>{{ group.teams.map(team => team.rank + ': ' + team.clanTag).join(' · ') }}</span>
            <AppButton size="sm" :disabled="evidenceLoading || busy" @click="openEvidence(group.evidenceId)">{{ $t('tournament.evidence') }}</AppButton>
          </div>
        </section>
        <section v-if="standings" class="tournament-stack">
          <h2>{{ $t('tournament.previewTitle') }}</h2><p class="tournament-muted">{{ $t('tournament.draftHint') }}</p>
          <TournamentPointsTable :standings="standings" />
        </section>
        <div class="tournament-actions">
          <AppButton v-if="dayState.status !== 'FINALIZED'" :disabled="!editable || !!reviewError || !reviews.length" @click="owner.saveDraft" data-testid="save-points-draft">{{ $t('tournament.saveDraft') }}</AppButton>
          <AppButton v-if="dayState.status !== 'FINALIZED'" variant="primary" :disabled="!canFinalize" @click="dialog = 'finalize'" data-testid="finalize-points">{{ $t('tournament.finalize') }}</AppButton>
          <AppButton v-if="['DRAFT', 'CORRECTION'].includes(dayState.status)" variant="danger" :disabled="busy || recognizing || stale" @click="dialog = 'discard'">{{ $t('tournament.discard') }}</AppButton>
          <AppButton v-if="dayState.status === 'FINALIZED'" :disabled="busy || stale" @click="dialog = 'correction'">{{ $t('tournament.correction') }}</AppButton>
          <AppButton v-if="dayState.published" :disabled="busy || recognizing || stale || dayState.status === 'CORRECTION'" @click="openClear">{{ $t('tournament.clearPoints') }}</AppButton>
        </div>
        <section class="tournament-card"><h2>{{ $t('tournament.audit') }}</h2><p v-if="!audit.length" class="tournament-muted">{{ $t('tournament.auditEmpty') }}</p>
          <ol v-else class="tournament-audit"><li v-for="entry in audit" :key="entry.id"><time>{{ formatDateTimeMinute(entry.createdAt) }}</time> · {{ entry.actor }} · {{ $t('tournament.auditActions.' + entry.action) }}<template v-if="entry.roundNumber"> · {{ $t('tournament.round', { number: entry.roundNumber }) }}</template><template v-if="entry.dayNumber"> · {{ $t('tournament.day', { number: entry.dayNumber }) }}</template><p v-if="entry.reason">{{ entry.reason }}</p></li></ol>
        </section>
      </template>
    </template>
    <AppDialog :open="historicalConfirm && allowed && !!historicalPreview" :title="$t('tournament.historicalPublish')" @close="!busy && (historicalConfirm = false)">
      <p>{{ $t('tournament.historicalConfirm') }}</p>
      <p v-if="historicalPreview">{{ historicalPreview.standings.event.year }} · {{ $t('tournament.regions.' + historicalPreview.standings.event.region) }} · {{ $t('tournament.seasons.' + historicalPreview.standings.event.season) }}</p>
      <template #actions><AppButton :disabled="busy" @click="historicalConfirm = false">{{ $t('tournament.cancel') }}</AppButton><AppButton variant="primary" :disabled="!canImportHistorical || !historicalPreview" @click="confirmHistorical">{{ $t('tournament.historicalPublish') }}</AppButton></template>
    </AppDialog>
    <AppDialog :open="!!dialog" :title="$t(dialog === 'finalize' ? 'tournament.finalizeTitle' : dialog === 'correction' ? 'tournament.correctionTitle' : dialog === 'clear' ? 'tournament.clearTitle' : 'tournament.discard')" :tone="dialog === 'clear' || dialog === 'discard' ? 'danger' : 'default'" @close="!busy && (dialog = '')">
      <p>{{ $t(dialog === 'finalize' ? 'tournament.finalizeHint' : dialog === 'correction' ? 'tournament.correctionHint' : dialog === 'clear' ? 'tournament.clearHint' : 'tournament.discardHint') }}</p>
      <div class="tournament-stack">
        <label v-if="dialog === 'correction'" class="tournament-field"><span>{{ $t('tournament.expectedGroups') }}</span><input v-model.number="correctionCount" type="number" min="1" max="10000" /></label>
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
