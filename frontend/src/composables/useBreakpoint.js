import { computed, readonly, ref } from 'vue'
import { BREAKPOINT_EXPANDED, BREAKPOINT_MEDIUM, SHELL_DRAWER_QUERY } from '../shared/breakpoints.js'

const tier = ref('expanded')
const coarsePointer = ref(false)
const drawerShell = ref(false)
let bound = false

function bind() {
  if (bound || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  bound = true
  const medium = window.matchMedia(`(min-width: ${BREAKPOINT_MEDIUM}px)`)
  const expanded = window.matchMedia(`(min-width: ${BREAKPOINT_EXPANDED}px)`)
  const coarse = window.matchMedia('(pointer: coarse)')
  const drawer = window.matchMedia(SHELL_DRAWER_QUERY)
  const update = () => {
    tier.value = expanded.matches ? 'expanded' : medium.matches ? 'medium' : 'compact'
    coarsePointer.value = coarse.matches
    drawerShell.value = drawer.matches
  }
  for (const query of [medium, expanded, coarse, drawer]) query.addEventListener?.('change', update)
  update()
}

export function useBreakpoint() {
  bind()
  return {
    tier: readonly(tier),
    isCompact: computed(() => tier.value === 'compact'),
    isExpanded: computed(() => tier.value === 'expanded'),
    isDrawerShell: readonly(drawerShell),
  }
}

export function usePointer() {
  bind()
  return { coarse: readonly(coarsePointer) }
}
