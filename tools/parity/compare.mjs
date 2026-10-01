// 迁移期一次性对比工具：逐字段对比 Java ReplayParser（java.json）与上游 Rust Core parseResult（wasm.json）。
// 字段映射即「服务端 Battle 模型 ← WASM BattleSummary」的迁移契约草案；差异就是要向上游补的清单。
import { readFileSync } from 'node:fs'

const [javaPath, wasmPath] = process.argv.slice(2)
const java = JSON.parse(readFileSync(javaPath, 'utf8'))
const wasm = JSON.parse(readFileSync(wasmPath, 'utf8'))

/** [Java 字段, WASM 取值函数] */
const BATTLE = [
  ['arenaId', (w) => w.arena_id],
  ['arenaBonusType', (w) => w.arena_bonus_type],
  ['winnerTeam', (w) => w.winner_team],
  ['version', (w) => w.client_version],
  ['clientVersion', (w) => w.client_version],
  ['mapName', (w) => w.map_key],
  ['durationS', (w) => w.result_duration_secs],
  ['startTime', (w) => w.timestamp],
  ['settlementStartTime', (w) => w.timestamp],
  ['settlementFinishReasonRaw', (w) => w.finish_reason],
  ['settlementDurationSec', (w) => w.result_duration_secs],
  ['recorder', (w) => w.author_nickname],
  ['nPlayers', (w) => w.players?.length, (j) => j.players?.length],
]
const PLAYER = [
  ['team', (p) => p.team],
  ['tankId', (p) => p.tank_id],
  ['nickname', (p) => p.nickname],
  ['clan', (p) => p.clan_tag ?? ''],
  ['prebattleGroupId', (p) => p.platoon_id],
  ['nShots', (p) => p.n_shots],
  ['nHitsDealt', (p) => p.n_hits_dealt],
  ['nPenetrationsDealt', (p) => p.n_penetrations_dealt],
  ['damageDealt', (p) => p.damage_dealt],
  ['damageAssisted', (p) => (p.damage_assisted_1 ?? 0) + (p.damage_assisted_2 ?? 0)],
  ['damageReceived', (p) => p.damage_received],
  ['nHitsReceived', (p) => p.n_hits_received],
  ['nPenetrationsReceived', (p) => p.n_penetrations_received],
  ['nEnemiesDamaged', (p) => p.n_enemies_damaged],
  ['kills', (p) => p.n_enemies_destroyed],
  ['damageBlocked', (p) => p.damage_blocked],
  // 非争霸模式 WASM 为 null（未出现），Java 按 0：消费端映射 null → 0
  ['victoryPointsEarned', (p) => p.victory_points_earned ?? 0],
  ['victoryPointsSeized', (p) => p.victory_points_seized ?? 0],
  ['survived', (p) => p.survived],
  ['killerAccountId', (p) => p.killer_account_id],
  ['xp', (p) => p.xp],
  ['credits', (p) => p.credits],
  ['rank', (p) => p.rank],
  ['settlementLifeTimeSec', (p) => p.life_time_secs],
  ['settlementKillerResultEntityId', (p) => p.killer_id],
]

const stats = new Map()
const note = (key, ok, sample) => {
  const s = stats.get(key) || { ok: 0, bad: 0, samples: [] }
  ok ? s.ok++ : s.bad++
  if (!ok && s.samples.length < 3) s.samples.push(sample)
  stats.set(key, s)
}
const same = (a, b) => a === b || (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6)

for (const file of Object.keys(java)) {
  const j = java[file], w = wasm[file]
  if (!w || j.error || w.error) { note('(parse)', false, `${file}: java=${j.error || 'ok'} wasm=${w?.error || 'missing'}`); continue }
  for (const [key, wf, jf] of BATTLE) {
    const a = jf ? jf(j) : j[key], b = wf(w)
    note(`battle.${key}`, same(a, b), `${a} vs ${b}`)
  }
  const wById = new Map((w.players || []).map((p) => [String(p.account_id), p]))
  for (const jp of j.players || []) {
    const wp = wById.get(String(jp.accountId))
    if (!wp) { note('player.(missing in wasm)', false, `${file}#${jp.accountId}`); continue }
    for (const [key, wf] of PLAYER) {
      const a = jp[key], b = wf(wp)
      note(`player.${key}`, same(a, b), `${jp.nickname}: ${a} vs ${b}`)
    }
  }
}

const rows = [...stats].sort((x, y) => y[1].bad - x[1].bad)
for (const [key, s] of rows) {
  const flag = s.bad === 0 ? 'OK  ' : 'DIFF'
  console.log(`${flag} ${key.padEnd(40)} ${s.ok}/${s.ok + s.bad}${s.bad ? '  e.g. ' + s.samples.join(' | ') : ''}`)
}
