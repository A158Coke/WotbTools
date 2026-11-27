import { displayName, fileKey } from './helpers.js'

type TeamSummary = { teamKey: string; autoName?: string | null; arenaTeams?: unknown[] | null }
type TeamNames = Record<string, string>
type SeriesBattle = {
  sourceId?: unknown
  winnerTeam?: number | null
  arenaId?: unknown
  mapName?: string | null
  durationS?: number | null
  startTime?: number | null
  sourceName?: string | null
  draw?: boolean | null
}
type SeriesResult = {
  battles?: SeriesBattle[] | null
  leagueMode?: boolean | null
  league?: { teamSummaries?: TeamSummary[] | null; failures?: Array<{ fileName: string }> | null } | null
  failures?: unknown[][] | null
  duplicates?: unknown[][] | null
}
type Translate = (key: string, params?: Record<string, unknown>) => string
type BattleOption = { value: string; label: string; meta: string; search: string }

function teamDisplayName(summary: TeamSummary, teamNames: TeamNames | null | undefined) {
  const override = teamNames?.[summary.teamKey]
  if (override) return override
  return summary.autoName || null
}

function arenaTeamIndex(teamSummaries: TeamSummary[]) {
  const index = new Map<string, TeamSummary>()
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
 *     startTime: number|null, sourceName: string|null, winnerTeam: number|null, draw: boolean, winnerKey: string|null, winnerName: string|null }>
 * }}
 */
export function buildSeriesOverview(
  resp: SeriesResult | null | undefined,
  teamNames: TeamNames = {},
  battleTeamNames: TeamNames = {},
) {
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
      draw: !winner && battle.draw === true,
      winnerKey: summary ? summary.teamKey : null,
      winnerName: (winner && battleTeamNames[`${battle.arenaId}:${winner}`]) || (summary ? teamDisplayName(summary, teamNames) : null),
    }
  })

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
  const unresolved = isSeries ? rows.filter(row => row.winnerTeam && !row.winnerKey).length : 0

  return { teams, unresolved, battles: rows }
}

export function battleWinnerText(
  battle: { winnerName?: string | null; winnerTeam?: number | null; draw?: boolean },
  t: Translate,
) {
  if (battle.winnerName) return t('workspace.series_winner', { name: battle.winnerName })
  if (battle.winnerTeam) return t('workspace.series_team_winner', { team: battle.winnerTeam })
  return t(battle.draw ? 'workspace.series_draw' : 'workspace.series_unknown_winner')
}

/**
 * 场次选择器选项（审计 BZ-09：每项显示「地图 · 胜负 · 时间」，不再只有文件名）。
 * @param {ReturnType<typeof buildSeriesOverview>} series
 * @param {{ t: Function, locale: string, mapLabel: Function, formatTime?: (epochSeconds: number) => string }} format
 */
export function battlePickerOptions(
  series: ReturnType<typeof buildSeriesOverview>,
  { t, locale, mapLabel, formatTime = defaultTimeFormatter(locale) }: {
    t: Translate
    locale: string
    mapLabel: (mapName: string, locale: string) => string
    formatTime?: (epochSeconds: number) => string
  },
): BattleOption[] {
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

/**
 * 回放列表的行：按 `sourceId = r{files 下标}` 把文件接到场次选项上，不产生第二份场次信息。
 * failures / duplicates 只带文件名，没有下标，同名文件的行状态可能互串，只影响这一行的标签。
 * @param {File[]} files
 * @param {ReturnType<typeof battlePickerOptions>} options
 * @param {object|null} resp ReplayResult
 * @param {{ currentSourceId?: string|null, parsing?: boolean }} [state]
 */
export function replayCollectionRows(
  files: File[],
  options: BattleOption[],
  resp: SeriesResult | null | undefined,
  { currentSourceId = null, parsing = false }: { currentSourceId?: string | null; parsing?: boolean } = {},
) {
  const byId = new Map(options.map(option => [option.value, option]))
  const failed = new Set((resp?.failures || []).map(entry => entry[0]))
  const duplicates = new Set((resp?.duplicates || []).map(entry => entry[0]))
  const excluded = new Set((resp?.league?.failures || []).map(entry => entry.fileName))
  return files.map((file, index) => {
    const sourceId = `r${index}`
    const option = byId.get(sourceId)
    const fileName = displayName(file)
    const row = { key: fileKey(file), file, fileName, title: fileName, meta: '', current: false, search: fileName }
    if (option) {
      return { ...row, status: 'ready', title: option.label, meta: option.meta, current: sourceId === currentSourceId,
        search: [option.label, option.meta, fileName].join(' ') }
    }
    if (failed.has(file.name)) return { ...row, status: 'failed' }
    if (duplicates.has(file.name)) return { ...row, status: 'duplicate' }
    if (excluded.has(file.name)) return { ...row, status: 'excluded' }
    return { ...row, status: parsing ? 'loading' : 'failed' }
  })
}

function defaultTimeFormatter(locale: string) {
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    format = new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }
  return (epochSeconds: number) => format.format(new Date(epochSeconds * 1000))
}
