<!--
  战局回放 / 战局重建能力面板。
  Dataset-only：读已解析 Processing Job 的 cached map-overview.json（processingJobId + sourceId），
  不重新上传 replay / 不重新 full process（multipart map-overview 已随 /api/replay/map-overview 废弃为 410）。
  热力/战局回放（MapOverview）。与 AI 复盘解耦——不想跑 AI 复盘时也能看图。
  目标文件由父组件以 prop 传入；file identity 与「是否开始加载」解耦：仅当宿主声明
  active=true 且该文件尚未尝试加载时才自动请求 cached map-overview；手动按钮仅用于重试。
  seekTo 支持 AI 报告时间链接（未加载先拉取、自动展开折叠，MapOverview 收到 seek 后切回放视图）。
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { isRecoverableDatasetCode } from '../utils/reconstruction-analysis.js'
import { apiErrorLabel } from '../utils/display.js'
import { ApiError, apiErrorFromResponse, apiFetch, normalizeApiError } from '../utils/http.js'
import type { BattlePlaybackDataset } from '../types/playback-v2.js'
import { validateBattlePlaybackDataset } from '../api/contract-runtime.js'
import MapOverview from './MapOverview.vue'
import BattlePlayback from './BattlePlayback.vue'

const props = defineProps({
  /** 目标回放文件（null = 尚未选择，显示空态提示）。 */
  file: { type: Object, default: null },
  /** Dataset 引用：两者齐备时读 cached map-overview，不再上传 replay。 */
  processingJobId: { type: String, default: null },
  sourceId: { type: String, default: null },
  /** 宿主声明「战局回放 capability 已进入」：仅当 active=true 且该文件尚未尝试加载时自动请求
   * （独立 BattlePlaybackPage 传入 active=true）。
   * 不再把「file prop 变化」当作「用户要求加载 playback」——两个状态相互独立。 */
  active: { type: Boolean, default: false },
  /** AI 报告时间跳转（秒）；宿主切换到本面板后传入。 */
  seekTo: { type: Number, default: null },
  /** Dataset 准备失败（父组件 ensureDatasetFor 未能建立引用）时的已本地化错误；空 = 无。 */
  datasetError: { type: String, default: '' }
})

const emit = defineEmits(['dataset-recover'])

const { t, te } = useI18n()
const { token, ensureToken } = useAuth()

/** Dataset 就绪守卫：战局回放只有拿到 authoritative processingJobId+sourceId 才读 cached artifact。 */
const datasetReady = computed(() => !!props.processingJobId && !!props.sourceId)

