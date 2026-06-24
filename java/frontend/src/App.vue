<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import MAP_NAMES from '../../../common/map_names.json'
import poopUrl from './assets/poop.png'

const { t } = useI18n()

const files = ref([])
const loading = ref(false)
const error = ref('')
const resp = ref(null)
const playerCols = ref([])
const visibleKeys = ref([])        // 单场表显示的列
const aggVisibleKeys = ref([])     // 汇总表显示的列
const pickerScope = ref('player')  // 当前选择器作用的表: 'player' | 'agg'
const showColPicker = ref(false)
const activeTab = ref('aggregate')
const sortState = ref({})
const dragging = ref(false)
const isDesktop = ref(false)
const pendingRemove = ref(null)    // 待确认移除的战斗 { battle, label }
const showRating = ref(false)      // 评分规则弹窗
const ratingCfg = ref(null)        // /api/rating 返回的真实评分参数

const DEFAULT_VISIBLE = [
  'nickname', 'clan', 'tank_name', 'tank_type', 'rating', 'survived_label',
  'kills', 'damage_dealt', 'damage_assisted', 'damage_received',
  'damage_blocked', 'n_shots', 'n_hits_dealt', 'n_penetrations_dealt',
  'hit_rate', 'pen_rate', 'n_enemies_damaged'
]
const LEFT_KEYS = new Set(['nickname', 'clan', 'tank_name'])
const langs = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'English' },
  { key: 'ru', label: 'Русский' },
]
function onLangChange(e) {
  localStorage.setItem('wotb-lang', e.target.value)
}

// 地图内部名 -> 中文 (与导出共用 common/map_names.json); 未匹配原样返回。
const mapLabel = (m) => MAP_NAMES[(m || '').toLowerCase().trim()] || m

onMounted(async () => {
  try {
    const r = await fetch('/api/health')
    if (r.ok) isDesktop.value = Boolean((await r.json()).desktop)
  } catch {
    isDesktop.value = false
  }
})

function addFiles(list) {
  const picked = Array.from(list || []).filter(f => f.name.toLowerCase().endsWith('.wotbreplay'))
  const byKey = new Map(files.value.map(f => [fileKey(f), f]))
  picked.forEach(f => byKey.set(fileKey(f), f))
  files.value = Array.from(byKey.values()).sort((a, b) => displayName(a).localeCompare(displayName(b)))
  error.value = ''
}

function fileKey(f) {
  return `${f.webkitRelativePath || f.name}:${f.size}:${f.lastModified}`
}

function displayName(f) {
  return f.webkitRelativePath || f.name
}

function onPick(e) {
  addFiles(e.target.files)
  e.target.value = ''
}

function onDrop(e) {
  dragging.value = false
  addFiles(e.dataTransfer.files)
}

function clearFiles() {
  files.value = []
  resp.value = null
  error.value = ''
}

function removeFile(f) {
  const k = fileKey(f)
  files.value = files.value.filter(x => fileKey(x) !== k)
}

// 移除某一场: 先弹确认对话框
function askRemoveBattle(battle, idx) {
  pendingRemove.value = { battle, label: `${mapLabel(battle.mapName)} #${idx + 1}` }
}

function cancelRemove() {
  pendingRemove.value = null
}

