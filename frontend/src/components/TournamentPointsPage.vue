<script setup lang="ts">
import { onScopeDispose, ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from './PageHeader.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import TournamentEventSelect from './TournamentEventSelect.vue'
import TournamentPointsTable from './TournamentPointsTable.vue'
import { getTournamentStandings, listTournamentEvents } from '../api/tournament-points.js'
import type { TournamentEvent, TournamentStandings } from '../api/tournament-points.js'
import { apiErrorLabel } from '../utils/display.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import '../styles/tournament-points.css'
const { t, te } = useI18n()
const { availability } = useFeatureGate()
const network = computed(() => availability(Feature.TOURNAMENT_POINTS))
const events = ref<TournamentEvent[]>([])
const eventId = ref<number | null>(null)
const standings = ref<TournamentStandings | null>(null)
const loading = ref(false)
const error = ref<unknown>(null)
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
    <PageHeader :title="$t('tournament.title')"><template #actions><AppButton :disabled="loading || !network.available" @click="eventId ? loadBoard() : loadEvents()">{{ $t('tournament.refresh') }}</AppButton></template></PageHeader>
    <Banner v-if="!network.available">{{ $t(network.messageKey || 'featureOffline.tournamentPoints') }}</Banner>
    <Banner v-if="error" tone="danger">{{ apiErrorLabel(t, te, error) }}</Banner>
    <TournamentEventSelect v-model="eventId" :events="events" :disabled="loading" />
    <p v-if="loading" role="status">{{ $t('tournament.loading') }}</p>
    <p v-else-if="!events.length" class="tournament-muted">{{ $t('tournament.noEvents') }}</p>
    <p v-else-if="!eventId" class="tournament-muted">{{ $t('tournament.selectEvent') }}</p>
    <TournamentPointsTable v-if="standings" :standings="standings" />
  </div>
</template>
