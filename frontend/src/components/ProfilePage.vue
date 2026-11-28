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
import ShowcaseHero from './ShowcaseHero.vue'

import { useProfileIdentity } from './profile/useProfileIdentity.ts'
import { useProfileRecords } from './profile/useProfileRecords.ts'
import { useProfileHundred } from './profile/useProfileHundred.ts'
import { useProfileWotbAccount } from './profile/useProfileWotbAccount.ts'
import { useProfileSession } from './profile/useProfileSession.ts'
import { getUserProfile } from '../api/user-profile.js'
const { locale, t, te } = useI18n()
const navigateView = inject(NAVIGATE_VIEW_KEY, null)
const { initPromise, login, logout, isAuthenticated, authenticated: authState, initError, tokenParsed, displayName: authDisplayName, authEpoch } = useAuth()

const { available: autoStart3dAvailable, enabled: autoStart3dEnabled } = useReplay3DAutoStart(
  () => (authState.value && tokenParsed.value?.sub ? String(tokenParsed.value.sub) : ''),
)

const { availability, requireFeature, connectivity } = useFeatureGate()

function requireProfileOnline() {
  return requireFeature(Feature.ACCOUNT_PROFILE)
}

function requireHofOnline() {
  return requireFeature(Feature.HALL_OF_FAME)
}

const phase = ref('init')




function ownEpoch(epoch) {

  return authEpoch() === epoch && isAuthenticated()

}

function epochArg(value) {
  return Number.isInteger(value) ? value : authEpoch()
}
const profile = ref(null)
const loginStarted = ref(false)
const androidBrowser = !isAndroidApp() && /Android/i.test(navigator.userAgent)
const authErrorKey = computed(() => initError.value?.code === 'AUTH_RETURN_NOT_COMPLETED'
  ? 'profile.authReturnError' : 'profile.error')
const profileAvailability = computed(() => availability(Feature.ACCOUNT_PROFILE))
const unavailableMessageKey = computed(() => {
  const current = profileAvailability.value
  if (current.pending || current.available) return ''
  return current.messageKey || 'featureOffline.accountProfile'
})

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
    await initPromise
    if (isAuthenticated()) {
      phase.value = 'done'
      void loadProfile()
    } else if (initError.value) {
      phase.value = 'auth-error'
    } else {
      phase.value = 'signedOut'
    }
  } catch {
    phase.value = 'auth-error'
  }
})

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

function retry() {
  if (isAuthenticated()) {
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

    <div v-else-if="phase === 'connectivity-unavailable'" class="profile-card profile-message" data-testid="profile-connectivity-unavailable">
      <template v-if="unavailableMessageKey">
        <p class="text-sub">{{ $t(unavailableMessageKey) }}</p>
        <button class="btn-primary" data-testid="profile-retry" :disabled="loading || loginStarted" @click="retry">{{ $t('profile.loadRetry') }}</button>
      </template>
    </div>

    <div v-else-if="profile" class="profile-main">
      <ShowcaseHero section="profile" :title="displayName" :description="heroSubtitle">
        <template v-if="navigateView" #actions>
          <AppButton data-testid="profile-settings-link" @click="navigateView('more')">{{ $t('profile.settingsLink') }}</AppButton>
          <AppButton data-testid="profile-submit-link" @click="navigateView('hof')">{{ $t('profile.submitLink') }}</AppButton>
        </template>
      </ShowcaseHero>

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
