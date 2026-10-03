<script setup>
/**
 * 射击分析能力面板（回放工作台内，Master–Detail）。
 *
 * 数据面：目标回放在本机解析（上游 Rust Core WASM `parseShotReplays`，文件不出本机）→
 * 射击总览 / 射击者筛选 / 射击列表（master）+ 射击检视（detail）。
 * 文件与 session identity 由工作台唯一持有：本面板从不自己要求文件，也没有第二份 session。
 *
 * Master–Detail（design-language §9）按**容器宽度**分档，不按视口：
 * 宽档常驻右栏；中档选中后成推开式侧栏（列表让位不遮盖）；窄档整屏面板 + 遮罩，
 * 焦点在打开时进入面板、Esc / 关闭后回到触发它的那一行。
 * 窄档详情支持左右滑动 / 方向键在**当前筛选结果内**切换上一发 / 下一发（首尾不循环）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import {
  parseAgentShotsFromBytes, parseAgentPlaybackFromBytes, enrichShotsFromRoster, isShotHit,
} from '../api/agent-replay-facets.js'
import { formatPlaybackClock } from '../utils/playbackClock.js'
import { storeShotsForViewer, fetchTankData, tankImageUrl } from '../scene/agentData.js'
import Scene3DStatus from './Scene3DStatus.vue'
import Badge from './Badge.vue'
import StatStrip from './StatStrip.vue'
import SegmentedControl from './SegmentedControl.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'

defineOptions({ name: 'ReplayShotsPane' })

const props = defineProps({
  /** 工作台派生的目标回放文件；null = 还没选（面板只显示提示） */
  file: { type: Object, default: null },
  /** 当前能力是否激活：false 时不解码（已在列表里的结果保留） */
  active: { type: Boolean, default: false },
  /** 工作台给出的不可用原因（多文件未选场次等）；非空时不解析 */
  blockedReason: { type: String, default: '' },
  /** 工作台注入的导航（router owner 不变）：在 3D 装甲查看器里打开这一发 */
  navigate: { type: Function, default: null },
})
const { t } = useI18n()

const shots = ref([])
const parsing = ref(false)
const err = ref('')
/** 作者严格路径 fail-visible（契约 v0.1.9）：author_path=error 时警示与空态并存 */
const authorError = ref('')
const shooter = ref('all')
const selectedIndex = ref(null)
/** 已解析的文件：同一文件不重复解码 */
let parsedFile = null
/** 在途解析的认领序号：文件切换后迟到的结果一律丢弃 */
let parseSeq = 0

/**
 * 弹种兜底 / 俯仰锚定共用同一份资产面数据链（与 2D 回放、装甲查看器同一来源）。
 * 弹表只在首次解析时按需加载一次。
 */
let shellTablePromise = null
function loadShellTable() {
  if (!shellTablePromise) {
    shellTablePromise = (async () => {
      const mod = await import('../scene/shellKinds.json')
      return mod.default
    })()
    shellTablePromise.catch(() => { shellTablePromise = null })
  }
  return shellTablePromise
}

/**
 * 弹种富化兜底（旧产物路径：WASM 输出没有 shell 字段时在客户端按同款表反解；
 * 新产物由 WASM 注入，此处零命中直通）。
 */
async function enrichShellFallback(parsedShots, table) {
  const byTank = new Map()
  for (const s of parsedShots) {
    if (s.shell_id && !s.shell && !byTank.has(s.shooter_tank_id)) byTank.set(s.shooter_tank_id, null)
  }
  await Promise.all([...byTank.keys()].map(async (tid) => {
    try { byTank.set(tid, await fetchTankData(tid)) } catch { /* 静态面缺失：跳过弹链兜底 */ }
  }))
  for (const s of parsedShots) {
    if (!s.shell_id || s.shell) continue
    const entry = table && table[String(s.shell_id)]
    if (entry) {
      s.shell = entry
      s.shell_kind = s.shell_kind || entry.type
      continue
    }
    const data = byTank.get(s.shooter_tank_id)
    if (!data) continue
    // 与上游 resolve_shell_by_global_id 同式：全配置弹链查找（顶级偏好，从后往前）
    for (let ci = (data.configs || []).length - 1; ci >= 0; ci--) {
      const cfg = data.configs[ci]
      const idx = (cfg.shell_global_ids || []).indexOf(s.shell_id)
      if (idx >= 0 && cfg.shells?.[idx]) {
        s.shell = s.shell || cfg.shells[idx]
        s.shell_kind = s.shell_kind || cfg.shells[idx].type
        break
      }
    }
  }
}

