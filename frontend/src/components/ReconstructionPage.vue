<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const file = ref(null)
const loading = ref(false)
const error = ref('')
const reconResult = ref(null)
const queryTime = ref('')
const stateResult = ref(null)

function addFile(e) {
  const picked = e.target.files?.[0]
  if (picked && picked.name.toLowerCase().endsWith('.wotbreplay')) {
    file.value = picked
    error.value = ''
    reconResult.value = null
    stateResult.value = null
  } else if (picked) {
    error.value = t('recon.invalid_file')
  }
}

function clearFile() {
  file.value = null
  error.value = ''
  reconResult.value = null
  stateResult.value = null
  queryTime.value = ''
}

function formData() {
  const fd = new FormData()
  if (file.value) fd.append('file', file.value)
  return fd
}

async function runReconstruct() {
  if (!file.value) {
    error.value = t('recon.no_file')
    return
  }
  loading.value = true
  error.value = ''
  stateResult.value = null
  try {
    const fd = formData()
    const r = await fetch('/api/replay/reconstruct', { method: 'POST', body: fd })
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
    const fd = formData()
    const r = await fetch(`/api/replay/state-at?time=${time}`, { method: 'POST', body: fd })
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
          <input type="file" accept=".wotbreplay" @change="addFile">
        </label>
        <button v-if="file" class="ghost" @click="clearFile">{{ $t('upload.clear') }}</button>
      </div>

      <div v-if="file" class="fb-chips" style="margin-top:12px">
        <span class="chip">{{ file.name }}</span>
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
</style>
