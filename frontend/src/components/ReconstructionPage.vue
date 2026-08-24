<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { localizeAiError } from '../utils/reconstruction-analysis.js'
import { takePendingReplayFiles } from '../utils/replayTransfer.js'
import AnalysisResultPanel from './AnalysisResultPanel.vue'
import MapOverview from './MapOverview.vue'
import ReplayInputPanel from './ReplayInputPanel.vue'

const { t, locale } = useI18n()
const { initPromise, tokenParsed, token, ensureToken, login, authenticated } = useAuth()

// KeepAlive include 匹配组件名：App.vue 仅缓存本页，切走视图时保持 SSE 流存活。
defineOptions({ name: 'ReconstructionPage' })

/** 登录后回跳到本页而不是个人中心。 */
const LOGIN_VIEW = 'reconstruction'

// AI Review 权限：已登录 + wotbtools-user 或 wotbtools-admin
const canUseAiReview = computed(() => {
  if (!authenticated.value) return false
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && (
    roles.includes('wotbtools-user') || roles.includes('wotbtools-admin')
  )
})

// 入口随时可见，但进入本页后检查登录状态：未登录则自动跳转登录页。
// 鉴权若已就绪（authenticated 为真）直接 ready，避免多余的加载闪屏；
// 否则先 'init' 不渲染内容，等 initPromise 落定再决定 ready / login。
const authPhase = ref(authenticated.value ? 'ready' : 'init')

onMounted(async () => {
  window.addEventListener('beforeunload', onPageLeave)
  let loggedIn = false
  try {
    loggedIn = Boolean(await initPromise)
  } catch {
    loggedIn = false
  }
  if (loggedIn) {
    authPhase.value = 'ready'
    adoptPendingReplay()
    return
  }
  authPhase.value = 'login'
  login(LOGIN_VIEW)
})


/** 跨视图文件接管（Phase 2 V2）：ReplayPage Battle context「战局回放/AI 复盘」跳转来此时，
 * 把暂存的 replay 文件接管为本地 files。mode=playback 自动加载地图；mode=ai 只填充文件，
 * 由用户点击「AI 战术复盘」发起（不自动消耗 AI 额度）。
 * take 语义：只消费一次；未 ready 时（登录回跳）由 onActivated 再次尝试。 */
function adoptPendingReplay() {
  const pending = takePendingReplayFiles()
  if (!pending || !pending.files || !pending.files.length) return
  files.value = pending.files.slice()
  error.value = ''
  resetResults()
  resetMap()
  if (pending.mode === 'playback') {
    loadMapOverview()
  }
}

onActivated(() => {
  if (authPhase.value === 'ready') adoptPendingReplay()
})

onBeforeUnmount(() => {
  // 仅移除页面级监听；应用内切页由 App.vue KeepAlive 保持组件存活，
  // 不在卸载时取消分析（真实关页/刷新由 beforeunload 处理）。
  window.removeEventListener('beforeunload', onPageLeave)
  // 地图请求：组件真正卸载（非 KeepAlive deactivate）时取消仍在执行的请求，
  // 递增序号使旧响应全部失效；deactivate 不触发本钩子，有效状态不受影响。
  mapRequestSeq++
  if (mapAbortController) {
    mapAbortController.abort()
    mapAbortController = null
  }
})

// 本页只做一件事：上传单场回放 → 发起 AI 复盘 → 展示结果。
// 回放重建由后端在 /api/replay/analyze 内部完成，前端不展示重建过程与详情。
const files = ref([])
const error = ref('')
const analyzing = ref(false)
const analysisResult = ref(null)

