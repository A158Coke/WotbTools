import { computed, readonly, ref } from 'vue'
import { BREAKPOINT_EXPANDED, BREAKPOINT_MEDIUM } from '../shared/breakpoints.js'

// 布局按可用宽度决定，交互尺寸按输入方式决定——两者分开（design-language §6）。
// 全应用共享一组 matchMedia 监听；应用生命周期内不解绑。
const tier = ref('expanded')
const coarsePointer = ref(false)
let bound = false

function bind() {
  if (bound || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  bound = true
  const medium = window.matchMedia(`(min-width: ${BREAKPOINT_MEDIUM}px)`)
  const expanded = window.matchMedia(`(min-width: ${BREAKPOINT_EXPANDED}px)`)
  const coarse = window.matchMedia('(pointer: coarse)')
  const update = () => {
    tier.value = expanded.matches ? 'expanded' : medium.matches ? 'medium' : 'compact'
    coarsePointer.value = coarse.matches
  }
  for (const query of [medium, expanded, coarse]) query.addEventListener?.('change', update)
  update()
}

/** 当前布局档位：compact < 768 ≤ medium < 1200 ≤ expanded。 */
export function useBreakpoint() {
  bind()
  return {
    tier: readonly(tier),
    isCompact: computed(() => tier.value === 'compact'),
    isExpanded: computed(() => tier.value === 'expanded'),
  }
}

/** 主要输入方式是否为粗指针（触屏）。只用于交互尺寸，不用于决定布局。 */
export function usePointer() {
  bind()
  return { coarse: readonly(coarsePointer) }
}