// 统一的受保护请求：确保带上有效的 Keycloak Bearer Token（/api/replay/* 需要角色），
// 并统一处理 token 刷新失败 / 401 / 403。
async function authedFetch(url: string, body: BodyInit | null, { signal }: { signal?: AbortSignal } = {}): Promise<Response> {
  const valid = await ensureToken(30)
  if (!valid) {
    throw new ApiError({ code: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
  }
  const accessToken = token()
  const headers: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  if (typeof body === 'string') headers['Content-Type'] = 'application/json'
  const r = await apiFetch(url, { method: 'POST', headers, body, signal })
  if (r.status === 401) {
    const error = await apiErrorFromResponse(r)
    throw error
  }
  if (!r.ok && r.status !== 204) throw await apiErrorFromResponse(r)
  return r
}

const mapOverview = ref(null)
/** V2 canonical battle-playback dataset；未加载或 204 时为空。 */
const mapPlaybackV2 = ref<BattlePlaybackDataset | null>(null)
/**
 * V2 battle-playback 显式状态机（禁止静默吞掉 204/error）：LOADING | FULL | PARTIAL | UNAVAILABLE | ERROR。
 * 后端已按 limitations 诚实标注 capability；前端据此展示确定性降级态，不做任何未观测事实推断。
 */
const playbackV2State = ref('LOADING')
const playbackV2Error = ref('')
const playbackV2Retryable = ref(false)
const playbackV2UnavailableReason = ref('')
/**
 * PRIMARY Battle Playback 的 overview 输入：MapOverview 存在时用其完整 overlay（heatmap 之外的
 * gridCells/spawnPoints/playableBounds 为可选项）；MapOverview 不可用/缺失时由 V2 dataset 合成最小
 * authoritative overview（mapCode/friendlyTeam/recorderAccountId/arenaBonusType），保证 PRIMARY 不依赖
 * map-overview artifact 是否存在才能渲染（Blocker 2：Battle Playback PRIMARY 不被 MapOverview capability 锁死）。
 */
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
/** 面板内视图：默认 BattlePlayback 为主；地图鸟瞰为 secondary。 */
const panelView = ref('playback')
const mapLoading = ref(false)
const mapLoaded = ref(false)
const mapError = ref('')
const mapSeek = ref<number | null>(null)
// 换文件竞态防护：每次请求独占一个 generation（递增序号 + AbortController）；
// 文件变化（resetMap）或组件真正卸载时递增序号并 abort 旧请求，
// 旧请求在成功/失败/finally 写状态前必须校验序号，绝不覆盖新文件的 mapOverview/mapError/mapLoaded/mapLoading。
let mapRequestSeq = 0
let mapAbortController: AbortController | null = null

/**
 * 手动加载地图鸟瞰：成功 200 → MapOverview；204 → 无数据（显示不可用提示）；失败 → 稳定错误码本地化。
 * 竞态契约：响应只属于发起时的 generation；任何写状态前校验 mapRequestSeq 未变，
 * 旧请求（含 AbortError）不得影响新文件的状态。
 */
async function loadMapOverview() {
  if (mapLoading.value) return
  // Dataset 路径：必须携带 processingJobId+sourceId，绝不回退 multipart。
  // 数据集未就绪属于状态机问题（PREPARING_DATASET）：不尝试加载、不设裸错误码；datasetReady 后自动重试。
  if (!datasetReady.value) return
  const controller = new AbortController()
  mapAbortController = controller
  const requestSeq = ++mapRequestSeq
  mapLoading.value = true
  mapError.value = ''
  try {
    const r = await authedFetch('/api/replay/map-overview',
      JSON.stringify({ processingJobId: props.processingJobId, sourceId: props.sourceId }),
      { signal: controller.signal })
    if (requestSeq !== mapRequestSeq) return // 换文件/卸载：旧响应丢弃
    if (r.status === 204) {
      mapOverview.value = null
    } else {
      mapOverview.value = await r.json()
    }
    if (requestSeq !== mapRequestSeq) return
    mapLoaded.value = true
  } catch (e) {
    if (requestSeq !== mapRequestSeq) return // 旧请求的失败/取消不得写入错误
    const apiError = normalizeApiError(e)
    if (apiError.code === 'REQUEST_ABORTED') return // 主动取消：不是错误
    if (isRecoverableDatasetCode(apiError.code)) {
      emit('dataset-recover', apiError.code)
      mapLoaded.value = false
      return
    }
    mapError.value = apiErrorLabel(t, te, apiError)
    mapLoaded.value = true
  } finally {
    // 仅当前 generation 可结束 loading；旧请求 finally 不得提前解除新请求的 loading
    if (requestSeq === mapRequestSeq) {
      mapLoading.value = false
      if (mapAbortController === controller) mapAbortController = null
    }
  }
}

/**
 * 拉取 V2 canonical battle-playback dataset（独立竞态序号）。显式状态机，绝不在 204/error 时静默
 * 置 null 导致 Playback 整块消失。204 → UNAVAILABLE（确定性原因）；非 200 → ERROR（本地化，
 * 是否显示 retry 由 canonical retryable 决定）；
 * 200 → FULL/PARTIAL。日志记录 processingJobId / sourceId / V2 status / capability / limitations /
 * failure code；绝不记录 token。
 */
let playbackV2Seq = 0
let playbackV2AbortController: AbortController | null = null
async function loadPlaybackV2() {
  if (playbackV2AbortController) playbackV2AbortController.abort()
  const controller = new AbortController()
  playbackV2AbortController = controller
  const seq = ++playbackV2Seq
  playbackV2State.value = 'LOADING'
  playbackV2Error.value = ''
  playbackV2Retryable.value = false
  playbackV2UnavailableReason.value = ''
  const logBase = { processingJobId: props.processingJobId, sourceId: props.sourceId }
  try {
    const r = await authedFetch('/api/replay/battle-playback-v2',
      JSON.stringify({ processingJobId: props.processingJobId, sourceId: props.sourceId }),
      { signal: controller.signal })
    if (seq !== playbackV2Seq) return
    if (r.status === 204) {
      mapPlaybackV2.value = null
      playbackV2State.value = 'UNAVAILABLE'
      playbackV2UnavailableReason.value = t('recon.playback.unavailable')
      // eslint-disable-next-line no-console
      console.warn('[playback-v2] unavailable (204 / no artifact / timeline not usable)', logBase)
      return
    }
    const ds = await r.json()
    if (seq !== playbackV2Seq) return
    const validation = validateBattlePlaybackDataset(ds)
    if (!validation.data) {
      // Diagnostic metadata is safe; never log response payload, token, or replay content.
      console.warn('[playback-v2] contract validation failed', {
        ...logBase,
        diagnostics: validation.diagnostics.slice(0, 8),
      })
      throw new ApiError({ code: 'INVALID_RESPONSE', status: r.status, retryable: false })
    }
    const dataset = validation.data
    mapPlaybackV2.value = dataset
    playbackV2State.value = dataset.capability === 'PARTIAL' ? 'PARTIAL' : 'FULL'
    // eslint-disable-next-line no-console
    console.info('[playback-v2] ok', {
      ...logBase,
      status: r.status,
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
    // eslint-disable-next-line no-console
    console.warn('[playback-v2] exception', {
      ...logBase,
      failureCode: apiError.code
    })
  } finally {
    if (playbackV2AbortController === controller) playbackV2AbortController = null
  }
}

/** ERROR 态手动重试：重新拉取 V2（不重 parse / 不重传）。 */
function retryPlaybackV2() {
  if (!datasetReady.value) return
  loadPlaybackV2()
}

/** 文件变化（新增/移除/清空）或 Dataset identity 变化时使旧请求失效并取消，重置地图区块。 */
function resetMap() {
  mapRequestSeq++
  playbackV2Seq++ // 使在途 V2 请求失效（换文件/清空/卸载时旧响应不得写回状态）。
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
  mapLoading.value = false
  mapLoaded.value = false
  mapError.value = ''
  mapSeek.value = null
}

/**
 * effective Dataset identity：processingJobId + sourceId 共同决定「当前地图属于谁」。任一变化
 * 都必须真正 reset（abort 在途请求、清空已加载的旧 map、
 * 解除 mapLoaded 阻塞），否则错误 Dataset A 的已加载地图会在 B 身份下继续显示。
 * 单一 watcher 同时避免 file watcher + dataset watcher 对同一变化的双重请求。
 */
function effectiveDatasetKey() {
  return `${props.processingJobId || ''}|${props.sourceId || ''}`
}

watch(effectiveDatasetKey, () => {
  resetMap()
  maybeAutoLoadMap()
}, { immediate: true })

/** active 变化（进入/离开战局回放 capability）：进入时按需自动加载；离开不卸载、保留已有状态。 */
watch(() => props.active, () => {
  maybeAutoLoadMap()
}, { immediate: true })

/**
 * 自动加载守卫：file 就绪 + active（宿主声明已进入战局回放）+ 该文件尚未尝试过加载（mapLoaded=false）
 * + 无在途请求。同一文件已加载（或已尝试失败/204）后再次进入不重复请求；手动按钮仍可重试。
 */
function maybeAutoLoadMap() {
  if (props.active && props.processingJobId && props.sourceId && !mapLoaded.value && !mapLoading.value) {
    loadMapOverview()
    // V2 dataset 独立于 map-overview 拉取：即使 map-overview 204，V2 也可能可用（/ 或反而 204 需显式 unavailable）。
    if (playbackV2State.value === 'LOADING') loadPlaybackV2()
  }
}

/**
 * AI 报告时间跳转：确保地图已加载（未加载先拉取）并自动展开折叠中的地图区块，
 * 再把 seek 传给 MapOverview（其 watch 自动切到战局回放视图）。先置 null 再 nextTick
 * 写回同一数值：连续点击同一时间戳（值不变）也会触发子组件 watch，播放器被拖走后仍会重新 seek。
 */
watch(() => props.seekTo, async (sec) => {
  if (!Number.isFinite(sec)) return
  if (!mapOverview.value && !mapLoading.value) {
    await loadMapOverview()
  }
  mapSeek.value = null
  await nextTick()
  mapSeek.value = sec
})

onBeforeUnmount(() => {
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
})
</script>

<template>
  <div>
    <p v-if="!file && !datasetReady" class="ws-note">{{ $t('workspace.playback_empty') }}</p>
    <div v-else class="panel map-panel" data-test="map-panel">
      <!-- dataset 未就绪（PREPARING_DATASET / FAILURE）：不读 cached artifact，显示准备/失败状态 -->
      <div v-if="!datasetReady" class="map-dataset-status" data-test="map-dataset-status">
        <span v-if="!datasetError" class="map-status-spinner" aria-hidden="true"></span>
        <span :class="{ 'map-dataset-error': !!datasetError }">{{ datasetError || $t('workspace.dataset_preparing') }}</span>
      </div>
      <template v-else>
        <div class="pb-panel-head">
          <h2>{{ $t('recon.playback.title') }}</h2>
          <div class="pb-view-toggle" role="tablist" aria-label="Replay playback views">
            <button
              type="button"
              class="pb-view-tab"
              :class="{ active: panelView === 'playback' }"
              data-test="pb-view-playback"
              @click="panelView = 'playback'"
            >{{ $t('recon.playback.view_playback') }}</button>
            <button
              type="button"
              class="pb-view-tab"
              :class="{ active: panelView === 'map' }"
              data-test="pb-view-map"
              @click="panelView = 'map'"
            >{{ $t('recon.playback.view_map') }}</button>
          </div>
          <button
            v-if="!mapOverview"
            type="button"
            class="map-load-btn"
            data-test="map-load-btn"
            :disabled="mapLoading"
            @click="loadMapOverview"
          >{{ $t(mapLoading ? 'recon.map.loading' : 'recon.map.load') }}</button>
        </div>
        <p v-if="mapError" class="error map-error" data-test="map-error">{{ mapError }}</p>

        <!-- PRIMARY：Battle Playback（第一屏直接展示 playback 控件，不再被 MapOverview 吞掉） -->
        <div v-show="panelView === 'playback'" data-test="pb-primary">
          <template v-if="playbackV2State === 'FULL' || playbackV2State === 'PARTIAL'">
            <p v-if="playbackV2State === 'PARTIAL'" class="pb-capability-note" data-test="pb-capability-partial">
              {{ $t('recon.playback.partial') }}
            </p>
            <BattlePlayback v-if="pbOverview" :overview="pbOverview || undefined" :playback-v2="mapPlaybackV2 || undefined" :seek-to="mapSeek ?? undefined" />
          </template>
          <div v-else-if="playbackV2State === 'UNAVAILABLE'" class="pb-status pb-unavailable" data-test="pb-unavailable">
            {{ playbackV2UnavailableReason }}
          </div>
          <div v-else-if="playbackV2State === 'ERROR'" class="pb-status pb-error" data-test="pb-error">
            <span>{{ playbackV2Error }}</span>
            <button v-if="playbackV2Retryable" type="button" class="ghost sm" data-test="pb-retry" @click="retryPlaybackV2">{{ $t('recon.playback.retry') }}</button>
          </div>
          <div v-else-if="playbackV2State === 'LOADING'" class="pb-status" data-test="pb-loading">
            <span class="map-status-spinner" aria-hidden="true"></span>{{ $t('recon.playback.loading') }}
          </div>
        </div>

        <!-- SECONDARY：地图鸟瞰（heatmap） -->
        <div v-show="panelView === 'map'" data-test="pb-map-secondary">
          <MapOverview v-if="mapOverview" :overview="mapOverview" />
          <p v-else-if="mapLoaded && !mapLoading" class="map-unavailable" data-test="map-unavailable">
            {{ $t('recon.map.unavailable') }}
          </p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ws-note { margin: 18px 4px; color: var(--text-muted); font-size: .85rem; }

/* Dataset 准备中/失败状态：非地图加载错误，显示 loading 文案（不设裸错误码） */
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
/* FAILURE：与 PREPARING 明确区分——无 spinner、错误色文本 */
.map-dataset-status .map-dataset-error {
  color: var(--error);
}

.panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  color: var(--text);
}
.panel h2 { margin: 0 0 12px; font-size: 1rem; }

/* 独立地图区块：标题 + 加载按钮；MapOverview 自身带边框与 tab */
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

/* 战局回放 PRIMARY：面板头（title + [战斗回放][地图鸟瞰] 切换）+ 显式状态 */
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
</style>
