<!--
  战局回放 / 战局重建能力面板。
  Dataset-only：读已解析 Processing Job 的 cached artifacts，不重新上传 replay / 不重新 full process。
  Endpoint/auth/runtime-contract ownership 统一在 api/replay-capabilities.ts；本组件只维护 capability
  生命周期、竞态 generation 与显式 UI 状态机。
-->
<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import {
  fetchBattlePlaybackDataset,
  fetchMapOverviewArtifact,
  type ReplayAuthSession,
  type ReplayDatasetRef,
} from '../api/replay-capabilities.js'
import { isRecoverableDatasetCode } from '../utils/reconstruction-analysis.js'
import { apiErrorLabel } from '../utils/display.js'
import { normalizeApiError } from '../utils/http.js'
import type { BattlePlaybackDataset } from '../types/playback-v2.js'
import MapOverview from './MapOverview.vue'
import BattlePlayback from './BattlePlayback.vue'

const BattleMap3D = defineAsyncComponent(() => import('./BattleMap3D.vue'))

const props = defineProps({
  file: { type: Object, default: null },
  processingJobId: { type: String, default: null },
  sourceId: { type: String, default: null },
  active: { type: Boolean, default: false },
  seekTo: { type: Number, default: null },
  datasetError: { type: String, default: '' }
})

const emit = defineEmits(['dataset-recover'])

const { t, te } = useI18n()
const auth = useAuth() as ReplayAuthSession
const datasetReady = computed(() => !!props.processingJobId && !!props.sourceId)

function datasetRef(): ReplayDatasetRef | null {
  if (!props.processingJobId || !props.sourceId) return null
  return { processingJobId: props.processingJobId, sourceId: props.sourceId }
}

const mapOverview = ref<Record<string, any> | null>(null)
const mapPlaybackV2 = ref<BattlePlaybackDataset | null>(null)
const playbackV2State = ref('LOADING')
const playbackV2Error = ref('')
const playbackV2Retryable = ref(false)
const playbackV2UnavailableReason = ref('')

/** V2 是 playback 核心事实源；MapOverview 只补 optional overlay。 */
const pbOverview = computed(() => {
  const v2 = mapPlaybackV2.value
  if (!v2) return null
  const overlay = mapOverview.value || {}
  return {
    ...overlay,
    mapCode: v2.mapCode ?? null,
    friendlyTeam: v2.friendlyTeam ?? null,
    recorderAccountId: v2.recorderAccountId ?? null,
    arenaBonusType: v2.arenaBonusType ?? null,
  }
})

const panelView = ref('playback')
const playbackDimension = ref<'2d' | '25d'>('2d')
// The relief renderer is a DEV-only, fixed top-down 2.5D experiment. It does not
// reconstruct client static geometry and it never owns replay time or markers.
const playback25dEnabled = import.meta.env.DEV
const mapLoading = ref(false)
const mapLoaded = ref(false)
const mapError = ref('')
const mapSeek = ref<number | null>(null)
let mapRequestSeq = 0
let mapAbortController: AbortController | null = null

async function loadMapOverview() {
  if (mapLoading.value) return
  const refValue = datasetRef()
  if (!refValue) return

  const controller = new AbortController()
  mapAbortController = controller
  const requestSeq = ++mapRequestSeq
  mapLoading.value = true
  mapError.value = ''
  try {
    const artifact = await fetchMapOverviewArtifact(auth, refValue, controller.signal)
    if (requestSeq !== mapRequestSeq) return
    mapOverview.value = artifact.available
      ? artifact.data as Record<string, any>
      : null
    if (requestSeq !== mapRequestSeq) return
    mapLoaded.value = true
  } catch (e) {
    if (requestSeq !== mapRequestSeq) return
    const apiError = normalizeApiError(e)
    if (apiError.code === 'REQUEST_ABORTED') return
    if (isRecoverableDatasetCode(apiError.code)) {
      emit('dataset-recover', apiError.code)
      mapLoaded.value = false
      return
    }
    mapError.value = apiErrorLabel(t, te, apiError)
    mapLoaded.value = true
  } finally {
    if (requestSeq === mapRequestSeq) {
      mapLoading.value = false
      if (mapAbortController === controller) mapAbortController = null
    }
  }
}

