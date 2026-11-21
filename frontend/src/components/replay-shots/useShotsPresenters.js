/**
 * ReplayShotsPane —— 列表 / 汇总派生态（拆分自 ReplayShotsPane.vue，行为原样）。
 * 射手筛选、命中率/穿透率汇总、徽标与展示文案。
 */
import { computed } from 'vue'
import { shotResultBadge } from '../../utils/shotPresentation.js'
import { formatShotBattleClock } from '../../utils/playbackClock.js'
import { isShotHit } from '../../api/agent-replay-facets.js'

/** @param {{
 *  shots: import('vue').Ref<Array<object>>,
 *  authorEid: import('vue').Ref<number|null>,
 *  recorderTankName: import('vue').Ref<string>,
 *  battleStartRaw: import('vue').Ref<number>,
 *  shooter: import('vue').Ref<string>,
 *  selectedIndex: import('vue').Ref<number|null>,
 *  props: { file: unknown },
 *  t: (key: string) => string,
 * }} ctx */
export function useShotsPresenters({ shots, authorEid, recorderTankName, battleStartRaw, shooter, selectedIndex, props, t }) {
  /** 射击时刻（开战相对）：与 2D / 3D 时间轴同一时钟 */
  const shotClock = (shot) => formatShotBattleClock(shot.time_s, battleStartRaw.value)

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
  const resultBadge = (shot) => shotResultBadge(shot, t)

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
    if (q.target_dead) issues.push(t('agentShots.q_target_dead'))
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

  /** Recorder identity comes from the parse outcome/roster, never from shot count. */
  function isOwnShot(shot) {
    return authorEid.value != null ? shot.shooter_eid === authorEid.value : shot.is_author === true
  }
  function tankName(shot, role) {
    return shot[`${role}_tank_name`] || t('agentShots.unknown_tank')
  }
  function targetName(shot) {
    return shot.target_eid == null ? t('agentShots.no_target') : tankName(shot, 'target')
  }

  /** Options keep their insertion token when group counts or display metadata change. */
  const shooterOptions = computed(() => {
    const byKey = new Map()
    for (const shot of shots.value) {
      const key = shot.shooter_eid ?? `unknown-${shot.index}`
      const existing = byKey.get(key)
      if (existing) { existing.n++; continue }
      byKey.set(key, {
        key, value: `player-${byKey.size}`, name: playerName(shot.shooter_name),
        tankName: tankName(shot, 'shooter'), n: 1, isAuthor: isOwnShot(shot),
        team: shot.shooter_team,
      })
    }
    return [...byKey.values()]
  })
  const shooterGroups = computed(() => {
    const groups = { allies: [], enemies: [], unknown: [] }
    for (const option of shooterOptions.value) {
      const group = option.team === 'ally' ? 'allies' : option.team === 'enemy' ? 'enemies' : 'unknown'
      groups[group].push(option)
    }
    return groups
  })
  const selectedShooter = computed(() => shooterOptions.value.find((option) => option.value === shooter.value))
  const ownShots = computed(() => shots.value.filter(isOwnShot))
  const filteredShots = computed(() => {
    if (shooter.value === 'own') return ownShots.value
    if (shooter.value === 'all') return shots.value
    const selected = selectedShooter.value
    return selected ? shots.value.filter((shot) => (shot.shooter_eid ?? `unknown-${shot.index}`) === selected.key) : []
  })
  const scopeTitle = computed(() => {
    if (shooter.value === 'own') return t('agentShots.my_shots')
    if (shooter.value === 'all') return t('agentShots.all_shooters')
    return selectedShooter.value?.tankName || t('agentShots.shooter')
  })
  const scopeSubtitle = computed(() => {
    if (shooter.value === 'own') {
      const own = shooterOptions.value.find((option) => option.isAuthor)
      const recordedName = recorderTankName.value.trim()
      return own ? `${own.tankName} · ${own.name}`
        : recordedName && !/^#?\d+$/.test(recordedName) ? recordedName : t('agentShots.own_shots_hint')
    }
    return selectedShooter.value?.name || t('agentShots.all_shots_hint')
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
    const damage = rows.reduce((sum, s) => sum + (s.damage || 0), 0)
    return {
      total, hits, pens, damage,
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
      { key: 'damage', label: t('agentShots.recorded_damage'), value: String(s.damage) },
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

  /** 该弹的射手配件串有可显示内容（Type5 物化在案且含非空槽 id；未知 id 由徽标 fail-closed）。 */
  function hasEquipment(s) {
    return Array.isArray(s?.shooter_equipment?.raw) && s.shooter_equipment.raw.some(id => Number.isInteger(id) && id > 0)
  }

  return {
    shotClock, shellBadge, resultBadge, qualityIssues, playerName,
    isOwnShot, tankName, targetName,
    shooterOptions, shooterGroups, selectedShooter,
    ownShots, filteredShots, scopeTitle, scopeSubtitle,
    shotSummary, summaryStats, selectedShot,
    trajectoryLength, rowHas3d, hasEquipment,
  }
}