// 确认后: 删对应回放文件, 再重新解析以更新汇总
function confirmRemoveBattle() {
  const battle = pendingRemove.value?.battle
  pendingRemove.value = null
  if (!battle) return
  files.value = files.value.filter(f => displayName(f) !== battle.sourceName)
  if (files.value.length) preview()
  else { resp.value = null; activeTab.value = 'aggregate' }
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
    if (!aggVisibleKeys.value.length) aggVisibleKeys.value = [...aggKeys]   // 汇总默认全显
    if (!aggOrder.value.length) aggOrder.value = [...aggKeys]
    activeTab.value = resp.value.battles.length > 1 ? 'aggregate' : 'b0'
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function exportXlsx(mode) {
  if (!files.value.length) { error.value = '请先选择回放文件或文件夹'; return }
  loading.value = true; error.value = ''
  try {
    const r = await fetch(`/api/export?mode=${encodeURIComponent(mode)}`, {
      method: 'POST',
      body: formData()
    })
    if (!r.ok) throw new Error('导出失败: HTTP ' + r.status)
    await downloadResponse(r, mode === 'each' ? '逐场导出.zip' : '联赛汇总.xlsx')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function downloadResponse(r, fallback) {
  const blob = await r.blob()
  const cd = r.headers.get('Content-Disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/)
  const name = m ? decodeURIComponent(m[1]) : fallback
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
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

const aggCols = computed(() => resp.value?.aggregateColumns || [])

// 列顺序(可拖拽); 显示集合 = visibleKeys / aggVisibleKeys。即点即生效。
const playerOrder = ref([])
const aggOrder = ref([])
const dragIdx = ref(-1)
const playerColMap = computed(() => Object.fromEntries(playerCols.value.map(c => [c.key, c])))
const aggColMap = computed(() => Object.fromEntries(aggCols.value.map(c => [c.key, c])))

// 各表实际显示的列: 按用户顺序过滤出可见列
const shownCols = computed(() =>
  playerOrder.value.filter(k => visibleKeys.value.includes(k)).map(k => playerColMap.value[k]).filter(Boolean))
const shownAggCols = computed(() =>
  aggOrder.value.filter(k => aggVisibleKeys.value.includes(k)).map(k => aggColMap.value[k]).filter(Boolean))

const colScope = computed(() => (activeTab.value === 'aggregate' ? 'agg' : 'player'))
const currentOrder = computed(() => (pickerScope.value === 'agg' ? aggOrder.value : playerOrder.value))

// 面板里的分组标签（用英文 key，由 i18n 渲染）
const COL_GROUP_CAT = {
  nickname: 'identity', clan: 'identity', account_id: 'extra',
  tank_name: 'vehicle', tank_tier: 'vehicle', tank_type: 'vehicle', tank_nation: 'vehicle', tank_id: 'extra',
  rating: 'battle', survived_label: 'battle', kills: 'battle', damage_dealt: 'battle',
  damage_assisted: 'battle', damage_received: 'battle', damage_blocked: 'battle',
  n_shots: 'battle', n_hits_dealt: 'battle', n_penetrations_dealt: 'battle',
  n_hits_received: 'battle', n_penetrations_received: 'battle', n_enemies_damaged: 'battle',
  platoon_label: 'extra',
  battles: 'overview', wins: 'overview', win_rate: 'overview', survival_rate: 'overview', rating_avg: 'overview',
  kills_avg: 'battle', damage: 'battle', damage_avg: 'battle', assisted: 'battle', assisted_avg: 'battle',
  received_avg: 'battle', blocked_avg: 'battle', hit_rate: 'battle', pen_rate: 'battle',
  enemies_damaged_avg: 'battle', tanks: 'extra',
}
const catOf = (key) => {
  const c = COL_GROUP_CAT[key]
  return c ? t('col_groups.' + c) : ''
}

function toggleColPicker() {
  if (showColPicker.value) { showColPicker.value = false; return }
  pickerScope.value = colScope.value
  showColPicker.value = true
}

function isVisible(key) {
  return (pickerScope.value === 'agg' ? aggVisibleKeys.value : visibleKeys.value).includes(key)
}

function toggleCol(key) {
  const ref_ = pickerScope.value === 'agg' ? aggVisibleKeys : visibleKeys
  ref_.value = ref_.value.includes(key) ? ref_.value.filter(k => k !== key) : [...ref_.value, key]
}

function selectAllCols() {
  const all = currentOrder.value.slice()
  if (pickerScope.value === 'agg') aggVisibleKeys.value = all
  else visibleKeys.value = all
}

function resetCols() {
  if (pickerScope.value === 'agg') {
    aggOrder.value = aggCols.value.map(c => c.key)
    aggVisibleKeys.value = aggCols.value.map(c => c.key)
  } else {
    playerOrder.value = playerCols.value.map(c => c.key)
    visibleKeys.value = [...DEFAULT_VISIBLE]
  }
}

function onColDragStart(i) { dragIdx.value = i }
function onColDrop(i) {
  const from = dragIdx.value
  dragIdx.value = -1
  if (from < 0 || from === i) return
  const orderRef = pickerScope.value === 'agg' ? aggOrder : playerOrder
  const next = orderRef.value.slice()
  const [moved] = next.splice(from, 1)
  next.splice(i, 0, moved)
  orderRef.value = next
}

function sortBy(scope, col) {
  const s = sortState.value[scope]
  if (s && s.key === col.key) s.reverse = !s.reverse
  else sortState.value[scope] = { key: col.key, reverse: false }
}

function sorted(rows, scope, cols) {
  const s = sortState.value[scope]
  if (!s) return rows
  const col = cols.find(c => c.key === s.key)
  const arr = [...rows]
  arr.sort((ra, rb) => {
    let a = ra.cells[s.key], b = rb.cells[s.key]
    if (col?.num) { a = Number(a) || 0; b = Number(b) || 0; return a - b }
    return String(a).localeCompare(String(b))
  })
  if (s.reverse) arr.reverse()
  return arr
}

function arrow(scope, key) {
  const s = sortState.value[scope]
  return s && s.key === key ? (s.reverse ? ' ▼' : ' ▲') : ''
}

function fmtDuration(s) {
  if (s == null) return ''
  const total = Math.floor(s)
  return t('duration', { min: Math.floor(total / 60), sec: total % 60 })
}

// 评分分级 -> 徽章配色
const RATING_KEYS = new Set(['rating', 'rating_avg'])
function ratingTier(v) {
  v = Number(v) || 0
  if (v >= 1600) return 'r-elite'
  if (v >= 1300) return 'r-great'
  if (v >= 1000) return 'r-good'
  if (v >= 700) return 'r-mid'
  return 'r-poor'
}

// 评分规则弹窗：实时参数取自 /api/rating（真值在 common/rating.json），分级阈值见 RATING_TIERS
const RATING_DEFAULTS = { assist: 0.6, block: 0.35, killValue: 200, winBonus: 0.05, minSamples: 5, scale: 1000, classFactor: {} }
const cfg = computed(() => ({ ...RATING_DEFAULTS, ...(ratingCfg.value || {}) }))
const RATING_TIERS = [
  { cls: 'r-elite', key: 'elite', min: 1600 },
  { cls: 'r-great', key: 'great', min: 1300 },
  { cls: 'r-good', key: 'good', min: 1000 },
  { cls: 'r-mid', key: 'mid', min: 700 },
  { cls: 'r-poor', key: 'poor', min: 0 },
]
function tierRange(i) {
  if (i === 0) return '≥ ' + RATING_TIERS[0].min
  if (RATING_TIERS[i].min === 0) return '< ' + RATING_TIERS[i - 1].min
  return RATING_TIERS[i].min + '–' + (RATING_TIERS[i - 1].min - 1)
}
async function openRating() {
  if (!ratingCfg.value) {
    try { ratingCfg.value = await (await fetch('/api/rating')).json() } catch { ratingCfg.value = {} }
  }
  showRating.value = true
}

// 同一组里评分最高/最低的趣味标记
function medal(rows, key, val) {
  if (!rows?.length) return ''
  let maxV = -Infinity, minV = Infinity
  for (const r of rows) {
    const v = Number(r.cells[key]) || 0
    if (v > maxV) maxV = v
    if (v < minV) minV = v
  }
  const v = Number(val) || 0
  if (v === maxV && maxV > 0) return 'first'   // 最高 -> 🥇
  if (v === minV && minV > 0) return 'last'    // 最低 -> 💩 图
  return ''
}

// 汇总页顶部指标卡
const aggStats = computed(() => {
  if (!resp.value) return null
  const battles = resp.value.battles || []
  const agg = resp.value.aggregate || []
  let maxRating = 0, maxDmg = 0
  agg.forEach(r => { maxRating = Math.max(maxRating, Number(r.cells.rating_avg) || 0) })
  battles.forEach(b => (b.players || []).forEach(p => { maxDmg = Math.max(maxDmg, Number(p.cells.damage_dealt) || 0) }))
  return { battles: battles.length, players: agg.length, maxRating, maxDmg }
})
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
      <button class="ghost" @click="openRating">
        <svg class="ic" viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9.6 9.4a2.4 2.4 0 0 1 4.4 1.3c0 1.6-2 1.9-2 3.3M12 17h.01" /></svg>{{ $t('rating_help.btn') }}
      </button>
      <select class="lang-select" v-model="$i18n.locale" @change="onLangChange">
        <option v-for="l in langs" :key="l.key" :value="l.key">{{ l.label }}</option>
      </select>
      <button v-if="isDesktop" class="ghost" @click="shutdown">
        <svg class="ic" viewBox="0 0 24 24"><path d="M7 6a7.7 7.7 0 1 0 10 0M12 4v8" /></svg>{{ $t('app.shutdown') }}
      </button>
    </header>

    <section class="uploadwrap"
             @dragover.prevent="dragging = true"
             @dragleave.prevent="dragging = false"
             @drop.prevent="onDrop">
      <div v-if="!files.length" class="uploadcard" :class="{ dragging }">
        <span class="up-icon"><svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg></span>
        <div class="up-title">{{ $t('upload.drop_hint') }}</div>
        <div class="up-sub">{{ $t('upload.sub_hint') }}</div>
        <div class="up-actions">
          <label class="filebtn">
            <svg class="ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>{{ $t('upload.select_files') }}
            <input type="file" multiple accept=".wotbreplay" @change="onPick" />
          </label>
          <label class="filebtn ghost">
            <svg class="ic" viewBox="0 0 24 24"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>{{ $t('upload.select_folder') }}
            <input type="file" multiple webkitdirectory @change="onPick" />
          </label>
        </div>
      </div>

      <div v-else class="filebar" :class="{ dragging }">
        <svg class="ic fb-ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>
        <span class="fb-count">{{ $t('upload.files_count', { count: files.length }) }}</span>
        <div class="fb-chips">
          <span v-for="f in files" :key="fileKey(f)" class="chip">
            {{ displayName(f) }}
            <button class="chipx" :title="$t('upload.remove_title')" @click="removeFile(f)">×</button>
          </span>
        </div>
        <label class="filebtn ghost sm" :title="$t('upload.add_files_title')">
          <svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>{{ $t('upload.add') }}
          <input type="file" multiple accept=".wotbreplay" @change="onPick" />
        </label>
        <label class="filebtn ghost sm" :title="$t('upload.add_folder_title')">
          <svg class="ic" viewBox="0 0 24 24"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>{{ $t('upload.folder') }}
          <input type="file" multiple webkitdirectory @change="onPick" />
        </label>
        <button class="ghost sm" :disabled="loading" @click="clearFiles">
          <svg class="ic" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></svg>{{ $t('upload.clear') }}
        </button>
      </div>

      <div v-if="files.length" class="actionrow">
        <button class="lg" :disabled="loading" @click="preview">
          {{ $t('action.preview') }}<svg class="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
        <span v-if="loading" class="muted">{{ $t('action.processing') }}</span>
        <span v-else class="muted">{{ $t('action.preview_hint') }}</span>
      </div>
    </section>

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
            <div v-if="showColPicker" class="colpanel">
              <div class="colpanel-head">
                <span class="cph-title">{{ pickerScope === 'agg' ? $t('col_picker.title_agg') : $t('col_picker.title_player') }} · {{ $t('col_picker.desc') }}</span>
                <button class="linkbtn" @click="selectAllCols">{{ $t('col_picker.select_all') }}</button>
                <button class="linkbtn" @click="resetCols">{{ $t('col_picker.reset') }}</button>
                <button class="linkbtn" @click="showColPicker = false">{{ $t('col_picker.done') }}</button>
              </div>
              <ul class="collist">
                <li v-for="(key, idx) in currentOrder" :key="key" draggable="true"
                    @dragstart="onColDragStart(idx)" @dragover.prevent @drop="onColDrop(idx)"
                    :class="{ dragging: dragIdx === idx }">
                  <span class="grip" title="⋮⋮">⋮⋮</span>
                  <label class="colitem">
                    <input type="checkbox" :checked="isVisible(key)" @change="toggleCol(key)" />
                    {{ $t((pickerScope === 'agg' ? 'agg_labels.' : 'player_labels.') + key) }}
                  </label>
                  <span class="cat">{{ catOf(key) }}</span>
                </li>
              </ul>
            </div>
          </span>
          <button class="sm" :disabled="loading" @click="exportXlsx('aggregate')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_aggregate') }}
          </button>
          <button class="ghost sm" :disabled="loading" @click="exportXlsx('each')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>{{ $t('action.export_each') }}
          </button>
        </div>
      </div>

      <div v-if="activeTab === 'aggregate' && resp.aggregate.length">
        <div v-if="aggStats" class="mcards">
          <div class="mc"><div class="k">{{ $t('metric.battles') }}</div><div class="v">{{ aggStats.battles }}</div></div>
          <div class="mc"><div class="k">{{ $t('metric.players') }}</div><div class="v">{{ aggStats.players }}</div></div>
          <div class="mc"><div class="k">{{ $t('metric.max_rating') }}</div><div class="v">{{ aggStats.maxRating }}</div></div>
          <div class="mc"><div class="k">{{ $t('metric.max_damage') }}</div><div class="v">{{ aggStats.maxDmg }}</div></div>
        </div>
        <div class="tablewrap">
          <table>
            <thead><tr>
              <th v-for="c in shownAggCols" :key="c.key" @click="sortBy('agg', c)">{{ $t('agg_labels.' + c.key) }}{{ arrow('agg', c.key) }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="(row, i) in sorted(resp.aggregate, 'agg', shownAggCols)" :key="i"
                  :class="row.team === 1 ? 't1' : 't2'">
                <td v-for="c in shownAggCols" :key="c.key">
                  <span v-if="RATING_KEYS.has(c.key)" class="rbadge" :class="ratingTier(row.cells[c.key])">{{ row.cells[c.key] }}<span class="medal"><template v-if="medal(resp.aggregate, c.key, row.cells[c.key]) === 'first'"> 🥇</template><img v-else-if="medal(resp.aggregate, c.key, row.cells[c.key]) === 'last'" class="poop" :src="poopUrl" alt="倒数"></span></span>
                  <span v-else>{{ row.cells[c.key] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="scroll-hint">← 左右滑动查看更多数据 →</p>
      </div>

      <div v-for="(b, i) in resp.battles" :key="i" v-show="activeTab === 'b' + i">
        <div class="mcards">
          <div class="mc"><div class="k">{{ $t('metric.map') }}</div><div class="v">{{ mapLabel(b.mapName) }}</div></div>
          <div class="mc"><div class="k">{{ $t('metric.duration') }}</div><div class="v">{{ fmtDuration(b.durationS) }}</div></div>
          <div class="mc"><div class="k">{{ $t('metric.winner') }}</div><div class="v">{{ b.winnerTeam ? $t('team.' + b.winnerTeam) : $t('team.unknown') }}</div></div>
          <div class="mc"><div class="k">{{ $t('metric.player_count') }}</div><div class="v">{{ b.players.length }}</div></div>
        </div>
        <div class="tablewrap">
          <table>
            <thead><tr>
              <th v-for="c in shownCols" :key="c.key" @click="sortBy('b' + i, c)">{{ $t('player_labels.' + c.key) }}{{ arrow('b' + i, c.key) }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="(row, ri) in sorted(b.players, 'b' + i, shownCols)" :key="ri"
                  :class="row.team === 1 ? 't1' : 't2'">
                <td v-for="c in shownCols" :key="c.key">
                  <span v-if="RATING_KEYS.has(c.key)" class="rbadge" :class="ratingTier(row.cells[c.key])">{{ row.cells[c.key] }}<span class="medal"><template v-if="medal(b.players, c.key, row.cells[c.key]) === 'first'"> 🥇</template><img v-else-if="medal(b.players, c.key, row.cells[c.key]) === 'last'" class="poop" :src="poopUrl" alt="倒数"></span></span>
                  <span v-else-if="c.key === 'survived_label'" :class="row.cells[c.key] === '存活' ? 'alive' : 'dead'">{{ row.cells[c.key] === '存活' ? $t('survived.alive') : $t('survived.dead') }}</span>
                  <span v-else>{{ row.cells[c.key] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="scroll-hint">← 左右滑动查看更多数据 →</p>
      </div>
    </template>

    <div v-if="pendingRemove" class="modal-mask" @click.self="cancelRemove">
      <div class="modal">
        <p class="modal-title">{{ $t('modal.remove_title') }}</p>
        <p>{{ $t('modal.remove_confirm', { label: pendingRemove.label }) }}</p>
        <p class="modal-sub">{{ $t('modal.remove_hint') }}</p>
        <div class="modal-actions">
          <button @click="confirmRemoveBattle">{{ $t('modal.confirm') }}</button>
          <button class="ghost" @click="cancelRemove">{{ $t('modal.cancel') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showRating" class="modal-mask" @click.self="showRating = false">
      <div class="modal modal-rating">
        <p class="modal-title">{{ $t('rating_help.title') }}</p>
        <p class="modal-sub">{{ $t('rating_help.intro') }}</p>

        <div class="rh-block">
          <div class="rh-h">{{ $t('rating_help.ec_title') }}</div>
          <code class="rh-f">EC = {{ $t('rating_help.dmg') }} + {{ cfg.assist }}·{{ $t('rating_help.assist') }} + {{ cfg.block }}·{{ $t('rating_help.block') }} + {{ cfg.killValue }}·{{ $t('rating_help.kills') }}</code>
        </div>

        <div class="rh-block">
          <div class="rh-h">{{ $t('rating_help.baseline_title') }}</div>
          <p class="rh-p">{{ $t('rating_help.baseline_desc', { n: cfg.minSamples }) }}</p>
          <div class="rh-factors">
            <span v-for="(f, k) in cfg.classFactor" :key="k" class="rh-tag">{{ k }} ×{{ f }}</span>
          </div>
        </div>

        <div class="rh-block">
          <div class="rh-h">{{ $t('rating_help.score_title') }}</div>
          <code class="rh-f">{{ $t('rating_help.score_word') }} = round( {{ cfg.scale }} × EC / {{ $t('rating_help.baseline_word') }} × (1 + {{ cfg.winBonus }} {{ $t('rating_help.if_win') }}) )</code>
        </div>

        <div class="rh-block">
          <div class="rh-h">{{ $t('rating_help.tier_title') }}</div>
          <div class="rh-tiers">
            <span v-for="(tr, i) in RATING_TIERS" :key="tr.key" class="rbadge" :class="tr.cls">{{ $t('rating_help.tiers.' + tr.key) }} {{ tierRange(i) }}</span>
          </div>
        </div>

        <p class="modal-sub">{{ $t('rating_help.note') }}</p>
        <div class="modal-actions">
          <button class="ghost" @click="showRating = false">{{ $t('rating_help.close') }}</button>
        </div>
      </div>
    </div>
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
/* 上传区 (两态: 空状态卡 / 已选文件条) */
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
/* 战斗标签上的移除按钮 */
.tabx { margin-left: 4px; padding: 0 3px; border-radius: 3px; opacity: .65; }
.tabx:hover { background: #d9534f; color: #fff; opacity: 1; }
/* 列选择下拉面板 */
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
/* 按内容自然宽度排列(不挤压列), 内容窄时仍填满容器; 横向滚动可完整看到末列 */
table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 13px; }
th, td { padding: 7px 12px; white-space: nowrap; text-align: center;
  border-bottom: 1px solid #eef1f6; font-variant-numeric: tabular-nums; }
th { background: #f1f4f8; color: #46566f; font-weight: 500; cursor: pointer; user-select: none;
  position: sticky; top: 0; border-bottom: 1px solid #d6deea; }
tbody tr:last-child td { border-bottom: none; }
/* 末列留出右侧余量, 不贴边/被滚动条裁切 */
th:last-child, td:last-child { padding-right: 16px; }
/* 队伍行底色(浅) */
tr.t1 td { background: #eef4fb; }
tr.t2 td { background: #fbf1ec; }
.closed { padding: 30px; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
/* 二次确认对话框 */
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

/* ====== 响应式 ====== */
@media (max-width: 768px) {
  header { flex-direction: column; align-items: flex-start; gap: 8px; }
  .mcards { grid-template-columns: repeat(2, 1fr); }
  .filebar { flex-wrap: wrap; }
  th, td { padding: 5px 8px; font-size: 12px; }
  .rbadge { min-width: 36px; padding: 1px 5px; font-size: 11px; }
  /* 水平滚动标签页 */
  .tabs { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { flex: none; white-space: nowrap; }
  /* 列选择器: 固定居中覆盖 */
  .colpanel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: calc(100vw - 40px); max-width: 380px; z-index: 200; max-height: 80vh; }
  .collist { max-height: 50vh; }
  /* 粘性首列 + 右侧渐隐提示可滚动 */
  .tablewrap { background: linear-gradient(to right, transparent calc(100% - 48px), rgba(0,0,0,.04) 100%), #fff; }
  th:first-child, td:first-child { position: sticky; left: 0; z-index: 2; }
  th:first-child { background: #f1f4f8; }
  td:first-child { background: #fff; }
  tr.t1 td:first-child { background: #eef4fb; }
  tr.t2 td:first-child { background: #fbf1ec; }
}
@media (max-width: 480px) {
  .wrap { padding: 10px 8px; }
  /* 指标卡: 单列 */
  .mcards { grid-template-columns: 1fr; gap: 6px; }
  .mc { padding: 6px 10px; }
  .mc .v { font-size: 15px; }
  /* 上传区: 堆叠 */
  .up-actions { flex-direction: column; align-items: stretch; }
  .up-actions .filebtn { width: 100%; }
  .filebar { flex-direction: column; align-items: stretch; gap: 6px; }
  .filebar .ghost.sm { width: 100%; }
  .fb-chips { max-height: 80px; overflow-y: auto; }
  .actionrow { flex-direction: column; align-items: stretch; }
  .actionrow .lg { width: 100%; }
  /* 列选择器 */
  .colpanel { width: calc(100vw - 24px); }
  .collist { max-height: 50vh; }
  /* 工具栏 */
  .restoolbar { flex-direction: column; }
  .tabs { flex: none; width: 100%; }
  .restoolbar .resactions { width: 100%; gap: 4px; }
  .restoolbar .resactions button { flex: 1; min-width: 0; }
  .modal { width: calc(100vw - 32px); }
  /* 表格紧凑 */
  th, td { padding: 4px 5px; font-size: 11px; }
  .rbadge { min-width: 28px; padding: 1px 4px; font-size: 10px; }
  .chip { font-size: 11px; padding: 2px 4px; }
  /* 头部关闭按钮: 仅图标 */
  header .ghost { font-size: 0; gap: 0; padding: 6px; width: 32px; height: 32px; border-radius: 50%; }
  header .ghost .ic { font-size: 0; width: 18px; height: 18px; }
}
.scroll-hint { display: none; }
@media (max-width: 768px) {
  .scroll-hint { display: block; text-align: center; font-size: 11px; color: #9aa3b2; margin: 6px 0 0; padding-bottom: 4px; }
}
</style>