let playbackV2Seq = 0
let playbackV2AbortController: AbortController | null = null
async function loadPlaybackV2() {
  const refValue = datasetRef()
  if (!refValue) return
  if (playbackV2AbortController) playbackV2AbortController.abort()

  const controller = new AbortController()
  playbackV2AbortController = controller
  const seq = ++playbackV2Seq
  playbackV2State.value = 'LOADING'
  playbackV2Error.value = ''
  playbackV2Retryable.value = false
  playbackV2UnavailableReason.value = ''
  const logBase = refValue

  try {
    const artifact = await fetchBattlePlaybackDataset(auth, refValue, controller.signal)
    if (seq !== playbackV2Seq) return
    if (!artifact.available) {
      mapPlaybackV2.value = null
      playbackV2State.value = 'UNAVAILABLE'
      playbackV2UnavailableReason.value = t('recon.playback.unavailable')
      console.warn('[playback-v2] unavailable (204 / no artifact / timeline not usable)', logBase)
      return
    }

    const dataset = artifact.data
    mapPlaybackV2.value = dataset
    playbackV2State.value = dataset.capability === 'PARTIAL' ? 'PARTIAL' : 'FULL'
    console.info('[playback-v2] ok', {
      ...logBase,
      status: artifact.status,
      capability: dataset.capability,
      limitations: dataset.limitations
    })
  } catch (e) {
    if (seq !== playbackV2Seq) return
    const apiError = normalizeApiError(e)
    if (apiError.code === 'REQUEST_ABORTED') {
      playbackV2State.value = 'LOADING'
      return
    }
    if (isRecoverableDatasetCode(apiError.code)) {
      emit('dataset-recover', apiError.code)
      return
    }
    mapPlaybackV2.value = null
    playbackV2State.value = 'ERROR'
    playbackV2Error.value = apiErrorLabel(t, te, apiError)
    playbackV2Retryable.value = apiError.retryable
    console.warn('[playback-v2] exception', {
      ...logBase,
      failureCode: apiError.code
    })
  } finally {
    if (playbackV2AbortController === controller) playbackV2AbortController = null
  }
}

function retryPlaybackV2() {
  if (!datasetReady.value) return
  loadPlaybackV2()
}

function resetMap() {
  mapRequestSeq++
  playbackV2Seq++
  if (playbackV2AbortController) {
    playbackV2AbortController.abort()
    playbackV2AbortController = null
  }
  if (mapAbortController) {
    mapAbortController.abort()
    mapAbortController = null
  }
  mapOverview.value = null
  mapPlaybackV2.value = null
  playbackV2State.value = 'LOADING'
  playbackV2Error.value = ''
  playbackV2Retryable.value = false
  playbackV2UnavailableReason.value = ''
  panelView.value = 'playback'
  playbackDimension.value = '2d'
  mapLoading.value = false
  mapLoaded.value = false
  mapError.value = ''
  mapSeek.value = null
}

function effectiveDatasetKey() {
  return `${props.processingJobId || ''}|${props.sourceId || ''}`
}

watch(effectiveDatasetKey, () => {
  resetMap()
  maybeAutoLoadMap()
}, { immediate: true })

watch(() => props.active, () => {
  maybeAutoLoadMap()
}, { immediate: true })

function maybeAutoLoadMap() {
  if (props.active && datasetReady.value && !mapLoaded.value && !mapLoading.value) {
    loadMapOverview()
    if (playbackV2State.value === 'LOADING') loadPlaybackV2()
  }
}

