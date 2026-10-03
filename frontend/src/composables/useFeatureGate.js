import { getFeatureAvailability } from '../app/featureCapabilities.js'
import { useConnectivity } from './useConnectivity.js'
import { showConnectivityNotice } from './useConnectivityNotice.js'

/**
 * 联网功能门禁（计划 §2/§3/§14）：**唯一**允许决定「这个功能现在能不能用」的地方。
 *
 * 用法（AI Review / HoF / 3D 播放入口，以及 business profile bootstrap）：
 *
 * ```js
 * const { requireFeature } = useFeatureGate()
 * function openAiReview() {
 *   if (!requireFeature(Feature.AI_REVIEW)) return   // 已给统一提示，且绝不发请求
 *   ...
 * }
 * ```
 *
 * 关键行为：
 *  - 不可用时**立即**返回 false 并提示，绝不放请求出去等超时（§14 禁止 timeout-then-generic-error）；
 *  - 入口本身**不隐藏**（§3.1）：是否显示入口是产品决策，门禁只决定点击后的行为；
 *  - 提示走统一出口（`useConnectivityNotice` → `ConnectivityNoticeDialog`），所有联网功能一份 UI；
 *  - 文案由 capability 模型按**真实** reason 给出（offline / unknown / degraded /
 *    service-unavailable 各不相同），这里不另写一套措辞。
 */
export function useFeatureGate() {
  const { connectivity } = useConnectivity()

  function availability(feature) {
    return getFeatureAvailability(feature, { connectivity: connectivity.value })
  }

  function isAvailable(feature) {
    return availability(feature).available
  }

  return {
    availability,
    isAvailable,
    requireFeature: feature => evaluateFeatureGate(feature, connectivity.value),
    connectivity,
  }
}

/**
 * 门禁的纯函数形式（可确定性测试，不依赖 Vue 响应式）：
 * 可用返回 true；不可用则先 `notify(availability)` 再返回 false。
 *
 * 注：ONLINE_OPTIONAL 功能在离线时 `available === true`（本地动作照常），因此**不**提示；
 * 需要跳过联网部分的调用方读 `availability().online`，而不是让门禁替它决定。
 */
export function evaluateFeatureGate(feature, connectivity, notify = showConnectivityNotice) {
  const result = getFeatureAvailability(feature, { connectivity })
  if (!result.available && result.messageKey) notify(result)
  return result.available
}
