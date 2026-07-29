<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { localizeAiError } from '../utils/reconstruction-analysis.js'
import AnalysisResultPanel from './AnalysisResultPanel.vue'
import ReplayInputPanel from './ReplayInputPanel.vue'

const { t } = useI18n()
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

// 本页只做一件事：上传单场回放 → 发起 AI 复盘 → 展示结果。
// 回放重建由后端在 /api/replay/analyze 内部完成，前端不展示重建过程与详情。
const files = ref([])
const error = ref('')
const analyzing = ref(false)
const analysisResult = ref(null)

function resetResults() {
  analysisResult.value = null
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
function singleFileFormData() {
  const fd = new FormData()
  if (files.value.length > 0) fd.append('files', files.value[0])
  return fd
}

// 统一的受保护请求：确保带上有效的 Keycloak Bearer Token（这些接口需要 wotbtools-admin 角色），
// 并统一处理 token 刷新失败 / 401 / 403。所有 /api/replay/* 受保护接口都必须经由此方法。
async function authedFetch(url, body) {
  const valid = await ensureToken(30)
  if (!valid) {
    login(LOGIN_VIEW)
    throw new Error(t('recon.auth_required'))
  }
  const accessToken = token()
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  const r = await fetch(url, { method: 'POST', headers, body })
  if (r.status === 401) {
    login(LOGIN_VIEW)
    throw new Error(t('recon.auth_required'))
  }
  if (r.status === 403) {
    throw new Error(t('recon.forbidden'))
  }
  return r
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
  try {
    const r = await authedFetch('/api/replay/analyze', singleFileFormData())
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
    const result = await r.json()
    if (!result || typeof result.analysis !== 'string' || !result.analysis.trim()) {
      throw new Error(t('recon.errors.AI_RESPONSE_INVALID'))
    }
    analysisResult.value = result
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    analyzing.value = false
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
      />

      <p v-if="error" class="error" style="margin:12px 0">{{ error }}</p>

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
</style>
