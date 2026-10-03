import { ref, watch } from 'vue'

/**
 * 「首次激活才挂载、之后切走只隐藏」的 pane 生命周期。
 *
 * 用于回放工作台的五个能力面板：非首屏能力的代码块不随工作台进入主包，
 * 但一旦挂载就保留实例（切走停渲染、切回不重新解析、不重新选文件）。
 * 状态是视图生命周期，不承载业务数据——业务 state 仍由 `useReplaySession` 唯一持有。
 *
 * @param {import('vue').Ref<boolean> | (() => boolean)} isActive 当前是否处于激活能力
 */
export function useMountedWhenActive(isActive) {
  const mounted = ref(typeof isActive === 'function' ? isActive() : isActive.value)
  watch(isActive, (active) => { if (active) mounted.value = true })
  return mounted
}
