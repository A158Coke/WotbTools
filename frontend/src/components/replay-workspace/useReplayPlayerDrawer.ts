import { computed, ref, watch } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import type { ReplayResult } from '../../types/replay.js'
import { CW_DIM_KEYS } from '../../utils/playerSummaryMerge.js'

type Selection = { scope: string; accountId: number | string; arenaId?: string | null; order?: Array<number | string> }
type UnifiedRow = { accountId: number | string; cells: Record<string, unknown>; league: { dimensionMeans?: unknown; mostUsedVehicle?: unknown } | null }
type DrawerContext = { unifiedRows: ComputedRef<UnifiedRow[]>; resp: Ref<ReplayResult | null>; selectionRevision: Ref<number>; isSummaryView: ComputedRef<boolean>; currentSingleIndex: ComputedRef<number> }

/** @param {{
 *  unifiedRows: import('vue').ComputedRef<Array<object>>,
 *  resp: import('vue').Ref<object|null>,
 *  selectionRevision: import('vue').Ref<number>,
 *  isSummaryView: import('vue').ComputedRef<boolean>,
 *  currentSingleIndex: import('vue').ComputedRef<number>,
 * }} ctx */
export function useReplayPlayerDrawer({ unifiedRows, resp, selectionRevision, isSummaryView, currentSingleIndex }: DrawerContext) {
  const selectedPlayerContext = ref<Selection | null>(null)

  const navOrder = ref<number[]>([])
  const navIndex = ref(-1)

  function selectPlayer(context: Selection) {
    selectedPlayerContext.value = context
    const order = Array.isArray(context.order) ? context.order.map(Number) : []
    navOrder.value = order
    navIndex.value = order.indexOf(Number(context.accountId))
  }

  function closeDrawer() {
    selectedPlayerContext.value = null
    navOrder.value = []
    navIndex.value = -1
  }

  const hasPrevPlayer = computed(() => navOrder.value.length > 0 && navIndex.value > 0)
  const hasNextPlayer = computed(() => navOrder.value.length > 0 && navIndex.value >= 0 && navIndex.value < navOrder.value.length - 1)

  function goPrevPlayer() {
    const ctx = selectedPlayerContext.value
    if (!ctx || !hasPrevPlayer.value) return
    const target = navOrder.value[navIndex.value - 1]
    selectedPlayerContext.value = { scope: ctx.scope, accountId: target, arenaId: ctx.arenaId }
    navIndex.value = navIndex.value - 1
  }

  function goNextPlayer() {
    const ctx = selectedPlayerContext.value
    if (!ctx || !hasNextPlayer.value) return
    const target = navOrder.value[navIndex.value + 1]
    selectedPlayerContext.value = { scope: ctx.scope, accountId: target, arenaId: ctx.arenaId }
    navIndex.value = navIndex.value + 1
  }

  const drawerOpen = computed(() => !!selectedPlayerContext.value)

  const selectedPlayer = computed(() => {
    const ctx = selectedPlayerContext.value
    if (!ctx) return null
    return { scope: ctx.scope, accountId: Number(ctx.accountId), arenaId: ctx.arenaId || null }
  })

  const drawerPlayer = computed(() => {
    const ctx = selectedPlayerContext.value
    if (!ctx) return null
    if (ctx.scope === 'summary') {
      const row = unifiedRows.value.find(r => Number(r.accountId) === Number(ctx.accountId))
      if (!row) return null
      return {
        accountId: row.accountId,
        nickname: row.cells.nickname,
        clan: row.cells.clan || '',
        rating: row.cells.league_rating,
        observedMean: row.cells.league_observed_mean,
        dimensionMeans: row.league?.dimensionMeans ?? null,
        mvpCount: row.cells.mvp_count,
        battles: row.cells.battles,
        wins: row.cells.wins,
        mostUsedVehicle: row.league?.mostUsedVehicle ?? null,
        ratedBattles: row.cells?.rated_battles ?? null,
        cells: row.cells,
      }
    }
    const battle = (resp.value?.battles || []).find(b => b.arenaId === ctx.arenaId)
    const row = battle?.players?.find(p => Number(p.accountId) === Number(ctx.accountId))
    if (!row) return null
    return {
      accountId: row.accountId,
      nickname: row.cells.nickname,
      clan: row.cells.clan || '',
      rating: row.cells.league_rating,
      dimensionScores: CW_DIM_KEYS.map(k => row.cells[k]),
      tankId: row.vehicleId ?? null,
      tankName: row.cells?.tank_name ?? '',
      tankBattles: 1,
      cells: row.cells,
    }
  })

  watch(selectionRevision, () => {
    selectedPlayerContext.value = null
    navOrder.value = []
    navIndex.value = -1
  })

  watch([isSummaryView, currentSingleIndex], () => {
    selectedPlayerContext.value = null
    navOrder.value = []
    navIndex.value = -1
  })

  const drawerScopePlayers = computed(() => {
    const ctx = selectedPlayerContext.value
    if (!ctx) return []
    if (ctx.scope === 'summary') return unifiedRows.value
    const battle = (resp.value?.battles || []).find(b => b.arenaId === ctx.arenaId)
    return battle ? battle.players : []
  })

  return {
    selectedPlayerContext, navOrder, navIndex,
    selectPlayer, closeDrawer,
    hasPrevPlayer, hasNextPlayer, goPrevPlayer, goNextPlayer,
    drawerOpen, selectedPlayer, drawerPlayer, drawerScopePlayers,
  }
}
