<script setup>
/**
 * Agent 射击复现（工作台能力 pane / ?view=agent-shots）：工作台已选 .wotbreplay → 浏览器 WASM
 * parseShotReplays（全员射击链：作者严格路径 + 他人宽松路径合并，文件不出本机）→ 逐发表格
 * （射击者筛选/命中·穿透·跳弹摘要/弹种与结果徽标/质量⚠）→ 点击行在 3D 装甲查看器
 * 世界模式复现该发（shots 数组经 sessionStorage 交接，无服务端）。
 * 契约 v0.1.9：输出 {shots, author_path, others} 包装——作者严格路径失败
 * fail-visible（警示条），不再静默吞空。
 * 数据面：api/agent-replay-facets.ts parseAgentShotsFromBytes + scene/agentData.js 交接。
 * 顶层计数口径：1 row = 1 unique shotId = 一次开火；同一 shotId 下的后续事件或多次装甲交互
 * 仍属于同一个 Shot，不在消费端展开成额外”射击”。
 * 由 ReplayWorkspace 以 pane 形式挂载（props.file/active/blockedReason），不自带文件选择。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseAgentShotsFromBytes, parseAgentPlaybackFromBytes, enrichShotsFromRoster, isShotHit } from '../api/agent-replay-facets.js'
import { storeShotsForViewer, fetchTankData, tankImageUrl } from '../scene/agentData.js'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()

/**
 * 工作台能力 pane 契约（与 BattlePlaybackPanel / AgentReplay3D 同一套 props）：
 * file = 工作台已选回放（本机解析、文件不出本机）；active = 当前 pane 可见；
 * blockedReason = 工作台给出的不可用原因（如多文件未选场次）。不再自带文件选择入口
 * （设计语言 §7：全站只有 FileUploader 一个上传组件）。
 */
const props = defineProps({
  file: { type: Object, default: null },
  active: { type: Boolean, default: false },
  blockedReason: { type: String, default: '' },
})

const fileName = ref('')
const parsing = ref(false)
const err = ref('')
const shots = ref([])
const authorError = ref('')
const othersStats = ref(null)
const shooter = ref('all')

/**
 * 全局弹种反解表（dump-shell-kinds 富表：{全局弹种 id: {type, penetration,
 * damage, ...}}，与回放 shell_id 同域）。构建期常量：传给 parseAgentShotsFromBytes
 * 由 WASM 反解（作者+他人/命中+脱靶统一覆盖——脱靶弹的 shell_id 来自开火/地形
 * 广播，同国全域，射手自身弹链查不到）；产物过旧忽略第三参时由
 * enrichShellFallback 客户端补齐。
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
 * 弹种富化兜底（仅旧 WASM 产物路径：parseShotReplays 尚不支持表注入、输出无
 * shell 字段时，按同款表在客户端反解——新产物由 WASM 注入，此处零命中直通）：
 * 查表（全域，kind+穿深一次到位）→ 射手坦克弹链兜底；均查不到保留空 kind。
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
    // 服务端 resolve_shell_by_global_id 同式：全配置弹链查找（顶级偏好，从后往前）
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
 * 俯仰锚定表（上游服务端 TankResolver 同数据链的客户端等价）：
 * playback.vehicles 的昵称 → tank_id → tank/{id}.json 顶级配置 pitch_limits，
 * 换算 GunPitchRange 形状（dep=max 俯角上限、ele=−min 仰角上限，扇区透传）。
 * 注入 WASM 后 prop2 俯仰按车型极限解码——消解客户端空表下的
 * 「俯仰由弹道推算/俯仰降级」大面积降级标记。缺数据的玩家跳过（如实降级）。
 */
async function buildPitchLimits(vehicles) {
  const limits = {}
  const tankNames = new Map()   // tank_id → [昵称]
  const tankRange = new Map()   // tank_id → GunPitchRange
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
    } catch { /* 数据缺失：该坦克玩家保持空锚定（如实降级） */ }
  }))
  for (const [tid, names] of tankNames) {
    const range = tankRange.get(tid)
    if (!range) continue
    for (const nick of names) limits[nick] = range
  }
  return limits
}

