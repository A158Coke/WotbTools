import { computed, readonly, ref } from 'vue'
import { ensureUserProfile } from '../utils/api-boost.js'

/**
 * WotBTools 业务用户 bootstrap（KC User → user_profile 的 eventual self-healing）。
 *
 * <p>Keycloak 负责认证/IAM 身份，`user_profile` 是 WotBTools 业务用户投影。稳态不变量是：
 * 每个已认证并成功进入 SPA 的用户都有 `user_profile`。KC-only 只允许作为
 * 短暂（broker 注册后浏览器还没回站、bootstrap 暂时失败）/ legacy / 不完整状态存在
 * —— 任何 KC-only 用户下一次成功进入 WotBTools 都会在这里被自动补齐。</p>
 *
 * <p>这里是 profile **ensure 的唯一 canonical owner**。页面（ProfilePage / BoostPage）
 * 只允许等待结果再读取资料，不得各自实现「读不到 → 自己创建」这套 provisioning。</p>
 *
 * <p>状态机：`idle`（尚未开始）→ `pending` → `ready` | `failed`。
 * 失败**不会**被永久缓存，也**不会**把 authenticate 结果改成 false：刷新 / 下一次
 * app bootstrap / 显式 `retry()` 都会重新尝试。刻意不做自动重试循环——一次
 * bootstrap 只调用一次。</p>
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

/**
 * 确保当前用户资料存在。并发调用共享同一个 in-flight 请求（两个 tab / 两个组件同时
 * bootstrap 时只会打一个请求）；已 ready 时直接返回，不重复调用。
 */
export function ensureBusinessUser() {
  if (state.value === 'ready') return Promise.resolve(true)
  if (inFlight) return inFlight
  inFlight = run()
  return inFlight
}

/**
 * 等待本轮 bootstrap 结束，并返回是否 ready。
 *
 * <p>页面用它来「等 bootstrap 完成再读资料」，而不是自己创建资料。若 bootstrap 尚未
 * 开始（例如页面比 AppShell 更早挂载、或上一次尝试已失败），这里会主动触发一次
 * ensure —— 仍然是同一个 canonical 实现，不是第二套 provisioning。</p>
 */
export async function whenBusinessUserSettled() {
  if (state.value !== 'ready') {
    await ensureBusinessUser()
  }
  return state.value === 'ready'
}

/** 显式重试（失败提示上的「重试」入口）；不做任何自动循环。 */
export function retryBusinessUser() {
  state.value = 'idle'
  error.value = null
  return ensureBusinessUser()
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
    ensure: ensureBusinessUser,
    whenSettled: whenBusinessUserSettled,
    retry: retryBusinessUser,
  }
}