/**
 * 俯仰锚定表：playback 名册 → tank_id → 顶级配置 pitch_limits，换算 GunPitchRange 形状
 * （dep = max 俯角上限、ele = −min 仰角上限）。注入后俯仰按车型极限解码，
 * 消解空表下的大面积「俯仰降级」标记；缺数据的玩家如实降级。
 */
async function buildPitchLimits(vehicles) {
  const limits = {}
  const tankNames = new Map()
  const tankRange = new Map()
  for (const v of vehicles || []) {
    if (v.nickname && v.tank_id && !tankNames.has(v.tank_id)) tankNames.set(v.tank_id, [])
    if (v.nickname && v.tank_id) tankNames.get(v.tank_id).push(v.nickname)
  }
  await Promise.all([...tankNames.keys()].map(async (tid) => {
    try {
      const data = await fetchTankData(tid)
      const cfgs = data.configs || []
      const pl = cfgs.length ? cfgs[cfgs.length - 1].pitch_limits : null
      if (pl && pl.max != null && pl.min != null) {
        tankRange.set(tid, {
          dep: pl.max,
          ele: -pl.min,
          ...(pl.front ? { front: pl.front } : {}),
          ...(pl.back ? { back: pl.back } : {}),
          ...(pl.transition != null ? { transition: pl.transition } : {}),
        })
      }
    } catch { /* 数据缺失：该玩家保持空锚定（如实降级） */ }
  }))
  for (const [tid, names] of tankNames) {
    const range = tankRange.get(tid)
    if (!range) continue
    for (const nick of names) limits[nick] = range
  }
  return limits
}

/**
 * 名册联表只补身份与阵营（`enrichShotsFromRoster`）；昵称缺在射击链上是常态
 * （他人宽松路径不带昵称），这里按 eid 联表补齐昵称——姓名不可解析时界面显示
 * 「未知玩家」，绝不落回内部 id（design-language §11）。
 */
function applyRosterNames(parsedShots, vehicles) {
  const byEid = new Map()
  for (const v of vehicles || []) {
    if (v && typeof v.eid === 'number' && v.nickname) byEid.set(v.eid, v.nickname)
  }
  for (const s of parsedShots) {
    if (!s.shooter_name && byEid.has(s.shooter_eid)) s.shooter_name = byEid.get(s.shooter_eid)
    if (!s.target_name && s.target_eid != null && byEid.has(s.target_eid)) s.target_name = byEid.get(s.target_eid)
  }
}

async function decode(file) {
  const seq = ++parseSeq
  parsing.value = true
  err.value = ''
  authorError.value = ''
  selectedIndex.value = null
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (seq !== parseSeq) return
    // 时序：先解析 playback（轻）构建俯仰锚定表，射击链只做一次重解析。
    // 锚定注入失败（产物过旧等）→ 裸解析兜底（俯仰降级标记如实透传）。
    let playback = null
    let pitchLimits = null
    try {
      playback = await parseAgentPlaybackFromBytes(bytes)
      if (seq !== parseSeq) return
      pitchLimits = await buildPitchLimits(playback.vehicles)
    } catch (e) {
      console.warn('pitch limits skipped:', e)
    }
    if (seq !== parseSeq) return
    const shellTable = await loadShellTable().catch(() => undefined)
    if (seq !== parseSeq) return
    let outcome
    try {
      outcome = await parseAgentShotsFromBytes(bytes, pitchLimits ?? undefined, shellTable)
    } catch (e) {
      console.warn('anchored parse failed, fallback:', e)
      if (seq !== parseSeq) return
      outcome = await parseAgentShotsFromBytes(bytes)
    }
    if (seq !== parseSeq) return
    // 作者严格路径 fail-visible（契约 v0.1.9）：失败不再静默，警示条 + 他人宽松全量
    authorError.value = outcome.author_error || ''
    const parsedShots = outcome.shots
    // 富化失败不阻断主表（名册失败仅 3D 链接缺失；弹种反解失败走槽位/id 兜底）
    if (playback) {
      try {
        enrichShotsFromRoster(parsedShots, playback.vehicles)
        applyRosterNames(parsedShots, playback.vehicles)
      } catch (e) {
        console.warn('roster enrichment skipped:', e)
      }
    }
    if (shellTable && parsedShots.some((s) => s.shell_id && !s.shell)) {
      try { await enrichShellFallback(parsedShots, shellTable) } catch (e) {
        console.warn('shell enrichment skipped:', e)
      }
    }
    if (seq !== parseSeq) return
    shots.value = parsedShots
    shooter.value = 'all'
  } catch (e) {
    if (seq !== parseSeq) return
    shots.value = []
    err.value = t('agentShots.error_parse') + ' ' + String(e?.message || e).slice(0, 200)
  } finally {
    if (seq === parseSeq) parsing.value = false
  }
}

