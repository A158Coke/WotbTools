<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { confirm } from '../composables/useConfirm.js'
import { useAuth } from '../composables/useAuth.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'
import { whenBusinessUserSettled } from '../composables/useBusinessUserBootstrap.js'
import {
  deleteUserWotbAccount,
  getUserHofRecords,
  getUserProfile,
  syncUserWotbAccountFromLogin,
  updateUserWotbAccount,
  verifyUserWotbAccountFromReplay
} from '../utils/api-user.js'
import { replayRecorderAccountId } from '../replay-local/submissionFacts.js'
import { hofHundredCancel, hofHundredMyStatus } from '../utils/api.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import AppButton from './AppButton.vue'

const { locale, t, te } = useI18n()
const { initPromise, login, logout, isAuthenticated, authenticated: authState, initError, tokenParsed, displayName: authDisplayName, authEpoch } = useAuth()

/**
 * 本页所有 backend 动作的统一门禁（PR #467 review blocker）。
 *
 * profile 数据来自 backend ⇒ 页面整体是 ONLINE_REQUIRED，但**按业务 feature 拆分**：
 *  - 账号资料读写（get / sync / update / verify / delete）走 [Feature.ACCOUNT_PROFILE]；
 *  - 名人堂记录 / 百场状态 / 撤销走 [Feature.HALL_OF_FAME]。
 * 判定一律来自 `useFeatureGate()`（capability SSOT），页面**不写** `connectivity === 'online'`
 * 这类第二套规则，也不在 transport 层（utils/api-user.js）里塞连通性判断。
 */
const { availability, requireFeature, connectivity } = useFeatureGate()

/** 账号资料动作：不允许时弹统一 connectivity notice 并返回 false。 */
function requireProfileOnline() {
  return requireFeature(Feature.ACCOUNT_PROFILE)
}

/** 名人堂动作：同上，但用 HoF 自己的能力语义（B10 接线时不需要返工）。 */
function requireHofOnline() {
  return requireFeature(Feature.HALL_OF_FAME)
}

const phase = ref('init')

/** 账户归属复核（Phase 7.2）：epoch 相同且仍处于登录态，迟到结果才允许写入。 */
function ownEpoch(epoch) {
  return authEpoch() === epoch && isAuthenticated()
}

/** 模板 @click 直连 handler 时 Vue 会把事件对象塞进第一个参数：只接受整数 epoch。 */
function epochArg(value) {
  return Number.isInteger(value) ? value : authEpoch()
}
const profile = ref(null)
const loginStarted = ref(false)
/** 离线 / 状态未知时的中性提示文案（取自 capability 模型，不另造文案、不当成错误态）。 */
const unavailableMessageKey = ref('')

const editingAccount = ref(false)
const editAccountId = ref(null)
const editNickname = ref('')
const editError = ref('')
const syncFromLoginPending = ref(false)
const syncFromLoginError = ref(null)
const records = ref([])
const recordsError = ref('')
const hundredStatus = ref(null)
const hundredError = ref('')
const hundredWithdrawingId = ref(null)
const hundredMessage = ref('')
/** loadProfile 进行中标志：reconnect watch 与手动 retry 共用的去重位。 */
const loading = ref(false)

function apiError(error) {
  return apiErrorLabel(t, te, error)
}

onMounted(async () => {
  try {
    const loggedIn = await initPromise
    if (loggedIn || isAuthenticated()) {
      phase.value = 'done'
      loadProfile()
    } else if (initError.value) {
      phase.value = 'error'
    } else {
      // 未登录：显示账户说明卡与登录按钮（design-language §10），不自动跳转登录页。
      phase.value = 'signedOut'
    }
  } catch {
    phase.value = 'error'
  }
})

