import { computed, readonly, ref } from 'vue'
import { ensureUserProfile } from '../utils/api-user.js'
import { Feature, getFeatureAvailability, profileBackendAllowed } from '../app/featureCapabilities.js'

/**
 * WotBTools 业务用户 bootstrap（KC User → user_profile 的 eventual self-healing）。
 *
 * <p>Keycloak 负责认证/IAM 身份，`user_profile` 是 WotBTools 业务用户投影。稳态不变量是：
 * 每个已认证并成功进入 SPA 的用户都有 `user_profile`。KC-only 只允许作为
 * 短暂（broker 注册后浏览器还没回站、bootstrap 暂时失败）/ legacy / 不完整状态存在
 * —— 任何 KC-only 用户下一次成功进入 WotBTools 都会在这里被自动补齐。</p>
 *
 * <p>这里是 profile **ensure 的唯一 canonical owner**。页面（ProfilePage 等）
 * 只允许等待结果再读取资料，不得各自实现「读不到 → 自己创建」这套 provisioning。</p>
 *
 * <p>状态机：`idle`（尚未开始）→ `pending` → `ready` | `failed`。
 * 失败**不会**被永久缓存，也**不会**把 authenticate 结果改成 false：刷新 / 下一次
 * app bootstrap / 显式 `retry()` 都会重新尝试。刻意不做自动重试循环——一次
 * bootstrap 只调用一次。</p>
 *
 * <p>**离线语义（PR B review blocker）**：profile ensure 是一次 backend 调用，因此它的准入
 * 由 capability SSOT（[Feature.ACCOUNT_PROFILE] 是 ONLINE_REQUIRED）决定，而不是另写一套
 * `connectivity === 'online'` 业务规则。离线 / 状态未知时**不发请求**、不进入 `failed`、
 * 不显示失败横幅；恢复在线后再补一次（仍由下面的 in-flight / ready 去重保护）。</p>
 */

/** idle | pending | ready | failed */
const state = ref('idle')
const error = ref(null)

/**
 * 进行中的 bootstrap Promise。成功与失败都会在 finally 里清空，
 * 因此一个 rejected Promise 绝不会锁死后续 retry。
 */
let inFlight = null

async function run() {
  state.value = 'pending'
  error.value = null
  try {
    await ensureUserProfile()
    state.value = 'ready'
    return true
  } catch (e) {
    // 真实身份冲突（如 WOTB_ACCOUNT_ALREADY_USED）也走这里，但保留原始 error 供调用方辨识；
    // 绝不吞掉、绝不把 authenticated 改成 false、绝不删除 Keycloak 用户。
    error.value = e
    state.value = 'failed'
    return false
  } finally {
    inFlight = null
  }
}

/** 业务资料功能当前的可用性（capability SSOT：ONLINE_REQUIRED）。 */
export function businessProfileAvailability(connectivity) {
  return getFeatureAvailability(Feature.ACCOUNT_PROFILE, { connectivity })
}

/**
 * 是否允许发起 profile backend 调用（**纯函数**，因此可确定性测试）。
 *
 * 只有「已认证 + ACCOUNT_PROFILE 可用」才允许。`offline` / `unknown` / `degraded` /
 * `service-unavailable` 一律拒绝 —— 后三种**不是**「你离线」，但同样不能访问 backend。
 */
export function shouldEnsureBusinessUser(context = {}) {
  // 策略本体在 capability 模块（profileBackendAllowed），浏览器测试替身共用同一实现。
  return profileBackendAllowed(context)
}

/**
 * 确保当前用户资料存在（**canonical primitive，页面不得直接调用**）。
 *
 * 并发调用共享同一个 in-flight 请求（两个 tab / 两个组件同时 bootstrap 时只会打一个请求）；
 * 已 ready 时直接返回，不重复调用。它对连通性**无感知** —— 所有外部入口必须走 gated 版本
 * （[ensureBusinessUserIfAllowed] / [whenBusinessUserSettled] / [retryBusinessUserIfAllowed]），
 * 否则离线时就会绕过 capability 策略直接打 backend。
 */
export function ensureBusinessUser() {
  if (state.value === 'ready') return Promise.resolve(true)
  if (inFlight) return inFlight
  inFlight = run()
  return inFlight
}

/**
 * 等待本轮 bootstrap 结束，并返回是否 ready（**页面唯一允许使用的等待入口**）。
 *
 * `context` = `{ authInitState, authenticated, connectivity }`，缺省视为**不允许**（fail-closed）：
 * backend 不可达时直接返回 false，**绝不**触发 ensure —— 「离线不发请求」这条不变量必须由
 * 本模块保证，而不能依赖每个调用方自己先判断一次（PR #467 review blocker）。
 *
 * 若 bootstrap 尚未开始（页面比 AppShell 更早挂载、或上一次尝试已失败），允许时仍会主动
 * 触发一次 ensure —— 同一个 canonical 实现，不是第二套 provisioning。
 */
export async function whenBusinessUserSettled(context = {}) {
  if (!profileBackendAllowed(context)) return false
  if (state.value !== 'ready') {
    await ensureBusinessUser()
  }
  return state.value === 'ready'
}

/** gated ensure（页面 / 组件入口）：不允许时返回 false 且**不发请求**。 */
export function ensureBusinessUserIfAllowed(context = {}) {
  if (!profileBackendAllowed(context)) return Promise.resolve(false)
  return ensureBusinessUser()
}

/** 显式重试（失败提示上的「重试」入口）；不做任何自动循环。raw primitive，页面用 gated 版本。 */
export function retryBusinessUser() {
  state.value = 'idle'
  error.value = null
  return ensureBusinessUser()
}

/** gated retry（失败横幅入口）：离线 / 状态未知时返回 false 且**不发请求**，也不重置状态机。 */
export function retryBusinessUserIfAllowed(context = {}) {
  if (!profileBackendAllowed(context)) return Promise.resolve(false)
  return retryBusinessUser()
}

/** 仅供测试重置模块级状态。 */
export function resetBusinessUserBootstrap() {
  state.value = 'idle'
  error.value = null
  inFlight = null
}

export function useBusinessUserBootstrap() {
  return {
    state: readonly(state),
    error: readonly(error),
    ready: computed(() => state.value === 'ready'),
    failed: computed(() => state.value === 'failed'),
    // 对外只暴露 gated 版本：页面无法误用 raw backend primitive。
    ensure: ensureBusinessUserIfAllowed,
    whenSettled: whenBusinessUserSettled,
    retry: retryBusinessUserIfAllowed,
  }
}
