/**
 * 回放结果的系列赛视图模型（L2b · 审计 BZ-06）：系列赛比分 + 逐场胜负 + 场次选项。
 * 纯函数；只消费 ReplayResult，不复制状态。文案 / 本地化留给组件。
 *
 * 队伍身份来自 League 批次汇总（resp.league.teamSummaries）：teamKey 跨场稳定（多数军团标签），
 * arenaTeams 列出它在每场里对应的 `${arenaId}:${team}`。普通（非 CW）批次没有跨场队伍身份，
 * 只能给出逐场「队伍 1 / 2 胜」，不推算系列赛比分。
 */

/** 战队显示名：批次覆盖名 → 自动名（军团标签）→ null（待命名）。 */
function teamDisplayName(summary, teamNames) {
  const override = teamNames?.[summary.teamKey]
  if (override) return override
  return summary.autoName || null
}

/** `${arenaId}:${team}` → teamSummary 索引。 */
function arenaTeamIndex(teamSummaries) {
  const index = new Map()
  for (const summary of teamSummaries) {
    for (const arenaTeam of summary.arenaTeams || []) index.set(String(arenaTeam), summary)
  }
  return index
}

/**
 * @param {object|null} resp ReplayResult
 * @param {Record<string,string>} [teamNames] 批次战队名覆盖 {teamKey: name}
 * @param {Record<string,string>} [battleTeamNames] 单场战队名覆盖 {`${arenaId}:${team}`: name}
 * @returns {{
 *   teams: Array<{ key: string, name: string|null, wins: number }>|null,
 *   unresolved: number,
 *   battles: Array<{ sourceId: string, index: number, mapName: string|null, durationS: number|null,
 *     startTime: number|null, sourceName: string|null, winnerTeam: number|null, winnerKey: string|null, winnerName: string|null }>
 * }}
 */
export function buildSeriesOverview(resp, teamNames = {}, battleTeamNames = {}) {
  const battles = Array.isArray(resp?.battles) ? resp.battles : []
  const teamSummaries = resp?.leagueMode === true && Array.isArray(resp?.league?.teamSummaries)
    ? resp.league.teamSummaries
    : []
  const byArenaTeam = arenaTeamIndex(teamSummaries)

  const rows = battles.map((battle, index) => {
    const winner = battle.winnerTeam === 1 || battle.winnerTeam === 2 ? battle.winnerTeam : null
    const summary = winner && battle.arenaId != null ? byArenaTeam.get(`${battle.arenaId}:${winner}`) : null
    return {
      sourceId: String(battle.sourceId ?? ''),
      index,
      mapName: battle.mapName ?? null,
      durationS: battle.durationS ?? null,
      startTime: battle.startTime ?? null,
      sourceName: battle.sourceName ?? null,
      winnerTeam: winner,
      winnerKey: summary ? summary.teamKey : null,
      // 单场里改过的队名（{arenaId:team}）优先于批次名，与单场概览一致
      winnerName: (winner && battleTeamNames[`${battle.arenaId}:${winner}`]) || (summary ? teamDisplayName(summary, teamNames) : null),
    }
  })

  // 只有恰好两支跨场稳定的队伍时才是「系列赛」：任何一支是 arenaId:team 兜底键都说明身份不可靠。
  // 胜场按逐场结果计数（teamSummaries.wins 只覆盖可评分场次）；无法归属的场次单独计数，界面如实说明。
  const isSeries = teamSummaries.length === 2
    && teamSummaries.every(summary => String(summary.teamKey).startsWith('clan:'))
  const teams = isSeries
    ? teamSummaries
      .map(summary => ({
        key: summary.teamKey,
        name: teamDisplayName(summary, teamNames),
        wins: rows.filter(row => row.winnerKey === summary.teamKey).length,
      }))
      .sort((a, b) => b.wins - a.wins || String(a.key).localeCompare(String(b.key)))
    : null
  // 只统计「有胜方但归属不到战队」的场次；平局 / 胜负未知不算
  const unresolved = isSeries ? rows.filter(row => row.winnerTeam && !row.winnerKey).length : 0

  return { teams, unresolved, battles: rows }
}

/** 逐场胜方文案：战队名 → 队伍编号 → 未知。 */
export function battleWinnerText(battle, t) {
  if (battle.winnerName) return t('workspace.series_winner', { name: battle.winnerName })
  if (battle.winnerTeam) return t('workspace.series_team_winner', { team: battle.winnerTeam })
  return t('workspace.series_unknown_winner')
}

/**
 * 场次选择器选项（审计 BZ-09：每项显示「地图 · 胜负 · 时间」，不再只有文件名）。
 * @param {ReturnType<typeof buildSeriesOverview>} series
 * @param {{ t: Function, locale: string, mapLabel: Function, formatTime?: (epochSeconds: number) => string }} format
 */
export function battlePickerOptions(series, { t, locale, mapLabel, formatTime = defaultTimeFormatter(locale) }) {
  return series.battles.map(battle => {
    const map = battle.mapName ? mapLabel(battle.mapName, locale) : '--'
    const meta = [battleWinnerText(battle, t), battle.startTime ? formatTime(battle.startTime) : null].filter(Boolean).join(' · ')
    return {
      value: battle.sourceId,
      label: `${t('workspace.battle_n', { n: battle.index + 1 })} · ${map}`,
      meta,
      search: [battle.sourceName, battle.mapName].filter(Boolean).join(' '),
    }
  })
}

function defaultTimeFormatter(locale) {
  let format
  try {
    format = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    format = new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }
  return epochSeconds => format.format(new Date(epochSeconds * 1000))
}
