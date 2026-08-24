<!--
  AI 复盘 Workspace 面板（单页 Workspace 改造）。
  从 ReconstructionPage 抽出的 AI 复盘核心：SSE 分析流（call1/evidence/call2/autopsy）+ 流式进度 + 结果面板。
  不负责页面级登录门禁/自动跳转（由宿主入口把关）；仅在发起请求时经 authedFetch 兜底
  ensureToken + 401/403 处理。目标文件由父组件以 prop 传入（文件始终在 ReplayPage 内存中，
  不重新上传、不跨视图交接）。
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { localizeAiError } from '../utils/reconstruction-analysis.js'
import AnalysisResultPanel from './AnalysisResultPanel.vue'
import ReplayAnalysisAction from './ReplayAnalysisAction.vue'

const props = defineProps({
  /** 目标回放文件（null = 尚未选择，显示空态提示）。 */
  file: { type: Object, default: null },
  /** 未登录/401 时回跳视图：ReplayPage Workspace=replay，独立 reconstruction 页=reconstruction。 */
  loginView: { type: String, default: 'replay' }
})

const emit = defineEmits(['seek'])

const { t, locale } = useI18n()
const { tokenParsed, token, ensureToken, login } = useAuth()

// AI Review 权限：已登录 + wotbtools-user 或 wotbtools-admin
const canUseAiReview = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && (
    roles.includes('wotbtools-user') || roles.includes('wotbtools-admin')
  )
})

const error = ref('')
const analyzing = ref(false)
const analysisResult = ref(null)

// 流式状态：当前阶段（call1 赛前预测 / evidence 证据分析 / call2 生成中 / autopsy 团队剖析）
// 与主复盘已到达文本（token 滚动）。
const progressStage = ref('')
const partialAnalysis = ref('')

// AI 复盘请求生命周期：客户端安全超时 + 取消（AbortController + 后端 cancel 端点）。
// 超时链对齐：后端整体 deadline=1100s < nginx analyze 1120s；前端 1100s 在 nginx 之前给出干净 AI_TIMEOUT。
const AI_ANALYZE_TIMEOUT_MS = 1_100_000
let analyzeAbortController = null
let analyzeTimeoutTimer = null
let cancelRequested = false
let timedOut = false
let currentCorrelationId = ''
let analyzeStartedAt = 0
/** 文件切换代际：切文件时在途分析作废，迟到的结果/错误不写状态。 */
let fileRevision = 0

function resetResults() {
  analysisResult.value = null
  progressStage.value = ''
  partialAnalysis.value = ''
}

// 目标文件变化：作废在途分析并重置面板（状态只属于当前目标文件）。
watch(() => props.file, () => {
  fileRevision++
  if (analyzing.value) {
    cancelRequested = true
    fireCancel(currentCorrelationId)
    if (analyzeAbortController) analyzeAbortController.abort()
  }
  resetResults()
  error.value = ''
})

// 统一的受保护请求：确保带上有效的 Keycloak Bearer Token（/api/replay/* 需要角色），
// 并统一处理 token 刷新失败 / 401 / 403。
async function authedFetch(url, body, { signal } = {}) {
  const valid = await ensureToken(30)
  if (!valid) {
    login(props.loginView)
    throw new Error(t('recon.auth_required'))
  }
  const accessToken = token()
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  const r = await fetch(url, { method: 'POST', headers, body, signal })
  if (r.status === 401) {
    login(props.loginView)
    throw new Error(t('recon.auth_required'))
  }
  if (r.status === 403) {
    throw new Error(t('recon.forbidden'))
  }
  return r
}

/** 尽力而为地通知后端取消 in-flight 请求（按钮取消 / 面板卸载 / 前端超时）。 */
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
  if (!props.file) {
    error.value = t('recon.errors.NO_REPLAY_FILE')
    return
  }
  const revisionAtStart = fileRevision
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
    // 文件已切换：本次分析作废，不写任何状态。
    if (fileRevision !== revisionAtStart) return
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

/** 单文件表单（analyze 使用唯一的文件）。 */
function singleFileFormData(correlationId) {
  const fd = new FormData()
  if (props.file) fd.append('files', props.file)
  fd.append('lang', locale.value)
  if (correlationId) fd.append('correlationId', correlationId)
  return fd
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
          // done 载荷的 mapOverview 不再消费：地图已拆为独立战局回放面板（BattlePlaybackPanel）。
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

onMounted(() => {
  window.addEventListener('beforeunload', onPageLeave)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onPageLeave)
})
</script>

<template>
  <div class="ai-review-panel">
    <p v-if="!file" class="ws-note">{{ $t('workspace.ai_empty') }}</p>
    <template v-else>
      <div v-if="canUseAiReview" class="ai-action-row">
        <ReplayAnalysisAction :analyzing="analyzing" @analyze="runAnalyze" @cancel="cancelAnalyze" />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="analyzing" class="panel streaming-panel">
        <div class="stream-status">
          <span class="stream-spinner" aria-hidden="true"></span>
          <span class="stream-stage">
            {{ $t(`recon.stages.${progressStage || 'call1'}`) }}
          </span>
        </div>
        <div v-if="partialAnalysis" class="stream-text">{{ partialAnalysis }}</div>
      </div>

      <AnalysisResultPanel v-if="analysisResult" :result="analysisResult" @seek="(sec) => emit('seek', sec)" />
    </template>
  </div>
</template>

<style scoped>
.ai-action-row { margin-top: 16px; }
.ws-note { margin: 18px 4px; color: var(--text-muted); font-size: .85rem; }

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
