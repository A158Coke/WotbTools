<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { useI18n } from 'vue-i18n'
import { confirm } from '../composables/useConfirm.js'
import { useAuth } from '../composables/useAuth.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'
import { whenBusinessUserSettled } from '../composables/useBusinessUserBootstrap.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import AppButton from './AppButton.vue'
import AppSwitch from './AppSwitch.vue'
import { useReplay3DAutoStart } from '../composables/useReplay3DAutoStart.ts'
import { sectionHeroStyle } from '../shared/sectionHeroes'

import { useProfileIdentity } from './profile/useProfileIdentity.ts'
import { useProfileRecords } from './profile/useProfileRecords.ts'
import { useProfileHundred } from './profile/useProfileHundred.ts'
import { useProfileWotbAccount } from './profile/useProfileWotbAccount.ts'
import { useProfileSession } from './profile/useProfileSession.ts'
import { getUserProfile } from '../api/user-profile.js'
const { locale, t, te } = useI18n()
const navigateView = inject(NAVIGATE_VIEW_KEY, null)
const { initPromise, login, logout, isAuthenticated, authenticated: authState, initError, tokenParsed, displayName: authDisplayName, authEpoch } = useAuth()

/** 3D 自动播放偏好（按 Keycloak sub 隔离；无登录身份时不可用、不显示设置）。 */
const { available: autoStart3dAvailable, enabled: autoStart3dEnabled } = useReplay3DAutoStart(
  () => (authState.value && tokenParsed.value?.sub ? String(tokenParsed.value.sub) : ''),
)

/**
 * 本页所有 backend 动作的统一门禁（PR #467 review blocker）。
 *
 * profile 数据来自 backend ⇒ 页面整体是 ONLINE_REQUIRED，但**按业务 feature 拆分**：
 *  - 账号资料读写（get / sync / update / verify / delete）走 [Feature.ACCOUNT_PROFILE]；
 *  - 名人堂记录 / 百场状态 / 撤销走 [Feature.HALL_OF_FAME]。
 * 判定一律来自 `useFeatureGate()`（capability SSOT），页面**不写** `connectivity === 'online'`
 * 这类第二套规则，也不在 transport 层（api/user-profile.ts）里塞连通性判断。
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
const androidBrowser = !isAndroidApp() && /Android/i.test(navigator.userAgent)
const authErrorKey = computed(() => initError.value?.code === 'AUTH_RETURN_NOT_COMPLETED'
  ? 'profile.authReturnError' : 'profile.error')
/**
 * 离线 / 状态未知时的中性提示文案（取自 capability 模型，不另造文案、不当成错误态）。
 * 实时派生而非进入时快照：首次检测未完成（pending）时不下结论，settle 后显示真实状态。
 */
const profileAvailability = computed(() => availability(Feature.ACCOUNT_PROFILE))
const unavailableMessageKey = computed(() => {
  const current = profileAvailability.value
  // pending：尚未下结论；available：已恢复在线、正在重新加载（phase 尚未离开
  // connectivity-unavailable）—— 两种情况都不得显示「需要联网」类文案。
  if (current.pending || current.available) return ''
  return current.messageKey || 'featureOffline.accountProfile'
})

/** loadProfile 进行中标志：reconnect watch 与手动 retry 共用的去重位。 */
const syncFromLoginPending = ref(false)
const syncFromLoginError = ref(null)
const loading = ref(false)

const {
  displayName, heroSubtitle, realmRoles,
  userIdCopied, resetUserIdCopied, copyUserId,
  isWargamingLogin, isWargamingProfile, serverLabel,
} = useProfileIdentity({ profile, tokenParsed, authDisplayName, authEpoch, ownEpoch, t })

const { records, recordsError, loadRecords, reset: resetRecords } = useProfileRecords({
  requireHofOnline, ownEpoch, epochArg, apiError,
})

const {
  hundredStatus, hundredError, hundredWithdrawingId, hundredMessage,
  loadHundredStatus, withdrawHundred, reset: resetHundred,
} = useProfileHundred({ requireHofOnline, ownEpoch, epochArg, authEpoch, apiError, t, confirm })