/**
 * 解码时机 = 能力激活（首次进入射击分析）：一个 watcher 同时覆盖"初始就激活"（深链直达）
 * 与"之后才激活"，也覆盖激活期间换了目标回放。同一文件不重复解码；切走不解码、保留结果。
 */
watch([() => props.active, () => props.file, () => props.blockedReason], ([active, file, blocked]) => {
  if (!active || !file || blocked) return
  if (parsedFile === file) return
  parsedFile = file
  decode(file)
}, { immediate: true })

const shellBadge = (s) => {
  const kindOf = (value) => {
    const v = (value || '').toLowerCase()
    if (/^ap_cr|^apcr/.test(v)) return 'APCR'
    if (/^hc|^heat/.test(v)) return 'HEAT'
    if (/^he/.test(v)) return 'HE'
    if (/^ap/.test(v)) return 'AP'
    return ''
  }
  const kind = s.shell_kind || (s.shell && s.shell.type) || ''
  const label = kindOf(kind)
  const pen = s.shell && s.shell.penetration ? Math.round(s.shell.penetration) : null
  if (!label) return { label: '', pen, tone: 'neutral' }
  return { label, pen, tone: /premium/.test(kind) ? 'warning' : 'neutral' }
}

/** 命中结果：hit_flags 位图 → 击穿 / HE / 跳弹 / 未穿 / 脱靶；无位图按 game_hit_result 降级 */
function resultBadge(s) {
  const f = s.hit_flags || 0
  if (!f) {
    if (s.target_eid == null) return { text: t('agentShots.res_miss'), tone: 'neutral' }
    const r = s.game_hit_result
    if (r === 3) return { text: t('agentShots.res_pen'), tone: 'success' }
    if (r === 4) return { text: t('agentShots.res_track'), tone: 'info' }
    // eid 在案 = 命中已知；r 未知（255/0/缺）只能证明"结果未知"，不得伪装成未击穿
    if (r == null || r === 255 || r === 0) return { text: t('agentShots.res_hit_unknown'), tone: 'warning' }
    return { text: t('agentShots.res_nopen'), tone: 'danger' }
  }
  if (f & 0x1000) return { text: 'HE', tone: 'warning' }
  if (f & 0x0010) return { text: t('agentShots.res_pen'), tone: 'success' }
  if (f & 0x0008) return { text: t('agentShots.res_ric'), tone: 'warning' }
  return { text: t('agentShots.res_nopen'), tone: 'danger' }
}

/** 数据质量徽章：降级 / 陈旧项汇总（悬停显示详情）——与上游同一规则 */
function qualityIssues(s) {
  const q = s.quality
  if (!q) return []
  const issues = []
  if (q.shooter_pos_from_muzzle) issues.push(t('agentShots.q_muzzle'))
  if (Math.abs(q.shooter_state_dt_ms || 0) >= 300) issues.push(`${t('agentShots.q_shooter_dt')} ${q.shooter_state_dt_ms}ms`)
  if (q.target_state_dt_ms != null && Math.abs(q.target_state_dt_ms) >= 300) issues.push(`${t('agentShots.q_target_dt')} ${q.target_state_dt_ms}ms`)
  if ((q.turret_degraded || []).includes('shooter')) issues.push(t('agentShots.q_shooter_turret'))
  if ((q.turret_degraded || []).includes('target')) issues.push(t('agentShots.q_target_turret'))
  if (q.dmg_unattributed) issues.push(t('agentShots.q_dmg_unattr'))
  if (q.target_anchor_src === 'nearest') issues.push(t('agentShots.q_target_nearest'))
  else if (q.target_anchor_src === 'extrapolated') issues.push(t('agentShots.q_target_extrap'))
  else if (q.target_anchor_src === 'filtered') issues.push(t('agentShots.q_target_filtered'))
  if (q.shooter_anchor_src === 'extrapolated') issues.push(t('agentShots.q_shooter_extrap'))
  else if (q.shooter_anchor_src === 'nearest') issues.push(t('agentShots.q_shooter_nearest'))
  if (q.shell_from_broadcast) issues.push(t('agentShots.q_shell_broadcast'))
  if (q.shell_from_terrain) issues.push(t('agentShots.q_shell_terrain'))
  if (q.shooter_pitch_from_velocity) issues.push(t('agentShots.q_pitch_velocity'))
  if (s.target_name && !s.shell_id) issues.push(t('agentShots.q_shell_unknown'))
  if (s.target_name && s.game_hit_result === 255) issues.push(t('agentShots.q_result_unknown'))
  return issues
}

