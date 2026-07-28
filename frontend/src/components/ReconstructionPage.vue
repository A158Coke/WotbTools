<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { localizeAiError } from '../utils/reconstruction-analysis.js'
import AnalysisResultPanel from './AnalysisResultPanel.vue'
import BattleStatePanel from './BattleStatePanel.vue'
import ReconstructionSummaryPanel from './ReconstructionSummaryPanel.vue'
import ReplayInputPanel from './ReplayInputPanel.vue'

const { t } = useI18n()
const { tokenParsed, token, ensureToken, login } = useAuth()

// AI 功能灰度：仅 wotbtools-admin 可见（后端 /api/replay/analyze 亦按该角色鉴权）
const isAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && roles.includes('wotbtools-admin')
})

// 支持多选：AI 分析可一次分析多场。reconstruct/state-at 为单文件工具，取第一个。
const MAX_AI_REVIEW_REPLAY_FILES = 16
const files = ref([])
const file = computed(() => files.value[0] || null)
const loading = ref(false)
const error = ref('')
const reconResult = ref(null)
const queryTime = ref('')
const stateResult = ref(null)
const analyzing = ref(false)
const analysisResult = ref(null)
const showAnalysis = ref(false)

function resetResults() {
  reconResult.value = null
  stateResult.value = null
  analysisResult.value = null
  showAnalysis.value = false
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
  const totalAfterAdd = files.value.length + picked.length
  if (totalAfterAdd > MAX_AI_REVIEW_REPLAY_FILES) {
    error.value = t('recon.errors.REPLAY_FILE_COUNT_EXCEEDED', { max: MAX_AI_REVIEW_REPLAY_FILES })
    return
  }
  files.value = [...files.value, ...picked]
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
  queryTime.value = ''
}

/** 单文件表单（reconstruct / state-at 用第一个文件）。 */
function singleFormData() {
  const fd = new FormData()
  if (file.value) fd.append('file', file.value)
  return fd
}

/** 多文件表单（analyze 用全部所选文件）。 */
function multiFormData() {
  const fd = new FormData()
  for (const f of files.value) fd.append('files', f)
  return fd
}

// 统一的受保护请求：确保带上有效的 Keycloak Bearer Token（这些接口需要 wotbtools-admin 角色），
// 并统一处理 token 刷新失败 / 401 / 403。所有 /api/replay/* 受保护接口都必须经由此方法。
async function authedFetch(url, body) {
  const valid = await ensureToken(30)
  if (!valid) {
    login()
    throw new Error(t('recon.auth_required'))
  }
  const accessToken = token()
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  const r = await fetch(url, { method: 'POST', headers, body })
  if (r.status === 401) {
    login()
    throw new Error(t('recon.auth_required'))
  }
  if (r.status === 403) {
    throw new Error(t('recon.forbidden'))
  }
  return r
}

async function runReconstruct() {
  if (!file.value) {
    error.value = t('recon.no_file')
    return
  }
  loading.value = true
  error.value = ''
  stateResult.value = null
  // 新的重建结果，作废上一份 AI 分析
  analysisResult.value = null
  showAnalysis.value = false
  try {
    const r = await authedFetch('/api/replay/reconstruct', singleFormData())
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw new Error(text || `HTTP ${r.status}`)
    }
    reconResult.value = await r.json()
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

async function runStateAt() {
  if (!file.value) {
    error.value = t('recon.no_file')
    return
  }
  const time = parseFloat(queryTime.value)
  if (isNaN(time) || time < 0) {
    error.value = t('recon.invalid_time')
    return
  }
  loading.value = true
  error.value = ''
  try {
    const r = await authedFetch(`/api/replay/state-at?time=${time}`, singleFormData())
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw new Error(text || `HTTP ${r.status}`)
    }
    stateResult.value = await r.json()
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

async function runAnalyze() {
  if (analyzing.value) return
  if (files.value.length === 0) {
    error.value = t('recon.errors.NO_REPLAY_FILE')
    return
  }
  if (files.value.length > MAX_AI_REVIEW_REPLAY_FILES) {
    error.value = t('recon.errors.REPLAY_FILE_COUNT_EXCEEDED', { max: MAX_AI_REVIEW_REPLAY_FILES })
    return
  }
  analyzing.value = true
  error.value = ''
  analysisResult.value = null
  try {
    const r = await authedFetch('/api/replay/analyze', multiFormData())
    if (!r.ok) {
      const rawBody = await r.text().catch(() => '')
      const trimmed = rawBody.trim()
      let errorData = { code: trimmed, maxFiles: 16 }
      // Try JSON parse for structured errors (REPLAY_FILE_COUNT_EXCEEDED etc.)
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const json = JSON.parse(trimmed)
          errorData = { code: json.code || '', maxFiles: json.maxFiles || 16 }
        } catch {
          // Not valid JSON — keep trimmed as plain text code
        }
      }
      throw new Error(localizeAiError(errorData, r.status, t))
    }
    const result = await r.json()
    if (!result || typeof result.analysis !== 'string' || !result.analysis.trim()) {
      throw new Error(t('recon.errors.AI_RESPONSE_INVALID'))
    }
    analysisResult.value = result
    showAnalysis.value = true
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    analyzing.value = false
  }
}

