<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import {
  createUserProfile,
  deleteUserWotbAccount,
  getMyBoosterAssignments,
  getMyBoosterProfile,
  getUserHofRecords,
  getUserProfile,
  updateMyBoosterAvailability,
  updateUserWotbAccount
} from '../utils/api-boost.js'
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  syncUserWotbAccountFromLogin
} from '../utils/api-boost.js'
import { hofHundredCancel, hofHundredMyStatus } from '../utils/api.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel, enumLabel } from '../utils/display.js'

const { locale, t, te } = useI18n()
const { initPromise, login, isAuthenticated, initError, tokenParsed } = useAuth()

const phase = ref('init')
const profile = ref(null)
const loginStarted = ref(false)

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
const boosterInfo = ref(null)
const boosterAssignments = ref([])
const loadingBoosterAssignments = ref(false)
const boosterAssignmentsError = ref('')
const boosterAvailabilityPending = ref(false)
const boosterAvailabilityError = ref('')

// Notifications
const notifications = ref([])
const unreadNotifications = ref(0)
const notificationsOpen = ref(false)
const loadingNotifications = ref(false)
const notificationError = ref('')

function label(group, value, fallback = '--') {
  return enumLabel(t, te, group, value, fallback)
}

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
      // 未登录：直接跳转 Keycloak 托管登录页（IdP 选择由 Keycloak 页面提供）。
      doLogin()
    }
  } catch {
    phase.value = 'error'
  }
})

async function loadProfile() {
  try {
    profile.value = await getUserProfile()
  } catch {
    try {
      profile.value = await createUserProfile()
    } catch {
      profile.value = null
      phase.value = 'error'
      return
    }
  }
  await syncFromLogin()
  if (profile.value?.wotbAccountId) {
    loadRecords()
    loadHundredStatus()
  }
  loadBoosterInfo()
  loadUnreadNotificationCount()
  if (isBoosterUser.value) {
    await loadBoosterAssignments()
  }
}

/** WG 幂等同步（ASIA/EU/NA）：昵称变化时刷新；失败不再静默，保留错误状态供重试。 */
async function syncFromLogin() {
  if (!isWargamingLogin.value) return
  syncFromLoginPending.value = true
  syncFromLoginError.value = null
  try {
    const synced = await syncUserWotbAccountFromLogin()
    if (synced) {
      profile.value = synced
    }
  } catch (e) {
    // 保留后端业务错误码：同步失败时绝不回退为 CN 手动入口。
    syncFromLoginError.value = e
  } finally {
    syncFromLoginPending.value = false
  }
}