/**
 * 玩家名：解析结果里的昵称优先；拿不到昵称时**不暴露内部 id**（design-language §11），
 * 统一显示「未知玩家」。
 */
function playerName(name) {
  const text = (name || '').trim()
  return text || t('agentShots.unknown_player')
}

/**
 * 射击者筛选：显式三态 ally / enemy / unknown——未知阵营绝不并入我方。
 * 选项值用**列表内序号**而不是 eid：DOM 里不出现内部 id（design-language §11），
 * 身份仍然是 eid（`entry.eid`），只用于筛选比较。
 */
const shooterGroups = computed(() => {
  const groups = { allies: [], enemies: [], unknown: [] }
  const count = {}
  for (const s of shots.value) {
    const key = s.shooter_eid ?? `#${s.index}`
    count[key] = (count[key] || 0) + 1
  }
  const seen = new Set()
  for (const s of shots.value) {
    const key = s.shooter_eid ?? `#${s.index}`
    if (seen.has(key)) continue
    seen.add(key)
    const entry = { key, eid: s.shooter_eid ?? null, name: playerName(s.shooter_name), n: count[key], isAuthor: !!s.is_author }
    if (s.shooter_team === 'ally') groups.allies.push(entry)
    else if (s.shooter_team === 'enemy') groups.enemies.push(entry)
    else groups.unknown.push(entry)
  }
  const byCount = (a, b) => b.n - a.n
  groups.allies.sort((a, b) => (b.isAuthor ? 1 : 0) - (a.isAuthor ? 1 : 0) || byCount(a, b))
  groups.enemies.sort(byCount)
  groups.unknown.sort(byCount)
  return groups
})

/** 三态分组按固定顺序摊平；序号即 DOM 选项值（DOM 里不出现内部 id），筛选时回查 eid。 */
const shooterOptions = computed(() => [
  ...shooterGroups.value.allies, ...shooterGroups.value.enemies, ...shooterGroups.value.unknown,
])

const shooterGroupsIndexed = computed(() => {
  let offset = 0
  const withIndex = (list) => list.map((o) => ({ ...o, idx: String(offset++) }))
  return {
    allies: withIndex(shooterGroups.value.allies),
    enemies: withIndex(shooterGroups.value.enemies),
    unknown: withIndex(shooterGroups.value.unknown),
  }
})

const selectedShooter = computed(() =>
  shooter.value === 'all' ? null : shooterOptions.value[Number(shooter.value)] ?? null)

const filteredShots = computed(() => {
  const selected = selectedShooter.value
  if (!selected) return shots.value
  return shots.value.filter((s) => (s.shooter_eid ?? `#${s.index}`) === selected.key)
})

/**
 * 总览（随筛选联动）：total 按上游顶层 Shot 行计（unique shotId / 一次开火），
 * 绝不按 interaction 数膨胀；命中率 = 命中 / 开火，穿透率 = 击穿 / 命中。
 */
const shotSummary = computed(() => {
  const rows = filteredShots.value
  const total = rows.length
  const hits = rows.filter(isShotHit).length
  const pens = rows.filter((s) => (s.is_author ? s.hit_flags & 0x0010 : s.game_hit_result === 3)).length
  const rics = rows.filter((s) => (s.is_author ? s.hit_flags & 0x0008 : false)).length
  const heHits = rows.filter((s) => s.is_author && s.hit_flags & 0x1000).length
  const kills = rows.filter((s) => s.is_kill).length
  const damage = rows.reduce((sum, s) => sum + (s.damage || 0), 0)
  return {
    total, hits, pens, rics, heHits, kills, damage,
    hitRate: total ? (100 * hits) / total : 0,
    penRate: hits ? (100 * pens) / hits : 0,
  }
})

const summaryStats = computed(() => {
  const s = shotSummary.value
  return [
    { key: 'shots', label: t('agentShots.stat_shots'), value: String(s.total) },
    { key: 'hit', label: t('agentShots.stat_hit'), value: `${s.hitRate.toFixed(0)}%`, sub: `${s.hits}/${s.total}` },
    { key: 'pen', label: t('agentShots.stat_pen'), value: `${s.penRate.toFixed(0)}%`, sub: `${s.pens}/${s.hits}` },
    { key: 'damage', label: t('agentShots.stat_dmg'), value: String(s.damage) },
    { key: 'ric_he', label: t('agentShots.stat_ric_he'), value: `${s.rics} / ${s.heHits}` },
    { key: 'kills', label: t('agentShots.stat_kills'), value: String(s.kills) },
  ]
})

const selectedShot = computed(() =>
  selectedIndex.value == null ? null : shots.value.find((s) => s.index === selectedIndex.value) || null)

