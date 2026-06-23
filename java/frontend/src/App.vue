<script setup>
import { ref, computed, onMounted } from 'vue'

const files = ref([])
const loading = ref(false)
const error = ref('')
const resp = ref(null)
const playerCols = ref([])
const visibleKeys = ref([])        // 单场表显示的列
const aggVisibleKeys = ref([])     // 汇总表显示的列
const draftKeys = ref([])          // 列选择器里的草稿(点"应用"才生效)
const pickerScope = ref('player')  // 当前选择器作用的表: 'player' | 'agg'
const showColPicker = ref(false)
const activeTab = ref('aggregate')
const sortState = ref({})
const dragging = ref(false)
const isDesktop = ref(false)

const DEFAULT_VISIBLE = [
  'nickname', 'clan', 'tank_name', 'tank_type', 'survived_label',
  'kills', 'damage_dealt', 'damage_assisted', 'damage_received',
  'damage_blocked', 'n_shots', 'n_hits_dealt', 'n_penetrations_dealt',
  'n_enemies_damaged'
]
const LEFT_KEYS = new Set(['nickname', 'clan', 'tank_name'])
const TEAM = { 1: '队伍1', 2: '队伍2' }

// 中文显示名由前端维护 (API 只回英文 key + 类型)。
// 单场表与汇总表各一套: 同名 key(如 kills) 在两表含义不同(击杀 vs 总击杀)。
const PLAYER_LABELS = {
  nickname: '玩家', clan: '战队', tank_name: '车辆', tank_tier: '等级',
  tank_type: '坦克类型', tank_nation: '国家', survived_label: '存活',
  kills: '击杀', damage_dealt: '伤害', damage_assisted: '协助伤害',
  damage_received: '损失血量', damage_blocked: '格挡', n_shots: '发射',
  n_hits_dealt: '命中', n_penetrations_dealt: '击穿', n_hits_received: '被命中',
  n_penetrations_received: '被击穿', n_enemies_damaged: '击伤',
  platoon_label: '排', tank_id: '车辆ID', account_id: '账号ID'
}
const AGG_LABELS = {
  nickname: '玩家', clan: '战队', battles: '场次', wins: '胜场',
  win_rate: '胜率%', survival_rate: '存活率%', kills: '总击杀', kills_avg: '场均击杀',
  damage: '总伤害', damage_avg: '场均伤害', assisted: '总协助伤害', assisted_avg: '场均协助伤害',
  received_avg: '场均损失血量', blocked_avg: '场均格挡', hit_rate: '命中率%', pen_rate: '击穿率%',
  enemies_damaged_avg: '场均击伤', tanks: '用车', account_id: '账号ID'
}
const playerLabel = (key) => PLAYER_LABELS[key] || key
const aggLabel = (key) => AGG_LABELS[key] || key

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

