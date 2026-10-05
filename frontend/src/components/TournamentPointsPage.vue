<script setup lang="ts">
import { onScopeDispose, ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from './PageHeader.vue'
import AppButton from './AppButton.vue'
import MenuButton from './MenuButton.vue'
import Banner from './Banner.vue'
import TournamentEventSelect from './TournamentEventSelect.vue'
import TournamentPointsTable from './TournamentPointsTable.vue'
import { getTournamentStandings, listTournamentEvents } from '../api/tournament-points.js'
import type { TournamentEvent, TournamentStandings } from '../api/tournament-points.js'
import { apiErrorLabel } from '../utils/display.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { downloadBlob } from '../utils/exportReplayPng.js'
import { projectTournamentPoints, createTournamentPointsXlsx, printTournamentPoints } from '../utils/tournamentPointsExport.js'
import '../styles/tournament-points.css'
const { t, te, locale } = useI18n()
const { availability } = useFeatureGate()
const network = computed(() => availability(Feature.TOURNAMENT_POINTS))
const events = ref<TournamentEvent[]>([])
const eventId = ref<number | null>(null)
const standings = ref<TournamentStandings | null>(null)
const loading = ref(false)
const error = ref<unknown>(null)
const exporting = ref(false)
const exportMessage = ref('')
const exportDisabled = computed(() => exporting.value || loading.value || !!error.value || !standings.value?.rows.length || standings.value.event.id !== eventId.value)
const exportItems = computed(() => [
  { key: 'xlsx', label: t('tournament.exportExcel'), testid: 'tournament-export-xlsx' },
  { key: 'pdf', label: t('tournament.exportPdf'), testid: 'tournament-export-pdf' },
])
async function exportBoard(format: string) {
  if (exportDisabled.value || !standings.value) return
  exportMessage.value = ''
  if (format === 'pdf' && isAndroidApp()) { exportMessage.value = t('tournament.exportPdfBrowser'); return }
  // Copy the public values and every label before an async library load or event change.
  const table = projectTournamentPoints(standings.value, locale.value, t)
  exporting.value = true
  try {
    if (format === 'xlsx') {
      const file = await createTournamentPointsXlsx(table)
      await downloadBlob(file.blob, file.filename)
    } else if (format === 'pdf') await printTournamentPoints(table)
  } catch { exportMessage.value = t('tournament.exportFailed') }
  finally { exporting.value = false }
}
let controller = new AbortController(), generation = 0
async function loadEvents() {
  if (!network.value.available) return
  loading.value = true
  error.value = null
  const gen = generation
  try {
    const values = await listTournamentEvents(false, controller.signal)
    if (gen !== generation) return
    events.value = values
  } catch (value) { if (gen === generation) error.value = value }
  finally { if (gen === generation) loading.value = false }
}
async function loadBoard() {
  controller.abort()
  controller = new AbortController()
  const gen = ++generation
  standings.value = null
  error.value = null
  loading.value = false
  if (!eventId.value || !network.value.available) return
  loading.value = true
  try {
    const result = await getTournamentStandings(eventId.value, controller.signal)
    if (gen === generation) standings.value = result
  } catch (value) { if (gen === generation) error.value = value }
  finally { if (gen === generation) loading.value = false }
}
watch(eventId, loadBoard)
watch(() => network.value.available, available => { if (available) void loadEvents() }, { immediate: true })
onScopeDispose(() => { generation++; controller.abort() })
</script>
<template>
  <div class="tournament-page tournament-stack">
    <PageHeader :title="$t('tournament.title')"><template #actions>
      <MenuButton :label="$t(exporting ? 'tournament.exporting' : 'tournament.export')" :items="exportItems" :disabled="exportDisabled" data-testid="tournament-export" @select="exportBoard" />
      <AppButton :disabled="loading || !network.available" @click="eventId ? loadBoard() : loadEvents()">{{ $t('tournament.refresh') }}</AppButton>
    </template></PageHeader>
    <Banner v-if="!network.available">{{ $t(network.messageKey || 'featureOffline.tournamentPoints') }}</Banner>
    <Banner v-if="error" tone="danger">{{ apiErrorLabel(t, te, error) }}</Banner>
    <Banner v-if="exportMessage" role="status">{{ exportMessage }}</Banner>
    <TournamentEventSelect v-model="eventId" :events="events" :disabled="loading" />
    <p v-if="loading" role="status">{{ $t('tournament.loading') }}</p>
    <p v-else-if="!events.length" class="tournament-muted">{{ $t('tournament.noEvents') }}</p>
    <p v-else-if="!eventId" class="tournament-muted">{{ $t('tournament.selectEvent') }}</p>
    <TournamentPointsTable v-if="standings" :standings="standings" />
  </div>
</template>