/** 弹道两点距离（米）：只做展示，不参与任何判定 */
function trajectoryLength(s) {
  const a = s.ball_a, b = s.ball_b
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return null
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
  return Math.hypot(dx, dy, dz)
}

/** 行内 3D 复现可用性：仅命中弹（有目标 = 服务器命中通知在案） */
function rowHas3d(s) {
  return s.target_eid != null
}

/**
 * 列表 / 详情分档由**容器宽度**决定（design-language §9：expanded 常驻、medium 推开式、
 * compact 全屏），不看视口——工作台可能被侧栏或抽屉挤窄。
 */
const paneRoot = ref(null)
const layout = ref('expanded')
const detailOpen = computed(() => selectedIndex.value != null)
const isOverlay = computed(() => layout.value === 'compact')

let observer = null
let detailPane = null
let lastTrigger = null

function applyLayout(width) {
  layout.value = width >= 900 ? 'expanded' : width >= 600 ? 'medium' : 'compact'
}

function selectShot(index, event) {
  selectedIndex.value = index
  lastTrigger = event?.currentTarget ?? null
  if (isOverlay.value) nextTick(() => detailPane?.focus?.())
}

function closeDetail() {
  selectedIndex.value = null
  if (lastTrigger?.focus) lastTrigger.focus()
}

/**
 * 上一发 / 下一发：**只在当前筛选结果内**移动（`filteredShots` 而不是 `shots`）。
 * 边界不循环——第一发没有上一发，最后一发没有下一发，对应按钮同时 disabled。
 */
const selectedPosition = computed(() =>
  filteredShots.value.findIndex((s) => s.index === selectedIndex.value))
const hasPreviousShot = computed(() => selectedPosition.value > 0)
const hasNextShot = computed(() =>
  selectedPosition.value >= 0 && selectedPosition.value < filteredShots.value.length - 1)

function goToAdjacentShot(step) {
  const position = selectedPosition.value
  if (position < 0) return false
  const next = position + step
  if (next < 0 || next >= filteredShots.value.length) return false
  selectedIndex.value = filteredShots.value[next].index
  return true
}

/**
 * 筛选把当前这一发筛掉了 → 关闭详情，不要留一个"列表里已经没有、详情还开着"的状态。
 * （导航本身只在筛选结果内移动，所以这是筛选变化时唯一的不一致入口。）
 */
watch(filteredShots, (rows) => {
  if (selectedIndex.value == null) return
  if (!rows.some((s) => s.index === selectedIndex.value)) closeDetail()
})

/** 键盘：方向键等价于上一发 / 下一发；表单控件聚焦时不劫持 */
function isFormControl(target) {
  return !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function onDetailKeydown(event) {
  if (!detailOpen.value) return
  if (event.key === 'Escape') {
    event.stopPropagation()
    closeDetail()
    return
  }
  if (isFormControl(event.target)) return
  if (event.key === 'ArrowLeft' && goToAdjacentShot(-1)) event.preventDefault()
  else if (event.key === 'ArrowRight' && goToAdjacentShot(1)) event.preventDefault()
}

/**
 * compact 全屏详情里的左右滑动切换（Pointer Events，无手势依赖）：
 * 只在 compact + 详情打开时生效；横向位移要足够大且明显压过纵向位移，避免和纵向滚动打架。
 */
const SWIPE_MIN_DX = 48
const SWIPE_DX_RATIO = 1.25
let swipeStart = null

function onDetailPointerDown(event) {
  if (layout.value !== 'compact' || !detailOpen.value) return
  swipeStart = { x: event.clientX, y: event.clientY }
}

function onDetailPointerUp(event) {
  const start = swipeStart
  swipeStart = null
  if (!start || layout.value !== 'compact' || !detailOpen.value) return
  const dx = event.clientX - start.x
  const dy = event.clientY - start.y
  if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) <= Math.abs(dy) * SWIPE_DX_RATIO) return
  goToAdjacentShot(dx < 0 ? 1 : -1)
}

/**
 * 在 3D 装甲查看器里复现这一发：装甲查看器属于坦克百科侧（独立页面），
 * 工作台只把发射数据交出去（本地交接通道，无服务端），导航仍走 router。
 */
async function resolveShellIdx(s) {
  if (!s.shell_id || !s.shooter_tank_id) return null
  try {
    const data = await fetchTankData(s.shooter_tank_id)
    const cfgs = data.configs || []
    for (let ci = cfgs.length - 1; ci >= 0; ci--) {
      const idx = (cfgs[ci].shell_global_ids || []).indexOf(s.shell_id)
      if (idx >= 0) return { cfg: ci, idx }
    }
    return null
  } catch {
    return null
  }
}