async function parseFile(file) {
  if (!file) return
  if (props.blockedReason) return
  const seq = ++parseSeq
  fileName.value = file.name
  parsing.value = true
  err.value = ''
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    // 时序：先解析 playback（轻）构建俯仰锚定表，shots 只做一次重解析。
    // 锚定注入失败（产物过旧等）→ 裸解析兜底（俯仰降级标记如实透传）。
    let playback = null
    let pitchLimits = null
    try {
      playback = await parseAgentPlaybackFromBytes(bytes)
      pitchLimits = await buildPitchLimits(playback.vehicles)
    } catch (e) {
      console.warn('pitch limits skipped:', e)
    }
    const shellTable = await loadShellTable().catch(() => undefined)
    let outcome
    try {
      outcome = await parseAgentShotsFromBytes(bytes, pitchLimits ?? undefined, shellTable)
    } catch (e) {
      console.warn('anchored parse failed, fallback:', e)
      outcome = await parseAgentShotsFromBytes(bytes)
    }
    // 作者严格路径 fail-visible（契约 v0.1.9）：失败不再静默，警示条 + 他人宽松全量
    authorError.value = outcome.author_error || ''
    othersStats.value = outcome.others || null
    const parsedShots = outcome.shots
    // 富化失败不阻断主表（roster 失败仅 3D 链接缺失；弹种反解失败走槽位/id 兜底）
    if (playback) {
      try { enrichShotsFromRoster(parsedShots, playback.vehicles) } catch (e) {
        console.warn('roster enrichment skipped:', e)
      }
    }
    // 弹种兜底：旧产物（parseShotReplays 不支持表注入，输出无 shell 字段）客户端补齐；
    // 新产物 WASM 已注入，此处零命中直通
    if (shellTable) {
      try {
        if (parsedShots.some((s) => s.shell_id && !s.shell)) {
          await enrichShellFallback(parsedShots, shellTable)
        }
      } catch (e) {
        console.warn('shell enrichment skipped:', e)
      }
    }
    if (seq !== parseSeq) return   // 清空 / 换文件后迟到的解析结果一律丢弃
    shots.value = parsedShots
    shooter.value = 'all'
  } catch (e) {
    if (seq !== parseSeq) return
    shots.value = []
    authorError.value = ''
    othersStats.value = null
    err.value = (t('agentShots.error_parse') || '解析失败') + ' ' + String(e?.message || e).slice(0, 200)
  } finally {
    if (seq === parseSeq) parsing.value = false
  }
}

/** 工作台撤下回放（清空选择 / 多文件未选场次）：回到等待态，清掉上一发的表格与筛选。 */
function resetToEmpty() {
  parseSeq++   // 在途解析作废（迟到的结果不得再上屏）
  lastParsedFile = null
  shots.value = []
  fileName.value = ''
  parsing.value = false
  err.value = ''
  authorError.value = ''
  othersStats.value = null
  shooter.value = 'all'
}

// 工作台已选回放 → 本 pane 自动解析；撤下回放 → 复位到等待态（多文件未选场次时同理）。
// 首进时 props.file 已就位：immediate 直接吃初始值（本组件不需要等挂载）。
let lastParsedFile = null
let parseSeq = 0
watch([() => props.file, () => props.blockedReason], ([file, blocked]) => {
  if (blocked || !file) {
    if (lastParsedFile) resetToEmpty()
    return
  }
  if (file === lastParsedFile) return
  lastParsedFile = file
  parseFile(file)
}, { immediate: true })

