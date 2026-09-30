<script setup>
/**
 * Agent 射击复现（?view=agent-shots）：本地 .wotbreplay → 浏览器 WASM parseShotReplays
 * （全员射击链：作者严格路径 + 他人宽松路径合并，文件不出本机）→ 逐发表格
 * （射击者筛选/命中·穿透·跳弹摘要/弹种与结果徽标/质量⚠）→ 点击行在 3D 装甲查看器
 * 世界模式复现该发（shots 数组经 sessionStorage 交接，无服务端）。
 * 数据面：api/agent-replay-facets.ts parseAgentShotsFromBytes + scene/agentData.js 交接。
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseAgentShotsFromBytes, parseAgentPlaybackFromBytes } from '../api/agent-replay-facets.js'
import { storeShotsForViewer, fetchTankData } from '../scene/agentData.js'

const { t } = useI18n()

const fileEl = ref(null)
const fileName = ref('')
const parsing = ref(false)
const err = ref('')
const shots = ref([])
const shooter = ref('all')

/**
 * 客户端富化（上游由 /api/replay/shots 服务端注入的字段，纯客户端链用 Playback
 * 花名册等价补齐——vehicles 即含 nickname/tank_id/team/is_author）：
 * - target_tank_id / shooter_tank_id：花名册 nickname → tank_id（battle_results 口径）；
 * - shooter_team：'ally' / 'enemy'（相对回放作者阵营）。
 * 名称冲突时取首个匹配（服务端 team_tank_of 同约束）。
 */
function enrichShotsFromRoster(parsedShots, vehicles) {
  const byNick = new Map()
  for (const r of vehicles || []) {
    if (r.nickname && !byNick.has(r.nickname)) byNick.set(r.nickname, r)
  }
  const authorTeam = (vehicles || []).find((r) => r.is_author)?.team
  for (const s of parsedShots) {
    const target = s.target_name ? byNick.get(s.target_name) : null
    if (target?.tank_id) s.target_tank_id = target.tank_id
    const shooterEntry = s.shooter_name ? byNick.get(s.shooter_name) : null
    if (shooterEntry?.tank_id) {
      s.shooter_tank_id = shooterEntry.tank_id
      if (authorTeam != null && shooterEntry.team != null) {
        s.shooter_team = shooterEntry.team === authorTeam ? 'ally' : 'enemy'
      }
    }
  }
}

/**
 * 弹种解析（上游 ShellKindTable.annotate 同源）：全局弹种 id → shell_type。
 * 优先查 tanks.pb 全量展开的静态反解表（shellKinds.json，dump-shell-kinds 产物，
 * 作者+他人/命中+脱靶统一覆盖——脱靶弹的 shell_id 来自开火/地形广播，属同国全域，
 * 射手自身弹链查不到）；表未命中再走射手坦克弹链兜底；仍查不到保留空 kind
 * （UI 走槽位/id 兜底，shell_id=0 的弹上游也保持未知）。
 */