async function openInViewer(s) {
  if (!rowHas3d(s)) return
  const shooterTank = s.shooter_tank_id || 0
  const tank = s.target_tank_id || shooterTank || 0
  if (!tank) return
  storeShotsForViewer(shots.value)
  const hit = await resolveShellIdx(s)
  const shellIdx = hit ? hit.idx : (s.is_author && s.shell_slot != null) ? s.shell_slot : null
  // 组件不碰 history：目的地交给工作台注入的 router owner
  props.navigate?.({
    query: {
      view: 'agent-armor',
      tank: String(tank),
      ...(shooterTank ? { shooter: String(shooterTank) } : {}),
      shot: String(s.index),
      ...(shellIdx != null ? { shell: String(shellIdx) } : {}),
      ...(hit && hit.cfg != null ? { scfg: String(hit.cfg) } : {}),
      ...(s.target_config_idx != null ? { config: String(s.target_config_idx) } : {}),
      world: '1',
      heatmap: '1',
    },
  })
}

onMounted(() => {
  if (typeof ResizeObserver !== 'function' || !paneRoot.value) return
  observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect?.width
    if (width) applyLayout(width)
  })
  observer.observe(paneRoot.value)
  applyLayout(paneRoot.value.getBoundingClientRect().width)
})

onBeforeUnmount(() => {
  // 工作台退出登录会卸载面板；不得继续启动后续解析或资产富化。
  parseSeq++
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div ref="paneRoot" class="shots-pane" data-testid="replay-shots-pane" @keydown="onDetailKeydown">
    <Scene3DStatus v-if="parsing" mode="loading" :message="$t('agentShots.parsing')" />
    <!-- 解析期间不显示"没选文件 / 被阻断 / 解析失败"：那些是解析**结果**，不是进行中的状态 -->
    <p v-else-if="blockedReason" class="shots-note" data-testid="shots-blocked">{{ blockedReason }}</p>
    <p v-else-if="!file" class="shots-note" data-testid="shots-empty">{{ $t('workspace.capability_upload_hint') }}</p>
    <Banner v-else-if="err" tone="danger" data-testid="shots-error">
      <p>{{ err }}</p>
    </Banner>
    <template v-else>
      <!-- 作者严格路径 fail-visible（契约 v0.1.9 核心目标）：独立于列表 / 空态状态链——
           author_path=error 且他人宽松路径 0 发时，警示与空态并存，
           绝不允许只显示"没有射击"把作者链失败伪装成正常空结果 -->
      <Banner v-if="authorError" tone="warning" data-testid="shots-author-error">
        <p>{{ $t('agentShots.author_path_error') }}</p>
        <p class="shots-cause">{{ authorError.slice(0, 160) }}</p>
      </Banner>

      <StatStrip :stats="summaryStats" />

      <div v-if="shooterOptions.length > 1" class="shots-filter">
        <label class="shots-filter-label" for="shots-shooter-select">{{ $t('agentShots.shooter') }}</label>
        <select id="shots-shooter-select" v-model="shooter" class="shots-select" data-testid="shots-shooter-select">
          <option value="all">{{ $t('agentShots.all_shooters') }} ({{ shots.length }})</option>
          <optgroup v-if="shooterGroupsIndexed.allies.length" :label="$t('agentShots.allies')">
            <option v-for="o in shooterGroupsIndexed.allies" :key="o.key" :value="o.idx">{{ o.name }} ({{ o.n }})</option>
          </optgroup>
          <optgroup v-if="shooterGroupsIndexed.enemies.length" :label="$t('agentShots.enemies')">
            <option v-for="o in shooterGroupsIndexed.enemies" :key="o.key" :value="o.idx">{{ o.name }} ({{ o.n }})</option>
          </optgroup>
          <optgroup v-if="shooterGroupsIndexed.unknown.length" :label="$t('agentShots.unknown_side')">
            <option v-for="o in shooterGroupsIndexed.unknown" :key="o.key" :value="o.idx">{{ o.name }} ({{ o.n }})</option>
          </optgroup>
        </select>
      </div>

      <div v-if="!filteredShots.length" class="shots-note" data-testid="shots-no-shots">{{ $t('agentShots.no_shots') }}</div>
      <div v-else class="shots-split" :class="[`is-${layout}`, { 'has-detail': detailOpen }]">
        <ul class="shot-list" :aria-label="$t('agentShots.title')">
          <li v-for="s in filteredShots" :key="s.index">
            <button
              type="button"
              class="shot-row"
              :class="{ 'is-selected': selectedIndex === s.index }"
              :aria-current="selectedIndex === s.index ? 'true' : undefined"
              :data-testid="`shot-row-${s.index}`"
              @click="selectShot(s.index, $event)"
            >
              <span class="shot-time">{{ formatPlaybackClock(s.time_s) }}</span>
              <img v-if="s.target_tank_id" class="shot-icon" loading="lazy" :src="tankImageUrl(s.target_tank_id)" alt="">
              <span class="shot-path">
                <span class="shot-names">
                  <span class="shot-name">{{ playerName(s.shooter_name) }}</span>
                  <span class="shot-arrow" aria-hidden="true">→</span>
                  <span class="shot-name">{{ s.target_name ? playerName(s.target_name) : '—' }}</span>
                </span>
                <span class="shot-meta">
                  <Badge :text="resultBadge(s).text" :tone="resultBadge(s).tone" />
                  <Badge v-if="shellBadge(s).label" :text="shellBadge(s).label" :tone="shellBadge(s).tone" />
                  <span v-if="shellBadge(s).pen" class="shot-dim">{{ shellBadge(s).pen }} mm</span>
                  <span v-if="s.damage" class="shot-dmg">{{ s.damage }}</span>
                  <span v-if="s.is_kill" class="shot-kill">{{ $t('agentShots.stat_kills') }}</span>
                  <span v-if="qualityIssues(s).length" class="shot-flag" :title="qualityIssues(s).join('; ')">!</span>
                </span>
              </span>
            </button>
          </li>
        </ul>

        <aside
          v-if="detailOpen"
          ref="detailPane"
          class="shot-detail"
          tabindex="-1"
          data-testid="shot-inspector"
          :aria-label="$t('agentShots.inspector_title')"
          @pointerdown="onDetailPointerDown"
          @pointerup="onDetailPointerUp"
          @pointercancel="swipeStart = null"
        >
          <header class="shot-detail-head">
            <h3 class="shot-detail-title">{{ $t('agentShots.inspector_title') }}</h3>
            <div class="shot-detail-nav">
              <!-- 滑动是快捷方式，按钮是可发现 / 可键盘操作的等价路径（首尾各自 disabled，不循环） -->
              <button
                type="button"
                class="shot-nav-btn"
                data-testid="shot-prev"
                :disabled="!hasPreviousShot"
                :title="$t('agentShots.prev_shot')"
                :aria-label="$t('agentShots.prev_shot')"
                @click="goToAdjacentShot(-1)"
              ><ChevronLeft :size="16" aria-hidden="true" /></button>
              <button
                type="button"
                class="shot-nav-btn"
                data-testid="shot-next"
                :disabled="!hasNextShot"
                :title="$t('agentShots.next_shot')"
                :aria-label="$t('agentShots.next_shot')"
                @click="goToAdjacentShot(1)"
              ><ChevronRight :size="16" aria-hidden="true" /></button>
              <AppButton size="sm" data-testid="shot-detail-close" @click="closeDetail">{{ $t('agentShots.close') }}</AppButton>
            </div>
          </header>
          <dl class="shot-detail-grid">
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_time') }}</dt><dd>{{ formatPlaybackClock(selectedShot.time_s) }}</dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_shooter') }}</dt><dd>{{ playerName(selectedShot.shooter_name) }}</dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_target') }}</dt><dd>{{ selectedShot.target_name ? playerName(selectedShot.target_name) : '—' }}</dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_shell') }}</dt><dd>
              <Badge v-if="shellBadge(selectedShot).label" :text="shellBadge(selectedShot).label" :tone="shellBadge(selectedShot).tone" />
              <span v-else class="shot-dim">{{ $t('agentShots.shell_unknown') }}</span>
              <span v-if="shellBadge(selectedShot).pen" class="shot-dim">{{ shellBadge(selectedShot).pen }} mm</span>
            </dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_result') }}</dt><dd>
              <Badge :text="resultBadge(selectedShot).text" :tone="resultBadge(selectedShot).tone" />
            </dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_dmg') }}</dt><dd>{{ selectedShot.damage || 0 }}</dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.detail_impact') }}</dt><dd>
              {{ selectedShot.target_eid != null ? $t('agentShots.impact_hit') : $t('agentShots.impact_miss') }}
            </dd></div>
            <div v-if="trajectoryLength(selectedShot) != null" class="shot-detail-row">
              <dt>{{ $t('agentShots.detail_trajectory') }}</dt>
              <dd>{{ trajectoryLength(selectedShot).toFixed(1) }} m</dd>
            </div>
          </dl>

          <div v-if="qualityIssues(selectedShot).length" class="shot-detail-quality">
            <h4>{{ $t('agentShots.detail_quality') }}</h4>
            <ul>
              <li v-for="issue in qualityIssues(selectedShot)" :key="issue">{{ issue }}</li>
            </ul>
          </div>

          <p class="shot-detail-hint">{{ $t('agentShots.inspector_hint') }}</p>
          <AppButton
            v-if="rowHas3d(selectedShot)"
            variant="primary"
            size="sm"
            data-testid="shot-open-viewer"
            @click="openInViewer(selectedShot)"
          >{{ $t('agentShots.open_viewer') }}</AppButton>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 配色一律走语义 token（两档主题同一份规则）；容器查询决定 Master–Detail 分档，
   不按视口——工作台可能被抽屉挤窄。 */