// 移除某一场(及其回放文件), 再重新解析以更新汇总
function removeBattle(battle) {
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
    if (!visibleKeys.value.length) visibleKeys.value = [...DEFAULT_VISIBLE]
    // 汇总表默认显示全部列
    if (!aggVisibleKeys.value.length) {
      aggVisibleKeys.value = (resp.value.aggregateColumns || []).map(c => c.key)
    }
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

// 各表实际显示的列(按规范列顺序过滤)
const shownCols = computed(() =>
  playerCols.value.filter(c => visibleKeys.value.includes(c.key)))
const shownAggCols = computed(() =>
  aggCols.value.filter(c => aggVisibleKeys.value.includes(c.key)))

// 列选择器作用于"当前所在的表"
const colScope = computed(() => (activeTab.value === 'aggregate' ? 'agg' : 'player'))
const pickerCols = computed(() => (pickerScope.value === 'agg' ? aggCols.value : playerCols.value))
const pickerLabel = (key) => (pickerScope.value === 'agg' ? aggLabel(key) : playerLabel(key))

function openColPicker() {
  if (showColPicker.value) { showColPicker.value = false; return }
  pickerScope.value = colScope.value
  const current = pickerScope.value === 'agg' ? aggVisibleKeys.value : visibleKeys.value
  draftKeys.value = [...current]
  showColPicker.value = true
}

function applyColumns() {
  if (pickerScope.value === 'agg') aggVisibleKeys.value = [...draftKeys.value]
  else visibleKeys.value = [...draftKeys.value]
  showColPicker.value = false
}

function setAllColumns() {
  draftKeys.value = pickerCols.value.map(c => c.key)
}

function resetColumns() {
  draftKeys.value = pickerScope.value === 'agg'
    ? aggCols.value.map(c => c.key)
    : [...DEFAULT_VISIBLE]
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
  const t = Math.floor(s)
  return `${Math.floor(t / 60)}分${t % 60}秒`
}
</script>

<template>
  <div class="wrap">
    <header>
      <h1>WoT Blitz 回放数据提取</h1>
      <button v-if="isDesktop" class="ghost" @click="shutdown">关闭离线程序</button>
    </header>

    <section class="toolbar">
      <label class="filebtn">
        选择回放文件
        <input type="file" multiple accept=".wotbreplay" @change="onPick" />
      </label>
      <label class="filebtn">
        选择文件夹
        <input type="file" multiple webkitdirectory @change="onPick" />
      </label>
      <button class="ghost" :disabled="loading || !files.length" @click="clearFiles">清空</button>
      <button :disabled="loading || !files.length" @click="preview">解析预览</button>
      <button :disabled="loading || !files.length" @click="exportXlsx('aggregate')">合并汇总(去重)</button>
      <button :disabled="loading || !files.length" @click="exportXlsx('each')">每场单独导出</button>
      <button v-if="resp" class="ghost" @click="openColPicker">选择列</button>
      <span class="muted">{{ files.length ? `已选 ${files.length} 个回放` : '未选择文件' }}</span>
      <span v-if="loading" class="muted">处理中…</span>
    </section>

    <section class="dropzone" :class="{ dragging }"
             @dragover.prevent="dragging = true"
             @dragleave.prevent="dragging = false"
             @drop.prevent="onDrop">
      拖拽 .wotbreplay 文件到这里
    </section>

    <section v-if="files.length" class="files">
      <span v-for="f in files" :key="fileKey(f)" class="chip">
        {{ displayName(f) }}
        <button class="chipx" title="移除该回放" @click="removeFile(f)">×</button>
      </span>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="showColPicker && pickerCols.length" class="colpicker">
      <div class="colTitle">选择「{{ pickerScope === 'agg' ? '汇总表' : '单场表' }}」显示的列：</div>
      <label v-for="c in pickerCols" :key="c.key">
        <input type="checkbox" :value="c.key" v-model="draftKeys" /> {{ pickerLabel(c.key) }}
      </label>
      <div class="colActions">
        <button @click="applyColumns">应用</button>
        <button class="ghost" @click="setAllColumns">全选</button>
        <button class="ghost" @click="resetColumns">重置默认</button>
        <button class="ghost" @click="showColPicker = false">取消</button>
      </div>
    </div>

    <template v-if="resp">
      <div v-if="resp.duplicates.length" class="warn">
        已跳过 {{ resp.duplicates.length }} 个重复上传：
        <span v-for="(d, i) in resp.duplicates" :key="i">{{ d[0] }}</span>
      </div>
      <div v-if="resp.failures.length" class="error">
        {{ resp.failures.length }} 个文件解析失败：
        <span v-for="(f, i) in resp.failures" :key="i">{{ f[0] }} ({{ f[1] }})</span>
      </div>

      <div class="tabs">
        <button v-if="resp.aggregate.length" :class="{ active: activeTab === 'aggregate' }"
                @click="activeTab = 'aggregate'">汇总 ({{ resp.aggregate.length }} 名选手)</button>
        <button v-for="(b, i) in resp.battles" :key="i" :class="{ active: activeTab === 'b' + i }"
                @click="activeTab = 'b' + i">{{ b.mapName }} #{{ i + 1 }}
          <span class="tabx" title="移除该场" @click.stop="removeBattle(b)">×</span>
        </button>
      </div>

      <div v-if="activeTab === 'aggregate' && resp.aggregate.length" class="tablewrap">
        <table>
          <thead><tr>
            <th v-for="c in shownAggCols" :key="c.key" @click="sortBy('agg', c)">{{ aggLabel(c.key) }}{{ arrow('agg', c.key) }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="(row, i) in sorted(resp.aggregate, 'agg', shownAggCols)" :key="i">
              <td v-for="c in shownAggCols" :key="c.key" :class="{ num: c.num }">{{ row.cells[c.key] }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-for="(b, i) in resp.battles" :key="i" v-show="activeTab === 'b' + i" class="tablewrap">
        <p class="info">地图: {{ b.mapName }} · 时长: {{ fmtDuration(b.durationS) }}
          · 获胜: {{ TEAM[b.winnerTeam] || '平局/未知' }} · 版本: {{ b.version }}</p>
        <table>
          <thead><tr>
            <th v-for="c in shownCols" :key="c.key" @click="sortBy('b' + i, c)">{{ playerLabel(c.key) }}{{ arrow('b' + i, c.key) }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="(row, ri) in sorted(b.players, 'b' + i, shownCols)" :key="ri"
                :class="row.team === 1 ? 't1' : 't2'">
              <td v-for="c in shownCols" :key="c.key" :class="{ num: c.num, left: LEFT_KEYS.has(c.key) }">
                {{ row.cells[c.key] }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style>
body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; color: #222; background: #f7f8fa; }
.wrap { max-width: 1400px; margin: 0 auto; padding: 16px 20px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h1 { font-size: 20px; margin: 0 0 12px; }
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
button, .filebtn { padding: 6px 14px; border: 1px solid #2f5597; background: #2f5597; color: #fff;
  border-radius: 4px; cursor: pointer; font-size: 13px; }
button:disabled { opacity: .5; cursor: default; }
.ghost { background: #fff; color: #2f5597; }
.filebtn input { display: none; }
.muted { color: #777; font-size: 13px; }
.error { color: #c00; }
.warn { color: #8a5200; background: #fff8e8; border: 1px solid #f0d08a; padding: 8px; border-radius: 4px; }
.warn span, .error span { display: inline-block; margin: 2px 8px 2px 0; }
.dropzone { border: 1px dashed #9fb4d4; background: #fff; color: #5b6f8f; padding: 16px; text-align: center;
  border-radius: 6px; margin-bottom: 10px; }
.dropzone.dragging { border-color: #2f5597; background: #eef4ff; color: #2f5597; }
.files { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 10px; }
.chip { background: #eef2f7; border: 1px solid #d7dee9; border-radius: 4px; padding: 3px 6px;
  font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.chipx { padding: 0 4px; border: none; background: transparent; color: #8a93a6; font-size: 14px;
  line-height: 1; cursor: pointer; border-radius: 3px; }
.chipx:hover { background: #d9534f; color: #fff; }
/* 战斗标签上的移除按钮 */
.tabx { margin-left: 4px; padding: 0 3px; border-radius: 3px; opacity: .65; }
.tabx:hover { background: #d9534f; color: #fff; opacity: 1; }
.colpicker { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 8px 12px;
  background: #fff; border: 1px solid #d6e0ef; border-radius: 4px; margin-bottom: 10px; }
.colTitle { flex-basis: 100%; font-size: 13px; color: #2f5597; font-weight: bold; }
.colpicker label { font-size: 13px; white-space: nowrap; }
.colActions { flex-basis: 100%; display: flex; gap: 8px; margin-top: 4px; }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; margin: 12px 0 6px; }
.tabs button { background: #e8edf5; color: #2f5597; border-color: #c7d3e6; }
.tabs button.active { background: #2f5597; color: #fff; }
.info { color: #1b5e20; font-size: 13px; margin: 6px 0; }
.tablewrap { overflow-x: auto; background: #fff; }
/* 按内容自然宽度排列(不挤压列), 内容窄时仍填满容器; 横向滚动可完整看到末列 */
table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 13px; }
th, td { border: 1px solid #cfd8e3; padding: 4px 8px; white-space: nowrap; }
th { background: #2f5597; color: #fff; cursor: pointer; user-select: none; position: sticky; top: 0; }
/* 末列(账号ID)留出右侧余量, 不贴边/被滚动条裁切 */
th:last-child, td:last-child { padding-right: 16px; }
td.num { text-align: center; }
td.left { text-align: left; }
tr.t1 td { background: #ddebf7; }
tr.t2 td { background: #fce4d6; }
.closed { padding: 30px; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
</style>
