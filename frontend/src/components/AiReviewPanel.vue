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
  /** Dataset 引用（plan §36–§37）：两者齐备时走 derived ai-facts，不再上传 replay。 */
  processingJobId: { type: String, default: null },
  sourceId: { type: String, default: null },
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
/**
 * Dataset 请求代际（BLOCKER 1.1）：authoritative input = file + processingJobId + sourceId
 * 三者。任一变化（含 Dataset identity 单独变化）都使在途分析作废——迟到响应不得写
 * analysisResult / partialAnalysis / error，也不得覆盖新 generation 的 loading/finally。
 */
let datasetRevision = 0
/**
 * 当前 AI analysis run（BLOCKER 2）：每次 runAnalyze 创建独立 run context
 * {revision, controller, correlationId, startedAt, timeoutTimer, cancelRequested, timedOut}。
 * 跨 generation 不再共享任何 mutable request 字段——旧 A 永远只能操作 A 自己的
 * controller / timer / correlationId，绝不可能清掉 B 的 timer 或 cancel B 的请求。
 */
let activeRun = null

function resetResults() {
  analysisResult.value = null
  progressStage.value = ''
  partialAnalysis.value = ''
}

// 目标 file 或 Dataset identity 变化：只取消 oldRun（自己的 timer/correlationId/controller），
// 再解除 active ownership；新 B run 不得被 oldRun 的异步 unwind 影响。
watch(() => [props.file, props.processingJobId, props.sourceId], () => {
  datasetRevision++
  const oldRun = activeRun
  if (oldRun) {
    cancelRun(oldRun)
  }
  activeRun = null
  analyzing.value = false
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
  if (typeof body === 'string') headers['Content-Type'] = 'application/json'
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

/** 只取消指定 run（closure-capture：只操作 run 自己的 timer / correlationId / controller）。 */
function cancelRun(run) {
  if (!run) return
  run.cancelRequested = true
  if (run.timeoutTimer) {
    clearTimeout(run.timeoutTimer)
    run.timeoutTimer = null
  }
  fireCancel(run.correlationId)
  run.controller.abort()
}

function cancelAnalyze() {
  cancelRun(activeRun)
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
  const run = {
    revision: datasetRevision,
    controller: new AbortController(),
    correlationId: newCorrelationId(),
    startedAt: Date.now(),
    timeoutTimer: null,
    cancelRequested: false,
    timedOut: false
  }
  activeRun = run
  analyzing.value = true
  error.value = ''
  analysisResult.value = null
  progressStage.value = 'call1'
  partialAnalysis.value = ''
  // timeout closure-capture run：fire 时只读 run.correlationId / run.controller（BLOCKER 2.4）。
  run.timeoutTimer = setTimeout(() => {
    run.timedOut = true
    fireCancel(run.correlationId)
    run.controller.abort()
  }, AI_ANALYZE_TIMEOUT_MS)
  try {
    const r = await authedFetch('/api/replay/analyze', analyzeBody(run.correlationId),
      { signal: run.controller.signal })
    if (activeRun !== run) return // stale response：不读流、不写任何状态
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
    const receivedDone = await readAnalyzeStream(r, run)
    if (!receivedDone && !run.cancelRequested) {
      // 流异常中断（未收到 done 且未取消）：视为无效响应。
      throw new Error(t('recon.errors.AI_RESPONSE_INVALID'))
    }
  } catch (e) {
    // file / Dataset identity 已切换：本次分析作废，不写任何状态。
    if (activeRun !== run) return
    if (e && e.name === 'AbortError') {
      error.value = run.timedOut ? t('recon.errors.AI_TIMEOUT') : t('recon.cancelled')
    } else if (run.cancelRequested) {
      // 用户主动取消：保持「已取消」语义，忽略后端 error 事件。
      error.value = t('recon.cancelled')
    } else {
      error.value = e.message || String(e)
    }
  } finally {
    // BLOCKER 2.3：只清理自己的 timer；非当前 run 的 finally 不得触碰共享 UI 状态。
    clearTimeout(run.timeoutTimer)
    run.timeoutTimer = null
    if (activeRun === run) {
      activeRun = null
      analyzing.value = false
    }
  }
}

/**
 * Dataset 路径（plan §36/§109）：必须携带 processingJobId+sourceId，绝不回退 multipart
 * 重新上传/重新 full process（BLOCKER A）。
 */
function analyzeBody(correlationId) {
  if (!props.processingJobId || !props.sourceId) {
    throw new Error('DATASET_UNAVAILABLE')
  }
  return JSON.stringify({
    processingJobId: props.processingJobId,
    sourceId: props.sourceId,
    lang: locale.value,
    correlationId
  })
}

/**
 * 读取 SSE 响应体并分发事件（run context 显式传入，BLOCKER 2.5）：
 * call1_start/call1_done/evidence_done → 阶段状态；
 * call2_token → 主复盘文本累积（token 滚动）；
 * autopsy_start/autopsy_done → 团队剖析阶段；
 * done → 设置最终结果并返回 true；
 * error → 抛出本地化错误。
 * @returns {Promise<boolean>} 是否收到 done 事件
 */
async function readAnalyzeStream(r, run) {
  const reader = r.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentEvent = ''
  let currentData = ''
  let receivedDone = false
  const deadlineMs = run.startedAt + AI_ANALYZE_TIMEOUT_MS

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
    if (activeRun !== run) {
      // Dataset identity 已在途变化：本流属于旧 generation，任何阶段/结果都不得写回。
      return
    }
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
        run.timedOut = true
        fireCancel(run.correlationId)
        run.controller.abort()
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
  const run = activeRun
  if (run) {
    fireCancel(run.correlationId)
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
/* AI Review Workspace 唯一 width owner：AI Action / Error / Streaming / Analysis Result
   全部共享同一 left/right edge 与 max-width；子组件不再各自决定页面宽度。 */
.ai-review-panel {
  width: min(1100px, 100%);
  margin-inline: auto;
}
.ai-action-row {
  display: flex;
  align-items: center;
  margin: 16px 0;
}
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
