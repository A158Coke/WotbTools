/**
 * ReplayPage —— Player Detail Drawer 的选择与导航（拆分自 ReplayPage.vue，行为原样）。
 * 只存 identity（scope + accountId + arenaId），不存 mutable row；数据按 context 实时 resolve。
 */
import { computed, ref, watch } from 'vue'
import { CW_DIM_KEYS } from '../../utils/playerSummaryMerge.js'

/** @param {{
 *  unifiedRows: import('vue').ComputedRef<Array<object>>,
 *  resp: import('vue').Ref<object|null>,
 *  selectionRevision: import('vue').Ref<number>,
 *  isSummaryView: import('vue').ComputedRef<boolean>,
 *  currentSingleIndex: import('vue').ComputedRef<number>,
 * }} ctx */
export function useReplayPlayerDrawer({ unifiedRows, resp, selectionRevision, isSummaryView, currentSingleIndex }) {
  // ---- Player Detail Drawer（只存 identity，不存 mutable row；刷新后按 accountId 重新 resolve） ----
  const selectedPlayerContext = ref(null)

  // ---- Player Detail Drawer 导航：跟随当前可见表格顺序，scope 不跨界 ----
  const navOrder = ref([])
  const navIndex = ref(-1)

  function selectPlayer(context) {
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

  /** 前后导航可用性：首位 prev 禁用、末位 next 禁用，不循环。 */
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

  /** Drawer 打开状态：context 存在即打开（默认关闭）。 */
  const drawerOpen = computed(() => !!selectedPlayerContext.value)

  /** 选中玩家 identity：scope + accountId + arenaId；
   *  Drawer 关闭（closeDrawer / Tab 切换 / selectionRevision）→ null → 表格清除 selected highlight。 */
  const selectedPlayer = computed(() => {
    const ctx = selectedPlayerContext.value
    if (!ctx) return null
    return { scope: ctx.scope, accountId: Number(ctx.accountId), arenaId: ctx.arenaId || null }
  })

  /** 当前 Drawer 的玩家数据（按 context 实时 resolve；排序/响应刷新后仍指向原选手）。 */
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
