<!--
  战局回放 / 战局重建能力面板。
  Dataset-only：读已解析 Processing Job 的 cached map-overview.json（processingJobId + sourceId），
  不重新上传 replay / 不重新 full process（multipart map-overview 已随 /api/replay/map-overview 废弃为 410）。
  热力/路线/战局回放（MapOverview）。与 AI 复盘解耦——不想跑 AI 复盘时也能看图。
  目标文件由父组件以 prop 传入；file identity 与「是否开始加载」解耦：仅当宿主声明
  active=true 且该文件尚未尝试加载时才自动请求 cached map-overview；手动按钮仅用于重试。
  seekTo 支持 AI 报告时间链接（未加载先拉取、自动展开折叠，MapOverview 收到 seek 后切回放视图）。
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { localizeAiError, isRecoverableDatasetCode } from '../utils/reconstruction-analysis.js'
import MapOverview from './MapOverview.vue'

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

const { t } = useI18n()
const { token, ensureToken, login } = useAuth()

/** Dataset 就绪守卫：战局回放只有拿到 authoritative processingJobId+sourceId 才读 cached artifact。 */
const datasetReady = computed(() => !!props.processingJobId && !!props.sourceId)

// 统一的受保护请求：确保带上有效的 Keycloak Bearer Token（/api/replay/* 需要角色），
// 并统一处理 token 刷新失败 / 401 / 403。
async function authedFetch(url, body, { signal } = {}) {
  const valid = await ensureToken(30)
  if (!valid) {
    login('replay')
    throw new Error(t('recon.auth_required'))
  }
  const accessToken = token()
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  if (typeof body === 'string') headers['Content-Type'] = 'application/json'
  const r = await fetch(url, { method: 'POST', headers, body, signal })
  if (r.status === 401) {
    login('replay')
    throw new Error(t('recon.auth_required'))
  }
  if (r.status === 403) {
    throw new Error(t('recon.forbidden'))
  }
  return r
}

const mapOverview = ref(null)
/** V2 canonical battle-playback dataset（可选；迁移期守卫，加载失败不阻断 legacy map）。 */
const mapPlaybackV2 = ref(null)
/**
 * 战局回放完整度（BattlePlaybackDataset.capability：FULL / PARTIAL / UNAVAILABLE）。
 * 后端已诚实标注 limitations；前端仅据此展示降级态，不做任何未观测事实推断。
 */
const playbackCapability = computed(() => mapPlaybackV2.value?.capability || null)
const playbackCapabilityLabel = computed(() => {
  switch (playbackCapability.value) {
    case 'FULL': return t('recon.map.capability_full')
    case 'PARTIAL': return t('recon.map.capability_partial')
    case 'UNAVAILABLE': return t('recon.map.capability_unavailable')
    default: return ''
  }
})
const mapLoading = ref(false)
const mapLoaded = ref(false)
const mapError = ref('')
const mapSeek = ref(null)
// 地图区块折叠状态（默认展开）；折叠用 v-show 不销毁 MapOverview，保留视图/播放器状态。
const mapOpen = ref(true)
// 换文件竞态防护：每次请求独占一个 generation（递增序号 + AbortController）；
// 文件变化（resetMap）或组件真正卸载时递增序号并 abort 旧请求，
// 旧请求在成功/失败/finally 写状态前必须校验序号，绝不覆盖新文件的 mapOverview/mapError/mapLoaded/mapLoading。
let mapRequestSeq = 0
let mapAbortController = null

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
    } else if (!r.ok) {
      const rawBody = await r.text().catch(() => '')
      let errorData = { code: rawBody.trim() }
      if (rawBody.trim().startsWith('{')) {
        try {
          errorData = JSON.parse(rawBody.trim())
        } catch {
          // 保持纯文本错误码
        }
      }
      // 数据集引用过期（JOB_NOT_FOUND 等）：交给父组件重建，不显示裸错误码。
      if (isRecoverableDatasetCode(errorData.code)) {
        emit('dataset-recover', errorData.code)
        mapLoaded.value = false
        return
      }
      throw new Error(localizeAiError(errorData, r.status, t))
    } else {
      mapOverview.value = await r.json()
      // V2 守卫：并排拉取 canonical dataset（fire-and-forget，不扰动 legacy map 的确定性请求
      // 时序；成功 200 则后端 timeline 可用，失败/204 保持 null 走 legacy）。
      loadPlaybackV2(controller.signal)
    }
    if (requestSeq !== mapRequestSeq) return
    mapLoaded.value = true
  } catch (e) {
    if (requestSeq !== mapRequestSeq) return // 旧请求的失败/取消不得写入错误
    if (e && e.name === 'AbortError') return // 主动取消：不是错误
    mapError.value = e.message || String(e)
    mapLoaded.value = true
  } finally {
    // 仅当前 generation 可结束 loading；旧请求 finally 不得提前解除新请求的 loading
    if (requestSeq === mapRequestSeq) {
      mapLoading.value = false
      if (mapAbortController === controller) mapAbortController = null
    }
  }
}

