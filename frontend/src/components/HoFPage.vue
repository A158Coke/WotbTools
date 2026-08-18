<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import * as api from '../utils/api.js'

const { locale, t, te } = useI18n()
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
const downloadingId = ref(null)
const downloadErr = ref('')

const { isAuthenticated, login } = useAuth()

function requireLogin() {
  if (isAuthenticated()) return true
  login('hof')
  return false
}

const battleType = ref('')
const selectedTankId = ref(null)
const selectedTankName = ref('')
const nickname = ref('')
let loadGeneration = 0

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  error.value = ''
  try {
    const params = { page: page.value, size: limit.value }
    if (battleType.value) params.battleType = battleType.value
    if (selectedTankId.value) params.tankId = selectedTankId.value
    if (nickname.value.trim()) params.nickname = nickname.value.trim()
    const res = await api.hofList(params)
    if (generation !== loadGeneration) return
    rows.value = res.items || []
    totalPages.value = res.totalPages || 0
  } catch (e) {
    if (generation === loadGeneration) error.value = apiErrorLabel(t, te, e)
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

function onBattleTypeChange() {
  page.value = 1
  load()
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

function searchNickname() {
  page.value = 1
  load()
}

function goPage(p) {
  page.value = p
  load()
}

async function upload(file) {
  if (uploading.value) return
  if (!requireLogin()) return
  if (!file || !file.name.toLowerCase().endsWith('.wotbreplay')) {
    uploadMsg.value = t('hof.invalid_file')
    return
  }
  uploading.value = true
  uploadMsg.value = ''
  uploadOk.value = false
  try {
    const result = await api.hofUpload(file)
    if (result.status === 'skipped') {
      uploadMsg.value = t('hof.upload_skipped', {
        reason: result.reasonCode && te(`hof.reason.${result.reasonCode}`)
          ? t(`hof.reason.${result.reasonCode}`)
          : t('hof.upload_skipped_default'),
      })
    } else {
      uploadMsg.value = t('hof.upload_success')
      uploadOk.value = true
    }
    if (fileInput.value) fileInput.value.value = ''
    await load()
  } catch (e) {
    uploadMsg.value = apiErrorLabel(t, te, e)
  } finally {
    uploading.value = false
  }
}

async function download(id) {
  if (downloadingId.value) return
  if (!requireLogin()) return
  downloadErr.value = ''
  downloadingId.value = id
  try {
    await api.hofDownload(id)
  } catch (e) {
    downloadErr.value = apiErrorLabel(t, te, e)
  } finally {
    downloadingId.value = null
  }
}

// 未登录点击「选择回放文件」→ 立即 login('hof')，绝不先打开系统文件选择器。
// 登录完成后回跳 ?view=hof，用户再次点击才会打开 picker。
function onUploadButtonClick() {
  if (uploading.value) return
  if (!requireLogin()) return
  fileInput.value?.click()
}

function onFileChange(e) {
  const f = e.target.files?.[0]
  if (f) upload(f)
}

// 未登录拖拽回放 → 立即 login，不读取/不发送文件。
function onDrop(e) {
  if (!requireLogin()) return
  const f = e.dataTransfer.files?.[0]
  if (f) upload(f)
}

onMounted(load)

function fmtTime(s) {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2014) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function battleTypeLabel(tp) {
  if (tp === 'RATING') return t('hof.battleType.rating')
  if (tp === 'RANDOM') return t('hof.battleType.random')
  return ''
}

function rankClass(rank) {
  return rank === 1 ? 'rk-gold' : rank === 2 ? 'rk-silver' : rank === 3 ? 'rk-bronze' : ''
}
</script>

<template>
  <div class="lb-wrap">
    <header class="lb-head">
      <span class="lb-kicker">{{ $t('hof.btn') }}</span>
      <h1>{{ $t('hof.title') }}</h1>
      <p>{{ $t('hof.subtitle') }}</p>
    </header>

    <section class="lb-upload-section"
             @dragover.prevent="dragging = true"
             @dragleave.prevent="dragging = false"
             @drop.prevent="dragging = false; onDrop($event)">
      <div class="lb-upload-card" :class="{ dragging }">
        <span class="up-icon"><svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg></span>
        <div class="up-title">{{ $t('hof.upload_title') }}</div>
        <div class="up-sub">{{ $t('hof.upload_hint') }}</div>
        <input ref="fileInput" type="file" accept=".wotbreplay" class="lb-hidden-input" @change="onFileChange" :disabled="uploading" />
        <button type="button" class="filebtn" :class="{ 'lb-uploading': uploading }" @click="onUploadButtonClick">
          <svg class="ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>
          {{ uploading ? $t('hof.uploading') : $t('hof.upload_btn') }}
        </button>
      </div>
      <p v-if="uploadMsg" class="lb-upload-msg" :class="{ err: !uploadOk }">{{ uploadMsg }}</p>
    </section>

    <div class="lb-toolbar">
      <label class="lb-limit">{{ $t('hof.battleTypeLabel') }}
        <select v-model="battleType" @change="onBattleTypeChange">
          <option value="">{{ $t('hof.battleType.all') }}</option>
          <option value="RANDOM">{{ $t('hof.battleType.random') }}</option>
          <option value="RATING">{{ $t('hof.battleType.rating') }}</option>
        </select>
      </label>
      <label class="lb-limit">{{ $t('hof.nicknameSearch') }}
        <input v-model="nickname" class="lb-nick-input" :placeholder="$t('hof.nicknamePlaceholder')" @keyup.enter="searchNickname" />
        <button type="button" class="ghost sm" @click="searchNickname">{{ $t('hof.search') }}</button>
      </label>
      <label class="lb-limit">{{ $t('hof.limit') }}
        <select v-model.number="limit" @change="page = 1; load()">
          <option :value="20">20</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select>
      </label>
      <button v-if="selectedTankId" class="ghost sm" @click="clearFilter">
        <svg class="ic" viewBox="0 0 24 24"><path d="M12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM14.8 9.2l-5.6 5.6M9.2 9.2l5.6 5.6" /></svg>{{ $t('hof.all_tanks') }}
      </button>
      <button class="ghost sm" :disabled="loading" @click="load">
        <svg class="ic" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v6h-6" /></svg>{{ $t('hof.refresh') }}
      </button>
    </div>

    <p v-if="selectedTankId" class="lb-filter-hint">
      {{ $t('hof.filter_tank') }}: <strong>{{ selectedTankName }}</strong>
    </p>

    <p v-if="downloadErr" class="lb-upload-msg err">{{ downloadErr }}</p>
    <p v-if="error" class="error">{{ $t('hof.error') }}: {{ error }}</p>
    <p v-else-if="loading" class="muted">{{ $t('hof.loading') }}</p>
    <p v-else-if="!rows.length" class="muted">{{ $t('hof.empty') }}</p>
    <div v-else class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>{{ $t('hof.rank') }}</th>
            <th>{{ $t('hof.nickname') }}</th>
            <th>{{ $t('hof.tank_name') }}</th>
            <th>{{ $t('hof.battleTypeLabel') }}</th>
            <th>{{ $t('hof.damage_dealt') }}</th>
            <th>{{ $t('hof.map') }}</th>
            <th>{{ $t('hof.version') }}</th>
            <th>{{ $t('hof.battle_time') }}</th>
            <th>{{ $t('hof.upload_time') }}</th>
            <th>{{ $t('hof.replay') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td><span class="rk" :class="rankClass(r.rank)">{{ r.rank }}</span></td>
            <td>{{ r.nickname }}</td>
            <td>
              <button
                v-if="!selectedTankId"
                class="lb-tank-link"
                :title="$t('hof.filter_by_tank')"
                @click="filterByTank(r.tankId, r.tankName)"
              >{{ r.tankName }}</button>
              <span v-else>{{ r.tankName }}</span>
            </td>
            <td><span class="bt-badge" :class="r.battleType === 'RATING' ? 'bt-rating' : 'bt-random'">{{ battleTypeLabel(r.battleType) }}</span></td>
            <td class="lb-dmg">{{ r.damageDealt.toLocaleString() }}</td>
            <td>{{ mapLabel(r.mapName, locale) }}</td>
            <td class="lb-version">{{ r.version || '-' }}</td>
            <td class="lb-time">{{ fmtTime(r.battleTime) || '-' }}</td>
            <td class="lb-time">{{ fmtTime(r.createdAt) }}</td>
            <td class="lb-replay">
              <button
                v-if="r.replayAvailable"
                class="lb-download"
                :disabled="downloadingId === r.id"
                :title="downloadingId === r.id ? $t('hof.downloading') : $t('hof.download')"
                :aria-label="downloadingId === r.id ? $t('hof.downloading') : $t('hof.download')"
                @click="download(r.id)"
              >
                <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 15l4 4 4-4M12 3v16" /></svg>
              </button>
              <span v-else class="lb-no-replay">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="totalPages > 1" class="pagination">
      <button :disabled="page <= 1" @click="goPage(page - 1)">{{ $t('hof.prev') }}</button>
      <span>{{ $t('hof.page_info', { page, total: totalPages }) }}</span>
      <button :disabled="page >= totalPages" @click="goPage(page + 1)">{{ $t('hof.next') }}</button>
    </div>
  </div>
</template>

<style scoped>
.lb-wrap { max-width: 1080px; margin: 0 auto; padding: 24px 20px 56px; }
.lb-head { margin: 0 0 14px; }
.lb-kicker { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 6px; background: var(--bg-rating); color: var(--accent-dark); font-size: 12px; font-weight: 800; }
.lb-head h1 { margin: 10px 0 6px; color: var(--text-heading); font-size: 1.7rem; line-height: 1.15; letter-spacing: 0; }
.lb-head p { margin: 0; color: var(--text-label); line-height: 1.65; }
.lb-toolbar { display: flex; align-items: center; gap: 12px; margin: 16px 0 12px; flex-wrap: wrap; }
.lb-limit { font-size: 13px; color: var(--text-label); display: inline-flex; align-items: center; gap: 6px; }
.lb-limit select { appearance: none; -webkit-appearance: none; border: 1px solid var(--border-ghost);
  background: var(--bg-card2); color: var(--text-label); padding: 5px 10px; border-radius: 7px;
  font-size: 13px; cursor: pointer; font-family: inherit; }
.lb-nick-input { border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text-label);
  padding: 5px 10px; border-radius: 7px; font-size: 13px; font-family: inherit; width: 130px; }
.lb-dmg { font-weight: 800; color: var(--accent-dark); font-variant-numeric: tabular-nums; }
.lb-replay { white-space: nowrap; }
.bt-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.bt-random { background: var(--rating-good-bg); color: var(--rating-good-fg); }
.bt-rating { background: var(--rating-great-bg); color: var(--rating-great-fg); }
.lb-download {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 26px; padding: 0;
  border: 1px solid var(--border-ghost); border-radius: 7px;
  background: var(--bg-card2); color: var(--text-label);
  font-family: inherit; cursor: pointer;
}
.lb-download .ic { width: 15px; height: 15px; }
.lb-download:hover:not(:disabled) { background: var(--bg-card-hover); color: var(--accent); }
.lb-download:disabled { opacity: .55; cursor: not-allowed; }
.lb-no-replay { color: var(--text-muted); }
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
.lb-hidden-input { display: none; }
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
  .lb-nick-input { width: 90px; }
}
</style>
