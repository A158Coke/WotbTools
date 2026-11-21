/**
 * ProfilePage —— 会话装载 / WG 同步 / 重连恢复（拆分自 ProfilePage.vue，行为原样）。
 * 归属代数（Phase 7.2）复核所有在途写入；门禁在最前，离线不发任何请求。
 */
import { watch } from 'vue'
import { getUserProfile, syncUserWotbAccountFromLogin } from '../../api/user-profile.js'

/** @param {{
 *  phase: import('vue').Ref<string>,
 *  loading: import('vue').Ref<boolean>,
 *  profile: import('vue').Ref<object|null>,
 *  isAuthenticated: () => boolean,
 *  authEpoch: () => number,
 *  ownEpoch: (epoch: number) => boolean,
 *  epochArg: (v: unknown) => number,
 *  requireProfileOnline: () => boolean,
 *  availabilityProfile: () => { available: boolean },
 *  connectivity: import('vue').Ref<string>,
 *  whenBusinessUserSettled: (context: unknown) => Promise<boolean>,
 *  syncFromLoginPending: import('vue').Ref<boolean>,
 *  syncFromLoginError: import('vue').Ref<unknown>,
 *  isWargamingLogin: import('vue').ComputedRef<boolean>,
 *  loadRecords: (epoch?: number) => Promise<void>,
 *  loadHundredStatus: (epoch?: number) => Promise<void>,
 * }} ctx */
export function useProfileSession({
  phase, loading, profile, isAuthenticated, authEpoch, ownEpoch, epochArg,
  requireProfileOnline, availabilityProfile, connectivity, whenBusinessUserSettled,
  syncFromLoginPending, syncFromLoginError, isWargamingLogin,
  loadRecords, loadHundredStatus, getUserProfile,
}) {
  /** 网络不可用时的中性状态：不是错误态，不显示「资料加载失败 / 重试」。 */
  function enterConnectivityUnavailable() {
    phase.value = 'connectivity-unavailable'
  }

  async function loadProfile() {
    if (loading.value || !isAuthenticated()) return
    // 门禁必须在最前面：offline / unknown / degraded / service-unavailable 时**不发任何请求**
    // （既不 ensure 也不 get），进入中性的 connectivity-unavailable 状态而不是错误态。
    if (!requireProfileOnline()) {
      enterConnectivityUnavailable()
      return
    }
    // 账户归属（Phase 7.2）：发起代数记在这里，之后每个 await 复核——登出 / 切到 B 后，
    // A 时代的迟到结果（profile / records / hundred）一律不得写入。
    const epoch = authEpoch()
    loading.value = true
    phase.value = 'done'
    try {
      // 等待全局 business bootstrap 完成 ensure；页面不再自己「读不到就创建」。
      // gated 版本在 backend 不可达时不会触发 ensure（见 useBusinessUserBootstrap）。
      const settled = await whenBusinessUserSettled({
        authInitState: 'authenticated',
        authenticated: true,
        connectivity: connectivity.value,
        authEpoch: epoch,
      })
      if (!ownEpoch(epoch)) return
      if (!settled) {
        if (!availabilityProfile().available) {
          enterConnectivityUnavailable()
        } else {
          // 连通性仍可用：bootstrap 失败属于业务错误，等待用户显式重试。
          profile.value = null
          phase.value = 'profile-error'
        }
        return
      }
      // ensure 期间也可能掉线：成功结果不能绕过当前的 backend 准入。
      if (!requireProfileOnline()) {
        enterConnectivityUnavailable()
        return
      }
      const fetchedProfile = await getUserProfile()
      if (!ownEpoch(epoch)) return
      profile.value = fetchedProfile
    } catch {
      if (!ownEpoch(epoch)) return
      profile.value = null
      if (availabilityProfile().available) phase.value = 'profile-error'
      else enterConnectivityUnavailable()
      return
    } finally {
      // P1（review）：pending 状态也要归属检查——A 的迟到响应不得把 B 正在进行的加载清掉，
      // 否则 B 的加载窗口会被误判为"空闲"，watcher / 重连路径可能再起一次加载。
      if (ownEpoch(epoch)) loading.value = false
    }
    if (!ownEpoch(epoch)) return
    phase.value = 'done'
    await syncFromLogin(epoch)
    if (!ownEpoch(epoch)) return
    if (profile.value?.wotbAccountId) {
      loadRecords(epoch)
      loadHundredStatus(epoch)
    }
  }

  /**
   * 恢复在线后自动加载（无需刷新 / 重开页面 / 重新登录），仍然只经 capability 门禁判定：
   *  - 已加载过 profile（`profile.value` 存在）不再触发；
   *  - 重复的 online 通知由 `loading` + `profile.value` 双重去重，不会形成请求风暴；
   *  - 只自动恢复 connectivity-unavailable；业务错误由用户显式 retry，避免自动重试循环。
   */
  const stopReconnectWatch = watch(connectivity, () => {
    if (!isAuthenticated()) return
    if (profile.value || loading.value) return
    if (phase.value !== 'connectivity-unavailable') return
    if (!availabilityProfile().available) return
    void loadProfile()
  })

  /** WG 幂等同步（ASIA/EU/NA）：昵称变化时刷新；失败不再静默，保留错误状态供重试。 */
  async function syncFromLogin(epochInput) {
    const epoch = epochArg(epochInput)
    if (!ownEpoch(epoch)) return
    if (!isWargamingLogin.value) return
    if (!requireProfileOnline()) return
    syncFromLoginPending.value = true
    syncFromLoginError.value = null
    try {
      const synced = await syncUserWotbAccountFromLogin()
      if (!ownEpoch(epoch)) return
      if (synced) {
        profile.value = synced
      }
    } catch (e) {
      if (!ownEpoch(epoch)) return
      // 保留后端业务错误码：同步失败时绝不回退为 CN 手动入口。
      syncFromLoginError.value = e
    } finally {
      if (ownEpoch(epoch)) syncFromLoginPending.value = false
    }
  }

  return { loadProfile, syncFromLogin, enterConnectivityUnavailable }
}
