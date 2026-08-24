import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

/**
 * 表格 sticky 核心列对（玩家列 + Rating 列）测量 helper（review PR#134 BLOCKER 2.9/2.10）。
 *
 * 抽取自 BattleTable 已验证的 sticky lifecycle（plan §3.3/§3.4/§19 Test A-F）：
 * - invariant：nickname.left = 0；league_rating.left = 真实可见 nickname 列宽（>0）。
 * - hidden（active=false 或 width<=0）时禁止写入，已有有效 offset 不被覆盖成 0。
 * - 测量链：nextTick → rAF → getBoundingClientRect().width（happy-dom 无 rAF 时回退 setTimeout）。
 * - ResizeObserver 监听昵称表头（ref 改变重连）；resize / 列变化 / 排序箭头 / reorder 重新测量。
 *
 * 两处消费方必须提供 enabled（CW leagueMode）与 active（v-show 可见性），
 * 由父组件真实持有（组件不通过 DOM 猜 visibility）。
 */

const nextFrame = typeof requestAnimationFrame === 'function'
  ? (cb) => requestAnimationFrame(cb)
  : (cb) => setTimeout(cb, 0)
const cancelFrame = typeof cancelAnimationFrame === 'function'
  ? (id) => cancelAnimationFrame(id)
  : (id) => clearTimeout(id)

export function useStickyColumns({ enabled, active, watchCols }) {
  const headerRefs = ref({})
  const stickyLeft = ref({ nickname: 0, league_rating: null })

  let raf = 0
  let observer = null

  function disconnect() {
    if (observer) {
      observer.disconnect()
      observer = null
    }
  }

  function connect() {
    disconnect()
    const el = headerRefs.value.nickname
    if (!enabled.value || !el || typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(() => schedule())
    observer.observe(el)
  }

  function nicknameWidth() {
    const el = headerRefs.value.nickname
    if (!el) return 0
    const width = el.getBoundingClientRect().width
    return (Number.isFinite(width) && width > 0) ? width : 0
  }

  function schedule() {
    if (!enabled.value || !active.value) return
    nextTick(() => {
      cancelFrame(raf)
      raf = nextFrame(() => {
        const width = nicknameWidth()
        if (width <= 0) return
        stickyLeft.value = { nickname: 0, league_rating: width }
      })
    })
  }

  watch(headerRefs, () => connect(), { deep: true })
  watch(enabled, schedule)
  watch(active, (v) => { if (v) schedule() })
  if (watchCols) watch(watchCols, schedule, { deep: true })

  onMounted(() => {
    connect()
    schedule()
    window.addEventListener('resize', schedule)
  })
  onBeforeUnmount(() => {
    disconnect()
    cancelFrame(raf)
    window.removeEventListener('resize', schedule)
  })

  const isStickyCol = key => enabled.value && (key === 'nickname' || key === 'league_rating')

  function colStyle(key) {
    if (!isStickyCol(key)) return {}
    if (key === 'nickname') return { left: '0px' }
    const v = stickyLeft.value[key]
    return v == null ? {} : { left: v + 'px' }
  }

  return { headerRefs, stickyLeft, isStickyCol, colStyle, schedule }
}