const displayName = computed(() =>
  profile.value?.displayName
  ?? tokenParsed.value?.display_name
  ?? tokenParsed.value?.preferred_username
  ?? t('profile.unknownUser')
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

const isBoosterUser = computed(() => {
  const roles = [
    ...(tokenParsed.value?.realm_access?.roles || []),
    ...(tokenParsed.value?.resource_access?.['wotbtools-web']?.roles || [])
  ]
  return roles.includes('booster')
})

const activeBoosterAssignments = computed(() =>
  boosterAssignments.value.filter(assignment => !assignment.unassignedAt)
)

const historyBoosterAssignments = computed(() =>
  boosterAssignments.value.filter(assignment => assignment.unassignedAt)
)

const boosterAvailabilityKey = computed(() => {
  if (!boosterInfo.value?.available) return 'paused'
  return (boosterInfo.value?.activeAssignmentCount || 0) > 0 ? 'busy' : 'available'
})

const boosterAvailabilityLabel = computed(() =>
  boosterInfo.value ? t(`boost.boosterAvailabilityState.${boosterAvailabilityKey.value}`) : '--'
)

const boosterAvailabilityActionLabel = computed(() =>
  boosterInfo.value?.available ? t('profile.pauseBoosterAvailability') : t('profile.resumeBoosterAvailability')
)

function doLogin() {
  if (!loginStarted.value) {
    loginStarted.value = true
    login()
  }
}

function startEditAccount() {
  editAccountId.value = profile.value?.wotbAccountId || null
  editNickname.value = profile.value?.wotbNickname || ''
  editingAccount.value = true
  editError.value = ''
}

async function saveAccount() {
  editError.value = ''
  try {
    profile.value = await updateUserWotbAccount({
      wotbAccountId: editAccountId.value,
      wotbNickname: editNickname.value,
      wotbServer: 'CN'
    })
    editingAccount.value = false
    loadRecords()
    loadHundredStatus()
  } catch (e) {
    editError.value = apiError(e)
  }
}

async function loadBoosterInfo() {
  try {
    boosterInfo.value = await getMyBoosterProfile()
    boosterAvailabilityError.value = ''
  } catch {
    boosterInfo.value = null
  }
}

async function toggleBoosterAvailability() {
  if (!boosterInfo.value || boosterAvailabilityPending.value) return
  boosterAvailabilityPending.value = true
  boosterAvailabilityError.value = ''
  try {
    boosterInfo.value = await updateMyBoosterAvailability({
      available: !boosterInfo.value.available
    })
  } catch (e) {
    boosterAvailabilityError.value = apiError(e)
  } finally {
    boosterAvailabilityPending.value = false
  }
}

async function loadBoosterAssignments() {
  loadingBoosterAssignments.value = true
  boosterAssignmentsError.value = ''
  try {
    boosterAssignments.value = await getMyBoosterAssignments(true)
  } catch (error) {
    boosterAssignmentsError.value = apiError(error)
  } finally {
    loadingBoosterAssignments.value = false
  }
}

async function loadRecords() {
  recordsError.value = ''
  try {
    records.value = await getUserHofRecords()
  } catch (error) {
    recordsError.value = apiError(error)
  }
}

/** 个人中心「我的百场成绩」：当前认证 / 当前申请 / 最近拒绝。 */
async function loadHundredStatus() {
  hundredError.value = ''
  try {
    hundredStatus.value = await hofHundredMyStatus()
  } catch (error) {
    hundredStatus.value = null
    hundredError.value = apiError(error)
  }
}

/** 撤销当前待审核申请：确认后调用取消 API，成功后刷新状态。 */
async function withdrawHundred(id) {
  if (!confirm(t('hundred.withdrawConfirm'))) return
  hundredWithdrawingId.value = id
  hundredMessage.value = ''
  hundredError.value = ''
  try {
    await hofHundredCancel(id)
    hundredMessage.value = t('hundred.withdrawSuccess')
    await loadHundredStatus()
  } catch (error) {
    hundredError.value = apiError(error)
  } finally {
    hundredWithdrawingId.value = null
  }
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString(locale.value) : '--'
}

async function removeAccount() {
  if (!confirm(t('profile.unbindConfirm'))) return
  editError.value = ''
  try {
    profile.value = await deleteUserWotbAccount()
    records.value = []
  } catch (e) {
    editError.value = apiError(e)
  }
}

function assignmentTime(value) {
  return value ? new Date(value).toLocaleString(locale.value) : '--'
}

// Notifications
async function loadNotifications() {
  loadingNotifications.value = true
  notificationError.value = ''
  try {
    notifications.value = await listNotifications()
    unreadNotifications.value = notifications.value.filter(n => !n.read).length
  } catch (e) {
    notificationError.value = apiError(e)
  } finally {
    loadingNotifications.value = false
  }
}

async function loadUnreadNotificationCount() {
  try {
    const res = await getUnreadNotificationCount()
    unreadNotifications.value = res.count || 0
  } catch {
    unreadNotifications.value = 0
  }
}

async function toggleNotifications() {
  notificationsOpen.value = !notificationsOpen.value
  if (notificationsOpen.value) await loadNotifications()
}

async function readNotification(notification) {
  if (!notification.read) {
    try {
      await markNotificationRead(notification.id)
      await loadNotifications()
    } catch (error) {
      notificationError.value = apiError(error)
    }
  }
}

async function readAllNotifications() {
  try {
    await markAllNotificationsRead()
    await loadNotifications()
  } catch (e) {
    notificationError.value = apiError(e)
  }
}

function notificationTitle(notification) {
  return t(`boost.notificationTitle.${notification.type}`, notification.payload || {})
}

function notificationMessage(notification) {
  return t(`boost.notificationMessage.${notification.type}`, notification.payload || {})
}
</script>

<template>
  <div class="profile-page">
    <div v-if="phase === 'init'" class="profile-empty">{{ $t('profile.loading') }}</div>

    <div v-else-if="phase === 'error'" class="profile-card profile-message">
      <p class="text-error">{{ $t('profile.error') }}</p>
      <button class="btn-primary" @click="doLogin">{{ $t('profile.retry') }}</button>
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
                <button class="btn-ghost btn-sm" :disabled="syncFromLoginPending" @click="syncFromLogin">
                  {{ syncFromLoginPending ? $t('profile.wgSyncing') : $t('profile.wgSyncRetry') }}
                </button>
              </div>
            </div>
            <div v-else-if="profile.wotbAccountId" class="account-bound">
              <div class="account-row"><span>{{ $t('profile.accountId') }}</span><code>{{ profile.wotbAccountId }}</code></div>
              <div class="account-row"><span>{{ $t('profile.nickname') }}</span><strong>{{ profile.wotbNickname || '--' }}</strong></div>
              <div class="account-row"><span>{{ $t('profile.server') }}</span><span class="badge-ok">{{ serverLabel }}</span></div>
              <div class="account-row"><span>{{ $t('profile.accountSource') }}</span><strong>{{ $t('profile.sourceUserFilled') }}</strong></div>
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
          <!-- Notifications -->
          <div class="profile-card profile-section">
            <div class="section-head" style="cursor: pointer" @click="toggleNotifications()">
              <h3 class="card-title">
                {{ $t('boost.notifications') }}
                <span v-if="unreadNotifications > 0" class="notification-count">{{ unreadNotifications }}</span>
              </h3>
              <div class="section-actions">
                <button v-if="notificationsOpen && notifications.length" class="btn-ghost btn-sm" @click.stop="readAllNotifications()">{{ $t('boost.markAllRead') }}</button>
              </div>
            </div>
            <div v-if="notificationError" class="error">{{ notificationError }}</div>
            <div v-if="notificationsOpen">
              <div v-if="loadingNotifications" class="profile-empty profile-empty-tight">{{ $t('profile.loading') }}</div>
              <div v-else-if="!notifications.length" class="profile-empty profile-empty-tight">{{ $t('boost.noNotifications') }}</div>
              <div v-else class="notification-list">
                <div
                  v-for="n in notifications"
                  :key="n.id"
                  class="notification-item"
                  :class="{ unread: !n.read }"
                  @click="readNotification(n)"
                >
                  <div class="notification-title">{{ notificationTitle(n) }}</div>
                  <div class="notification-msg">{{ notificationMessage(n) }}</div>
                  <div class="notification-time">{{ new Date(n.createdAt).toLocaleString() }}</div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="boosterInfo" class="profile-card profile-section">
            <div class="section-head">
              <h3 class="card-title">{{ $t('profile.boosterTitle') }}</h3>
              <div class="section-actions">
                <button
                  class="btn-ghost btn-sm"
                  :disabled="boosterAvailabilityPending"
                  @click="toggleBoosterAvailability"
                >
                  {{ boosterAvailabilityPending ? $t('profile.boosterAvailabilitySaving') : boosterAvailabilityActionLabel }}
                </button>
              </div>
            </div>
            <div class="booster-info">
              <div class="sec-row"><span>{{ $t('profile.boosterNickname') }}</span><strong>{{ boosterInfo.nickname }}</strong></div>
              <div class="sec-row"><span>{{ $t('profile.boosterLevel') }}</span><span class="badge-ok">{{ label('level', boosterInfo.level) }}</span></div>
              <div class="sec-row"><span>{{ $t('profile.boosterActiveAssignments') }}</span><strong>{{ boosterInfo.activeAssignmentCount }}</strong></div>
              <div class="sec-row">
                <span>{{ $t('profile.boosterAvailability') }}</span>
                <span class="availability-badge" :class="boosterAvailabilityKey">{{ boosterAvailabilityLabel }}</span>
              </div>
              <div v-if="boosterInfo.status === 'ACTIVE'" class="profile-status-ok">{{ $t('profile.boosterActive') }}</div>
              <div v-else class="profile-status-warn">{{ $t('profile.boosterInactive') }}</div>
              <p class="text-muted">{{ $t('profile.boosterAvailabilityHint') }}</p>
              <p v-if="boosterAvailabilityError" class="error">{{ boosterAvailabilityError }}</p>
            </div>
          </div>

          <div class="profile-card profile-section">
            <h3 class="card-title">{{ $t('profile.securityTitle') }}</h3>
            <div class="security-info">
              <div class="sec-row"><span>{{ $t('profile.loginMethod') }}</span><strong>Keycloak</strong></div>
              <div class="sec-row"><span>{{ $t('profile.authService') }}</span><code>auth.wotbtools.com</code></div>
              <p class="text-muted">{{ $t('profile.securityDesc') }}</p>
            </div>
          </div>

          <div v-if="isBoosterUser" class="profile-card profile-section">
            <div class="section-head">
              <h3 class="card-title">{{ $t('profile.myAssignments') }}</h3>
              <span class="section-meta">{{ boosterAssignments.length }}</span>
            </div>
            <div v-if="loadingBoosterAssignments" class="profile-empty profile-empty-tight">{{ $t('profile.loading') }}</div>
            <p v-else-if="boosterAssignmentsError" class="error">{{ boosterAssignmentsError }}</p>
            <template v-else>
              <div class="assignment-group">
                <h4 class="assign-group-title">{{ $t('profile.activeAssignments') }}</h4>
                <p v-if="!activeBoosterAssignments.length" class="profile-empty profile-empty-tight">{{ $t('profile.noActiveAssignments') }}</p>
                <div v-else class="assign-list">
                  <div v-for="a in activeBoosterAssignments" :key="a.id" class="assign-card">
                    <div class="assign-head">
                      <span class="assign-type">{{ label('requestTypeValue', a.requestType, $t('boost.requestType')) }}</span>
                      <span class="assign-status-tag" :class="a.status?.toLowerCase()">{{ label('assignmentStatus', a.status) }}</span>
                    </div>
                    <div class="assign-desc">{{ a.targetDescription || '--' }}</div>
                    <div class="assign-meta">
                      <span>{{ $t('boost.assigned') }}: {{ assignmentTime(a.assignedAt) }}</span>
                    </div>
                    <p v-if="a.note" class="assign-note">{{ $t('profile.assignmentNote') }}: {{ a.note }}</p>
                  </div>
                </div>
              </div>

              <div class="assignment-group">
                <h4 class="assign-group-title">{{ $t('profile.assignmentHistory') }}</h4>
                <p v-if="!historyBoosterAssignments.length" class="profile-empty profile-empty-tight">{{ $t('profile.noAssignmentHistory') }}</p>
                <div v-else class="assign-list">
                  <div v-for="a in historyBoosterAssignments" :key="a.id" class="assign-card">
                    <div class="assign-head">
                      <span class="assign-type">{{ label('requestTypeValue', a.requestType, $t('boost.requestType')) }}</span>
                      <span class="assign-status-tag" :class="a.status?.toLowerCase()">{{ label('assignmentStatus', a.status) }}</span>
                    </div>
                    <div class="assign-desc">{{ a.targetDescription || '--' }}</div>
                    <div class="assign-meta">
                      <span>{{ $t('boost.assigned') }}: {{ assignmentTime(a.assignedAt) }}</span>
                      <span>{{ $t('profile.assignmentClosedAt') }}: {{ assignmentTime(a.unassignedAt) }}</span>
                    </div>
                    <p v-if="a.note" class="assign-note">{{ $t('profile.assignmentNote') }}: {{ a.note }}</p>
                  </div>
                </div>
              </div>
            </template>
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
.booster-info { display: flex; flex-direction: column; gap: 8px; }
.availability-badge { font-size: .72rem; padding: 2px 8px; border-radius: 6px; font-weight: 700; }
.availability-badge.available { background: var(--status-ok-bg); color: var(--status-ok-fg); }
.availability-badge.busy { background: var(--status-info-bg); color: var(--status-info-fg); }
.availability-badge.paused { background: var(--status-warn-bg); color: var(--status-warn-fg); }
.profile-status-ok { font-size: .8rem; color: var(--status-ok-fg); font-weight: 700; }
.profile-status-warn { font-size: .8rem; color: var(--status-warn-fg); font-weight: 700; }
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
.assignment-group + .assignment-group { margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(66, 77, 84, .45); }
.assign-group-title { margin: 0 0 10px; font-size: .78rem; font-weight: 700; color: #a3a6a0; letter-spacing: .05em; text-transform: uppercase; }
.assign-list { display: flex; flex-direction: column; gap: 8px; }
.assign-card { padding: 12px; border: 1px solid rgba(66, 77, 84, .45); border-radius: 8px; background: var(--showcase-tactical-soft); }
.assign-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
.assign-type { font-weight: 600; font-size: .88rem; color: var(--showcase-tactical-heading); }
.assign-status-tag { font-size: .75rem; padding: 2px 8px; border-radius: 6px; background: var(--bg-chip); color: var(--text-sub); }
.assign-status-tag.assigned { background: var(--status-info-bg); color: var(--status-info-fg); }
.assign-status-tag.accepted,
.assign-status-tag.in_progress,
.assign-status-tag.pending_confirm,
.assign-status-tag.completed { background: var(--status-ok-bg); color: var(--status-ok-fg); }
.assign-status-tag.declined,
.assign-status-tag.cancelled { background: var(--status-err-bg); color: var(--status-err-fg); }
.assign-status-tag.exception { background: var(--status-warn-bg); color: var(--status-warn-fg); }
.assign-desc { font-size: .85rem; color: var(--showcase-tactical-text); margin-bottom: 4px; line-height: 1.4; }
.assign-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: .78rem; color: #9aa09c; }
.assign-note { margin: 6px 0 0; font-size: .78rem; color: #9aa09c; line-height: 1.4; }

/* Notifications */
.notification-count { display: inline-flex; min-width: 18px; height: 18px; align-items: center; justify-content: center; margin-left: 6px; padding: 0 4px; border-radius: 999px; background: var(--error); color: var(--danger-solid-fg); font-size: 11px; vertical-align: middle; }
.notification-list { display: flex; flex-direction: column; gap: 6px; }
.notification-item { cursor: pointer; padding: 8px 10px; border: 1px solid rgba(66, 77, 84, .45); border-radius: 6px; background: var(--showcase-tactical-soft); transition: background .12s; }
.notification-item:hover { background: #172025; }
.notification-item.unread { border-color: var(--accent); background: rgba(217, 143, 24, .08); }
.notification-title { font-weight: 600; font-size: .82rem; color: var(--showcase-tactical-text); line-height: 1.3; }
.notification-msg { font-size: .78rem; color: #a3a6a0; margin-top: 2px; }
.notification-time { font-size: .72rem; color: #9aa09c; margin-top: 3px; }

@media (width < 768px) {
  .profile-body { flex-direction: column; }
  .profile-right { width: 100%; }
  .profile-hero { flex-direction: column; gap: 12px; align-items: flex-start; }
}
</style>