const {
  editingAccount, editAccountId, editNickname, editError,
  startEditAccount, saveAccount,
  verifyInput, verifyPending, verifyError, verifyWithReplay,
  removeAccount, reset: resetAccountEditor,
} = useProfileWotbAccount({
  profile, requireProfileOnline, ownEpoch, authEpoch, apiError,
  loadRecords, loadHundredStatus, confirm, t,
})

const { loadProfile, syncFromLogin } = useProfileSession({
  phase, loading, profile, isAuthenticated, authEpoch, ownEpoch, epochArg,
  requireProfileOnline,
  availabilityProfile: () => availability(Feature.ACCOUNT_PROFILE),
  connectivity, whenBusinessUserSettled,
  syncFromLoginPending, syncFromLoginError, isWargamingLogin,
  loadRecords, loadHundredStatus, getUserProfile,
})

function apiError(error) {
  return apiErrorLabel(t, te, error)
}

onMounted(async () => {
  try {
    // `initPromise` 只用来等 auth bootstrap **落定**（它 resolve 值为 undefined：模块级一次性
    // 交易，logout 不会重建它，它的历史结果在登出后立刻失效）。
    // 登录态一律只认当前 reactive session —— 否则 logout 后重挂载会误进 done，页面永久停在
    // `profile.loading`（Android 2.1.0 真机 bug）。
    await initPromise
    if (isAuthenticated()) {
      phase.value = 'done'
      void loadProfile()
    } else if (initError.value) {
      phase.value = 'auth-error'
    } else {
      // 未登录：显示账户说明卡与登录按钮（design-language §10），不自动跳转登录页。
      phase.value = 'signedOut'
    }
  } catch {
    phase.value = 'auth-error'
  }
})

/**
 * 认证状态**响应式**语义（2.1.0 Phase 6 / 7）：
 * - false → true（登录回站 / 账户切到 B / Android authChanged 推送）：立即进入已登录并
 *   恰好加载一次（loading + profile 双重去重，不因 watcher 与手动 retry 叠加出请求风暴）；
 * - true → false（logout / 会话失效）：**立即**清理上一账号的一切投影——profile / records /
 *   hundred / 同步与编辑状态 / 错误——不得等页面重挂或刷新。
 * 在途请求由 loadProfile 等各自的 epoch 复核丢弃（Phase 7.2）。
 */
watch(() => [authState.value, tokenParsed.value?.sub], ([now, sub], [before, previousSub]) => {
  if (before === now && sub === previousSub) return
  profile.value = null
  resetRecords()
  resetHundred()
  syncFromLoginPending.value = false
  syncFromLoginError.value = null
  resetAccountEditor()
  resetUserIdCopied()
  loginStarted.value = false
  loading.value = false
  phase.value = now ? 'done' : 'signedOut'
  if (now) void loadProfile()
})