// 射击者筛选：显式三态 ally / enemy / unknown——undefined（阵营未知，含
// team=0 与未联上花名册）绝不并入 Allies（旧 `!== 'enemy'` 是 roster team hack
// 的同族 bug）；作者置顶，其余按发数
const shooterGroups = computed(() => {
  const groups = { allies: [], enemies: [], unknown: [] }
  const count = {}
  for (const s of shots.value) {
    const name = s.shooter_name || `eid:${s.shooter_eid}`
    count[name] = (count[name] || 0) + 1
  }
  const seen = new Set()
  for (const s of shots.value) {
    const name = s.shooter_name || `eid:${s.shooter_eid}`
    if (seen.has(name)) continue
    seen.add(name)
    const entry = { name, n: count[name], isAuthor: !!s.is_author }
    if (s.shooter_team === 'ally') groups.allies.push(entry)
    else if (s.shooter_team === 'enemy') groups.enemies.push(entry)
    else groups.unknown.push(entry)
  }
  const byN = (a, b) => (b.isAuthor ? 1 : 0) - (a.isAuthor ? 1 : 0) || b.n - a.n
  groups.allies.sort(byN)
  groups.enemies.sort((a, b) => b.n - a.n)
  groups.unknown.sort((a, b) => b.n - a.n)
  return groups
})

const shooterOptions = computed(() => [...shooterGroups.value.allies, ...shooterGroups.value.enemies, ...shooterGroups.value.unknown])

const filteredShots = computed(() => {
  if (shooter.value === 'all') return shots.value
  return shots.value.filter((s) => (s.shooter_name || `eid:${s.shooter_eid}`) === shooter.value)
})

// 汇总摘要（随筛选联动）：total 按上游顶层 Shot 行计（unique shotId / 一次开火），
// 绝不按 method29/type32 的 interaction 数膨胀；命中率 = 命中/开火，穿透率 = 击穿/命中。
const shotSummary = computed(() => {
  const rows = filteredShots.value
  // 命中判定唯一权威 = target_eid 在案（isShotHit；作者与非作者同规则）
  const total = rows.length
  const hits = rows.filter(isShotHit).length
  const pens = rows.filter((s) => (s.is_author ? s.hit_flags & 0x0010 : s.game_hit_result === 3)).length
  const rics = rows.filter((s) => (s.is_author ? s.hit_flags & 0x0008 : false)).length
  const heHits = rows.filter((s) => s.is_author && s.hit_flags & 0x1000).length
  const kills = rows.filter((s) => s.is_kill).length
  const dmgTotal = rows.reduce((a, s) => a + (s.damage || 0), 0)
  return {
    total, hits, pens, rics, heHits, kills, dmgTotal,
    hitRate: total ? 100 * hits / total : 0,
    penRate: hits ? 100 * pens / hits : 0,
  }
})

function wrCls(p) { return p >= 60 ? 'g' : p >= 45 ? 'y' : 'r' }

// 数据质量徽章：ShotQuality 降级/陈旧项汇总（⚠ 悬停显示详情）——与上游 ReplayView 同规则
function qualityTitle(s) {
  const q = s.quality
  if (!q) return ''
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
  return issues.join('; ')
}

// 弹种徽标：shell_kind（表注入反解，全域覆盖命中+脱靶）→ AP/APCR/HEAT/HE +
// premium 标记 + 穿深（注入 shell 数据，射手配置弹表口径）。缺 kind 时作者走
// 槽位兜底，其余走 shell_id 小字（shell_id=0 的弹上游也保持未知）。
function shellBadge(s) {
  const kindOf = (t) => {
    t = (t || '').toLowerCase()
    if (/^ap_cr|^apcr/.test(t)) return 'APCR'
    if (/^hc|^heat/.test(t)) return 'HEAT'
    if (/^he/.test(t)) return 'HE'
    if (/^ap/.test(t)) return 'AP'
    return ''
  }
  const t = s.shell_kind || (s.shell && s.shell.type) || ''
  const label = kindOf(t)
  if (!label) {
    if (s.target_eid == null) return {}
    if (s.is_author && s.shell_slot != null) return { fallback: '#' + s.shell_slot }
    if (s.shell_id) return { fallbackSmall: 'id' + s.shell_id }
    return {}
  }
  return {
    label,
    gold: /premium/.test(t),
    pen: s.shell && s.shell.penetration ? Math.round(s.shell.penetration) + 'mm' : null,
  }
}

