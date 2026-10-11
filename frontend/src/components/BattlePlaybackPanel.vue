<!--
  战局回放能力面板：目标回放在本机解析（上游 Rust Core WASM → BattlePlaybackDataset + MapOverview，
  replay-local/playback），服务器没有 parser。本组件只维护解析生命周期、竞态序号与显式 UI 状态机。
-->
<script setup lang="ts">
import { computed, defineAsyncComponent, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { isOfficialDemo, OFFICIAL_DEMO } from '../replay-local/demo.js'
import { parseLocalPlayback } from '../replay-local/playback/index.js'
import { ReplayEngineUnavailableError } from '../replay-local/parseReplays.js'
import type { BattlePlaybackDataset, PlaybackReloadTelemetry } from '../types/playback-v2.js'
import MapOverview from './MapOverview.vue'
import BattlePlayback from './BattlePlayback.vue'

const BattleMap3D = defineAsyncComponent(() => import('./BattleMap3D.vue'))

const props = defineProps({
  /** 目标回放文件：本地解析（上游 Rust Core WASM），文件不出本机 */
  file: { type: Object, default: null },
  playbackSession: { type: Object, default: null },
  active: { type: Boolean, default: false },
  seekTo: { type: Number, default: null },
  /** 工作台给出的不可用原因（如多文件未选场次）；非空时不解析 */
  blockedReason: { type: String, default: '' },
})

const mapOverview = ref<Record<string, any> | null>(null)
const onboarding = inject(ONBOARDING_KEY, null)
const playbackView = ref<InstanceType<typeof BattlePlayback> | null>(null)
let guideOpenedAnnotations = false
const mapPlaybackV2 = ref<BattlePlaybackDataset | null>(null)
const reloadTelemetry = ref<PlaybackReloadTelemetry | null>(null)
/** LOADING | FULL | PARTIAL | UNAVAILABLE | ERROR */
const playbackV2State = ref('LOADING')
const playbackV2Error = ref('')

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
const mapSeek = ref<number | null>(null)
/** 在途解析的认领序号：文件切换 / 卸载后迟到的结果一律丢弃 */
let parseSeq = 0
/** 已完成（或正在）解析的文件：同一文件不重复解析 */
let parsedFile: unknown = null

function reset() {
  parseSeq++
  parsedFile = null
  mapOverview.value = null
  mapPlaybackV2.value = null
  reloadTelemetry.value = null
  playbackV2State.value = 'LOADING'
  playbackV2Error.value = ''
  panelView.value = 'playback'
  mapSeek.value = null
}

async function load() {
  const file = props.file
  if (!file || props.blockedReason || parsedFile === file) return
  parsedFile = file
  const seq = ++parseSeq
  playbackV2State.value = 'LOADING'
  playbackV2Error.value = ''
  try {
    const canonical = props.playbackSession ? await props.playbackSession.loadCanonical(file as File) : await parseLocalPlayback(file as File)
    if (!canonical) throw props.playbackSession.getState(file as File).canonicalError
    const { dataset, overview, reloadTelemetry: telemetry } = canonical
    if (seq !== parseSeq) return
    mapPlaybackV2.value = dataset
    reloadTelemetry.value = telemetry
    mapOverview.value = overview as Record<string, any> | null
    playbackV2State.value = !dataset ? 'UNAVAILABLE' : dataset.capability === 'PARTIAL' ? 'PARTIAL' : 'FULL'
  } catch (e) {
    if (seq !== parseSeq) return
    // 服务器没有 parser：解析失败只显示原因，不回退服务端
    console.warn('[playback-local] parse failed', e)
    parsedFile = null
    mapPlaybackV2.value = null
    reloadTelemetry.value = null
    playbackV2State.value = 'ERROR'
    playbackV2Error.value = e instanceof ReplayEngineUnavailableError
      ? 'recon.playback.engine_unavailable'
      : 'recon.playback.parse_failed'
  }
}

function retry() {
  if (props.file && props.playbackSession) {
    if (props.playbackSession.getState(props.file).sceneState === 'error') props.playbackSession.invalidate(props.file)
    else props.playbackSession.invalidateCanonical(props.file)
  }
  parsedFile = null
  load()
}

watch(() => props.file, () => {
  reset()
  if (props.active) load()
})

watch(() => props.active, (active) => {
  if (active) load()
}, { immediate: true })

watch(() => props.seekTo, async (sec) => {
  if (!Number.isFinite(sec)) return
  mapSeek.value = null
  await nextTick()
  mapSeek.value = sec
})

onBeforeUnmount(() => {
  parseSeq++
  onboarding?.registerSurface('playback', null)
  onboarding?.registerSurface('annotations', null)
})
onMounted(() => {
  onboarding?.registerSurface('playback', {
    ready: () => props.active && !!mapPlaybackV2.value && !!playbackView.value,
    failed: () => ['ERROR', 'UNAVAILABLE'].includes(playbackV2State.value) || !!props.blockedReason,
    prepare: async () => {
      playbackView.value?.pause()
      if (isOfficialDemo(props.file as File)) {
        mapSeek.value = null
        await nextTick()
        mapSeek.value = OFFICIAL_DEMO.cue.playbackSeconds
      }
    },
  })
  onboarding?.registerSurface('annotations', {
    ready: () => props.active && playbackView.value?.annotationsOpen() === true,
    failed: () => ['ERROR', 'UNAVAILABLE'].includes(playbackV2State.value) || !!props.blockedReason,
    prepare: async () => {
      guideOpenedAnnotations = playbackView.value?.openAnnotations() === true || guideOpenedAnnotations
      await nextTick()
    },
    cleanup: () => {
      if (guideOpenedAnnotations) playbackView.value?.closeAnnotations()
      guideOpenedAnnotations = false
    },
  })
})
</script>

<template>
  <div>
    <p v-if="blockedReason" class="ws-note map-dataset-error" data-test="map-dataset-status">{{ blockedReason }}</p>
    <p v-else-if="!file" class="ws-note">{{ $t('workspace.playback_empty') }}</p>
    <div v-else class="panel map-panel" data-test="map-panel">
      <div class="pb-panel-head">
        <h2>{{ $t('recon.playback.title') }}</h2>
        <div class="pb-view-toggle" role="tablist" aria-label="Replay playback views">
          <button type="button" class="pb-view-tab" :class="{ active: panelView === 'playback' }" data-test="pb-view-playback" @click="panelView = 'playback'">{{ $t('recon.playback.view_playback') }}</button>
          <button type="button" class="pb-view-tab" :class="{ active: panelView === 'map' }" data-test="pb-view-map" @click="panelView = 'map'">{{ $t('recon.playback.view_map') }}</button>
        </div>
      </div>

      <div v-show="panelView === 'playback'" data-test="pb-primary">
        <template v-if="playbackV2State === 'FULL' || playbackV2State === 'PARTIAL'">
          <p v-if="playbackV2State === 'PARTIAL'" class="pb-capability-note" data-test="pb-capability-partial">{{ $t('recon.playback.partial') }}</p>
          <BattlePlayback
            ref="playbackView"
            v-if="pbOverview"
            :overview="pbOverview || undefined"
            :playback-v2="mapPlaybackV2 || undefined"
            :reload-telemetry="reloadTelemetry || undefined"
            :seek-to="mapSeek ?? undefined"
            :active="active && panelView === 'playback'"
          />

          <!-- 2.5D directly upgrades the map background. BattleMap still owns all
               replay overlays/time/state; if local height data is unavailable the
               original raster simply remains visible as a technical fallback. -->
          <Teleport
            v-if="pbOverview"
            defer
            to="[data-test='pb-primary'] .pb-viewport"
          >
            <BattleMap3D :map-code="String(mapPlaybackV2?.mapCode || '')" />
          </Teleport>
        </template>
        <div v-else-if="playbackV2State === 'UNAVAILABLE'" class="pb-status pb-unavailable" data-test="pb-unavailable">{{ $t('recon.playback.unavailable') }}</div>
        <div v-else-if="playbackV2State === 'ERROR'" class="pb-status pb-error" data-test="pb-error">
          <span>{{ $t(playbackV2Error) }}</span>
          <button type="button" class="ghost sm" data-test="pb-retry" @click="retry">{{ $t('recon.playback.retry') }}</button>
        </div>
        <div v-else-if="playbackV2State === 'LOADING'" class="pb-status" data-test="pb-loading">
          <span class="map-status-spinner" aria-hidden="true"></span>{{ $t('recon.playback.loading') }}
        </div>
      </div>

      <div v-show="panelView === 'map'" data-test="pb-map-secondary">
        <MapOverview v-if="mapOverview" :overview="mapOverview" />
        <p v-else-if="playbackV2State !== 'LOADING'" class="map-unavailable" data-test="map-unavailable">{{ $t('recon.map.unavailable') }}</p>
      </div>
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
