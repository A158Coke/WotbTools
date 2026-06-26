<script setup>
import { ref, onMounted } from 'vue'
import { mapLabel } from '../utils/helpers.js'
import * as api from '../utils/api.js'

defineEmits(['back'])

const rows = ref([])
const loading = ref(false)
const error = ref('')
const limit = ref(50)
const uploading = ref(false)
const uploadMsg = ref('')
const fileInput = ref(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await api.leaderboardTopDamage(limit.value)
  } catch (e) {
    error.value = e.message
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function upload(file) {
  if (!file || !file.name.endsWith('.wotbreplay')) {
    uploadMsg.value = '请选择 .wotbreplay 文件'
    return
  }
  uploading.value = true
  uploadMsg.value = ''
  try {
    await api.leaderboardUpload(file)
    uploadMsg.value = '上传成功！已录入排行榜'
    fileInput.value.value = ''
    await load()
  } catch (e) {
    uploadMsg.value = e.message
  } finally {
    uploading.value = false
  }
}

function onFileChange(e) {
  const f = e.target.files?.[0]
  if (f) upload(f)
}

onMounted(load)

function fmtTime(s) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function rankClass(i) {
  return i === 0 ? 'rk-gold' : i === 1 ? 'rk-silver' : i === 2 ? 'rk-bronze' : ''
}
</script>

<template>
  <div class="lb-wrap">
    <header>
      <div class="brand">
        <span class="logo">W</span>
        <div class="brandtext">
          <h1>{{ $t('app.title') }}</h1>
          <p class="subtitle">{{ $t('app.subtitle') }}</p>
        </div>
      </div>
      <button class="ghost" @click="$emit('back')">← {{ $t('leaderboard.back') }}</button>
    </header>

    <div class="lb-head">
      <h2 class="lb-title">{{ $t('leaderboard.title') }}</h2>
      <p class="subtitle">{{ $t('leaderboard.subtitle') }}</p>
    </div>

    <div class="lb-upload">
      <input ref="fileInput" type="file" accept=".wotbreplay" @change="onFileChange" :disabled="uploading" />
      <span v-if="uploadMsg" class="lb-upload-msg" :class="{ err: uploading === false && uploadMsg.includes('失败') || uploadMsg.includes('请选择') }">{{ uploadMsg }}</span>
      <span v-if="uploading" class="muted">上传中...</span>
    </div>

    <div class="lb-toolbar">
      <label class="lb-limit">{{ $t('leaderboard.limit') }}
        <select v-model.number="limit" @change="load">
          <option :value="20">20</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select>
      </label>
      <button class="ghost sm" :disabled="loading" @click="load">
        <svg class="ic" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v6h-6" /></svg>{{ $t('leaderboard.refresh') }}
      </button>
    </div>

    <p v-if="error" class="error">{{ $t('leaderboard.error') }}: {{ error }}</p>
    <p v-else-if="loading" class="muted">{{ $t('leaderboard.loading') }}</p>
    <p v-else-if="!rows.length" class="muted">{{ $t('leaderboard.empty') }}</p>
    <div v-else class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>{{ $t('leaderboard.rank') }}</th>
            <th>{{ $t('leaderboard.nickname') }}</th>
            <th>{{ $t('leaderboard.tank_name') }}</th>
            <th>{{ $t('leaderboard.damage_dealt') }}</th>
            <th>{{ $t('leaderboard.map') }}</th>
            <th>{{ $t('leaderboard.time') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="r.id">
            <td><span class="rk" :class="rankClass(i)">{{ i + 1 }}</span></td>
            <td>{{ r.nickname }}</td>
            <td>{{ r.tankName }}</td>
            <td class="lb-dmg">{{ r.damageDealt.toLocaleString() }}</td>
            <td>{{ mapLabel(r.mapName) }}</td>
            <td class="lb-time">{{ fmtTime(r.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.lb-wrap { max-width: 900px; margin: 0 auto; padding: 16px 20px; }
.lb-head { margin-top: 18px; }
.lb-title { font-size: 17px; font-weight: 600; color: var(--text-heading); margin: 0; }
.subtitle { font-size: 12px; color: var(--text-sub); margin: 4px 0 0; }
.lb-toolbar { display: flex; align-items: center; gap: 12px; margin: 14px 0 10px; flex-wrap: wrap; }
.lb-limit { font-size: 13px; color: var(--text-label); display: inline-flex; align-items: center; gap: 6px; }
.lb-limit select { appearance: none; -webkit-appearance: none; border: 1px solid var(--border-ghost);
  background: var(--bg-card2); color: var(--text-label); padding: 5px 10px; border-radius: 7px;
  font-size: 13px; cursor: pointer; font-family: inherit; }
.lb-dmg { font-weight: 600; color: var(--text-heading); }
.lb-time { color: var(--text-muted); }
.rk { display: inline-block; min-width: 26px; padding: 1px 8px; border-radius: 6px; font-size: 12px;
  font-weight: 600; background: var(--bg-chip); color: var(--text-label); }
.rk-gold { background: #f7e29a; color: #6b4e00; }
.rk-silver { background: #dde2ea; color: #45505f; }
.rk-bronze { background: #f0cda6; color: #6e4321; }
[data-theme="dark"] .rk-gold { background: #5a4a14; color: #f7e29a; }
[data-theme="dark"] .rk-silver { background: #3a414d; color: #cdd5e1; }
[data-theme="dark"] .rk-bronze { background: #4d3621; color: #f0cda6; }
.muted { padding: 24px 4px; }
.lb-upload { display: flex; align-items: center; gap: 12px; margin: 12px 0; flex-wrap: wrap; }
.lb-upload input[type="file"] { font-size: 13px; color: var(--text-label); }
.lb-upload-msg { font-size: 13px; }
.lb-upload-msg.err { color: var(--error); }
</style>