// 结果徽标：hit_flags 位图 → 击穿/HE/跳弹/未穿/脱靶；无位图时按 game_hit_result
// 降级——但 hit 权威 = target_eid（isShotHit）：eid 在案而无位图（method38 位图
// 为空的边界）绝不显示 miss（与摘要统计同权威，不自相矛盾）
function resultBadge(s) {
  const f = s.hit_flags || 0
  if (!f) {
    if (s.target_eid == null) return { text: t('agentShots.res_miss'), cls: 'miss' }
    const r = s.game_hit_result
    if (r === 3) return { text: t('agentShots.res_pen'), cls: 'pen' }
    if (r === 4) return { text: t('agentShots.res_track'), cls: 'track' }
    // eid 在案 = 命中已知；r 未知（255/0/缺）只能证明"结果未知"，不得伪装成未击穿
    // （qualityTitle 已把 255 标 q_result_unknown，两处状态语义对齐）
    if (r == null || r === 255 || r === 0) return { text: t('agentShots.res_hit_unknown'), cls: 'unknown' }
    return { text: t('agentShots.res_nopen'), cls: 'nopen' }
  }
  if (f & 0x1000) return { text: 'HE', cls: 'he-res' }
  if (f & 0x0010) return { text: t('agentShots.res_pen'), cls: 'pen' }
  if (f & 0x0008) return { text: t('agentShots.res_ric'), cls: 'ric' }
  return { text: t('agentShots.res_nopen'), cls: 'nopen' }
}

function dmgColor(s) {
  const d = s.damage || 0
  // canonical token（两档成对）：伤害分级着色在高对比/低对比档都可读
  return !d ? 'var(--text-muted)' : d >= 1000 ? 'var(--status-err-fg)' : d >= 600 ? 'var(--status-warn-fg)' : 'var(--text)'
}

// 行内 3D 复现可用性：仅命中弹（有目标 = 服务器命中通知在案，弹道/命中判定/装甲
// 实测齐备）。脱靶弹不提供 3D 复现（评审裁决：其 shell_id/弹道为广播降级数据，
// 无装甲判定意义）。判定按 target_eid（身份域），名字仅显示
function rowHas3d(s) {
  return s.target_eid != null
}

// 3D 查看器 URL（世界模式）：命中弹用目标车辆；脱靶弹（无 target_tank_id）用射手车辆兜底。
// shots 数组先经 sessionStorage 交接（新窗口同源可取，agentData.fetchReplayShots）。
// 弹种下标：确定性 shell_id → 射手弹表全配置反查（顶级偏好），连同所属配置
// scfg 一起传（3D 端下拉弹表按 scfg 选定，下标同域——多炮坦克不再错挂 stock 表）。
function srViewerUrl(s, shellHit) {
  const shooterTank = s.shooter_tank_id || 0
  const tid = s.target_tank_id || shooterTank || 0
  if (!tid) return ''
  const sh = shooterTank ? '&shooter=' + shooterTank : ''
  const hit = shellHit || null
  const shIdx = hit ? hit.idx : (s.is_author && s.shell_slot != null) ? s.shell_slot : null
  const ammo = shIdx != null ? '&shell=' + shIdx : ''
  const scfg = hit && hit.cfg != null ? '&scfg=' + hit.cfg : ''
  const cfg = s.target_config_idx != null ? '&config=' + s.target_config_idx : ''
  return `/?view=agent-armor&tank=${tid}&shot=${s.index}${sh}${ammo}${cfg}${scfg}&world=1&heatmap=1`
}

async function openShotInViewer(no) {
  const shot = shots.value.find((s) => s.index === no)
  if (!shot) return
  const url = srViewerUrl(shot, await resolveShellIdx(shot))
  if (!url) return
  storeShotsForViewer(shots.value)
  // 审计 3D-09：不再 window.open 弹小窗（被拦截时静默无反应、WebView 行为不可控、没有返回路径），
  // 在当前标签页打开装甲查看器，返回走浏览器历史
  router.push(url)
}