watch(() => props.seekTo, async (sec) => {
  if (!Number.isFinite(sec)) return
  if (!mapOverview.value && !mapLoading.value) await loadMapOverview()
  mapSeek.value = null
  await nextTick()
  mapSeek.value = sec
})

onBeforeUnmount(() => {
  mapRequestSeq++
  playbackV2Seq++
  if (playbackV2AbortController) playbackV2AbortController.abort()
  if (mapAbortController) mapAbortController.abort()
  playbackV2AbortController = null
  mapAbortController = null
})
</script>

<template>
  <div>
    <p v-if="!file && !datasetReady" class="ws-note">{{ $t('workspace.playback_empty') }}</p>
    <div v-else class="panel map-panel" data-test="map-panel">
      <div v-if="!datasetReady" class="map-dataset-status" data-test="map-dataset-status">
        <span v-if="!datasetError" class="map-status-spinner" aria-hidden="true"></span>
        <span :class="{ 'map-dataset-error': !!datasetError }">{{ datasetError || $t('workspace.dataset_preparing') }}</span>
      </div>
      <template v-else>
        <div class="pb-panel-head">
          <h2>{{ $t('recon.playback.title') }}</h2>
          <div class="pb-view-toggle" role="tablist" aria-label="Replay playback views">
            <button type="button" class="pb-view-tab" :class="{ active: panelView === 'playback' }" data-test="pb-view-playback" @click="panelView = 'playback'">{{ $t('recon.playback.view_playback') }}</button>
            <button type="button" class="pb-view-tab" :class="{ active: panelView === 'map' }" data-test="pb-view-map" @click="panelView = 'map'">{{ $t('recon.playback.view_map') }}</button>
          </div>
          <button v-if="!mapOverview" type="button" class="map-load-btn" data-test="map-load-btn" :disabled="mapLoading" @click="loadMapOverview">{{ $t(mapLoading ? 'recon.map.loading' : 'recon.map.load') }}</button>
        </div>
        <p v-if="mapError" class="error map-error" data-test="map-error">{{ mapError }}</p>

        <div v-show="panelView === 'playback'" data-test="pb-primary">
          <template v-if="playbackV2State === 'FULL' || playbackV2State === 'PARTIAL'">
            <p v-if="playbackV2State === 'PARTIAL'" class="pb-capability-note" data-test="pb-capability-partial">{{ $t('recon.playback.partial') }}</p>
            <BattlePlayback
              v-if="pbOverview"
              :overview="pbOverview || undefined"
              :playback-v2="mapPlaybackV2 || undefined"
              :seek-to="mapSeek ?? undefined"
            />

            <!-- The 2.5D canvas is teleported *inside* BattleMap's existing viewport.
                 Its parent receives the exact same pan/zoom transform as the 2D image,
                 while SVG bases/tracers and DOM hull/turret markers remain above it. -->
            <Teleport
              v-if="playback25dEnabled && pbOverview && playbackDimension === '25d'"
              defer
              to="[data-test='pb-primary'] .pb-viewport"
            >
              <BattleMap3D :map-code="String(mapPlaybackV2?.mapCode || '')" />
            </Teleport>

            <Teleport
              v-if="playback25dEnabled && pbOverview"
              defer
              to="[data-test='pb-primary'] .pb-map-stage"
            >
              <button
                type="button"
                class="pb-dimension-corner-btn"
                data-test="pb-dimension-toggle"
                :aria-label="playbackDimension === '2d' ? 'Switch to terrain relief view' : 'Switch to flat 2D view'"
                :title="playbackDimension === '2d' ? 'Switch to terrain relief view' : 'Switch to flat 2D view'"
                @click="playbackDimension = playbackDimension === '2d' ? '25d' : '2d'"
              >{{ playbackDimension === '2d' ? '3D' : '2D' }}</button>
            </Teleport>
          </template>
          <div v-else-if="playbackV2State === 'UNAVAILABLE'" class="pb-status pb-unavailable" data-test="pb-unavailable">{{ playbackV2UnavailableReason }}</div>
          <div v-else-if="playbackV2State === 'ERROR'" class="pb-status pb-error" data-test="pb-error" :data-retryable="playbackV2Retryable">
            <span>{{ playbackV2Error }}</span>
            <button type="button" class="ghost sm" data-test="pb-retry" @click="retryPlaybackV2">{{ $t('recon.playback.retry') }}</button>
          </div>
          <div v-else-if="playbackV2State === 'LOADING'" class="pb-status" data-test="pb-loading">
            <span class="map-status-spinner" aria-hidden="true"></span>{{ $t('recon.playback.loading') }}
          </div>
        </div>

        <div v-show="panelView === 'map'" data-test="pb-map-secondary">
          <MapOverview v-if="mapOverview" :overview="mapOverview" />
          <p v-else-if="mapLoaded && !mapLoading" class="map-unavailable" data-test="map-unavailable">{{ $t('recon.map.unavailable') }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ws-note { margin: 18px 4px; color: var(--text-muted); font-size: .85rem; }
.map-dataset-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: .9rem;
  color: var(--text-label);
}
.map-status-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: map-status-spin 0.9s linear infinite;
  flex-shrink: 0;
}
@keyframes map-status-spin { to { transform: rotate(360deg); } }
.map-dataset-status .map-dataset-error { color: var(--error); }
.panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  color: var(--text);
}
.panel h2 { margin: 0 0 12px; font-size: 1rem; }
.map-panel { margin-top: 16px; }
.map-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.map-panel-head h2 { margin: 0 0 12px; }
.map-load-btn {
  margin: 0 0 12px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-card2);
  color: var(--text-label);
  font-size: .8rem;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color .15s, color .15s;
}
.map-load-btn:hover:not(disabled) { border-color: var(--accent); color: var(--accent-dark); }
.map-load-btn:disabled { opacity: .6; cursor: default; }
.map-error { margin: 0 0 8px; }
.map-unavailable { color: var(--text-secondary); font-size: .85rem; margin: 0; }
.pb-panel-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.pb-panel-head h2 { margin: 0; }
.pb-view-toggle {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--border-ghost);
  border-radius: 8px;
  background: var(--bg-card);
}
.pb-view-tab {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-sub);
  cursor: pointer;
  font-size: .85rem;
  font-family: inherit;
  font-weight: 700;
}
.pb-view-tab.active { background: color-mix(in srgb, var(--accent) 14%, var(--bg-card)); color: var(--accent-dark); }
.pb-view-tab:hover:not(.active) { color: var(--text-heading); }

.pb-dimension-corner-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 35;
  min-width: 40px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid rgb(255 255 255 / 22%);
  border-radius: 7px;
  background: rgb(10 16 22 / 78%);
  color: #eef5f9;
  font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .04em;
  cursor: pointer;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 14px rgb(0 0 0 / 22%);
}
.pb-dimension-corner-btn:hover {
  border-color: color-mix(in srgb, var(--accent) 65%, white 10%);
  background: rgb(10 16 22 / 92%);
}
.pb-dimension-corner-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.pb-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 2px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-label);
  font-size: .9rem;
}
.pb-status.pb-error { border-color: color-mix(in srgb, var(--error) 40%, var(--border)); color: var(--error); }
.pb-status.pb-unavailable { color: var(--text-secondary); }
.pb-capability-note {
  margin: 4px 2px 10px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--warn-text) 40%, var(--border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--warn-text) 10%, var(--bg-card));
  color: var(--warn-text);
  font-size: .82rem;
}
@media (max-width: 767px) {
  .pb-dimension-corner-btn {
    top: 8px;
    right: 8px;
    min-width: 38px;
    height: 28px;
    padding: 0 8px;
  }
}
</style>
