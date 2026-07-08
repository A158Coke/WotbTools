<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapLabel } from '../utils/helpers.js'
import * as api from '../utils/api.js'

const { locale, t } = useI18n()
const rows = ref([])
const loading = ref(false)
const error = ref('')
const limit = ref(50)
const page = ref(1)
const totalPages = ref(0)
const uploading = ref(false)
const uploadMsg = ref('')
const uploadOk = ref(false)
const dragging = ref(false)
const fileInput = ref(null)

const selectedTankId = ref(null)
const selectedTankName = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = selectedTankId.value
      ? await api.leaderboardTopDamageByTank(selectedTankId.value, page.value, limit.value)
      : await api.leaderboardTopDamage(page.value, limit.value)
    rows.value = res.items
    totalPages.value = res.totalPages
  } catch (e) {
    error.value = e.message
    rows.value = []
  } finally {
    loading.value = false
  }
}

function filterByTank(tankId, tankName) {
  selectedTankId.value = tankId
  selectedTankName.value = tankName
  page.value = 1
  load()
}

function clearFilter() {
  selectedTankId.value = null
  selectedTankName.value = ''
  page.value = 1
  load()
}

function goPage(p) {
  page.value = p
  load()
}

async function upload(file) {
  if (!file || !file.name.endsWith('.wotbreplay')) {
    uploadMsg.value = t('leaderboard.invalid_file')
    return
  }
  uploading.value = true
  uploadMsg.value = ''
  uploadOk.value = false
  try {
    const result = await api.leaderboardUpload(file)
    if (result.status === 'skipped') {
      uploadMsg.value = t('leaderboard.upload_skipped', {
        reason: result.reason || t('leaderboard.upload_skipped_default'),
      })
    } else {
      uploadMsg.value = t('leaderboard.upload_success')
      uploadOk.value = true
    }
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

function onDrop(e) {
  const f = e.dataTransfer.files?.[0]
  if (f) upload(f)
}

onMounted(load)

function fmtTime(s) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime()) || d.getFullYear() < 2014) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function globalRank(i) {
  return (page.value - 1) * limit.value + i
}

function rankClass(rank) {
  return rank === 0 ? 'rk-gold' : rank === 1 ? 'rk-silver' : rank === 2 ? 'rk-bronze' : ''
}
</script>