// 独立地图区块（热力/路线/战局回放）：走 /api/replay/map-overview 只解析回放、不调 AI；
// 与 AI 复盘结果解耦——不想跑 AI 复盘时也能看图。
const mapOverview = ref(null)
const mapLoading = ref(false)
const mapLoaded = ref(false)
const mapError = ref('')
const mapSeek = ref(null)
// 地图区块折叠状态（默认展开）与面板 DOM 引用（时间链接 seek 后滚动定位）。
const mapOpen = ref(true)
const mapPanelEl = ref(null)
// 换文件竞态防护：每次请求独占一个 generation（递增序号 + AbortController）；
// 文件变化（addFile/removeFile/clearFile → resetMap）或组件真正卸载时递增序号并 abort 旧请求，
// 旧请求在成功/失败/finally 写状态前必须校验序号，绝不覆盖新文件的 mapOverview/mapError/mapLoaded/mapLoading。
let mapRequestSeq = 0
let mapAbortController = null

/**
 * 手动加载地图鸟瞰：成功 200 → MapOverview；204 → 无数据（显示不可用提示）；失败 → 稳定错误码本地化。
 * 竞态契约：响应只属于发起时的 generation；任何写状态前校验 mapRequestSeq 未变，
 * 旧请求（含 AbortError）不得影响新文件的状态。
 */
