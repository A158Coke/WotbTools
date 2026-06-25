<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_VISIBLE, mapLabel, displayName } from './utils/helpers.js'
import FileUploader from './components/FileUploader.vue'
import ColumnPicker from './components/ColumnPicker.vue'
import AggregateTable from './components/AggregateTable.vue'
import BattleTable from './components/BattleTable.vue'
import RemoveConfirmModal from './components/RemoveConfirmModal.vue'
import RatingModal from './components/RatingModal.vue'
import VersionPage from './components/VersionPage.vue'

const { t } = useI18n()

const files = ref([])
const loading = ref(false)
const error = ref('')
const resp = ref(null)
const playerCols = ref([])
const visibleKeys = ref([])
const aggVisibleKeys = ref([])
const showColPicker = ref(false)
const pickerScope = ref('player')
const activeTab = ref('aggregate')
const isDesktop = ref(false)
const pendingRemove = ref(null)
const showRating = ref(false)
const showVersion = ref(false)

const playerOrder = ref([])
const aggOrder = ref([])

const aggCols = computed(() => resp.value?.aggregateColumns || [])
const playerColMap = computed(() => Object.fromEntries(playerCols.value.map(c => [c.key, c])))
const aggColMap = computed(() => Object.fromEntries(aggCols.value.map(c => [c.key, c])))
const colScope = computed(() => activeTab.value === 'aggregate' ? 'agg' : 'player')
const currentOrder = computed(() => pickerScope.value === 'agg' ? aggOrder.value : playerOrder.value)
const shownCols = computed(() =>
  playerOrder.value.filter(k => visibleKeys.value.includes(k)).map(k => playerColMap.value[k]).filter(Boolean))
const shownAggCols = computed(() =>
  aggOrder.value.filter(k => aggVisibleKeys.value.includes(k)).map(k => aggColMap.value[k]).filter(Boolean))

const aggStats = computed(() => {
  if (!resp.value) return null
  const battles = resp.value.battles || []
  const agg = resp.value.aggregate || []
  let maxRating = 0, maxDmg = 0
  agg.forEach(r => { maxRating = Math.max(maxRating, Number(r.cells.rating_avg) || 0) })
  battles.forEach(b => (b.players || []).forEach(p => { maxDmg = Math.max(maxDmg, Number(p.cells.damage_dealt) || 0) }))
  return { battles: battles.length, players: agg.length, maxRating, maxDmg }
})

onMounted(async () => {
  try {
    const r = await fetch('/api/health')
    if (r.ok) isDesktop.value = Boolean((await r.json()).desktop)
  } catch { isDesktop.value = false }
})

function toggleColPicker() {
  if (showColPicker.value) { showColPicker.value = false; return }
  pickerScope.value = colScope.value
  showColPicker.value = true
}

function onLangChange(e) {
  localStorage.setItem('wotb-lang', e.target.value)
}

function formData() {
  const fd = new FormData()
  files.value.forEach(f => fd.append('files', f, displayName(f)))
  return fd
}