.shots-pane { container-type: inline-size; display: grid; gap: var(--space-3); }

.shots-note { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
.shots-cause { margin: var(--space-1) 0 0; color: var(--color-text-secondary); font: var(--type-caption); }

.shots-filter { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.shots-filter-label { color: var(--color-text-secondary); font: var(--type-caption); }
.shots-select {
  min-height: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}
.shots-select:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.shots-split { position: relative; display: grid; gap: var(--space-4); align-items: start; }
.shots-split.is-expanded { grid-template-columns: minmax(0, 1fr) minmax(260px, 360px); }

.shot-list {
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  list-style: none;
}

.shot-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--row-h);
  padding: var(--space-1) var(--space-3);
  border: 0;
  border-block-end: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  cursor: pointer;
}
.shot-list li:last-child .shot-row { border-block-end: 0; }
.shot-row.is-selected { background: var(--color-surface-3); }
.shot-row:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }

.shot-time { flex: none; width: 5.5ch; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.shot-icon { flex: none; width: 36px; height: 25px; object-fit: contain; }
.shot-path { display: grid; gap: 2px; min-width: 0; flex: 1; }
.shot-names { display: flex; gap: var(--space-1); min-width: 0; }
.shot-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shot-arrow { flex: none; color: var(--color-text-tertiary); }
.shot-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.shot-dim { color: var(--color-text-secondary); font: var(--type-caption); }
.shot-dmg { color: var(--color-text-primary); font: var(--type-caption); font-variant-numeric: tabular-nums; }
.shot-kill { color: var(--color-danger); font: var(--type-caption); font-weight: 600; }
.shot-flag { color: var(--color-warning); font: var(--type-caption); font-weight: 700; cursor: help; }

.shot-detail {
  display: grid;
  gap: var(--space-3);
  align-content: start;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}
.shot-detail:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.shot-detail-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.shot-detail-title { margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
.shot-detail-nav { display: flex; align-items: center; gap: var(--space-1); }
.shot-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--control-h-sm);
  min-height: var(--control-h-sm);
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.shot-nav-btn:disabled { opacity: .45; cursor: not-allowed; }
.shot-nav-btn:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.shot-detail-grid { display: grid; gap: var(--space-1); margin: 0; }
.shot-detail-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.shot-detail-row dt { color: var(--color-text-secondary); font: var(--type-caption); }
.shot-detail-row dd { display: flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--color-text-primary); font: var(--type-body); font-variant-numeric: tabular-nums; }
.shot-detail-quality h4 { margin: 0 0 var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); }
.shot-detail-quality ul { margin: 0; padding-inline-start: var(--space-4); color: var(--color-text-secondary); font: var(--type-caption); }
.shot-detail-hint { margin: 0; color: var(--color-text-tertiary); font: var(--type-caption); }

/* medium：选中后成为推开式侧栏——列表让位（padding）不遮盖内容；
   compact：整屏面板 + 遮罩，关闭后焦点回到触发它的那一行 */
.shots-split { --shot-detail-w: min(360px, 42cqi); }

.shots-split.is-medium.has-detail .shot-list { margin-inline-end: calc(var(--shot-detail-w) + var(--space-4)); }

.shots-split.is-medium .shot-detail {
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
  width: var(--shot-detail-w);
  max-height: 100%;
  overflow-y: auto;
}

.shots-split.is-compact .shot-detail {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  align-content: start;
  padding: var(--space-4);
  border: 0;
  border-radius: 0;
  background: var(--color-surface-1);
  overflow-y: auto;
}

.shots-split.is-compact.has-detail::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: var(--z-drawer);
  background: var(--color-scrim);
}

@media (hover: hover) {
  .shot-row:not(.is-selected):hover { background: var(--color-surface-2); }
}

/* 触屏：点击区域抬到 --hit-min（44px），布局不动 */
@media (pointer: coarse) {
  .shot-row { min-height: var(--hit-min); }
  .shots-select { min-height: var(--control-h-md); }
  .shot-nav-btn { min-width: var(--hit-min); min-height: var(--hit-min); }
}
</style>