function toggleAnalysis() {
  showAnalysis.value = !showAnalysis.value
}

</script>

<template>
  <main class="recon-page wrap">
    <ReplayInputPanel
      v-model:query-time="queryTime"
      :files="files"
      :file="file"
      :loading="loading"
      :analyzing="analyzing"
      :analysis-result="analysisResult"
      :is-admin="isAdmin"
      :show-analysis="showAnalysis"
      @add-file="addFile"
      @remove-file="removeFile"
      @clear="clearFile"
      @reconstruct="runReconstruct"
      @state-at="runStateAt"
      @analyze="runAnalyze"
      @toggle-analysis="toggleAnalysis"
    />

    <p v-if="error" class="error" style="margin:12px 0">{{ error }}</p>

    <ReconstructionSummaryPanel v-if="reconResult" :result="reconResult" />

    <AnalysisResultPanel
      v-if="analysisResult && showAnalysis"
      :result="analysisResult"
      @close="showAnalysis = false"
    />

    <BattleStatePanel v-if="stateResult" :result="stateResult" />
  </main>
</template>

<style scoped>
.recon-page :deep(.sub-hint) { color: var(--text-sub); font-size: .88rem; margin: 6px 0 16px; }
.recon-page :deep(.fb-chips) { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 12px; }
.recon-page :deep(.chip) { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 8px; border-radius: 5px; background: var(--bg-chip); color: var(--text-label); }
.error { color: var(--error); font-size: .88rem; }

.recon-page :deep(.time-action) {
  display: flex;
  align-items: center;
  gap: 8px;
}
.recon-page :deep(.time-input) {
  width: 100px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-upload);
  color: var(--text);
  font-size: .85rem;
}
.recon-page :deep(.time-input::placeholder) { color: var(--text-sub); }

.recon-page :deep(.panel) {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
}
.recon-page :deep(.panel h2) { margin: 0 0 12px; font-size: 1rem; }

.recon-page :deep(.recon-stats) {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.recon-page :deep(.stat-item) {
  background: var(--bg-card2);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 8px 14px;
  min-width: 100px;
}
.recon-page :deep(.stat-label) { display: block; font-size: 11px; color: var(--text-sub); margin-bottom: 2px; text-transform: uppercase; letter-spacing: .3px; }
.recon-page :deep(.stat-value) { display: block; font-size: 1.1rem; font-weight: 700; color: var(--text-heading); }

.recon-page :deep(.recon-details) { margin-top: 8px; }
.recon-page :deep(.recon-details summary) { cursor: pointer; font-size: .82rem; color: var(--accent); }
.recon-page :deep(.json-block) {
  background: var(--bg-card2);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 12px;
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
  max-height: 400px;
  white-space: pre;
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  color: var(--text-code);
  margin-top: 6px;
}

.recon-page :deep(.state-panel) { margin-top: 16px; }
.recon-page :deep(.state-table) { margin-top: 10px; }
.recon-page :deep(.tablewrap) { overflow-x: auto; }
.recon-page :deep(.recon-table) { width: 100%; border-collapse: collapse; font-size: .82rem; }
.recon-page :deep(.recon-table th) { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border-header); white-space: nowrap; color: var(--text-label); font-weight: 600; }
.recon-page :deep(.recon-table td) { padding: 5px 8px; border-bottom: 1px solid var(--border-light); }
.recon-page :deep(.recon-table .num) { text-align: right; font-variant-numeric: tabular-nums; }
.recon-page :deep(.recon-table .mono) { font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace; font-size: 11px; }
.recon-page :deep(.recon-table tbody tr:hover) { background: var(--bg-list-hover); }

.recon-page :deep(.ai-action) { margin-top: 16px; }
</style>