async function doLogin() {
  if (loginStarted.value) return
  const epoch = authEpoch()
  loginStarted.value = true
  try {
    await login('profile')
  } catch {
    if (authEpoch() === epoch && !isAuthenticated()) phase.value = 'auth-error'
  } finally {
    if (authEpoch() === epoch) loginStarted.value = false
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

function formatTime(value) {
  return value ? new Date(value).toLocaleString(locale.value) : '--'
}

</script>

<template>
  <div class="profile-page" data-tour="settings-account">
    <div v-if="phase === 'init'" class="profile-empty">{{ $t('profile.loading') }}</div>

    <div v-else-if="phase === 'auth-error' || phase === 'profile-error'" class="profile-card profile-message">
      <p class="text-error">{{ $t(phase === 'profile-error' ? 'profile.loadError' : authErrorKey) }}</p>
      <button class="btn-primary" data-testid="profile-retry" :disabled="loading || loginStarted" @click="retry">{{ $t(phase === 'auth-error' ? 'profile.retry' : 'profile.loadRetry') }}</button>
    </div>

    <div v-else-if="phase === 'signedOut'" class="profile-signed-out" data-testid="profile-signed-out">
      <h1 class="profile-signed-out-title">{{ $t('account.signedOutTitle') }}</h1>
      <p class="profile-signed-out-hint">{{ $t('account.signedOutHint') }}</p>
      <p v-if="androidBrowser" class="text-sub" data-testid="profile-browser-login-hint">{{ $t('profile.androidBrowserLoginHint') }}</p>
      <AppButton variant="primary" size="lg" data-testid="profile-login" @click="doLogin">{{ $t('app.login') }}</AppButton>
    </div>

    <!--
      连通性不可用：**中性**空态，不是错误态。文案直接来自 capability 模型（offline 时是
      「账号资料需要联网读取」，unknown / degraded / service-unavailable 各有自己的说法），
      即时提示由统一的 ConnectivityNoticeDialog 负责，这里不另造 modal。
    -->
    <div v-else-if="phase === 'connectivity-unavailable'" class="profile-card profile-message" data-testid="profile-connectivity-unavailable">
      <template v-if="unavailableMessageKey">
        <p class="text-sub">{{ $t(unavailableMessageKey) }}</p>
        <button class="btn-primary" data-testid="profile-retry" :disabled="loading || loginStarted" @click="retry">{{ $t('profile.loadRetry') }}</button>
      </template>
    </div>

    <div v-else-if="profile" class="profile-main">
      <div class="profile-card profile-hero" :style="sectionHeroStyle('profile')">
        <div class="hero-left">
          <div class="hero-avatar">{{ (displayName || '?')[0] }}</div>
          <div class="hero-identity">
            <h2 class="hero-name">{{ displayName }}</h2>
            <p class="hero-subtitle">{{ heroSubtitle }}</p>
          </div>
        </div>
        <!-- 4.0：页头只放去设置 / 提交成绩的入口；登出移到右栏底部的描边按钮 -->
        <div class="hero-links">
          <button v-if="navigateView" type="button" class="hero-link" data-testid="profile-settings-link" @click="navigateView('more')">{{ $t('profile.settingsLink') }}</button>
          <button v-if="navigateView" type="button" class="hero-link" data-testid="profile-submit-link" @click="navigateView('hof')">{{ $t('profile.submitLink') }}</button>
        </div>
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
            <div class="info-row">
              <span class="info-label">{{ $t('profile.keycloakUserId') }}</span>
              <span class="info-value info-value-copy">
                <code data-testid="profile-keycloak-user-id">{{ profile.keycloakUserId || '--' }}</code>
                <button v-if="profile.keycloakUserId" type="button" class="btn-ghost btn-sm" data-testid="profile-copy-user-id" @click="copyUserId">
                  {{ $t(userIdCopied ? 'profile.copied' : 'profile.copy') }}
                </button>
              </span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ $t('profile.keycloakUsername') }}</span>
              <span class="info-value"><code data-testid="profile-keycloak-username">{{ profile.username || '--' }}</code></span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ $t('profile.roles') }}</span>
              <span class="info-value role-list" data-testid="profile-roles">
                <span v-for="role in realmRoles" :key="role" class="role-chip">{{ role }}</span>
                <template v-if="!realmRoles.length">--</template>
              </span>
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
            <p v-else class="profile-empty profile-empty-tight">{{ $t('profile.loadPending') }}</p>
          </div>
        </div>

        <div class="profile-right">
          <div v-if="autoStart3dAvailable" class="profile-card profile-section" data-testid="profile-playback-settings">
            <h3 class="card-title">{{ $t('profile.playbackSettingsTitle') }}</h3>
            <AppSwitch
              v-model="autoStart3dEnabled"
              :label="$t('profile.autoStart3d')"
              :description="$t('profile.autoStart3dHint')"
              data-testid="profile-auto-start-3d"
            />
          </div>
          <div class="profile-card profile-section">
            <h3 class="card-title">{{ $t('profile.securityTitle') }}</h3>
            <div class="security-info">
              <div class="sec-row"><span>{{ $t('profile.loginMethod') }}</span><strong>Keycloak</strong></div>
              <div class="sec-row"><span>{{ $t('profile.authService') }}</span><code>auth.wotbtools.com</code></div>
              <p class="text-muted">{{ $t('profile.securityDesc') }}</p>
            </div>
          </div>
          <AppButton variant="secondary" block data-testid="profile-logout" @click="logout()">{{ $t('profile.logout') }}</AppButton>

        </div>
      </div>
    </div>

    <div v-else class="profile-empty">{{ $t('profile.loadPending') }}</div>
  </div>
</template>

<style scoped src="./profile.css"></style>
