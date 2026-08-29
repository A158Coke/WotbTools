<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useReplay } from '../composables/useReplay.js'
import { apiErrorLabel } from '../utils/display.js'
import { fileKey } from '../utils/helpers.js'
import FileUploader from './FileUploader.vue'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'
import AiReviewPanel from './AiReviewPanel.vue'
import BattlePlaybackPanel from './BattlePlaybackPanel.vue'

defineOptions({ name: 'ReplayCapabilityPage' })

const props = defineProps({
  mode: { type: String, required: true },
})

const { t, te } = useI18n()
const replay = useReplay()
const { files, loading, error, processingJob, processingError, uploadState,
  updateFiles, requestDirectAction, cancelProcessing, dismissProcessingJob } = replay
const isAuthenticated = inject('isAuthenticated', () => false)
const login = inject('login', null)
const navigate = inject('navigate', null)
const replayHandoff = inject('replayHandoff', ref(null))

const targetFile = ref(null)
const datasetRef = ref(null)
const datasetError = ref('')
const handoffActive = ref(false)
const seekTo = ref(null)
let recoveryAttempted = false
let recoveryInFlightRevision = null
let prepareRevision = 0

const isAi = computed(() => props.mode === 'ai')
const title = computed(() => isAi.value ? t('home.aiReview') : t('home.battlePlayback'))
const panelReady = computed(() => !!targetFile.value && !!datasetRef.value?.processingJobId && !!datasetRef.value?.sourceId)

function validRef(value) {
  return !!value && typeof value.processingJobId === 'string' && value.processingJobId.trim() !== ''
    && typeof value.sourceId === 'string' && /^r\d+$/.test(value.sourceId)
}

function syntheticFile(sourceId) {
  return { name: `${sourceId}.wotbreplay`, size: 0, type: 'application/octet-stream' }
}

function consumeHandoff() {
  const incoming = replayHandoff?.value
  if (!validRef(incoming)) return
  handoffActive.value = true
  datasetRef.value = { processingJobId: incoming.processingJobId, sourceId: incoming.sourceId }
  targetFile.value = syntheticFile(incoming.sourceId)
  seekTo.value = Number.isFinite(incoming.seekTo) ? incoming.seekTo : null
}

onMounted(() => {
  consumeHandoff()
  if (!isAuthenticated() && login) login('replay')
})

watch(files, (next) => {
  if (handoffActive.value) return
  const file = next.length === 1 ? next[0] : null
  targetFile.value = file
  datasetRef.value = null
  datasetError.value = ''
  recoveryAttempted = false
  recoveryInFlightRevision = null
  seekTo.value = null
  if (!file) {
    if (next.length > 1) datasetError.value = t('workspace.single_replay_required')
    return
  }
  const revision = ++prepareRevision
  requestDirectAction(file).then((refValue) => {
    if (revision !== prepareRevision || !targetFile.value || fileKey(targetFile.value) !== fileKey(file)) return
    datasetRef.value = refValue
  }).catch((e) => {
    if (revision !== prepareRevision || !targetFile.value || fileKey(targetFile.value) !== fileKey(file)) return
    datasetError.value = apiErrorLabel(t, te, e)
  })
}, { deep: true })

function changeReplay() {
  handoffActive.value = false
  targetFile.value = null
  datasetRef.value = null
  datasetError.value = ''
  seekTo.value = null
  recoveryAttempted = false
  recoveryInFlightRevision = null
  prepareRevision++
  updateFiles([])
}

function goBack() {
  if (navigate) navigate('replay')
}

function onDatasetRecover() {
  if (handoffActive.value) {
    handoffActive.value = false
    targetFile.value = null
    datasetRef.value = null
    datasetError.value = t('workspace.dataset_prepare_failed')
    return
  }
  const file = targetFile.value
  if (recoveryInFlightRevision != null) return
  if (!file || recoveryAttempted) {
    datasetRef.value = null
    datasetError.value = t('workspace.dataset_prepare_failed')
    return
  }
  recoveryAttempted = true
  const revision = ++prepareRevision
  recoveryInFlightRevision = revision
  datasetRef.value = null
  datasetError.value = ''
  requestDirectAction(file).then((refValue) => {
    if (revision === prepareRevision && targetFile.value && fileKey(targetFile.value) === fileKey(file)) {
      datasetRef.value = refValue
      datasetError.value = ''
    }
    if (recoveryInFlightRevision === revision) recoveryInFlightRevision = null
  }).catch((e) => {
    if (revision === prepareRevision && targetFile.value && fileKey(targetFile.value) === fileKey(file)) {
      datasetError.value = apiErrorLabel(t, te, e)
    }
    if (recoveryInFlightRevision === revision) recoveryInFlightRevision = null
  })
}

function onAiSeek(sec) {
  if (props.mode !== 'ai' || !datasetRef.value || !navigate) return
  navigate('battle-playback', { ...datasetRef.value, seekTo: sec })
}

onBeforeUnmount(() => { prepareRevision++ })
</script>

<template>
  <main class="layout-data-workspace capability-page">
    <header class="capability-header">
      <button v-if="handoffActive" type="button" class="ghost sm" @click="goBack">← {{ $t('workspace.back_to_replay') }}</button>
      <div>
        <span class="upload-kicker">WOTBTOOLS · REPLAY CAPABILITY</span>
        <h1>{{ title }}</h1>
      </div>
      <button v-if="panelReady" type="button" class="ghost sm" @click="changeReplay">{{ $t('workspace.change_replay') }}</button>
    </header>

    <template v-if="!handoffActive">
      <FileUploader :files="files" :loading="loading" :confirm-remove="false" :show-workspace-actions="false"
        @update:files="updateFiles" />
      <ReplayProcessingPanel v-if="uploadState || processingJob" :upload-state="uploadState" :job="processingJob"
        :error="processingError" @cancel="cancelProcessing" @dismiss="dismissProcessingJob" />
      <p v-if="error || datasetError" class="error">{{ error || datasetError }}</p>
      <p v-if="!files.length" class="replay-empty-note">{{ $t('workspace.capability_upload_hint') }}</p>
    </template>

    <p v-if="handoffActive && !panelReady" class="replay-empty-note">{{ $t('workspace.dataset_preparing') }}</p>
    <AiReviewPanel v-if="isAi" :file="targetFile" :processing-job-id="datasetRef?.processingJobId ?? null"
      :source-id="datasetRef?.sourceId ?? null" :dataset-error="datasetError"
      @dataset-recover="onDatasetRecover" @seek="onAiSeek" />
    <BattlePlaybackPanel v-else :file="targetFile" :processing-job-id="datasetRef?.processingJobId ?? null"
      :source-id="datasetRef?.sourceId ?? null" :active="true" :seek-to="seekTo" :dataset-error="datasetError"
      @dataset-recover="onDatasetRecover" />
  </main>
</template>

<style scoped>
.capability-page { min-height: calc(100vh - var(--topbar-h, 60px)); }
.capability-header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; }
.capability-header h1 { margin:4px 0 0; }
.capability-header > div { flex:1; }
@media (max-width: 767px) { .capability-header { align-items:flex-start; flex-wrap:wrap; } .capability-header > div { order:-1; flex-basis:100%; } }
</style>
