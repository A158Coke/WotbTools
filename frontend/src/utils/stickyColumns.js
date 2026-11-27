import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'


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
