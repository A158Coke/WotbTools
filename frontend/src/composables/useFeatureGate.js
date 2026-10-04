import { FeatureRequirement, getFeatureAvailability } from '../app/featureCapabilities.js'
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
  const { connectivity, settled, whenSettled } = useConnectivity()

  /**
   * 当前可用性 + `pending`（连通性首次检测尚未完成）。
   *
   * `pending` 只对联网功能有意义：此时 ONLINE_REQUIRED 仍 fail-closed（`available=false`），
   * 但 `reason` / `messageKey` 来自**占位**的 UNKNOWN，不是检测结论 —— UI 必须先判断
   * `pending`，pending 时不得展示任何 connectivity 提示（不是 unknown，也不是 offline）。
   * LOCAL 与未注册功能不依赖连通性，`pending` 恒为 false，绝不被初始化阻塞。
   *
   * 读取 `settled.value` 让 computed 依赖它：首次结果恰好是 UNKNOWN 时 `connectivity` 不变，
   * 只有 settled false → true 能把 UI 从 pending 切到真实 UNKNOWN。
   */
  function availability(feature) {
    const result = getFeatureAvailability(feature, { connectivity: connectivity.value })
    const dependsOnConnectivity = result.requirement !== null && result.requirement !== FeatureRequirement.LOCAL
    return Object.freeze({ ...result, pending: dependsOnConnectivity && !settled.value })
  }

  function isAvailable(feature) {
    return availability(feature).available
  }

  /**
   * 同步门禁（返回值即「当前这次动作能不能做」）。
   *
   * 与 `availability(feature)` 同一判定：是否等待首次检测只看**该功能自己的** `pending`。
   *  - 不 pending（LOCAL / 未注册功能，或检测已完成）：直接按当前状态判定；
   *  - pending 但当前动作本就可用（ONLINE_OPTIONAL 的本地部分）：放行，不因初始化阻塞；
   *  - pending 且不可用（ONLINE_REQUIRED）：fail-closed 返回 false，当前动作被拒绝（不发请求），
   *    不立即弹 connectivity 提示（占位 UNKNOWN 不是结论）；检测完成后只按真实状态
   *    **补判 / 补提示**一次（在线则不提示），**不会**自动重放被拒绝的原始动作 ——
   *    需要恢复的页面由自己的可用性 watcher 负责。
   */
  function requireFeature(feature) {
    const current = availability(feature)
    if (!current.pending) return evaluateFeatureGate(feature, connectivity.value)
    if (current.available) return true
    void whenSettled().then(() => evaluateFeatureGate(feature, connectivity.value))
    return false
  }

  return {
    availability,
    isAvailable,
    requireFeature,
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