async function loadMapOverview() {
  if (mapLoading.value || files.value.length === 0) return
  const controller = new AbortController()
  mapAbortController = controller
  const requestSeq = ++mapRequestSeq
  mapLoading.value = true
  mapError.value = ''
  const fd = new FormData()
  for (const f of files.value) fd.append('files', f)
  try {
    const r = await authedFetch('/api/replay/map-overview', fd, { signal: controller.signal })
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
      throw new Error(localizeAiError(errorData, r.status, t))
    } else {
      mapOverview.value = await r.json()
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

/** 文件变化（新增/移除/清空）时使旧请求失效并取消，重置地图区块。 */
function resetMap() {
  mapRequestSeq++
  if (mapAbortController) {
    mapAbortController.abort()
    mapAbortController = null
  }
  mapOverview.value = null
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
 * AI 报告时间跳转：确保地图已加载（未加载先拉取）并自动展开折叠中的地图区块，
 * 再把 seek 传给 MapOverview（其 watch 自动切到战局回放视图）。先置 null 再 nextTick
 * 写回同一数值：连续点击同一时间戳（值不变）也会触发子组件 watch，播放器被拖走后仍会重新 seek。
 */
async function onAiSeek(sec) {
  if (files.value.length > 0 && !mapOverview.value && !mapLoading.value) {
    await loadMapOverview()
  }
  // 地图可能被折叠：先展开（v-show 不销毁 MapOverview，内部视图/播放器状态保留）再传 seek
  mapOpen.value = true
  mapSeek.value = null
  await nextTick()
  mapSeek.value = sec
  await nextTick()
  // 报告底部点时间链接 → 回滚到地图区块（其在分析结果面板上方），MapOverview 已自动切到战局回放视图
  if (mapOverview.value && mapPanelEl.value) {
    mapPanelEl.value.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// 流式状态：当前阶段（call1 赛前预测 / evidence 证据分析 / call2 生成中 / autopsy 团队剖析）
// 与主复盘已到达文本（token 滚动）。
const progressStage = ref('')
const partialAnalysis = ref('')

// AI 复盘请求生命周期：客户端安全超时 + 取消（AbortController + 后端 cancel 端点）。
// 超时链对齐：后端整体 deadline=1100s（团队 Call#1+Call#2+Autopsy 各 ≤315s + 余量）
// < nginx analyze 1120s；前端 1100s 在 nginx 之前给出干净 AI_TIMEOUT，而不是等到代理 504。
const AI_ANALYZE_TIMEOUT_MS = 1_100_000
let analyzeAbortController = null
let analyzeTimeoutTimer = null
let cancelRequested = false
let timedOut = false
let currentCorrelationId = ''
let analyzeStartedAt = 0

function resetResults() {
  analysisResult.value = null
  progressStage.value = ''
  partialAnalysis.value = ''
}

function addFile(e) {
  const picked = Array.from(e.target.files || [])
    .filter(f => f.name.toLowerCase().endsWith('.wotbreplay'))
  if (picked.length === 0) {
    if ((e.target.files || []).length) {
      error.value = t('recon.invalid_file')
    }
    return
  }
  files.value = [picked[0]]
  error.value = ''
  resetResults()
  resetMap()
}

function removeFile(index) {
  files.value = files.value.filter((_, i) => i !== index)
  resetResults()
  resetMap()
  error.value = ''
}

function clearFile() {
  files.value = []
  error.value = ''
  resetResults()
  resetMap()
}

/** 单文件表单（analyze 使用唯一的文件）。 */
function singleFileFormData(correlationId) {
  const fd = new FormData()
  if (files.value.length > 0) fd.append('files', files.value[0])
  fd.append('lang', locale.value)
  if (correlationId) fd.append('correlationId', correlationId)
  return fd
}

// 统一的受保护请求：确保带上有效的 Keycloak Bearer Token（这些接口需要 wotbtools-admin 角色），
// 并统一处理 token 刷新失败 / 401 / 403。所有 /api/replay/* 受保护接口都必须经由此方法。
async function authedFetch(url, body, { signal } = {}) {
  const valid = await ensureToken(30)
  if (!valid) {
    login(LOGIN_VIEW)
    throw new Error(t('recon.auth_required'))
  }
  const accessToken = token()
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  const r = await fetch(url, { method: 'POST', headers, body, signal })
  if (r.status === 401) {
    login(LOGIN_VIEW)
    throw new Error(t('recon.auth_required'))
  }
  if (r.status === 403) {
    throw new Error(t('recon.forbidden'))
  }
  return r
}

/** 尽力而为地通知后端取消 in-flight 请求（按钮取消 / 页面离开 / 前端超时）。 */
function fireCancel(correlationId) {
  if (!correlationId) return
  const accessToken = token()
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  fetch(`/api/replay/analyze/cancel?correlationId=${encodeURIComponent(correlationId)}`, {
    method: 'POST',
    headers,
    keepalive: true
  }).catch(() => {})
}

function cancelAnalyze() {
  if (!analyzing.value || !analyzeAbortController) return
  cancelRequested = true
  fireCancel(currentCorrelationId)
  analyzeAbortController.abort()
}

function newCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function runAnalyze() {
  if (analyzing.value) return
  if (files.value.length === 0) {
    error.value = t('recon.errors.NO_REPLAY_FILE')
    return
  }
  analyzing.value = true
  error.value = ''
  analysisResult.value = null
  progressStage.value = 'call1'
  partialAnalysis.value = ''
  cancelRequested = false
  timedOut = false
  currentCorrelationId = newCorrelationId()
  analyzeStartedAt = Date.now()
  const controller = new AbortController()
  analyzeAbortController = controller
  analyzeTimeoutTimer = setTimeout(() => {
    timedOut = true
    fireCancel(currentCorrelationId)
    controller.abort()
  }, AI_ANALYZE_TIMEOUT_MS)
  try {
    const r = await authedFetch(
      '/api/replay/analyze',
      singleFileFormData(currentCorrelationId),
      { signal: controller.signal }
    )
    if (!r.ok) {
      const rawBody = await r.text().catch(() => '')
      const trimmed = rawBody.trim()
      let errorData = { code: trimmed, maxFiles: 1 }
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const json = JSON.parse(trimmed)
          errorData = { code: json.code || '', maxFiles: json.maxFiles || 1 }
        } catch {
        }
      }
      throw new Error(localizeAiError(errorData, r.status, t))
    }
    // SSE 流式解析：阶段事件 + call2_token 主复盘增量 + done 收尾。
    const receivedDone = await readAnalyzeStream(r, controller)
    if (!receivedDone && !cancelRequested) {
      // 流异常中断（未收到 done 且未取消）：视为无效响应。
      throw new Error(t('recon.errors.AI_RESPONSE_INVALID'))
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      error.value = timedOut ? t('recon.errors.AI_TIMEOUT') : t('recon.cancelled')
    } else if (cancelRequested) {
      // 用户主动取消：保持「已取消」语义，忽略后端 error 事件。
      error.value = t('recon.cancelled')
    } else {
      error.value = e.message || String(e)
    }
  } finally {
    clearTimeout(analyzeTimeoutTimer)
    analyzeTimeoutTimer = null
    analyzeAbortController = null
    currentCorrelationId = ''
    analyzing.value = false
  }
}

/**
 * 读取 SSE 响应体并分发事件：
 * call1_start/call1_done/evidence_done → 阶段状态；
 * call2_token → 主复盘文本累积（token 滚动）；
 * autopsy_start/autopsy_done → 团队剖析阶段；
 * done → 设置最终结果并返回 true；
 * error → 抛出本地化错误。
 * @returns {Promise<boolean>} 是否收到 done 事件
 */
async function readAnalyzeStream(r, controller) {
  const reader = r.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentEvent = ''
  let currentData = ''
  let receivedDone = false
  const deadlineMs = analyzeStartedAt + AI_ANALYZE_TIMEOUT_MS

  const dispatch = () => {
    if (!currentEvent) return
    let data = {}
    if (currentData) {
      try {
        data = JSON.parse(currentData)
      } catch {
        data = {}
      }
    }
    handleStreamEvent(currentEvent, data)
    currentEvent = ''
    currentData = ''
  }

  const handleStreamEvent = (event, data) => {
    switch (event) {
      case 'call1_start':
        progressStage.value = 'call1'
        break
      case 'call1_done':
        progressStage.value = 'evidence'
        break
      case 'evidence_done':
        progressStage.value = 'call2'
        break
      case 'call2_token':
        // fallback 路径（NON_ZH/NO_RECONSTRUCTION/RECORDER_UNRESOLVED/
        // FEATURES_UNAVAILABLE/PRE_BATTLE_UNAVAILABLE 等）会直接进入旧
        // PlayerReplay 流，不发送 evidence_done/call2 阶段事件；token 到达即
        // 说明已在生成主复盘，阶段强制进入 call2，避免停留在「赛前预测/证据分析」。
        if (progressStage.value !== 'call2') {
          progressStage.value = 'call2'
        }
        if (typeof data.delta === 'string') {
          partialAnalysis.value += data.delta
        }
        break
      case 'autopsy_start':
        progressStage.value = 'autopsy'
        break
      case 'autopsy_done':
        progressStage.value = 'call2'
        break
      case 'done':
        if (typeof data.analysis === 'string' && data.analysis.trim()) {
          // done 载荷的 mapOverview 不再消费：地图已拆为页面级独立区块
          // （/api/replay/map-overview 单独加载，与 AI 复盘解耦）。
          analysisResult.value = {
            analysis: data.analysis,
            preBattleSection: data.preBattleSection
          }
          progressStage.value = 'done'
          receivedDone = true
        }
        break
      case 'error':
        // 流中途失败：以稳定错误码本地化后终止流。
        const localized = new Error(localizeAiError({ code: data.code || '' }, 502, t))
        localized.isLocalized = true
        throw localized
      default:
        break
    }
  }

  try {
    for (;;) {
      // 墙钟超时兜底：后台标签定时器被节流时，活跃流仍按 1100s 语义中止。
      if (Date.now() >= deadlineMs) {
        timedOut = true
        fireCancel(currentCorrelationId)
        controller.abort()
        const err = new Error('AI_ANALYZE_TIMEOUT')
        err.name = 'AbortError'
        throw err
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        if (line === '') {
          dispatch()
        } else if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          currentData = line.slice(5).trim()
        }
      }
      if (receivedDone) break
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      // 用户取消/超时：保持取消语义，不当作流异常。
      throw e
    }
    if (e && e.isLocalized) {
      // error 事件已生成本地化消息：原样传播。
      throw e
    }
    throw new Error(t('recon.errors.AI_RESPONSE_INVALID'))
  } finally {
    reader.releaseLock?.()
  }
  return receivedDone
}

function onPageLeave() {
  if (analyzing.value && currentCorrelationId) {
    fireCancel(currentCorrelationId)
  }
}

</script>

<template>
  <main class="recon-page layout-data-workspace">
    <!-- 未登录：提示并已自动跳转登录页，按钮用于跳转失败时手动重试 -->
    <div v-if="authPhase === 'login'" class="recon-auth">
      <p>{{ $t('recon.pleaseLogin') }}</p>
      <button class="btn-primary" @click="login(LOGIN_VIEW)">{{ $t('app.login') }}</button>
    </div>

    <div v-else-if="authPhase === 'init'" class="recon-auth">
      <p>{{ $t('recon.auth_loading') }}</p>
    </div>

    <template v-else>
      <ReplayInputPanel
        :files="files"
        :analyzing="analyzing"
        :can-use-ai-review="canUseAiReview"
        @add-file="addFile"
        @remove-file="removeFile"
        @clear="clearFile"
        @analyze="runAnalyze"
        @cancel="cancelAnalyze"
      />

      <!-- 独立地图区块：热力/路线/战局回放，不依赖 AI 复盘 -->
      <div v-if="files.length" class="panel map-panel" data-test="map-panel" ref="mapPanelEl">
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
        <p v-if="mapError" class="error map-error" data-test="map-error">{{ mapError }}</p>
        <!-- 折叠用 v-show 而非 v-if：MapOverview 是否挂载只由 mapOverview 决定，折叠不销毁组件、保留视图/播放器状态 -->
        <div v-show="mapOpen" data-test="map-body">
          <MapOverview
            v-if="mapOverview"
            :overview="mapOverview"
            :seek-to="mapSeek"
          />
          <p v-else-if="mapLoaded && !mapLoading" class="map-unavailable" data-test="map-unavailable">
            {{ $t('recon.map.unavailable') }}
          </p>
        </div>
      </div>

      <p v-if="error" class="error" style="margin:12px 0">{{ error }}</p>

      <div v-if="analyzing" class="panel streaming-panel">
        <div class="stream-status">
          <span class="stream-spinner" aria-hidden="true"></span>
          <span class="stream-stage">
            {{ $t(`recon.stages.${progressStage || 'call1'}`) }}
          </span>
        </div>
        <div v-if="partialAnalysis" class="stream-text">{{ partialAnalysis }}</div>
      </div>

      <AnalysisResultPanel v-if="analysisResult" :result="analysisResult" @seek="onAiSeek" />
    </template>
  </main>
</template>

<style scoped>
.recon-page :deep(.sub-hint) { color: var(--text-sub); font-size: .88rem; margin: 6px 0 16px; }
.recon-page :deep(.fb-chips) { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 12px; }
.recon-page :deep(.chip) { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 8px; border-radius: 5px; background: var(--bg-chip); color: var(--text-label); }
.error { font-size: .88rem; }
.recon-auth { text-align: center; padding: 40px; color: var(--text-secondary); }

.recon-page :deep(.panel) {
  background: rgba(13, 18, 22, .94);
  border: 1px solid #303a40;
  border-radius: 8px;
  padding: 16px 20px;
  color: #d8d5cd;
}
.recon-page :deep(.panel h2) { margin: 0 0 12px; font-size: 1rem; }

/* AnalysisKeyEvents 使用 .recon-details 折叠原始事件 */
.recon-page :deep(.recon-details) { margin-top: 8px; }
.recon-page :deep(.recon-details summary) { cursor: pointer; font-size: .82rem; color: var(--accent); }

.recon-page :deep(.ai-action) { margin-top: 16px; }

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
.map-load-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-dark); }
.map-load-btn:disabled { opacity: .6; cursor: default; }
.map-error { margin: 0 0 8px; }
.map-unavailable { color: var(--text-secondary); font-size: .85rem; margin: 0; }

/* 流式生成面板：阶段状态 + 主复盘 token 滚动预览 */
.streaming-panel { margin-top: 16px; }
.stream-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: .88rem;
  color: var(--text-label);
  margin-bottom: 8px;
}
.stream-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: stream-spin 0.9s linear infinite;
  flex-shrink: 0;
}
@keyframes stream-spin {
  to { transform: rotate(360deg); }
}
.stream-text {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: .9rem;
  color: var(--text);
  max-height: 320px;
  overflow-y: auto;
  word-break: break-word;
}
</style>