<script setup>
import { ref, computed, onMounted } from 'vue'

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

const DEFAULT_VISIBLE = [
  'nickname', 'clan', 'tank_name', 'tank_type', 'rating', 'survived_label',
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
  tank_type: '坦克类型', tank_nation: '国家', rating: '评分', survived_label: '存活',
  kills: '击杀', damage_dealt: '伤害', damage_assisted: '协助伤害',
  damage_received: '损失血量', damage_blocked: '格挡', n_shots: '发射',
  n_hits_dealt: '命中', n_penetrations_dealt: '击穿', n_hits_received: '被命中',
  n_penetrations_received: '被击穿', n_enemies_damaged: '击伤',
  platoon_label: '排', tank_id: '车辆ID', account_id: '账号ID'
}
const AGG_LABELS = {
  nickname: '玩家', clan: '战队', battles: '场次', wins: '胜场',
  win_rate: '胜率%', survival_rate: '存活率%', rating_avg: '场均评分',
  kills: '总击杀', kills_avg: '场均击杀',
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

// 移除某一场: 先弹确认对话框
function askRemoveBattle(battle, idx) {
  pendingRemove.value = { battle, label: `${battle.mapName} #${idx + 1}` }
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
const pickerLabel = (key) => (pickerScope.value === 'agg' ? aggLabel(key) : playerLabel(key))
const currentOrder = computed(() => (pickerScope.value === 'agg' ? aggOrder.value : playerOrder.value))

// 面板里的分组标签
const COL_GROUP = {
  nickname: '身份', clan: '身份', account_id: '附加',
  tank_name: '车辆', tank_tier: '车辆', tank_type: '车辆', tank_nation: '车辆', tank_id: '附加',
  rating: '战斗', survived_label: '战斗', kills: '战斗', damage_dealt: '战斗',
  damage_assisted: '战斗', damage_received: '战斗', damage_blocked: '战斗',
  n_shots: '战斗', n_hits_dealt: '战斗', n_penetrations_dealt: '战斗',
  n_hits_received: '战斗', n_penetrations_received: '战斗', n_enemies_damaged: '战斗',
  platoon_label: '附加',
  battles: '总览', wins: '总览', win_rate: '总览', survival_rate: '总览', rating_avg: '总览',
  kills_avg: '战斗', damage: '战斗', damage_avg: '战斗', assisted: '战斗', assisted_avg: '战斗',
  received_avg: '战斗', blocked_avg: '战斗', hit_rate: '战斗', pen_rate: '战斗',
  enemies_damaged_avg: '战斗', tanks: '附加',
}
const catOf = (key) => COL_GROUP[key] || ''

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
  const t = Math.floor(s)
  return `${Math.floor(t / 60)}分${t % 60}秒`
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
          <h1>WoT Blitz 回放分析</h1>
          <p class="subtitle">解析回放 · 14 人战场数据 · 导出 xlsx</p>
        </div>
      </div>
      <button v-if="isDesktop" class="ghost" @click="shutdown">
        <svg class="ic" viewBox="0 0 24 24"><path d="M7 6a7.7 7.7 0 1 0 10 0M12 4v8" /></svg>关闭离线程序
      </button>
    </header>

    <section class="uploadwrap"
             @dragover.prevent="dragging = true"
             @dragleave.prevent="dragging = false"
             @drop.prevent="onDrop">
      <div v-if="!files.length" class="uploadcard" :class="{ dragging }">
        <span class="up-icon"><svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg></span>
        <div class="up-title">拖拽 .wotbreplay 文件到这里</div>
        <div class="up-sub">支持多选文件，或选择整个文件夹</div>
        <div class="up-actions">
          <label class="filebtn">
            <svg class="ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>选择回放文件
            <input type="file" multiple accept=".wotbreplay" @change="onPick" />
          </label>
          <label class="filebtn ghost">
            <svg class="ic" viewBox="0 0 24 24"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>选择文件夹
            <input type="file" multiple webkitdirectory @change="onPick" />
          </label>
        </div>
      </div>

      <div v-else class="filebar" :class="{ dragging }">
        <svg class="ic fb-ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>
        <span class="fb-count">{{ files.length }} 个文件</span>
        <div class="fb-chips">
          <span v-for="f in files" :key="fileKey(f)" class="chip">
            {{ displayName(f) }}
            <button class="chipx" title="移除该回放" @click="removeFile(f)">×</button>
          </span>
        </div>
        <label class="filebtn ghost sm" title="添加回放文件">
          <svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>添加
          <input type="file" multiple accept=".wotbreplay" @change="onPick" />
        </label>
        <label class="filebtn ghost sm" title="添加文件夹">
          <svg class="ic" viewBox="0 0 24 24"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>文件夹
          <input type="file" multiple webkitdirectory @change="onPick" />
        </label>
        <button class="ghost sm" :disabled="loading" @click="clearFiles">
          <svg class="ic" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></svg>清空
        </button>
      </div>

      <div v-if="files.length" class="actionrow">
        <button class="lg" :disabled="loading" @click="preview">
          解析预览<svg class="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
        <span v-if="loading" class="muted">处理中…</span>
        <span v-else class="muted">解析后，导出按钮出现在结果区</span>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="resp">
      <div v-if="resp.duplicates.length" class="warn">
        已跳过 {{ resp.duplicates.length }} 个重复上传：
        <span v-for="(d, i) in resp.duplicates" :key="i">{{ d[0] }}</span>
      </div>
      <div v-if="resp.failures.length" class="error">
        {{ resp.failures.length }} 个文件解析失败：
        <span v-for="(f, i) in resp.failures" :key="i">{{ f[0] }} ({{ f[1] }})</span>
      </div>

      <div class="restoolbar">
        <div class="tabs" :class="{ locked: showColPicker }"
             :title="showColPicker ? '列选择器打开时不可切换表格，请先点「完成」' : ''">
          <button v-if="resp.aggregate.length" :disabled="showColPicker"
                  :class="{ active: activeTab === 'aggregate' }"
                  @click="activeTab = 'aggregate'">汇总 ({{ resp.aggregate.length }} 名选手)</button>
          <button v-for="(b, i) in resp.battles" :key="i" :disabled="showColPicker"
                  :class="{ active: activeTab === 'b' + i }"
                  @click="activeTab = 'b' + i">{{ b.mapName }} #{{ i + 1 }}
            <span class="tabx" title="移除该场" @click.stop="askRemoveBattle(b, i)">×</span>
          </button>
        </div>
        <div class="resactions">
          <span class="dropdown">
            <button class="ghost sm" @click="toggleColPicker">
              <svg class="ic" viewBox="0 0 24 24"><path d="M4 4h16v16H4zM10 4v16" /></svg>选择列 ▾
            </button>
            <div v-if="showColPicker" class="colpanel">
              <div class="colpanel-head">
                <span class="cph-title">{{ pickerScope === 'agg' ? '汇总表' : '单场表' }}列 · 勾选显示、拖拽排序</span>
                <button class="linkbtn" @click="selectAllCols">全选</button>
                <button class="linkbtn" @click="resetCols">重置</button>
                <button class="linkbtn" @click="showColPicker = false">完成</button>
              </div>
              <ul class="collist">
                <li v-for="(key, idx) in currentOrder" :key="key" draggable="true"
                    @dragstart="onColDragStart(idx)" @dragover.prevent @drop="onColDrop(idx)"
                    :class="{ dragging: dragIdx === idx }">
                  <span class="grip" title="拖拽排序">⋮⋮</span>
                  <label class="colitem">
                    <input type="checkbox" :checked="isVisible(key)" @change="toggleCol(key)" />
                    {{ pickerLabel(key) }}
                  </label>
                  <span class="cat">{{ catOf(key) }}</span>
                </li>
              </ul>
            </div>
          </span>
          <button class="sm" :disabled="loading" @click="exportXlsx('aggregate')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>合并汇总
          </button>
          <button class="ghost sm" :disabled="loading" @click="exportXlsx('each')">
            <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 13l4 4 4-4M12 5v12" /></svg>每场导出
          </button>
        </div>
      </div>

      <div v-if="activeTab === 'aggregate' && resp.aggregate.length">
        <div v-if="aggStats" class="mcards">
          <div class="mc"><div class="k">战斗场次</div><div class="v">{{ aggStats.battles }}</div></div>
          <div class="mc"><div class="k">选手</div><div class="v">{{ aggStats.players }}</div></div>
          <div class="mc"><div class="k">最高场均评分</div><div class="v">{{ aggStats.maxRating }}</div></div>
          <div class="mc"><div class="k">最高单场伤害</div><div class="v">{{ aggStats.maxDmg }}</div></div>
        </div>
        <div class="tablewrap">
          <table>
            <thead><tr>
              <th v-for="c in shownAggCols" :key="c.key" @click="sortBy('agg', c)">{{ aggLabel(c.key) }}{{ arrow('agg', c.key) }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="(row, i) in sorted(resp.aggregate, 'agg', shownAggCols)" :key="i"
                  :class="row.team === 1 ? 't1' : 't2'">
                <td v-for="c in shownAggCols" :key="c.key">
                  <span v-if="RATING_KEYS.has(c.key)" class="rbadge" :class="ratingTier(row.cells[c.key])">{{ row.cells[c.key] }}</span>
                  <span v-else>{{ row.cells[c.key] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-for="(b, i) in resp.battles" :key="i" v-show="activeTab === 'b' + i">
        <div class="mcards">
          <div class="mc"><div class="k">地图</div><div class="v">{{ b.mapName }}</div></div>
          <div class="mc"><div class="k">时长</div><div class="v">{{ fmtDuration(b.durationS) }}</div></div>
          <div class="mc"><div class="k">获胜</div><div class="v">{{ TEAM[b.winnerTeam] || '平局/未知' }}</div></div>
          <div class="mc"><div class="k">玩家</div><div class="v">{{ b.players.length }}</div></div>
        </div>
        <div class="tablewrap">
          <table>
            <thead><tr>
              <th v-for="c in shownCols" :key="c.key" @click="sortBy('b' + i, c)">{{ playerLabel(c.key) }}{{ arrow('b' + i, c.key) }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="(row, ri) in sorted(b.players, 'b' + i, shownCols)" :key="ri"
                  :class="row.team === 1 ? 't1' : 't2'">
                <td v-for="c in shownCols" :key="c.key">
                  <span v-if="RATING_KEYS.has(c.key)" class="rbadge" :class="ratingTier(row.cells[c.key])">{{ row.cells[c.key] }}</span>
                  <span v-else-if="c.key === 'survived_label'" :class="row.cells[c.key] === '存活' ? 'alive' : 'dead'">{{ row.cells[c.key] }}</span>
                  <span v-else>{{ row.cells[c.key] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div v-if="pendingRemove" class="modal-mask" @click.self="cancelRemove">
      <div class="modal">
        <p class="modal-title">移除该场</p>
        <p>确定移除「{{ pendingRemove.label }}」这场回放吗？</p>
        <p class="modal-sub">将从列表删除对应回放文件并重新汇总。可重新选择文件再解析。</p>
        <div class="modal-actions">
          <button @click="confirmRemoveBattle">确认移除</button>
          <button class="ghost" @click="cancelRemove">取消</button>
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
</style>