// shell_id（全局弹种 id）→ 射手弹表 (配置下标, 弹下标)：与上游
// resolve_shell_by_global_id 同式（全配置弹链查找，顶级偏好从后往前——
// 该弹可能在非顶级变体，仅扫顶级会漏）
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
</script>

<template>
  <section class="agent-shots">
    <h2>{{ t('agentShots.title') }}</h2>
    <p class="hint">{{ t('agentShots.hint') }}</p>

    <div class="controls">
      <!-- 文件来自工作台上传区（全站唯一上传入口）；这里只显示当前文件与状态 -->
      <span v-if="fileName" class="fname">{{ fileName }}</span>
      <span v-else class="status" data-test="shots-source-hint">{{ blockedReason || t('workspace.playback_empty') }}</span>
    </div>

    <p v-if="parsing" class="status">{{ t('agentShots.parsing') }}</p>
    <p v-else-if="err" class="status error">{{ err }}</p>

    <template v-else>
      <!-- 作者严格路径 fail-visible（契约 v0.1.9 核心目标）：独立于 table/no-shots
           状态链——author_path=error 且他人宽松路径 0 发时，警示与空态并存，
           绝不允许只显示"没有射击"把作者链失败伪装成正常空结果 -->
      <p v-if="authorError" class="status warn" :title="authorError">
        ⚠ {{ t('agentShots.author_path_error') }}<span class="muted sid"> — {{ authorError.slice(0, 160) }}</span>
      </p>

      <template v-if="filteredShots.length">
      <div v-if="shooterOptions.length > 1" class="controls">
        <span class="muted">{{ t('agentShots.shooter') }}</span>
        <select v-model="shooter">
          <option value="all">{{ t('agentShots.all_shooters') }} ({{ shots.length }})</option>
          <optgroup v-if="shooterGroups.allies.length" :label="t('agentShots.allies')">
            <option v-for="o in shooterGroups.allies" :key="o.name" :value="o.name">{{ o.name }} ({{ o.n }})</option>
          </optgroup>
          <optgroup v-if="shooterGroups.enemies.length" :label="t('agentShots.enemies')">
            <option v-for="o in shooterGroups.enemies" :key="o.name" :value="o.name">{{ o.name }} ({{ o.n }})</option>
          </optgroup>
          <optgroup v-if="shooterGroups.unknown.length" :label="t('agentShots.unknown_side')">
            <option v-for="o in shooterGroups.unknown" :key="o.name" :value="o.name">{{ o.name }} ({{ o.n }})</option>
          </optgroup>
        </select>
      </div>

      <div class="stat-grid">
        <div class="stat-box"><div class="lbl">{{ t('agentShots.stat_shots') }}</div><div class="val">{{ shotSummary.total }}</div></div>
        <div class="stat-box"><div class="lbl">{{ t('agentShots.stat_hit') }}</div><div class="val" :class="wrCls(shotSummary.hitRate)">{{ shotSummary.hitRate.toFixed(0) }}%</div><div class="sub">{{ shotSummary.hits }}/{{ shotSummary.total }}</div></div>
        <div class="stat-box"><div class="lbl">{{ t('agentShots.stat_pen') }}</div><div class="val o">{{ shotSummary.penRate.toFixed(0) }}%</div><div class="sub">{{ shotSummary.pens }}/{{ shotSummary.hits }}</div></div>
        <div class="stat-box"><div class="lbl">{{ t('agentShots.stat_dmg') }}</div><div class="val b">{{ shotSummary.dmgTotal }}</div></div>
        <div class="stat-box"><div class="lbl">{{ t('agentShots.stat_ric_he') }}</div><div class="val">{{ shotSummary.rics }} / {{ shotSummary.heHits }}</div></div>
        <div class="stat-box"><div class="lbl">{{ t('agentShots.stat_kills') }}</div><div class="val r">{{ shotSummary.kills }}</div></div>
      </div>

      <div class="table-wrap">
        <table class="shot-table">
          <colgroup>
            <col class="w-idx"><col class="w-time"><col><col class="w-dmg"><col class="w-shell"><col class="w-res"><col class="w-target"><col class="w-3d">
          </colgroup>
          <thead>
            <tr>
              <th class="num">#</th><th>{{ t('agentShots.col_time') }}</th><th>{{ t('agentShots.col_shooter') }}</th>
              <th class="num">{{ t('agentShots.col_dmg') }}</th><th class="ctr">{{ t('agentShots.col_shell') }}</th>
              <th class="ctr">{{ t('agentShots.col_result') }}</th><th>{{ t('agentShots.col_target') }}</th><th class="ctr"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in filteredShots" :key="s.index" :class="{ link: rowHas3d(s) && srViewerUrl(s) }" @click="rowHas3d(s) && openShotInViewer(s.index)">
              <td class="num muted">#{{ s.index }}</td>
              <td class="num">{{ s.time_s.toFixed(1) }}</td>
              <td class="ell" :title="s.shooter_name || (s.shooter_eid ? 'eid:' + s.shooter_eid : '')">
                <b v-if="s.is_author" class="author">★{{ s.shooter_name || t('agentShots.author') }}</b>
                <span v-else>{{ s.shooter_name || ('eid:' + s.shooter_eid) }}</span>
                <span v-if="qualityTitle(s)" :title="qualityTitle(s)" class="q-warn">⚠</span>
              </td>
              <td class="num"><b :style="{ color: dmgColor(s) }">{{ s.damage || 0 }}</b></td>
              <td class="ctr">
                <template v-if="shellBadge(s).label">
                  <span class="pill shell-pill" :class="{ gold: shellBadge(s).gold }">{{ shellBadge(s).label }}</span>
                  <span v-if="shellBadge(s).pen" class="muted sid">{{ shellBadge(s).pen }}</span>
                </template>
                <span v-else-if="shellBadge(s).fallback" class="muted">#{{ shellBadge(s).fallback }}</span>
                <span v-else-if="shellBadge(s).fallbackSmall" class="muted sid" :title="t('agentShots.shell_unknown')">{{ shellBadge(s).fallbackSmall }}</span>
                <span v-else class="muted">—</span>
              </td>
              <td class="ctr">
                <span class="pill" :class="resultBadge(s).cls">{{ resultBadge(s).text }}</span>
                <span v-if="s.is_kill" class="pill kill">KILL</span>
              </td>
              <td class="ell" :title="s.target_name || ''">
                <img v-if="s.target_tank_id" class="ticon" loading="lazy"
                     :src="tankImageUrl(s.target_tank_id)" alt="">
                <span>{{ s.target_name || (s.target_eid != null ? 'eid:' + s.target_eid : '—') }}</span>
              </td>
              <td class="ctr" @click.stop>
                <a v-if="rowHas3d(s) && srViewerUrl(s)" class="btn" :href="srViewerUrl(s)" @click.prevent="openShotInViewer(s.index)">3D</a>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted footnote">{{ t('agentShots.footnote') }}</p>
      </template>
      <p v-else-if="shots.length === 0 && fileName" class="status">{{ t('agentShots.no_shots') }}</p>
    </template>
  </section>
