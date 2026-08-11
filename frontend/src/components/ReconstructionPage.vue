<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { localizeAiError } from '../utils/reconstruction-analysis.js'
import AnalysisResultPanel from './AnalysisResultPanel.vue'
import ReplayInputPanel from './ReplayInputPanel.vue'

const { t, locale } = useI18n()
const { initPromise, tokenParsed, token, ensureToken, login, authenticated } = useAuth()

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
    return
  }
  authPhase.value = 'login'
  login(LOGIN_VIEW)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onPageLeave)
  if (analyzing.value) {
    cancelRequested = true
    fireCancel(currentCorrelationId)
    analyzeAbortController?.abort()
  }
})

// 本页只做一件事：上传单场回放 → 发起 AI 复盘 → 展示结果。
// 回放重建由后端在 /api/replay/analyze 内部完成，前端不展示重建过程与详情。
const files = ref([])
const error = ref('')
const analyzing = ref(false)
const analysisResult = ref(null)

// 流式状态：当前阶段（call1 赛前预测 / evidence 证据分析 / call2 生成中 / autopsy 团队剖析）
// 与主复盘已到达文本（token 滚动）。
const progressStage = ref('')
const partialAnalysis = ref('')

// AI 复盘请求生命周期：客户端安全超时 + 取消（AbortController + 后端 cancel 端点）。
// 超时链对齐：后端 AI_CALL_TIMEOUT_SEC=315 + 解析余量 < nginx analyze 420s；
// 前端 400s 在 nginx 之前给出干净 AI_TIMEOUT，而不是等到代理 504。
const AI_ANALYZE_TIMEOUT_MS = 400_000
let analyzeAbortController = null
let analyzeTimeoutTimer = null
let cancelRequested = false
let timedOut = false
let currentCorrelationId = ''

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
}

function removeFile(index) {
  files.value = files.value.filter((_, i) => i !== index)
  resetResults()
  error.value = ''
}

function clearFile() {
  files.value = []
  error.value = ''
  resetResults()
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
    const receivedDone = await readAnalyzeStream(r, controller.signal)
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
async function readAnalyzeStream(r, signal) {
  const reader = r.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentEvent = ''
  let currentData = ''
  let receivedDone = false

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
          analysisResult.value = {
            analysis: data.analysis,
            preBattleSection: data.preBattleSection,
            mapOverview: data.mapOverview
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
  <main class="recon-page wrap">
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

      <AnalysisResultPanel v-if="analysisResult" :result="analysisResult" />
    </template>
  </main>
</template>

<style scoped>
.recon-page :deep(.sub-hint) { color: var(--text-sub); font-size: .88rem; margin: 6px 0 16px; }
.recon-page :deep(.fb-chips) { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 12px; }
.recon-page :deep(.chip) { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 8px; border-radius: 5px; background: var(--bg-chip); color: var(--text-label); }
.error { color: var(--error); font-size: .88rem; }
.recon-auth { text-align: center; padding: 40px; color: var(--text-secondary); }

.recon-page :deep(.panel) {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
}
.recon-page :deep(.panel h2) { margin: 0 0 12px; font-size: 1rem; }

/* AnalysisKeyEvents 使用 .recon-details 折叠原始事件 */
.recon-page :deep(.recon-details) { margin-top: 8px; }
.recon-page :deep(.recon-details summary) { cursor: pointer; font-size: .82rem; color: var(--accent); }

.recon-page :deep(.ai-action) { margin-top: 16px; }

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