async function loadProfile() {
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
  try {
    // 等待全局 business bootstrap 完成 ensure；页面不再自己「读不到就创建」。
    // gated 版本在 backend 不可达时不会触发 ensure（见 useBusinessUserBootstrap）。
    const settled = await whenBusinessUserSettled({
      authInitState: 'authenticated',
      authenticated: true,
      connectivity: connectivity.value,
    })
    if (!ownEpoch(epoch)) return
    if (!settled) {
      if (!availability(Feature.ACCOUNT_PROFILE).available) {
        enterConnectivityUnavailable()
      } else {
        // 连通性仍可用：bootstrap 失败属于业务错误，等待用户显式重试。
        profile.value = null
        phase.value = 'error'
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
    phase.value = 'error'
    return
  } finally {
    // P1（review）：pending 状态也要归属检查——A 的迟到响应不得把 B 正在进行的加载清掉，
    // 否则 B 的加载窗口会被误判为"空闲"，watcher / 重连路径可能再起一次加载。
    if (ownEpoch(epoch)) loading.value = false
  }
  if (!ownEpoch(epoch)) return
  phase.value = 'done'
  unavailableMessageKey.value = ''
  await syncFromLogin(epoch)
  if (!ownEpoch(epoch)) return
  if (profile.value?.wotbAccountId) {
    loadRecords(epoch)
    loadHundredStatus(epoch)
  }
}

/** 网络不可用时的中性状态：不是错误态，不显示「资料加载失败 / 重试」。 */
function enterConnectivityUnavailable() {
  phase.value = 'connectivity-unavailable'
  unavailableMessageKey.value = availability(Feature.ACCOUNT_PROFILE).messageKey || 'featureOffline.accountProfile'
}

/**
 * 恢复在线后自动加载（无需刷新 / 重开页面 / 重新登录），仍然只经 capability 门禁判定：
 *  - 已加载过 profile（`profile.value` 存在）不再触发；
 *  - 重复的 online 通知由 `loading` + `profile.value` 双重去重，不会形成请求风暴；
 *  - 只自动恢复 connectivity-unavailable；业务错误由用户显式 retry，避免自动重试循环。
 */
watch(connectivity, () => {
  if (!isAuthenticated()) return
  if (profile.value || loading.value) return
  if (phase.value !== 'connectivity-unavailable') return
  if (!availability(Feature.ACCOUNT_PROFILE).available) return
  void loadProfile()
})

/**
 * 认证状态**响应式**语义（2.1.0 Phase 6 / 7）：
 * - false → true（登录回站 / 账户切到 B / Android authChanged 推送）：立即进入已登录并
 *   恰好加载一次（loading + profile 双重去重，不因 watcher 与手动 retry 叠加出请求风暴）；
 * - true → false（logout / 会话失效）：**立即**清理上一账号的一切投影——profile / records /
 *   hundred / 同步与编辑状态 / 错误——不得等页面重挂或刷新。
 * 在途请求由 loadProfile 等各自的 epoch 复核丢弃（Phase 7.2）。
 */
watch(authState, (now, before) => {
  if (before === now) return
  if (now) {
    if (loading.value) return
    phase.value = 'done'
    void loadProfile()
    return
  }
  profile.value = null
  records.value = []
  recordsError.value = ''
  hundredStatus.value = null
  hundredError.value = ''
  hundredWithdrawingId.value = null
  hundredMessage.value = ''
  syncFromLoginPending.value = false
  syncFromLoginError.value = null
  editingAccount.value = false
  editError.value = ''
  loginStarted.value = false
  loading.value = false
  phase.value = 'signedOut'
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
    // 保留后端业务错误码：同步失败时绝不回退为 CN 手动入口。
    syncFromLoginError.value = e
  } finally {
    if (ownEpoch(epoch)) syncFromLoginPending.value = false
  }
}

/** hero 展示名与顶栏同源：后端 Profile 的 displayName 优先，缺失才落到 useAuth.displayName。 */
const displayName = computed(() =>
  profile.value?.displayName
  || authDisplayName.value
  || t('profile.unknownUser')
)

const heroSubtitle = computed(() =>
  profile.value?.wotbNickname
    ? profile.value.wotbNickname
    : isWargamingLogin.value
      ? t('profile.wgSyncing')
      : t('profile.notBoundWotbAccount')
)

/** JWT 明确是 WG 登录（ASIA/EU/NA + 可信 verified + account_id），即使同步失败也据此只读。 */
const isWargamingLogin = computed(() => {
  const region = tokenParsed.value?.wotb_region
  const accountId = tokenParsed.value?.wotb_account_id
  const verified = tokenParsed.value?.wotb_verified
  return ['ASIA', 'EU', 'NA'].includes(region)
    && Boolean(accountId)
    && (verified === true || verified === 'true')
})

/** WARGAMING source 或 JWT WG 身份 = 资料只读；CN MANUAL 用户可编辑。 */
const isWargamingProfile = computed(
  () => profile.value?.wotbAccountSource === 'WARGAMING'
    || isWargamingLogin.value
)

const SERVER_LABEL_BY_VALUE = Object.freeze({
  CN: 'profile.serverCn',
  ASIA: 'profile.serverAsia',
  EU: 'profile.serverEu',
  NA: 'profile.serverNa',
})

const serverLabel = computed(() => {
  const key = profile.value?.wotbServer
    ? SERVER_LABEL_BY_VALUE[profile.value.wotbServer]
    : null
  return key ? t(key) : '--'
})

function doLogin() {
  if (!loginStarted.value) {
    loginStarted.value = true
    // 登录完成后回到账户页
    Promise.resolve(login('profile')).finally(() => { loginStarted.value = false })
  }
}

/** 出错重试：已登录时重新加载资料；只有确实未登录时才发起登录。 */
function retry() {
  if (isAuthenticated()) {
    // 不预设 'done'：loadProfile 自己会在离线时落到中性提示，避免闪一下「已加载」再失败。
    void loadProfile()
  } else {
    doLogin()
  }
}

function startEditAccount() {
  editAccountId.value = profile.value?.wotbAccountId || null
  editNickname.value = profile.value?.wotbNickname || ''
  editingAccount.value = true
  editError.value = ''
}

async function saveAccount() {
  if (!requireProfileOnline()) return
  const epoch = authEpoch()
  editError.value = ''
  try {
    const updated = await updateUserWotbAccount({
      wotbAccountId: editAccountId.value,
      wotbNickname: editNickname.value,
      wotbServer: 'CN'
    })
    if (!ownEpoch(epoch)) return
    profile.value = updated
    editingAccount.value = false
    loadRecords(epoch)
    loadHundredStatus(epoch)
  } catch (e) {
    if (!ownEpoch(epoch)) return
    editError.value = apiError(e)
  }
}

/** 用回放验证：本机解析选中的回放，提交录像者 accountId（服务器不解析回放） */
const verifyInput = ref(null)
const verifyPending = ref(false)
const verifyError = ref('')

async function verifyWithReplay(event) {
  const file = event?.target?.files?.[0]
  if (event?.target) event.target.value = ''
  if (!file || verifyPending.value) return
  // 门禁放在最前：本地解析是 LOCAL 能力，但「用回放验证账号」最终要打 backend verify，
  // 离线时先提示，避免用户选完文件才发现无法提交。
  if (!requireProfileOnline()) return
  const epoch = authEpoch()
  verifyPending.value = true
  verifyError.value = ''
  try {
    const recorderAccountId = await replayRecorderAccountId(file)
    if (!ownEpoch(epoch)) return
    if (!requireProfileOnline()) return
    const verified = await verifyUserWotbAccountFromReplay(recorderAccountId)
    if (!ownEpoch(epoch)) return
    profile.value = verified
  } catch (e) {
    if (!ownEpoch(epoch)) return
    verifyError.value = apiError(e)
  } finally {
    if (ownEpoch(epoch)) verifyPending.value = false
  }
}

async function loadRecords(epochInput) {
  const epoch = epochArg(epochInput)
  if (!ownEpoch(epoch)) return
  if (!requireHofOnline()) return
  recordsError.value = ''
  try {
    const fetchedRecords = await getUserHofRecords()
    if (!ownEpoch(epoch)) return
    records.value = fetchedRecords
  } catch (error) {
    if (ownEpoch(epoch)) recordsError.value = apiError(error)
  }
}

/** 个人中心「我的百场成绩」：当前认证 / 当前申请 / 最近拒绝。 */
async function loadHundredStatus(epochInput) {
  const epoch = epochArg(epochInput)
  if (!ownEpoch(epoch)) return
  if (!requireHofOnline()) return
  hundredError.value = ''
  try {
    const fetchedStatus = await hofHundredMyStatus()
    if (!ownEpoch(epoch)) return
    hundredStatus.value = fetchedStatus
  } catch (error) {
    if (!ownEpoch(epoch)) return
    hundredStatus.value = null
    hundredError.value = apiError(error)
  }
}

/** 撤销当前待审核申请：确认后调用取消 API，成功后刷新状态。 */
async function withdrawHundred(id) {
  if (!requireHofOnline()) return
  if (!(await confirm({ title: t('hundred.withdrawConfirm'), confirmLabel: t('hundred.withdraw'), danger: true }))) return
  if (!requireHofOnline()) return
  const epoch = authEpoch()
  hundredWithdrawingId.value = id
  hundredMessage.value = ''
  hundredError.value = ''
  try {
    await hofHundredCancel(id)
    if (!ownEpoch(epoch)) return
    hundredMessage.value = t('hundred.withdrawSuccess')
    await loadHundredStatus(epoch)
  } catch (error) {
    if (!ownEpoch(epoch)) return
    hundredError.value = apiError(error)
  } finally {
    if (ownEpoch(epoch)) hundredWithdrawingId.value = null
  }
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString(locale.value) : '--'
}

async function removeAccount() {
  if (!requireProfileOnline()) return
  if (!(await confirm({ title: t('profile.unbindConfirm'), confirmLabel: t('profile.unbind'), danger: true }))) return
  if (!requireProfileOnline()) return
  editError.value = ''
  try {
    profile.value = await deleteUserWotbAccount()
    records.value = []
  } catch (e) {
    editError.value = apiError(e)
  }
}
</script>

<template>
  <div class="profile-page">
    <div v-if="phase === 'init'" class="profile-empty">{{ $t('profile.loading') }}</div>

    <div v-else-if="phase === 'error'" class="profile-card profile-message">
      <p class="text-error">{{ $t('profile.error') }}</p>
      <button class="btn-primary" data-testid="profile-retry" @click="retry">{{ $t('profile.retry') }}</button>
    </div>

    <div v-else-if="phase === 'signedOut'" class="profile-signed-out" data-testid="profile-signed-out">
      <h1 class="profile-signed-out-title">{{ $t('account.signedOutTitle') }}</h1>
      <p class="profile-signed-out-hint">{{ $t('account.signedOutHint') }}</p>
      <AppButton variant="primary" size="lg" data-testid="profile-login" @click="doLogin">{{ $t('app.login') }}</AppButton>
    </div>

    <!--
      连通性不可用：**中性**空态，不是错误态。文案直接来自 capability 模型（offline 时是
      「账号资料需要联网读取」，unknown / degraded / service-unavailable 各有自己的说法），
      即时提示由统一的 ConnectivityNoticeDialog 负责，这里不另造 modal。
    -->
    <div v-else-if="phase === 'connectivity-unavailable'" class="profile-card profile-message" data-testid="profile-connectivity-unavailable">
      <p class="text-sub">{{ $t(unavailableMessageKey) }}</p>
      <button class="btn-primary" data-testid="profile-retry" @click="retry">{{ $t('profile.retry') }}</button>
    </div>

    <div v-else-if="profile" class="profile-main">
      <div class="profile-card profile-hero">
        <div class="hero-left">
          <div class="hero-avatar">{{ (displayName || '?')[0] }}</div>
          <div class="hero-identity">
            <h2 class="hero-name">{{ displayName }}</h2>
            <p class="hero-subtitle">{{ heroSubtitle }}</p>
          </div>
        </div>
        <AppButton variant="danger" size="sm" data-testid="profile-logout" @click="logout()">{{ $t('profile.logout') }}</AppButton>
      </div>

      <div class="profile-body">
        <div class="profile-left">
          <div class="profile-card profile-section">
            <div class="section-head">
              <h3 class="card-title">{{ $t('profile.identity') }}</h3>
            </div>
            <div class="info-row">
              <span class="info-label">{{ $t('profile.displayName') }}</span>
              <span class="info-value">{{ displayName }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ $t('profile.authProvider') }}</span>
              <span class="info-value">Keycloak</span>
            </div>
          </div>

          <div class="profile-card profile-section">
            <div class="section-head">
              <h3 class="card-title">{{ $t('profile.wotbTitle') }}</h3>
              <div class="section-actions">
                <template v-if="!isWargamingProfile">
                  <button v-if="!editingAccount && !profile.wotbAccountId" class="btn-primary btn-sm" @click="startEditAccount">{{ $t('profile.setAccount') }}</button>
                  <button v-if="!editingAccount && profile.wotbAccountId" class="btn-ghost btn-sm" @click="startEditAccount">{{ $t('profile.edit') }}</button>
                  <button v-if="!editingAccount && profile.wotbAccountId" class="btn-ghost btn-sm" @click="removeAccount">{{ $t('profile.unbind') }}</button>
                </template>
              </div>
            </div>

            <div v-if="editingAccount && !isWargamingProfile" class="edit-form">
              <div class="edit-row">
                <label>{{ $t('profile.accountId') }}</label>
                <input v-model.number="editAccountId" type="number" class="edit-input" />
              </div>
              <div class="edit-row">
                <label>{{ $t('profile.nickname') }}</label>
                <input v-model="editNickname" maxlength="64" class="edit-input" />
              </div>
              <div class="edit-row">
                <button class="btn-primary btn-sm" @click="saveAccount">{{ $t('profile.save') }}</button>
                <button class="btn-ghost btn-sm" @click="editingAccount = false">{{ $t('profile.cancel') }}</button>
                <span v-if="editError" class="error">{{ editError }}</span>
              </div>
            </div>

            <div v-else-if="isWargamingProfile && profile.wotbAccountId" class="account-bound">
              <div class="account-row"><span>{{ $t('profile.server') }}</span><span class="badge-ok">{{ serverLabel }}</span></div>
              <div class="account-row"><span>{{ $t('profile.accountSource') }}</span><strong>{{ $t('profile.sourceWargaming') }}</strong></div>
              <div class="account-row"><span>{{ $t('profile.verified') }}</span><span class="badge-ok">{{ $t('profile.verifiedBadge') }}</span></div>
              <div class="account-row"><span>{{ $t('profile.nickname') }}</span><strong>{{ profile.wotbNickname || '--' }}</strong></div>
              <div class="account-row"><span>{{ $t('profile.accountId') }}</span><code>{{ profile.wotbAccountId }}</code></div>
            </div>
            <div v-else-if="isWargamingProfile" class="account-bound">
              <p class="error">{{ $t('profile.wgSyncFailed') }}</p>
              <div class="edit-row">
                <button class="btn-ghost btn-sm" :disabled="syncFromLoginPending" @click="syncFromLogin()">
                  {{ syncFromLoginPending ? $t('profile.wgSyncing') : $t('profile.wgSyncRetry') }}
                </button>
              </div>
            </div>
            <div v-else-if="profile.wotbAccountId" class="account-bound">
              <div class="account-row"><span>{{ $t('profile.accountId') }}</span><code>{{ profile.wotbAccountId }}</code></div>
              <div class="account-row"><span>{{ $t('profile.nickname') }}</span><strong>{{ profile.wotbNickname || '--' }}</strong></div>
              <div class="account-row"><span>{{ $t('profile.server') }}</span><span class="badge-ok">{{ serverLabel }}</span></div>
              <div class="account-row"><span>{{ $t('profile.accountSource') }}</span><strong>{{ $t('profile.sourceUserFilled') }}</strong></div>
              <div class="account-row">
                <span>{{ $t('profile.verified') }}</span>
                <span v-if="profile.wotbAccountVerifiedAt" class="badge-ok">✓ {{ $t('profile.verifiedBadge') }}</span>
                <span v-else class="badge-pending">{{ $t('profile.notVerified') }}</span>
              </div>
              <template v-if="!profile.wotbAccountVerifiedAt">
                <p class="text-muted">{{ $t('profile.notVerifiedHint') }}</p>
                <div class="edit-row">
                  <input ref="verifyInput" type="file" accept=".wotbreplay" hidden data-testid="profile-verify-input" @change="verifyWithReplay">
                  <button class="btn-ghost btn-sm" :disabled="verifyPending" data-testid="profile-verify-replay" @click="verifyInput?.click()">
                    {{ verifyPending ? $t('profile.verifyingReplay') : $t('profile.verifyWithReplay') }}
                  </button>
                  <span v-if="verifyError" class="error" data-testid="profile-verify-error">{{ verifyError }}</span>
                </div>
              </template>
            </div>
            <p v-else class="profile-empty">{{ $t('profile.wotbNotBound') }}</p>
          </div>

          <div v-if="profile.wotbAccountId" class="profile-card profile-section">
            <h3 class="card-title section-title-line">{{ $t('profile.records') }}</h3>
            <div v-if="records.length" class="records-table-wrap">
              <table class="records-table">
                <thead><tr><th>{{ $t('profile.tank') }}</th><th class="rec-dmg">{{ $t('profile.damage') }}</th><th>{{ $t('profile.map') }}</th></tr></thead>
                <tbody>
                  <tr v-for="r in records" :key="r.id">
                    <td class="rec-tank">{{ r.tankName || '--' }}</td>
                    <td class="rec-dmg">{{ r.damageDealt != null ? r.damageDealt.toLocaleString() : '--' }}</td>
                    <td class="rec-map">{{ mapLabel(r.mapName, locale) || '--' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="recordsError" class="error">{{ recordsError }}</p>
            <p v-else-if="!records.length" class="profile-empty">{{ $t('profile.noRecords') }}</p>
          </div>

          <div v-if="profile.wotbAccountId" class="profile-card profile-section">
            <h3 class="card-title section-title-line">{{ $t('hundred.profileTitle') }}</h3>

            <div v-if="hundredMessage" class="hundred-ok">{{ hundredMessage }}</div>
            <p v-if="hundredError" class="error">{{ hundredError }}</p>
            <template v-else-if="hundredStatus">
              <h4 class="hundred-group-title">{{ $t('hundred.currentRecords') }}</h4>
              <div v-if="hundredStatus.current.length" class="records-table-wrap">
                <table class="records-table">
                  <thead>
                    <tr>
                      <th>{{ $t('profile.tank') }}</th>
                      <th class="rec-dmg">{{ $t('hundred.avgDamage') }}</th>
                      <th>{{ $t('hundred.battleCount') }}</th>
                      <th>{{ $t('hundred.approvedAt') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in hundredStatus.current" :key="s.id">
                      <td class="rec-tank">{{ s.vehicleName || '--' }}</td>
                      <td class="rec-dmg">{{ s.approvedAverageDamage != null ? s.approvedAverageDamage.toLocaleString() : '--' }}</td>
                      <td>{{ s.approvedBattleCount != null ? s.approvedBattleCount.toLocaleString() : '--' }}</td>
                      <td class="rec-map">{{ formatTime(s.approvedAt) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="profile-empty profile-empty-tight">{{ $t('hundred.noCurrent') }}</p>

              <h4 class="hundred-group-title">{{ $t('hundred.currentPending') }}</h4>
              <div v-if="hundredStatus.pending.length" class="records-table-wrap">
                <table class="records-table">
                  <thead>
                    <tr>
                      <th>{{ $t('profile.tank') }}</th>
                      <th class="rec-dmg">{{ $t('hundred.pendingDamage') }}</th>
                      <th>{{ $t('hundred.pendingBattles') }}</th>
                      <th>{{ $t('hundred.pendingTime') }}</th>
                      <th>{{ $t('hundred.reviewStatus') }}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="s in hundredStatus.pending" :key="s.id">
                      <td class="rec-tank">{{ s.vehicleName || '--' }}</td>
                      <td class="rec-dmg">{{ (s.approvedAverageDamage ?? s.claimedAverageDamage)?.toLocaleString() ?? '--' }}</td>
                      <td>{{ (s.approvedBattleCount ?? s.claimedBattleCount)?.toLocaleString() ?? '--' }}</td>
                      <td class="rec-map">{{ formatTime(s.submittedAt) }}</td>
                      <td><span class="badge-ok">{{ $t('hundred.reviewStatus') }}</span></td>
                      <td class="hundred-action">
                        <button class="btn-ghost btn-sm" :disabled="hundredWithdrawingId === s.id" @click="withdrawHundred(s.id)">
                          {{ hundredWithdrawingId === s.id ? $t('hundred.withdrawing') : $t('hundred.withdraw') }}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="profile-empty profile-empty-tight">{{ $t('hundred.noPending') }}</p>

              <h4 class="hundred-group-title">{{ $t('hundred.recentRejected') }}</h4>
              <div v-if="hundredStatus.rejected.length" class="hundred-rejected">
                <div v-for="s in hundredStatus.rejected" :key="s.id" class="hundred-rejected-item">
                  <div class="hundred-rejected-head"><strong>{{ s.vehicleName || '--' }}</strong></div>
                  <p class="hundred-rejected-reason">{{ $t('hundred.rejectedReason') }}: {{ s.rejectReason || '--' }}</p>
                  <p v-if="s.rejectReasonText" class="hundred-rejected-text">{{ $t('hundred.rejectedReasonText') }}: {{ s.rejectReasonText }}</p>
                </div>
              </div>
              <p v-else class="profile-empty profile-empty-tight">{{ $t('hundred.noRejected') }}</p>
            </template>
            <p v-else class="profile-empty profile-empty-tight">{{ $t('profile.loading') }}</p>
          </div>
        </div>

        <div class="profile-right">
          <div class="profile-card profile-section">
            <h3 class="card-title">{{ $t('profile.securityTitle') }}</h3>
            <div class="security-info">
              <div class="sec-row"><span>{{ $t('profile.loginMethod') }}</span><strong>Keycloak</strong></div>
              <div class="sec-row"><span>{{ $t('profile.authService') }}</span><code>auth.wotbtools.com</code></div>
              <p class="text-muted">{{ $t('profile.securityDesc') }}</p>
            </div>
          </div>

        </div>
      </div>
    </div>

    <div v-else class="profile-empty">{{ $t('profile.loading') }}</div>
  </div>
</template>

<style scoped>
.profile-page { max-width: 1280px; margin: 0 auto; padding: 24px 20px 64px; }
.profile-card { background: var(--showcase-tactical); border: 1px solid var(--showcase-tactical-border); border-radius: 8px; box-shadow: var(--surface-shadow); }
.profile-message { max-width: 400px; margin: 60px auto; padding: 40px; text-align: center; }
.profile-empty { padding: 24px 0; text-align: center; color: #a3a6a0; font-size: .9rem; }
.profile-empty-tight { padding: 8px 0 0; }
.profile-section { padding: 20px; margin-bottom: 16px; }
.card-title { font-size: .95rem; font-weight: 600; color: var(--showcase-tactical-heading); margin: 0; }
.section-meta { font-size: .75rem; color: #a3a6a0; }
.section-title-line { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid rgba(66, 77, 84, .45); }
.section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid rgba(66, 77, 84, .45); }
.section-actions { display: flex; gap: 6px; }
.profile-hero { display: flex; align-items: center; justify-content: space-between; padding: 24px 28px; margin-bottom: 24px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--bg-card)), var(--bg-card)); }
.hero-left { display: flex; align-items: center; gap: 20px; }
.profile-signed-out {
  display: grid;
  justify-items: start;
  gap: var(--space-3);
  max-width: 560px;
  margin: var(--space-12) auto;
  padding: var(--space-6);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}
.profile-signed-out-title { margin: 0; color: var(--color-text-primary); font: var(--type-h2); }
.profile-signed-out-hint { margin: 0 0 var(--space-2); color: var(--color-text-secondary); font: var(--type-body); }
.hero-avatar { width: 56px; height: 56px; border-radius: 8px; background: linear-gradient(135deg, var(--accent), var(--accent-hover)); color: var(--accent-text); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 800; flex-shrink: 0; box-shadow: 0 12px 26px var(--accent-shadow); }
.hero-name { font-size: 1.3rem; font-weight: 700; color: var(--text-heading); margin: 0 0 6px; }
.hero-subtitle { font-size: .85rem; color: var(--text-sub); margin: 0; }
.profile-body { display: flex; gap: 24px; align-items: flex-start; }
.profile-left { flex: 1; min-width: 0; }
.profile-right { width: 340px; flex-shrink: 0; }
.info-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; gap: 16px; }
.info-label { color: #a3a6a0; font-size: .85rem; flex-shrink: 0; }
.info-value { color: var(--showcase-tactical-text); font-size: .85rem; font-weight: 500; text-align: right; word-break: break-all; }
.account-bound { display: flex; flex-direction: column; gap: 10px; }
.account-row { display: flex; justify-content: space-between; font-size: .88rem; color: var(--showcase-tactical-text); }
.account-row span { color: #a3a6a0; }
.account-row code { font-family: monospace; font-size: .8rem; color: #f0a42b; }
.badge-ok { font-size: .72rem; padding: 2px 8px; border-radius: 6px; background: var(--status-ok-bg); color: var(--status-ok-fg); font-weight: 700; }
.badge-pending { font-size: .72rem; padding: 2px 8px; border-radius: 6px; background: var(--bg-chip); color: var(--text-sub); font-weight: 700; }
.edit-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.edit-form .edit-row { margin-bottom: 10px; }
.edit-form label { display: block; font-size: .8rem; color: #a3a6a0; margin-bottom: 3px; }
.edit-input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text); font-size: .88rem; width: 200px; font-family: inherit; }
.error { color: #ff8f86; font-size: .82rem; }
.text-muted { font-size: .8rem; color: #9aa09c; line-height: 1.5; }
.security-info { display: flex; flex-direction: column; gap: 8px; }
.sec-row { display: flex; justify-content: space-between; font-size: .88rem; gap: 12px; color: var(--showcase-tactical-text); }
.sec-row span { color: #a3a6a0; }
.sec-row code { font-family: monospace; font-size: .78rem; color: #f0a42b; }
.btn-primary { padding: 8px 20px; border: none; border-radius: 7px; background: var(--accent); color: var(--accent-text); font-size: .88rem; cursor: pointer; font-family: inherit; font-weight: 700; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-sm { padding: 5px 12px; font-size: .8rem; border-radius: 6px; }
.btn-ghost { padding: 8px 18px; border: 1px solid #465159; border-radius: 7px; background: transparent; color: var(--showcase-tactical-text); font-size: .85rem; cursor: pointer; font-family: inherit; }
.btn-ghost.btn-sm { padding: 5px 12px; font-size: .8rem; border-radius: 6px; }
.btn-ghost:hover { background: #1c262b; }
.btn-ghost:disabled { cursor: wait; opacity: .65; background: #1c262b; }
.records-table-wrap { overflow-x: auto; }
.records-table { width: 100%; border-collapse: collapse; font-size: .85rem; }
.records-table th { text-align: left; padding: 8px 12px; border-bottom: 2px solid var(--border); color: var(--text-sub); font-weight: 600; font-size: .78rem; text-transform: uppercase; letter-spacing: .03em; }
.records-table td { padding: 10px 12px; border-bottom: 1px solid var(--border-light); color: var(--text); }
.records-table tbody tr:hover { background: var(--bg-list-hover); }
.rec-dmg { text-align: right !important; font-variant-numeric: tabular-nums; font-weight: 600; width: 90px; }
.rec-tank { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rec-map { color: #9aa09c; }
.hundred-group-title { margin: 16px 0 8px; font-size: .78rem; font-weight: 700; color: var(--text-sub); letter-spacing: .05em; text-transform: uppercase; }
.hundred-group-title:first-of-type { margin-top: 0; }
.hundred-action { text-align: right; white-space: nowrap; }
.hundred-ok { font-size: .82rem; color: var(--status-ok-fg); margin-bottom: 8px; }
.hundred-rejected { display: flex; flex-direction: column; gap: 8px; }
.hundred-rejected-item { padding: 10px 12px; border: 1px solid rgba(66, 77, 84, .45); border-radius: 6px; background: var(--showcase-tactical-soft); }
.hundred-rejected-head { margin-bottom: 4px; }
.hundred-rejected-head strong { font-size: .85rem; color: var(--showcase-tactical-heading); }
.hundred-rejected-reason { margin: 0; font-size: .8rem; color: var(--showcase-tactical-text); }
.hundred-rejected-text { margin: 2px 0 0; font-size: .78rem; color: #9aa09c; line-height: 1.4; }

@media (width < 768px) {
  /* .profile-body 的移动端形态由 showcase.css 全局规则（display:block !important）
     唯一拥有，此处不再声明对 block 容器无效的 flex-direction。 */
  .profile-right { width: 100%; }
  .profile-hero { flex-direction: column; gap: 12px; align-items: flex-start; }
}
</style>