</template>

<style scoped>
/* 配色一律走 canonical token（tokens.css / classic-profile.css 两档均有定义）——
   此前用 --fg/--panel/--line/--muted/--danger 这套名字在本仓**从未定义**，var() 的
   深色 fallback 恒生效，等于写死深色：浅色档下 --muted 的 #9aa4b2 落在白底上对比度
   仅 ~2.5:1（"文字发淡"），面板/按钮/边框则是突兀深色块。
   语义色用 --status-*-fg / --accent（同样两档成对），tint 用 color-mix 自适应主题。 */
.agent-shots { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fname { color: var(--text-muted); font-size: 0.85em; }
.status.error { color: var(--status-err-fg); }
.status.warn { color: var(--status-warn-fg); border: 1px solid color-mix(in srgb, var(--status-warn-fg) 35%, transparent); border-radius: 6px; padding: 6px 10px; }
.ticon { width: 36px; height: 25px; object-fit: contain; vertical-align: middle; margin-right: 6px; }
.muted { color: var(--text-muted); }
.small { font-size: 10px; }
.footnote { font-size: 0.8em; margin: 0; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.stat-box { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.stat-box .lbl { font-size: 0.72em; color: var(--text-muted); }
.stat-box .val { font-size: 1.15em; font-weight: 800; }
.stat-box .val.g { color: var(--status-ok-fg); }
.stat-box .val.y { color: var(--status-warn-fg); }
.stat-box .val.r { color: var(--status-err-fg); }
.stat-box .val.o { color: var(--accent); }
.stat-box .sub { font-size: 0.72em; color: var(--text-muted); }

/* 表格：固定布局 + 定列宽（auto 布局下中文表头/长昵称互相挤压错位）。
   薄外层负责横向滚动兜底（窄视口），行内容单行省略不换行。 */
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
.shot-table { width: 100%; min-width: 760px; table-layout: fixed; border-collapse: collapse; font-size: 12px; }
.shot-table th, .shot-table td { padding: 5px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shot-table th { text-align: left; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); }
.shot-table td { border-bottom: 1px dashed var(--border); }
.shot-table tbody tr:hover td { background: var(--bg-list-hover); }
.shot-table tbody tr.link { cursor: pointer; }
.w-idx { width: 44px; } .w-time { width: 56px; } .w-dmg { width: 58px; }
.w-shell { width: 104px; } .w-res { width: 92px; }
/* 「3D」按钮 ≈ 36px 宽 + 单元格左右各 8px padding = 52px；48px 会把它裁掉（审计 3D-25） */
.w-3d { width: 56px; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.ctr { text-align: center; }
.ell { overflow: hidden; text-overflow: ellipsis; }
.author { color: var(--status-info-fg); }
/* 单符号宽：.warn 是 app-shell 设施类（display:block+padding），表格内标注点必须避开撞名 */
.q-warn { display: inline; width: 1em; color: var(--status-warn-fg); cursor: help; font-size: 10px; vertical-align: baseline; }
.sid { font-size: 10px; }
.pill { border-radius: 999px; padding: 1px 8px; font-weight: 700; font-size: 10px; display: inline-block; }
.shell-pill { min-width: 40px; box-sizing: border-box; }
/* 徽标 tint = 同 token 的 color-mix（浅/深档自动跟随，不再写死深色 rgba） */
.pill.gold { background: color-mix(in srgb, var(--status-warn-fg) 18%, transparent); color: var(--status-warn-fg); }
.pill.pen { background: color-mix(in srgb, var(--status-ok-fg) 18%, transparent); color: var(--status-ok-fg); }
.pill.nopen { background: color-mix(in srgb, var(--status-err-fg) 16%, transparent); color: var(--status-err-fg); }
.pill.ric { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
.pill.track { background: color-mix(in srgb, var(--status-info-fg) 18%, transparent); color: var(--status-info-fg); }
.pill.he-res { background: color-mix(in srgb, var(--status-warn-fg) 22%, transparent); color: var(--status-warn-fg); }
.pill.miss { background: color-mix(in srgb, var(--text-muted) 16%, transparent); color: var(--text-muted); }
.pill.unknown { background: color-mix(in srgb, var(--status-warn-fg) 16%, transparent); color: var(--status-warn-fg); }
.pill.kill { background: color-mix(in srgb, var(--status-err-fg) 24%, transparent); color: var(--status-err-fg); margin-left: 4px; }
.btn { border: 1px solid var(--border); padding: 2px 10px; border-radius: 6px; text-decoration: none; }
select, button { background: var(--bg-card); color: var(--text); border: 1px solid var(--border); padding: 4px 10px; border-radius: 6px; }
</style>