async function preview() {
  if (!files.value.length) { error.value = '请先选择回放文件或文件夹'; return }
  loading.value = true; error.value = ''
  try {
    const r = await fetch('/api/preview', { method: 'POST', body: formData() })
    if (!r.ok) throw new Error('解析失败: HTTP ' + r.status)
    resp.value = await r.json()
    playerCols.value = resp.value.playerColumns
    const aggKeys = (resp.value.aggregateColumns || []).map(c => c.key)
    if (!visibleKeys.value.length) visibleKeys.value = [...DEFAULT_VISIBLE]
    if (!playerOrder.value.length) playerOrder.value = resp.value.playerColumns.map(c => c.key)
    if (!aggVisibleKeys.value.length) aggVisibleKeys.value = [...aggKeys]
    if (!aggOrder.value.length) aggOrder.value = [...aggKeys]
    activeTab.value = resp.value.battles.length > 1 ? 'aggregate' : 'b0'
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function shutdown() {
  if (!isDesktop.value) return
  try {
    await fetch('/api/shutdown', { method: 'POST' })
    document.body.innerHTML = '<div class="closed">离线程序正在关闭，可以关闭此浏览器标签页。</div>'
  } catch (e) {
    error.value = '关闭失败: ' + e.message
  }
}

async function exportXlsx(mode) {
  if (!files.value.length) { error.value = '请先选择回放文件或文件夹'; return }
  loading.value = true; error.value = ''
  try {
    const r = await fetch(`/api/export?mode=${encodeURIComponent(mode)}`, { method: 'POST', body: formData() })
    if (!r.ok) throw new Error('导出失败: HTTP ' + r.status)
    const blob = await r.blob()
    const cd = r.headers.get('Content-Disposition') || ''
    const m = cd.match(/filename\*=UTF-8''([^;]+)/)
    const name = m ? decodeURIComponent(m[1]) : (mode === 'each' ? '逐场导出.zip' : '联赛汇总.xlsx')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = name; a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function askRemoveBattle(battle, idx) {
  pendingRemove.value = { battle, label: `${mapLabel(battle.mapName)} #${idx + 1}` }
}
function cancelRemove() { pendingRemove.value = null }
function confirmRemoveBattle() {
  const battle = pendingRemove.value?.battle
  pendingRemove.value = null
  if (!battle) return
  files.value = files.value.filter(f => displayName(f) !== battle.sourceName)
  if (files.value.length) preview()
  else { resp.value = null; activeTab.value = 'aggregate' }
}

// Column picker callbacks
function toggleCol(e) { const ref_ = e.scope === 'agg' ? aggVisibleKeys : visibleKeys; ref_.value = ref_.value.includes(e.key) ? ref_.value.filter(k => k !== e.key) : [...ref_.value, e.key] }
function selectAllCols(scope) { const all = (scope === 'agg' ? aggOrder : playerOrder).value.slice(); if (scope === 'agg') aggVisibleKeys.value = all; else visibleKeys.value = all }
function resetCols(scope) {
  if (scope === 'agg') { aggOrder.value = aggCols.value.map(c => c.key); aggVisibleKeys.value = aggCols.value.map(c => c.key) }
  else { playerOrder.value = playerCols.value.map(c => c.key); visibleKeys.value = [...DEFAULT_VISIBLE] }
}
function handleReorder(next) { (pickerScope.value === 'agg' ? aggOrder : playerOrder).value = next }
</script>

<template>
  <div class="wrap">
    <header>
      <div class="brand">
        <span class="logo">W</span>
        <div class="brandtext">
          <h1>{{ $t('app.title') }}</h1>
          <p class="subtitle">{{ $t('app.subtitle') }}</p>
        </div>
      </div>
      <button class="ghost" @click="showRating = true">
        <svg class="ic" viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9.6 9.4a2.4 2.4 0 0 1 4.4 1.3c0 1.6-2 1.9-2 3.3M12 17h.01" /></svg>{{ $t('rating_help.btn') }}
      </button>
      <button class="ghost" @click="showVersion = true">
        <svg class="ic" viewBox="0 0 24 24"><path d="M12 8v4l2 2"/><circle cx="12" cy="12" r="9"/></svg>{{ $t('version.btn') }}
      </button>
      <select class="lang-select" v-model="$i18n.locale" @change="onLangChange">
        <option v-for="l in [{key:'zh',label:'中文'},{key:'en',label:'English'},{key:'ru',label:'Русский'}]" :key="l.key" :value="l.key">{{ l.label }}</option>
      </select>
      <button v-if="isDesktop" class="ghost" @click="shutdown">
        <svg class="ic" viewBox="0 0 24 24"><path d="M7 6a7.7 7.7 0 1 0 10 0M12 4v8" /></svg>{{ $t('app.shutdown') }}
      </button>
    </header>

    <VersionPage v-if="showVersion" @back="showVersion = false" />
    <template v-else>
    <FileUploader :files="files" :loading="loading" @update:files="files = $event" @preview="preview" />

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="resp">
      <div v-if="resp.duplicates.length" class="warn">
        {{ $t('result.duplicates', { count: resp.duplicates.length }) }}
        <span v-for="(d, i) in resp.duplicates" :key="i">{{ d[0] }}</span>
      </div>
      <div v-if="resp.failures.length" class="error">
        {{ $t('result.failures', { count: resp.failures.length }) }}
        <span v-for="(f, i) in resp.failures" :key="i">{{ f[0] }} ({{ f[1] }})</span>
      </div>

      <div class="restoolbar">
        <div class="tabs" :class="{ locked: showColPicker }"
             :title="showColPicker ? $t('action.picker_locked') : ''">
          <button v-if="resp.aggregate.length" :disabled="showColPicker"
                  :class="{ active: activeTab === 'aggregate' }"
                  @click="activeTab = 'aggregate'">{{ $t('result.aggregate_tab', { count: resp.aggregate.length }) }}</button>
          <button v-for="(b, i) in resp.battles" :key="i" :disabled="showColPicker"
                  :class="{ active: activeTab === 'b' + i }"
                  @click="activeTab = 'b' + i">{{ mapLabel(b.mapName) }} #{{ i + 1 }}
            <span class="tabx" :title="$t('modal.remove_title')" @click.stop="askRemoveBattle(b, i)">×</span>
          </button>
        </div>
        <div class="resactions">
          <span class="dropdown">
            <button class="ghost sm" @click="toggleColPicker">
              <svg class="ic" viewBox="0 0 24 24"><path d="M4 4h16v16H4zM10 4v16" /></svg>{{ $t('action.select_cols') }} ▾
            </button>
            <ColumnPicker v-if="showColPicker" :scope="pickerScope" :order="currentOrder"
              :visible="pickerScope === 'agg' ? aggVisibleKeys : visibleKeys"
              @close="showColPicker = false" @toggle="toggleCol"
              @select-all="selectAllCols" @reset="resetCols" @reorder="handleReorder" />
          </span>
          <button class="sm" :disabled="loading" @click="exportXlsx('aggregate')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_aggregate') }}
          </button>
          <button class="ghost sm" :disabled="loading" @click="exportXlsx('each')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_each') }}
          </button>
        </div>
      </div>

      <div v-show="activeTab === 'aggregate' && resp.aggregate.length">
        <AggregateTable :aggregate="resp.aggregate" :shown-cols="shownAggCols" :agg-stats="aggStats" />
      </div>

      <div v-for="(b, i) in resp.battles" :key="i" v-show="activeTab === 'b' + i">
        <BattleTable :battle="b" :shown-cols="shownCols" />
      </div>
    </template>

    <RemoveConfirmModal :pending="pendingRemove" @confirm="confirmRemoveBattle" @cancel="cancelRemove" />
    <RatingModal :show="showRating" @close="showRating = false" />
    </template>
  </div>
</template>

<style>
body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; color: #222; background: #f7f8fa; }
.wrap { max-width: 1400px; margin: 0 auto; padding: 16px 20px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding-bottom: 14px; border-bottom: 1px solid #e9edf3; margin-bottom: 18px; }
h1 { font-size: 17px; margin: 0; font-weight: 600; color: #28313f; line-height: 1.2; }
.brand { display: flex; align-items: center; gap: 11px; }
.brandtext { display: flex; flex-direction: column; }
.subtitle { font-size: 12px; color: #8b94a3; margin: 2px 0 0; }
.logo { width: 34px; height: 34px; border-radius: 9px; background: #e6f1fb; color: #185fa5;
  display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 17px; }
.ic { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round; }
.mcards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 4px 0 12px; }
.mc { background: #f1f4f8; border-radius: 8px; padding: 9px 13px; }
.mc .k { font-size: 12px; color: #777; }
.mc .v { font-size: 18px; font-weight: 600; margin-top: 2px; }
.rbadge { display: inline-block; min-width: 42px; padding: 1px 7px; border-radius: 6px; font-size: 12px; }
.r-poor { background: #FCEBEB; color: #791F1F; }
.medal { font-size: 12px; }
.poop { height: 1.15em; width: auto; vertical-align: -0.25em; margin-left: 2px; }
.r-mid { background: #F1EFE8; color: #444441; }
.r-good { background: #EAF3DE; color: #27500A; }
.r-great { background: #E6F1FB; color: #0C447C; }
.r-elite { background: #EEEDFE; color: #3C3489; }
.alive { color: #3B6D11; }
.dead { color: #9aa1ad; }
button, .filebtn { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 7px 14px; border: 1px solid transparent; background: #4f88d6; color: #fff; line-height: 1;
  border-radius: 7px; cursor: pointer; font-size: 13px; transition: background .12s, border-color .12s; }
button:hover:not(:disabled), .filebtn:hover { background: #4079c9; }
button:disabled { opacity: .5; cursor: default; }
.ghost { background: #f1f4f8; color: #46566f; border-color: #dbe3ef; }
.ghost:hover:not(:disabled), .filebtn.ghost:hover { background: #e7ecf4; }
.filebtn input { display: none; }
.lg { padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 9px; }
.lg .ic { width: 18px; height: 18px; }
.sm { padding: 5px 11px; font-size: 12px; border-radius: 7px; }
.sm .ic { width: 14px; height: 14px; }
.muted { color: #777; font-size: 13px; }
.error { color: #c00; }
.warn { color: #8a5200; background: #fff8e8; border: 1px solid #f0d08a; padding: 8px; border-radius: 4px; }
.warn span, .error span { display: inline-block; margin: 2px 8px 2px 0; }
.uploadwrap { margin-bottom: 16px; }
.uploadcard { border: 1.5px dashed #c2d0e4; background: #fbfcfe; border-radius: 12px;
  padding: 30px 20px; text-align: center; transition: border-color .12s, background .12s; }
.uploadcard.dragging { border-color: #4f88d6; background: #eef4fb; }
.up-icon { display: inline-flex; align-items: center; justify-content: center; width: 52px; height: 52px;
  border-radius: 50%; background: #e6f1fb; color: #3a82d2; margin-bottom: 12px; }
.up-icon .ic { width: 26px; height: 26px; }
.up-title { font-size: 15px; font-weight: 600; color: #3a4555; }
.up-sub { font-size: 13px; color: #9098a6; margin-top: 4px; }
.up-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }
.filebar { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #e3e8ef;
  border-radius: 10px; padding: 9px 13px; transition: border-color .12s, background .12s; }
.filebar.dragging { border-color: #4f88d6; background: #eef4fb; }
.fb-ic { width: 18px; height: 18px; color: #5b86c4; }
.fb-count { font-size: 13px; font-weight: 600; color: #3a4555; flex: none; }
.fb-chips { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; }
.actionrow { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.chip { background: #eef2f7; border: 1px solid #d7dee9; border-radius: 4px; padding: 3px 6px;
  font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.chipx { padding: 0 4px; border: none; background: transparent; color: #8a93a6; font-size: 14px;
  line-height: 1; cursor: pointer; border-radius: 3px; }
.chipx:hover { background: #d9534f; color: #fff; }
.tabx { margin-left: 4px; padding: 0 3px; border-radius: 3px; opacity: .65; }
.tabx:hover { background: #d9534f; color: #fff; opacity: 1; }
.dropdown { position: relative; display: inline-block; }
.colpanel { position: absolute; top: 110%; right: 0; z-index: 50; width: 260px;
  background: #fff; border: 1px solid #c7d3e6; border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0,0,0,.15); padding: 6px 0; }
.colpanel-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 4px 10px 6px; border-bottom: 1px solid #eef1f6; }
.cph-title { flex-basis: 100%; font-size: 12px; color: #777; margin-bottom: 2px; }
.linkbtn { background: none; border: none; color: #4f88d6; padding: 2px 4px;
  font-size: 12px; cursor: pointer; }
.linkbtn:hover:not(:disabled) { background: none; }
.linkbtn:hover { text-decoration: underline; }
.collist { list-style: none; margin: 0; padding: 4px 0; max-height: 320px; overflow-y: auto; }
.collist li { display: flex; align-items: center; gap: 6px; padding: 3px 10px; }
.collist li:hover { background: #f3f6fb; }
.collist li.dragging { opacity: .4; }
.grip { cursor: grab; color: #aab; user-select: none; font-size: 12px; letter-spacing: -2px; }
.colitem { flex: 1; font-size: 13px; display: flex; align-items: center; gap: 6px;
  white-space: nowrap; cursor: default; }
.cat { font-size: 11px; color: #9aa3b2; }
.restoolbar { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; margin: 16px 0 8px; }
.resactions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; margin: 0; }
.tabs button { background: #f1f4f8; color: #46566f; border-color: #dbe3ef; }
.tabs button:hover:not(:disabled) { background: #e7ecf4; }
.tabs button.active { background: #e6f1fb; color: #185fa5; border-color: #bcd8f2; font-weight: 600; }
.tabs.locked button:disabled { cursor: not-allowed; }
.tablewrap { overflow-x: auto; background: #fff; border: 1px solid #e3e8ef; border-radius: 10px; }
table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 13px; }
th, td { padding: 7px 12px; white-space: nowrap; text-align: center;
  border-bottom: 1px solid #eef1f6; font-variant-numeric: tabular-nums; }
th { background: #f1f4f8; color: #46566f; font-weight: 500; cursor: pointer; user-select: none;
  position: sticky; top: 0; border-bottom: 1px solid #d6deea; }
tbody tr:last-child td { border-bottom: none; }
th:last-child, td:last-child { padding-right: 16px; }
tr.t1 td { background: #eef4fb; }
tr.t2 td { background: #fbf1ec; }
th:first-child, td:first-child { position: sticky; left: 0; z-index: 2; }
th:first-child { background: #f1f4f8; }
td:first-child { background: #fff; }
tr.t1 td:first-child { background: #eef4fb; }
tr.t2 td:first-child { background: #fbf1ec; }
.closed { padding: 30px; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex;
  align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 8px; padding: 18px 20px; width: 360px; max-width: 90vw;
  box-shadow: 0 8px 30px rgba(0,0,0,.2); }
.modal-title { font-size: 15px; font-weight: bold; margin: 0 0 8px; color: #34465f; }
.modal-sub { font-size: 12px; color: #777; margin: 6px 0 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.modal-rating { width: 460px; }
.rh-block { margin-top: 12px; }
.rh-h { font-size: 12px; font-weight: 600; color: #34465f; margin-bottom: 5px; }
.rh-p { font-size: 12px; color: #555; margin: 0 0 6px; line-height: 1.5; }
.rh-f { display: block; background: #f3f6fa; border: 1px solid #e4eaf1; border-radius: 6px;
  padding: 8px 10px; font-size: 12px; color: #2b3a4d; line-height: 1.5; word-break: break-word; }
.rh-factors, .rh-tiers { display: flex; flex-wrap: wrap; gap: 6px; }
.rh-tag { font-size: 11px; padding: 2px 8px; border-radius: 6px; background: #eef2f7; color: #46566f; }
.rh-tiers .rbadge { font-size: 11px; }
.lang-select { appearance: none; -webkit-appearance: none; border: 1px solid #dbe3ef; background: #f1f4f8;
  color: #46566f; padding: 6px 28px 6px 10px; border-radius: 7px; font-size: 13px; cursor: pointer;
  font-family: inherit; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' stroke='%2346566f' stroke-width='2' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 6px center; background-size: 14px; }
.lang-select:hover { background-color: #e7ecf4; }

@media (max-width: 768px) {
  header { flex-direction: column; align-items: flex-start; gap: 8px; }
  .mcards { grid-template-columns: repeat(2, 1fr); }
  .filebar { flex-wrap: wrap; }
  th, td { padding: 5px 8px; font-size: 12px; }
  .rbadge { min-width: 36px; padding: 1px 5px; font-size: 11px; }
  .tabs { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { flex: none; white-space: nowrap; }
  .colpanel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: calc(100vw - 40px); max-width: 380px; z-index: 200; max-height: 80vh; }
  .collist { max-height: 50vh; }
  .tablewrap { background: linear-gradient(to right, transparent calc(100% - 48px), rgba(0,0,0,.04) 100%), #fff; }
}
@media (max-width: 480px) {
  .wrap { padding: 10px 8px; }
  .mcards { grid-template-columns: 1fr; gap: 6px; }
  .mc { padding: 6px 10px; }
  .mc .v { font-size: 15px; }
  .up-actions { flex-direction: column; align-items: stretch; }
  .up-actions .filebtn { width: 100%; }
  .filebar { flex-direction: column; align-items: stretch; gap: 6px; }
  .filebar .ghost.sm { width: 100%; }
  .fb-chips { max-height: 80px; overflow-y: auto; }
  .actionrow { flex-direction: column; align-items: stretch; }
  .actionrow .lg { width: 100%; }
  .colpanel { width: calc(100vw - 24px); }
  .collist { max-height: 50vh; }
  .restoolbar { flex-direction: column; }
  .tabs { flex: none; width: 100%; }
  .restoolbar .resactions { width: 100%; gap: 4px; }
  .restoolbar .resactions button { flex: 1; min-width: 0; }
  .modal { width: calc(100vw - 32px); }
  th, td { padding: 4px 5px; font-size: 11px; }
  .rbadge { min-width: 28px; padding: 1px 4px; font-size: 10px; }
  .chip { font-size: 11px; padding: 2px 4px; }
  header .ghost { font-size: 0; gap: 0; padding: 6px; width: 32px; height: 32px; border-radius: 50%; }
  header .ghost .ic { font-size: 0; width: 18px; height: 18px; }
}
.scroll-hint { display: none; }
@media (max-width: 768px) {
  .scroll-hint { display: block; text-align: center; font-size: 11px; color: #9aa3b2; margin: 6px 0 0; padding-bottom: 4px; }
}
</style>