<template>
  <div class="lb-wrap">
    <header class="lb-head">
      <span class="lb-kicker">{{ $t('leaderboard.btn') }}</span>
      <h1>{{ $t('leaderboard.title') }}</h1>
      <p>{{ $t('leaderboard.subtitle') }}</p>
    </header>

    <section class="lb-upload-section"
             @dragover.prevent="dragging = true"
             @dragleave.prevent="dragging = false"
             @drop.prevent="dragging = false; onDrop($event)">
      <div class="lb-upload-card" :class="{ dragging }">
        <span class="up-icon"><svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg></span>
        <div class="up-title">{{ $t('leaderboard.upload_title') }}</div>
        <div class="up-sub">{{ $t('leaderboard.upload_hint') }}</div>
        <label class="filebtn" :class="{ 'lb-uploading': uploading }">
          <input ref="fileInput" type="file" accept=".wotbreplay" @change="onFileChange" :disabled="uploading" />
          <svg class="ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>
          {{ uploading ? $t('leaderboard.uploading') : $t('leaderboard.upload_btn') }}
        </label>
      </div>
      <p v-if="uploadMsg" class="lb-upload-msg" :class="{ err: !uploadOk }">{{ uploadMsg }}</p>
    </section>

    <div class="lb-toolbar">
      <label class="lb-limit">{{ $t('leaderboard.limit') }}
        <select v-model.number="limit" @change="page = 1; load()">
          <option :value="20">20</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select>
      </label>
      <button v-if="selectedTankId" class="ghost sm" @click="clearFilter">
        <svg class="ic" viewBox="0 0 24 24"><path d="M12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM14.8 9.2l-5.6 5.6M9.2 9.2l5.6 5.6" /></svg>{{ $t('leaderboard.all_tanks') }}
      </button>
      <button class="ghost sm" :disabled="loading" @click="load">
        <svg class="ic" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v6h-6" /></svg>{{ $t('leaderboard.refresh') }}
      </button>
    </div>

    <p v-if="selectedTankId" class="lb-filter-hint">
      {{ $t('leaderboard.filter_tank') }}: <strong>{{ selectedTankName }}</strong>
    </p>

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
            <th>{{ $t('leaderboard.version') }}</th>
            <th>{{ $t('leaderboard.battle_time') }}</th>
            <th>{{ $t('leaderboard.upload_time') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="r.id">
            <td><span class="rk" :class="rankClass(globalRank(i))">{{ globalRank(i) + 1 }}</span></td>
            <td>{{ r.nickname }}</td>
            <td>
              <button
                v-if="!selectedTankId"
                class="lb-tank-link"
                :title="$t('leaderboard.filter_by_tank')"
                @click="filterByTank(r.tankId, r.tankName)"
              >{{ r.tankName }}</button>
              <span v-else>{{ r.tankName }}</span>
            </td>
            <td class="lb-dmg">{{ r.damageDealt.toLocaleString() }}</td>
            <td>{{ mapLabel(r.mapName, locale) }}</td>
            <td class="lb-version">{{ r.version || '-' }}</td>
            <td class="lb-time">{{ fmtTime(r.battleTime) || '-' }}</td>
            <td class="lb-time">{{ fmtTime(r.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="totalPages > 1" class="pagination">
      <button :disabled="page <= 1" @click="goPage(page - 1)">{{ $t('leaderboard.prev') }}</button>
      <span>{{ $t('leaderboard.page_info', { page, total: totalPages }) }}</span>
      <button :disabled="page >= totalPages" @click="goPage(page + 1)">{{ $t('leaderboard.next') }}</button>
    </div>
  </div>
</template>

<style scoped>
.lb-wrap { max-width: 1040px; margin: 0 auto; padding: 24px 20px 56px; }
.lb-head { margin: 0 0 14px; }
.lb-kicker { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 6px; background: var(--bg-rating); color: var(--accent-dark); font-size: 12px; font-weight: 800; }
.lb-head h1 { margin: 10px 0 6px; color: var(--text-heading); font-size: 1.7rem; line-height: 1.15; letter-spacing: 0; }
.lb-head p { margin: 0; color: var(--text-label); line-height: 1.65; }
.lb-toolbar { display: flex; align-items: center; gap: 12px; margin: 16px 0 12px; flex-wrap: wrap; }
.lb-limit { font-size: 13px; color: var(--text-label); display: inline-flex; align-items: center; gap: 6px; }
.lb-limit select { appearance: none; -webkit-appearance: none; border: 1px solid var(--border-ghost);
  background: var(--bg-card2); color: var(--text-label); padding: 5px 10px; border-radius: 7px;
  font-size: 13px; cursor: pointer; font-family: inherit; }
.lb-dmg { font-weight: 800; color: var(--accent-dark); font-variant-numeric: tabular-nums; }
.lb-time { color: var(--text-muted); font-size: .9em; white-space: nowrap; }
.lb-version { color: var(--text-muted); font-size: .85em; }
.lb-tank-link {
  background: none; border: none; padding: 0; color: var(--accent); font-family: inherit;
  font-size: inherit; cursor: pointer; text-decoration: none;
}
.lb-tank-link:hover { text-decoration: underline; color: var(--accent-hover); background: var(--accent-shadow); border-radius: 3px; transition: all .12s; }
.lb-filter-hint { margin: 8px 0 10px; font-size: 13px; color: var(--text-label); }
.lb-filter-hint strong { color: var(--accent-dark); }
.rk { display: inline-block; min-width: 26px; padding: 1px 8px; border-radius: 6px; font-size: 12px;
  font-weight: 600; background: var(--bg-chip); color: var(--text-label); }
.rk-gold { background: var(--rating-good-bg); color: var(--rating-good-fg); }
.rk-silver { background: var(--bg-chip); color: var(--text-label); }
.rk-bronze { background: var(--rating-great-bg); color: var(--rating-great-fg); }
.muted { padding: 28px 4px; color: var(--text-muted); }

.lb-upload-section { margin: 16px 0; }
.lb-upload-card {
  position: relative;
  overflow: hidden;
  border: 1.5px dashed var(--border-dashed);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, transparent), transparent 48%),
    var(--bg-upload);
  border-radius: 8px;
  padding: 30px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: border-color .12s, background .12s, box-shadow .12s, transform .12s;
}
.lb-upload-card::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: .75;
}
.lb-upload-card.dragging { border-color: var(--accent); background: var(--bg-blue-light); box-shadow: 0 16px 36px var(--accent-shadow); transform: translateY(-1px); }
.lb-upload-card .up-title { max-width: 420px; margin-top: 10px; line-height: 1.25; }
.lb-upload-card .up-sub { max-width: 360px; margin-top: 8px; line-height: 1.5; }
.lb-upload-card .filebtn { margin-top: 18px; position: relative; z-index: 1; }
.lb-upload-card .filebtn input { display: none; }
.lb-upload-card .filebtn.lb-uploading { opacity: .6; pointer-events: none; }
.lb-upload-msg { margin-top: 10px; font-size: 13px; text-align: center; }
.lb-upload-msg.err { color: var(--error); }
.lb-wrap .error { display: inline-block; padding: 10px 14px; border: 1px solid color-mix(in srgb, var(--error) 35%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--error) 8%, var(--bg-card)); color: var(--error); }
.pagination { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 16px 0; font-size: .85rem; }
.pagination button { padding: 6px 14px; border: 1px solid var(--border-ghost); border-radius: 7px; background: var(--bg-card2); color: var(--text-label); cursor: pointer; font-family: inherit; font-size: .82rem; }
.pagination button:disabled { opacity: .4; cursor: not-allowed; }
.pagination button:hover:not(:disabled) { background: var(--bg-card-hover); }
@media (max-width: 560px) {
  .lb-wrap { padding: 14px 12px 48px; }
  .lb-head h1 { font-size: 1.55rem; }
  .lb-upload-card { min-height: 230px; padding: 28px 16px; }
  .lb-upload-card .up-title { max-width: 260px; }
  .lb-upload-card .up-sub { max-width: 240px; }
}
</style>