async function enrichShellKinds(parsedShots) {
  let table = null
  try {
    table = (await import('../scene/shellKinds.json')).default
  } catch { /* 表缺失：退化为射手弹链反解 */ }
  const byTank = new Map()
  for (const s of parsedShots) {
    const tid = s.shooter_tank_id
    if (tid && !byTank.has(tid)) byTank.set(tid, null)
  }
  await Promise.all([...byTank.keys()].map(async (tid) => {
    try { byTank.set(tid, await fetchTankData(tid)) } catch { /* 静态面缺失：跳过弹链兜底 */ }
  }))
  for (const s of parsedShots) {
    if (!s.shell_id) continue
    if (table) {
      const kind = table[String(s.shell_id)]
      if (kind) { s.shell_kind = s.shell_kind || kind; continue }
    }
    const data = byTank.get(s.shooter_tank_id)
    if (!data) continue
    // 服务端 shell_index_by_global_id 同式：全配置弹链查找（该弹可能在非顶级变体）
    for (const cfg of data.configs || []) {
      const idx = (cfg.shell_global_ids || []).indexOf(s.shell_id)
      if (idx >= 0 && cfg.shells?.[idx]?.type) {
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

async function onFilePicked(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (!file) return
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
    let parsedShots
    try {
      parsedShots = await parseAgentShotsFromBytes(bytes, pitchLimits ?? undefined)
    } catch (e) {
      console.warn('anchored parse failed, fallback:', e)
      parsedShots = await parseAgentShotsFromBytes(bytes)
    }
    // 富化失败不阻断主表（roster 失败仅 3D 链接缺失；弹种反解失败走槽位/id 兜底）
    if (playback) {
      try { enrichShotsFromRoster(parsedShots, playback.vehicles) } catch (e) {
        console.warn('roster enrichment skipped:', e)
      }
    }
    try {
      await enrichShellKinds(parsedShots)
    } catch (e) {
      console.warn('shell kind enrichment skipped:', e)
    }
    shots.value = parsedShots
    shooter.value = 'all'
  } catch (e) {
    shots.value = []
    err.value = (t('agentShots.error_parse') || '解析失败') + ' ' + String(e?.message || e).slice(0, 200)
  } finally {
    parsing.value = false
  }
}

// 射击者筛选：我方（作者阵营）/ 敌方分组，作者置顶
const shooterGroups = computed(() => {
  const groups = { allies: [], enemies: [] }
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
    const entry = { name, n: count[name], isAuthor: !!s.is_author, ally: s.shooter_team !== 'enemy' }
    ;(entry.ally ? groups.allies : groups.enemies).push(entry)
  }
  const byN = (a, b) => (b.isAuthor ? 1 : 0) - (a.isAuthor ? 1 : 0) || b.n - a.n
  groups.allies.sort(byN)
  groups.enemies.sort((a, b) => b.n - a.n)
  return groups
})

const shooterOptions = computed(() => [...shooterGroups.value.allies, ...shooterGroups.value.enemies])

const filteredShots = computed(() => {
  if (shooter.value === 'all') return shots.value
  return shots.value.filter((s) => (s.shooter_name || `eid:${s.shooter_eid}`) === shooter.value)
})

// 汇总摘要（随筛选联动）：命中率 = 有 flags 或非作者命中的比例；穿透率 = 击穿/命中（不含跳弹）
const shotSummary = computed(() => {
  const rows = filteredShots.value
  const isHit = (s) => (s.is_author ? (s.hit_flags || 0) !== 0 : !!s.target_name)
  const total = rows.length
  const hits = rows.filter(isHit).length
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

// 弹种徽标：shell_kind → AP/APCR/HEAT/HE + premium 标记。脱靶弹（无命中通知）
// 的 shell_id 来自开火/地形广播、与弹表全局域不同——不可反解，一律显示 "—"；
// 命中弹缺 kind 时作者走槽位兜底，其余走 shell_id 小字（数据缺坦克可查时）。
function shellBadge(s) {
  const kindOf = (t) => {
    t = (t || '').toLowerCase()
    if (/^ap_cr|^apcr/.test(t)) return 'APCR'
    if (/^hc|^heat/.test(t)) return 'HEAT'
    if (/^he/.test(t)) return 'HE'
    if (/^ap/.test(t)) return 'AP'
    return ''
  }
  const label = kindOf(s.shell_kind)
  if (!label) {
    if (!s.target_name) return {}
    if (s.is_author && s.shell_slot != null) return { fallback: '#' + s.shell_slot }
    if (s.shell_id) return { fallbackSmall: 'id' + s.shell_id }
    return {}
  }
  return { label, gold: /premium/.test(s.shell_kind || '') }
}

// 结果徽标：hit_flags 位图 → 击穿/HE/跳弹/未穿/脱靶；非作者按 game_hit_result 降级
function resultBadge(s) {
  const f = s.hit_flags || 0
  if (!s.is_author && !f) {
    const r = s.game_hit_result
    if (r == null || r === 255 || r === 0) return { text: t('agentShots.res_miss'), cls: 'miss' }
    if (r === 3) return { text: t('agentShots.res_pen'), cls: 'pen' }
    if (r === 4) return { text: t('agentShots.res_track'), cls: 'track' }
    return { text: t('agentShots.res_nopen'), cls: 'nopen' }
  }
  if (!f) return { text: t('agentShots.res_miss'), cls: 'miss' }
  if (f & 0x1000) return { text: 'HE', cls: 'he-res' }
  if (f & 0x0010) return { text: t('agentShots.res_pen'), cls: 'pen' }
  if (f & 0x0008) return { text: t('agentShots.res_ric'), cls: 'ric' }
  return { text: t('agentShots.res_nopen'), cls: 'nopen' }
}

function dmgColor(s) {
  const d = s.damage || 0
  return !d ? 'var(--muted, #9aa4b2)' : d >= 1000 ? 'var(--danger, #e0665b)' : d >= 600 ? '#ffcf5c' : 'var(--fg, #dfe5ec)'
}

// 行内 3D 复现可用性：仅命中弹（有目标 = 服务器命中通知在案，弹道/命中判定/装甲
// 实测齐备）。脱靶弹不提供 3D 复现（评审裁决：其 shell_id/弹道为广播降级数据，
// 无装甲判定意义）
function rowHas3d(s) {
  return !!s.target_name
}

// 3D 查看器 URL（世界模式）：命中弹用目标车辆；脱靶弹（无 target_tank_id）用射手车辆兜底。
// shots 数组先经 sessionStorage 交接（新窗口同源可取，agentData.fetchReplayShots）。
// 弹种下标：确定性 shell_id → 射手实际搭载弹表（configs 末位）反查；查不到回退槽位/省略。
function srViewerUrl(s, shellIdx) {
  const shooterTank = s.shooter_tank_id || 0
  const tid = s.target_tank_id || shooterTank || 0
  if (!tid) return ''
  const sh = shooterTank ? '&shooter=' + shooterTank : ''
  const shIdx = shellIdx != null ? shellIdx : (s.is_author && s.shell_slot != null) ? s.shell_slot : null
  const ammo = shIdx != null ? '&shell=' + shIdx : ''
  const cfg = s.target_config_idx != null ? '&config=' + s.target_config_idx : ''
  return `/?view=agent-armor&tank=${tid}&shot=${s.index}${sh}${ammo}${cfg}&world=1&heatmap=1`
}

async function openShotInViewer(no) {
  const shot = shots.value.find((s) => s.index === no)
  if (!shot) return
  const url = srViewerUrl(shot, await resolveShellIdx(shot))
  if (!url) return
  storeShotsForViewer(shots.value)
  window.open(url, '_blank', 'width=' + Math.round(window.innerWidth * 0.85) + ',height=' + Math.round(window.innerHeight * 0.9))
}

// shell_id（全局弹种 id）→ 射手弹表下标：与上游 shell_index_by_global_id 同规则（顶级配置弹链）
async function resolveShellIdx(s) {
  if (!s.shell_id || !s.shooter_tank_id) return null
  try {
    const data = await fetchTankData(s.shooter_tank_id)
    const cfgs = data.configs || []
    const cfg = cfgs.length ? cfgs[cfgs.length - 1] : null
    const ids = cfg?.shell_global_ids || []
    const idx = ids.indexOf(s.shell_id)
    return idx >= 0 ? idx : null
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
      <label class="pick">
        <input type="file" accept=".wotbreplay" @change="onFilePicked" />
        {{ t('agentShots.pick') }}
      </label>
      <span v-if="fileName" class="fname">{{ fileName }}</span>
    </div>

    <p v-if="parsing" class="status">{{ t('agentShots.parsing') }}</p>
    <p v-else-if="err" class="status error">{{ err }}</p>

    <template v-else-if="filteredShots.length">
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
              <td class="ell">
                <b v-if="s.is_author" class="author">★{{ s.shooter_name || t('agentShots.author') }}</b>
                <span v-else>{{ s.shooter_name || ('eid:' + s.shooter_eid) }}</span>
                <span v-if="qualityTitle(s)" :title="qualityTitle(s)" class="q-warn">⚠</span>
              </td>
              <td class="num"><b :style="{ color: dmgColor(s) }">{{ s.damage || 0 }}</b></td>
              <td class="ctr">
                <span v-if="shellBadge(s).label" class="pill shell-pill" :class="{ gold: shellBadge(s).gold }">{{ shellBadge(s).label }}</span>
                <span v-else-if="shellBadge(s).fallback" class="muted">#{{ shellBadge(s).fallback }}</span>
                <span v-else-if="shellBadge(s).fallbackSmall" class="muted sid" :title="t('agentShots.shell_unknown')">{{ shellBadge(s).fallbackSmall }}</span>
                <span v-else class="muted">—</span>
              </td>
              <td class="ctr">
                <span class="pill" :class="resultBadge(s).cls">{{ resultBadge(s).text }}</span>
                <span v-if="s.is_kill" class="pill kill">KILL</span>
              </td>
              <td class="ell">{{ s.target_name || '—' }}</td>
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
    <p v-else-if="shots.length === 0 && fileName && !parsing && !err" class="status">{{ t('agentShots.no_shots') }}</p>
  </section>
</template>

<style scoped>
.agent-shots { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pick { cursor: pointer; border: 1px solid var(--line, #2a3441); padding: 5px 12px; border-radius: 6px; }
.pick input[type='file'] { display: none; }
.fname { color: var(--muted, #9aa4b2); font-size: 0.85em; }
.status.error { color: var(--danger, #e0665b); }
.muted { color: var(--muted, #9aa4b2); }
.small { font-size: 10px; }
.footnote { font-size: 0.8em; margin: 0; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.stat-box { background: var(--panel, #1a2029); border: 1px solid var(--line, #2a3441); border-radius: 8px; padding: 8px 10px; }
.stat-box .lbl { font-size: 0.72em; color: var(--muted, #9aa4b2); }
.stat-box .val { font-size: 1.15em; font-weight: 800; }
.stat-box .val.g { color: #5fbf7a; }
.stat-box .val.y { color: #ffcf5c; }
.stat-box .val.r { color: #ff6b6b; }
.stat-box .val.o { color: #ff9800; }
.stat-box .sub { font-size: 0.72em; color: var(--muted, #9aa4b2); }

/* 表格：固定布局 + 定列宽（auto 布局下中文表头/长昵称互相挤压错位）。
   薄外层负责横向滚动兜底（窄视口），行内容单行省略不换行。 */
.table-wrap { overflow-x: auto; border: 1px solid var(--line, #2a3441); border-radius: 8px; }
.shot-table { width: 100%; min-width: 760px; table-layout: fixed; border-collapse: collapse; font-size: 12px; }
.shot-table th, .shot-table td { padding: 5px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shot-table th { text-align: left; color: var(--muted, #9aa4b2); font-weight: 600; border-bottom: 1px solid var(--line, #2a3441); }
.shot-table td { border-bottom: 1px dashed var(--line, #2a3441); }
.shot-table tbody tr:hover td { background: rgba(110, 168, 254, 0.06); }
.shot-table tbody tr.link { cursor: pointer; }
.w-idx { width: 44px; } .w-time { width: 56px; } .w-dmg { width: 58px; }
.w-shell { width: 68px; } .w-res { width: 92px; } .w-3d { width: 48px; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.ctr { text-align: center; }
.ell { overflow: hidden; text-overflow: ellipsis; }
.author { color: #6ea8fe; }
/* 单符号宽：.warn 是 app-shell 设施类（display:block+padding），表格内标注点必须避开撞名 */
.q-warn { display: inline; width: 1em; color: #ff9800; cursor: help; font-size: 10px; vertical-align: baseline; }
.sid { font-size: 10px; }
.pill { border-radius: 999px; padding: 1px 8px; font-weight: 700; font-size: 10px; display: inline-block; }
.shell-pill { min-width: 40px; box-sizing: border-box; }
.pill.gold { background: rgba(255, 207, 92, 0.16); color: #ffcf5c; }
.pill.pen { background: rgba(95, 191, 122, 0.16); color: #5fbf7a; }
.pill.nopen { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
.pill.ric { background: rgba(255, 152, 0, 0.16); color: #ff9800; }
.pill.track { background: rgba(95, 168, 232, 0.16); color: #5fa8e8; }
.pill.he-res { background: rgba(255, 207, 92, 0.2); color: #ffd970; }
.pill.miss { background: rgba(154, 164, 178, 0.16); color: #9aa4b2; }
.pill.kill { background: rgba(255, 107, 107, 0.24); color: #ff8a8a; margin-left: 4px; }
.btn { border: 1px solid var(--line, #2a3441); padding: 2px 10px; border-radius: 6px; text-decoration: none; }
select, button { background: #1d242e; color: var(--fg, #dfe5ec); border: 1px solid var(--line, #2a3441); padding: 4px 10px; border-radius: 6px; }
</style>
