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
import { parseAgentShotsFromBytes, parseAgentFacetsFromBytes } from '../api/agent-replay-facets.js'
import { storeShotsForViewer, fetchTankData } from '../scene/agentData.js'

const { t } = useI18n()

const fileEl = ref(null)
const fileName = ref('')
const parsing = ref(false)
const err = ref('')
const shots = ref([])
const shooter = ref('all')

/**
 * 客户端富化（上游由 /api/replay/shots 服务端注入的字段，纯客户端链用切面花名册等价补齐）：
 * - target_tank_id / shooter_tank_id：花名册 nickname → tank_id（battle_results 口径）；
 * - shooter_team：'ally' / 'enemy'（相对回放作者阵营）。
 * 名称冲突时取首个匹配（服务端 team_tank_of 同约束）。
 */
function enrichShotsFromRoster(parsedShots, roster) {
  const byNick = new Map()
  for (const r of roster || []) {
    if (r.nickname && !byNick.has(r.nickname)) byNick.set(r.nickname, r)
  }
  const authorTeam = (roster || []).find((r) => r.is_author)?.team
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

async function onFilePicked(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (!file) return
  fileName.value = file.name
  parsing.value = true
  err.value = ''
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const parsedShots = await parseAgentShotsFromBytes(bytes)
    // 花名册富化失败不阻断主表（仅 3D 链接缺失）
    try {
      const facets = await parseAgentFacetsFromBytes(bytes)
      enrichShotsFromRoster(parsedShots, facets.ai.rosters)
    } catch (e) {
      console.warn('roster enrichment skipped:', e)
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

// 弹种徽标：shell_kind → AP/APCR/HEAT/HE + premium 标记；缺 kind 时槽位/id 兜底
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

// 行内 3D 复现可用性：命中弹必有弹道；脱靶弹也可复现（ball_a→ball_b 弹道 + terrain_impact 落点）
function rowHas3d(s) {
  const miss = !s.target_name
  return !miss || (Array.isArray(s.ball_b) && (s.ball_b[0] || s.ball_b[1] || s.ball_b[2]))
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

      <table class="shot-table">
        <thead>
          <tr>
            <th>#</th><th>{{ t('agentShots.col_time') }}</th><th>{{ t('agentShots.col_shooter') }}</th>
            <th>{{ t('agentShots.col_dmg') }}</th><th>{{ t('agentShots.col_shell') }}</th>
            <th>{{ t('agentShots.col_result') }}</th><th>{{ t('agentShots.col_target') }}</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filteredShots" :key="s.index" :style="rowHas3d(s) ? 'cursor:pointer;' : ''" @click="rowHas3d(s) && openShotInViewer(s.index)">
            <td>#{{ s.index }}</td>
            <td>{{ s.time_s.toFixed(1) }}s</td>
            <td>
              <b v-if="s.is_author" class="author">★{{ s.shooter_name || t('agentShots.author') }}</b>
              <span v-else>{{ s.shooter_name || ('eid:' + s.shooter_eid) }}</span>
              <span v-if="qualityTitle(s)" :title="qualityTitle(s)" class="warn">⚠</span>
            </td>
            <td><b :style="{ color: dmgColor(s) }">{{ s.damage || 0 }}</b></td>
            <td>
              <template v-if="shellBadge(s).fallback"><span class="muted">{{ shellBadge(s).fallback }}</span></template>
              <template v-else-if="shellBadge(s).fallbackSmall"><span class="muted small">{{ shellBadge(s).fallbackSmall }}</span></template>
              <template v-else>
                <span class="pill" :class="{ gold: shellBadge(s).gold }">{{ shellBadge(s).label }}</span>
              </template>
            </td>
            <td>
              <span class="pill" :class="resultBadge(s).cls">{{ resultBadge(s).text }}</span>
              <span v-if="s.is_kill" class="pill kill">KILL</span>
            </td>
            <td>
              <span v-if="!s.target_name" class="muted">—</span>
              <template v-else>{{ s.target_name }}</template>
            </td>
            <td @click.stop>
              <a v-if="rowHas3d(s) && srViewerUrl(s)" class="btn" :href="srViewerUrl(s)" @click.prevent="openShotInViewer(s.index)">3D</a>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
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
.footnote { font-size: 0.8em; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.stat-box { background: var(--panel, #1a2029); border: 1px solid var(--line, #2a3441); border-radius: 8px; padding: 8px 10px; }
.stat-box .lbl { font-size: 0.72em; color: var(--muted, #9aa4b2); }
.stat-box .val { font-size: 1.15em; font-weight: 800; }
.stat-box .val.g { color: #5fbf7a; }
.stat-box .val.y { color: #ffcf5c; }
.stat-box .val.r { color: #ff6b6b; }
.stat-box .val.o { color: #ff9800; }
.stat-box .sub { font-size: 0.72em; color: var(--muted, #9aa4b2); }
.shot-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
.shot-table th { text-align: left; color: var(--muted, #9aa4b2); font-weight: 600; padding: 4px 6px; border-bottom: 1px solid var(--line, #2a3441); }
.shot-table td { padding: 4px 6px; border-bottom: 1px dashed var(--line, #2a3441); }
.shot-table tr:hover td { background: rgba(110, 168, 254, 0.06); }
.author { color: #6ea8fe; }
.warn { color: #ff9800; cursor: help; font-size: 10px; }
.pill { border-radius: 999px; padding: 1px 8px; font-weight: 700; font-size: 10px; }
.pill.gold { background: rgba(255, 207, 92, 0.16); color: #ffcf5c; }
.pill.pen { background: rgba(95, 191, 122, 0.16); color: #5fbf7a; }
.pill.nopen { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
.pill.ric { background: rgba(255, 152, 0, 0.16); color: #ff9800; }
.pill.track { background: rgba(95, 168, 232, 0.16); color: #5fa8e8; }
.pill.he-res { background: rgba(255, 207, 92, 0.2); color: #ffd970; }
.pill.miss { background: rgba(154, 164, 178, 0.16); color: #9aa4b2; }
.pill.kill { background: rgba(255, 107, 107, 0.24); color: #ff8a8a; }
.btn { border: 1px solid var(--line, #2a3441); padding: 2px 10px; border-radius: 6px; text-decoration: none; }
select, button { background: #1d242e; color: var(--fg, #dfe5ec); border: 1px solid var(--line, #2a3441); padding: 4px 10px; border-radius: 6px; }
</style>