/** 拉取 V2 canonical battle-playback dataset（fire-and-forget；独立竞态序号，失败静默回退 legacy）。 */
let playbackV2Seq = 0
async function loadPlaybackV2(signal) {
  const seq = ++playbackV2Seq
  try {
    const r = await authedFetch('/api/replay/battle-playback-v2',
      JSON.stringify({ processingJobId: props.processingJobId, sourceId: props.sourceId }),
      { signal })
    if (seq !== playbackV2Seq) return
    mapPlaybackV2.value = r.status === 200 ? await r.json() : null
  } catch {
    if (seq === playbackV2Seq) mapPlaybackV2.value = null
  }
}

/** 文件变化（新增/移除/清空）或 Dataset identity 变化时使旧请求失效并取消，重置地图区块。 */
function resetMap() {
  mapRequestSeq++
  if (mapAbortController) {
    mapAbortController.abort()
    mapAbortController = null
  }
  mapOverview.value = null
  mapPlaybackV2.value = null
  mapLoading.value = false
  mapLoaded.value = false
  mapError.value = ''
  mapSeek.value = null
  mapOpen.value = true
}

/** 地图区块折叠/展开（默认展开）。 */
function toggleMap() {
  mapOpen.value = !mapOpen.value
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
  // 地图可能被折叠：先展开（v-show 不销毁 MapOverview，内部视图/播放器状态保留）再传 seek
  mapOpen.value = true
  mapSeek.value = null
  await nextTick()
  mapSeek.value = sec
})

onBeforeUnmount(() => {
  mapRequestSeq++
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
        <div class="map-panel-head">
          <h2>{{ $t('recon.map.title') }}</h2>
          <button
            v-if="!mapOverview"
            type="button"
            class="map-load-btn"
            data-test="map-load-btn"
            :disabled="mapLoading"
            @click="loadMapOverview"
          >{{ $t(mapLoading ? 'recon.map.loading' : 'recon.map.load') }}</button>
          <button
            v-else
            type="button"
            class="map-load-btn"
            data-test="toggle-map"
            :aria-expanded="mapOpen"
            @click="toggleMap"
          >{{ $t(mapOpen ? 'recon.collapse' : 'recon.expand') }}</button>
        </div>
        <p v-if="playbackCapabilityLabel" class="map-capability-note" data-test="playback-capability">
          {{ playbackCapabilityLabel }}
        </p>
        <p v-if="mapError" class="error map-error" data-test="map-error">{{ mapError }}</p>
        <!-- 折叠用 v-show 而非 v-if：MapOverview 是否挂载只由 mapOverview 决定，折叠不销毁组件、保留视图/播放器状态 -->
        <div v-show="mapOpen" data-test="map-body">
          <MapOverview
            v-if="mapOverview"
            :overview="mapOverview"
            :seek-to="mapSeek"
            :playback-v2="mapPlaybackV2"
          />
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
.map-capability-note {
  margin: 4px 0 10px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--warn-text) 40%, var(--border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--warn-text) 10%, var(--bg-card));
  color: var(--warn-text);
  font-size: .82rem;
}

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
  background: rgba(13, 18, 22, .94);
  border: 1px solid #303a40;
  border-radius: 8px;
  padding: 16px 20px;
  color: #d8d5cd;
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
</style>
