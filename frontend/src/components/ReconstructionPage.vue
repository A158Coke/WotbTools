<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'

const { t } = useI18n()
const { tokenParsed, token, ensureToken, login } = useAuth()

// AI 功能灰度：仅 wotbtools-admin 可见（后端 /api/replay/analyze 亦按该角色鉴权）
const isAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && roles.includes('wotbtools-admin')
})

// 支持多选：AI 分析可一次分析多场。reconstruct/state-at 为单文件工具，取第一个。
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
  if (picked.length) {
    files.value = picked
    error.value = ''
    resetResults()
  } else if ((e.target.files || []).length) {
    error.value = t('recon.invalid_file')
  }
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
  if (!file.value) {
    error.value = t('recon.no_file')
    return
  }
  analyzing.value = true
  error.value = ''
  analysisResult.value = null
  try {
    const r = await authedFetch('/api/replay/analyze', multiFormData())
    if (!r.ok) {
      const text = (await r.text().catch(() => '')).trim()
      if (text === 'AI_NOT_CONFIGURED') {
        throw new Error(t('recon.ai_not_configured'))
      }
      throw new Error(t('recon.ai_error') + (text ? `: ${text}` : ` (HTTP ${r.status})`))
    }
    analysisResult.value = await r.json()
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

function fmtJson(obj) {
  return JSON.stringify(obj, null, 2)
}
</script>

<template>
  <main class="recon-page wrap">
    <div class="uploadwrap">
      <div class="up-icon">
        <svg class="ic" viewBox="0 0 24 24"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/></svg>
      </div>
      <h2>{{ $t('recon.title') }}</h2>
      <p class="sub-hint">{{ $t('recon.description') }}</p>

      <div class="up-actions">
        <label class="filebtn">
          {{ $t('recon.select_file') }}
          <input type="file" accept=".wotbreplay" multiple @change="addFile">
        </label>
        <button v-if="files.length" class="ghost" @click="clearFile">{{ $t('upload.clear') }}</button>
      </div>

      <div v-if="files.length" class="fb-chips" style="margin-top:12px">
        <span v-for="(f, i) in files" :key="i" class="chip">{{ f.name }}</span>
      </div>

      <div class="actionrow">
        <button class="lg" :disabled="loading || !file" @click="runReconstruct">
          {{ loading ? $t('action.processing') : $t('recon.reconstruct_btn') }}
        </button>
        <div v-if="file" style="display:flex;align-items:center;gap:8px">
          <input class="time-input" type="number" step="0.1" min="0" :placeholder="t('recon.time_placeholder')" v-model="queryTime">
          <button class="ghost" :disabled="loading || !file || !queryTime" @click="runStateAt">
            {{ $t('recon.query_btn') }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="error" class="error" style="margin:12px 0">{{ error }}</p>

    <div v-if="reconResult" class="panel">
      <h2>{{ $t('recon.result_title') }}</h2>
      <div class="recon-stats">
        <div class="stat-item">
          <span class="stat-label">{{ $t('recon.packet_count') }}</span>
          <span class="stat-value">{{ reconResult.packetCount?.toLocaleString() }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ $t('recon.decoded_count') }}</span>
          <span class="stat-value">{{ reconResult.decodedPacketCount?.toLocaleString() }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ $t('recon.event_count') }}</span>
          <span class="stat-value">{{ reconResult.eventCount?.toLocaleString() }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ $t('recon.duration') }}</span>
          <span class="stat-value">{{ reconResult.replayDurationSec?.toFixed(2) }}s</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ $t('recon.participants') }}</span>
          <span class="stat-value">{{ reconResult.participantCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ $t('recon.entities') }}</span>
          <span class="stat-value">{{ reconResult.entityCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ $t('recon.checkpoints') }}</span>
          <span class="stat-value">{{ reconResult.checkpointCount }}</span>
        </div>
      </div>
      <details class="recon-details">
        <summary>{{ $t('recon.raw_json') }}</summary>
        <pre class="json-block">{{ fmtJson(reconResult) }}</pre>
      </details>

    </div>
      <!-- AI 分析：仅 wotbtools-admin 可见（灰度）；不依赖重建结果 -->
      <div v-if="isAdmin && files.length > 0" class="ai-action" style="margin-top:16px">
        <button v-if="!analysisResult" class="lg" :disabled="analyzing" @click="runAnalyze">
          {{ analyzing ? $t('action.processing')
             : (files.length > 1 ? $t('recon.analyze_multi_btn', { n: files.length })
                                  : $t('recon.analyze_btn')) }}
        </button>
        <button v-else class="ghost" @click="toggleAnalysis">
          {{ showAnalysis ? $t('recon.hide_analysis') : $t('recon.show_analysis') }}
        </button>
      </div>

    <div v-if="analysisResult && showAnalysis" class="panel" style="margin-top:16px">
      <div class="panel-head">
        <h2>{{ $t('recon.analysis_title') }}</h2>
        <button class="close-x" :aria-label="$t('recon.close')" @click="showAnalysis = false">×</button>
      </div>
      <p v-if="['MULTI_PLAYER_BATTLE', 'MULTI_TEAM_BATTLE'].includes(analysisResult.mode)" class="sub-hint">
        {{ $t('recon.multi_summary', { n: analysisResult.battleCount }) }}
      </p>
      <p class="analysis-text">{{ analysisResult.analysis }}</p>
      <details v-if="analysisResult.keyEvents?.length" class="recon-details">
        <summary>{{ $t('recon.key_events') }} ({{ analysisResult.keyEvents.length }})</summary>
        <ul class="key-events">
          <li v-for="(ev, i) in analysisResult.keyEvents" :key="i">
            <span class="ke-time">{{ ev.clockSec?.toFixed(1) }}s</span>
            <span class="ke-type">{{ ev.type }}</span>
            <span class="ke-label">{{ ev.label }}</span>
          </li>
        </ul>
      </details>
    </div>

    <div v-if="stateResult" class="panel" style="margin-top:16px">
      <h2>{{ $t('recon.state_title', { time: stateResult.rawClockSec?.toFixed(1) }) }}</h2>
      <div class="recon-stats">
        <div class="stat-item">
          <span class="stat-label">{{ $t('recon.lifecycle') }}</span>
          <span class="stat-value">{{ stateResult.lifecycle }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ $t('recon.vehicle_count') }}</span>
          <span class="stat-value">{{ stateResult.vehicles?.length }}</span>
        </div>
      </div>
      <div v-if="stateResult.vehicles?.length" class="tablewrap" style="margin-top:10px">
        <table class="recon-table">
          <thead>
            <tr>
              <th>{{ $t('recon.eid') }}</th>
              <th>{{ $t('recon.team') }}</th>
              <th>{{ $t('recon.hp') }}</th>
              <th>{{ $t('recon.maxhp') }}</th>
              <th>{{ $t('recon.life') }}</th>
              <th>{{ $t('recon.obs') }}</th>
              <th>{{ $t('recon.damage_dealt') }}</th>
              <th>{{ $t('recon.damage_recv') }}</th>
              <th>{{ $t('recon.position') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in stateResult.vehicles" :key="v.entityId">
              <td class="num">{{ v.entityId }}</td>
              <td class="num">{{ v.team }}</td>
              <td class="num">{{ v.currentHealth ?? '--' }}</td>
              <td class="num">{{ v.maxHealth ?? '--' }}</td>
              <td>{{ v.lifeState }}</td>
              <td>{{ v.observationState }}</td>
              <td class="num">{{ v.damageDealt }}</td>
              <td class="num">{{ v.damageReceived }}</td>
              <td class="mono">{{ v.position ? `(${v.position.map(n => n.toFixed(1)).join(', ')})` : '--' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <details class="recon-details">
        <summary>{{ $t('recon.raw_json') }}</summary>
        <pre class="json-block">{{ fmtJson(stateResult) }}</pre>
      </details>
    </div>
  </main>
</template>

<style scoped>
.sub-hint { color: var(--text-sub); font-size: .88rem; margin: 6px 0 16px; }
.fb-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 8px; border-radius: 5px; background: var(--bg-chip); color: var(--text-label); }
.error { color: var(--error); font-size: .88rem; }

.time-input {
  width: 100px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-upload);
  color: var(--text);
  font-size: .85rem;
}
.time-input::placeholder { color: var(--text-sub); }

.panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
}
.panel h2 { margin: 0 0 12px; font-size: 1rem; }

.recon-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.stat-item {
  background: var(--bg-card2);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 8px 14px;
  min-width: 100px;
}
.stat-label { display: block; font-size: 11px; color: var(--text-sub); margin-bottom: 2px; text-transform: uppercase; letter-spacing: .3px; }
.stat-value { display: block; font-size: 1.1rem; font-weight: 700; color: var(--text-heading); }

.recon-details { margin-top: 8px; }
.recon-details summary { cursor: pointer; font-size: .82rem; color: var(--accent); }
.json-block {
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

.tablewrap { overflow-x: auto; }
.recon-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
.recon-table th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border-header); white-space: nowrap; color: var(--text-label); font-weight: 600; }
.recon-table td { padding: 5px 8px; border-bottom: 1px solid var(--border-light); }
.recon-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.recon-table .mono { font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace; font-size: 11px; }
.recon-table tbody tr:hover { background: var(--bg-list-hover); }

.ai-action { margin-top: 14px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.panel-head h2 { margin: 0 0 12px; }
.close-x {
  background: none;
  border: none;
  color: var(--text-sub);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
  margin-bottom: 8px;
}
.close-x:hover { color: var(--text); }

.analysis-text {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: .9rem;
  color: var(--text);
  margin: 0 0 8px;
}
.key-events { list-style: none; margin: 8px 0 0; padding: 0; }
.key-events li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 3px 0;
  border-bottom: 1px solid var(--border-light);
  font-size: .82rem;
}
.ke-time { color: var(--text-sub); font-variant-numeric: tabular-nums; min-width: 52px; text-align: right; }
.ke-type { color: var(--accent); font-weight: 600; min-width: 130px; }
.ke-label { color: var(--text); }
</style>