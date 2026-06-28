<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import * as api from '../utils/api-boost.js'

const { t } = useI18n()
const { initPromise, login, logout, isAuthenticated, userName, initError } = useAuth()

const phase = ref('init')
const profile = ref(null)
const loginStarted = ref(false)

// Edit states
const editingName = ref(false)
const editingAccount = ref(false)
const editName = ref('')
const editAccountId = ref(null)
const editNickname = ref('')
const editError = ref('')

onMounted(async () => {
  try {
    const loggedIn = await initPromise
    if (loggedIn || isAuthenticated()) {
      phase.value = 'done'
      loadProfile()
    } else if (initError.value) {
      phase.value = 'error'
    } else {
      phase.value = 'login'
      login()
    }
  } catch {
    phase.value = 'error'
  }
})

async function loadProfile() {
  try {
    profile.value = await api.getUserProfile()
  } catch {
    profile.value = null
  }
}

function doLogin() { if (!loginStarted.value) { loginStarted.value = true; login() } }
function doLogout() { logout() }

function startEditName() {
  editName.value = profile.value?.displayName || userName() || ''
  editingName.value = true
  editError.value = ''
}
async function saveName() {
  editError.value = ''
  try {
    profile.value = await api.updateUserProfile({ displayName: editName.value })
    editingName.value = false
  } catch (e) { editError.value = e.message }
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
    profile.value = await api.updateUserWotbAccount({
      wotbAccountId: editAccountId.value,
      wotbNickname: editNickname.value,
      wotbServer: 'CN'
    })
    editingAccount.value = false
  } catch (e) { editError.value = e.message }
}
async function removeAccount() {
  if (!confirm(t('profile.unbindConfirm'))) return
  editError.value = ''
  try {
    profile.value = await api.deleteUserWotbAccount()
  } catch (e) { editError.value = e.message }
}
</script>

<template>
  <div class="profile-page">
    <div v-if="phase === 'init'" class="profile-empty">{{ $t('profile.loading') }}</div>

    <div v-else-if="phase === 'error'" class="profile-card profile-message">
      <p class="text-error">{{ $t('profile.error') }}</p>
      <button class="btn-primary" @click="doLogin">{{ $t('profile.retry') }}</button>
    </div>

    <div v-else-if="phase === 'login'" class="profile-card profile-message">
      <p>{{ $t('profile.redirecting') }}</p>
      <button class="btn-primary" @click="doLogin">{{ $t('profile.manualLogin') }}</button>
    </div>

    <div v-else-if="profile" class="profile-main">
      <div class="profile-card profile-hero">
        <div class="hero-left">
          <div class="hero-avatar">{{ (profile.displayName || userName() || '?')[0] }}</div>
          <div class="hero-identity">
            <h2 class="hero-name">{{ profile.displayName || userName() || 'WoTBTools User' }}</h2>
            <div class="hero-meta">
              <span class="hero-badge">Keycloak</span>
            </div>
          </div>
        </div>
        <button class="btn-ghost" @click="doLogout">{{ $t('profile.logout') }}</button>
      </div>

      <div class="profile-body">
        <div class="profile-left">
          <!-- Display Name -->
          <div class="profile-card profile-section">
            <div class="section-head">
              <h3 class="card-title">{{ $t('profile.displayName') }}</h3>
              <button v-if="!editingName" class="btn-ghost btn-sm" @click="startEditName">{{ $t('profile.edit') }}</button>
            </div>
            <div v-if="editingName" class="edit-row">
              <input v-model="editName" maxlength="64" class="edit-input" />
              <button class="btn-primary btn-sm" @click="saveName">{{ $t('profile.save') }}</button>
              <button class="btn-ghost btn-sm" @click="editingName = false">{{ $t('profile.cancel') }}</button>
              <span v-if="editError" class="error">{{ editError }}</span>
            </div>
            <p v-else class="profile-value">{{ profile.displayName || '—' }}</p>
          </div>

          <!-- WoTB Account -->
          <div class="profile-card profile-section">
            <div class="section-head">
              <h3 class="card-title">{{ $t('profile.wotbTitle') }}</h3>
              <div class="section-actions">
                <button v-if="!editingAccount && !profile.wotbAccountId" class="btn-primary btn-sm" @click="startEditAccount">{{ $t('profile.setAccount') }}</button>
                <button v-if="!editingAccount && profile.wotbAccountId" class="btn-ghost btn-sm" @click="startEditAccount">{{ $t('profile.edit') }}</button>
                <button v-if="!editingAccount && profile.wotbAccountId" class="btn-ghost btn-sm" @click="removeAccount">{{ $t('profile.unbind') }}</button>
              </div>
            </div>

            <div v-if="editingAccount" class="edit-form">
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

            <div v-else-if="profile.wotbAccountId" class="account-bound">
              <div class="account-row"><span>{{ $t('profile.accountId') }}</span><code>{{ profile.wotbAccountId }}</code></div>
              <div class="account-row"><span>{{ $t('profile.nickname') }}</span><strong>{{ profile.wotbNickname || '—' }}</strong></div>
              <div class="account-row"><span>{{ $t('profile.server') }}</span><span class="badge-ok">{{ profile.wotbServer }}</span></div>
            </div>
            <p v-else class="profile-empty">{{ $t('profile.wotbNotBound') }}</p>
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
.profile-page { max-width: 900px; margin: 0 auto; padding: 24px 20px 64px; }
.profile-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; }
.profile-message { max-width: 400px; margin: 60px auto; padding: 40px; text-align: center; }
.profile-empty { padding: 24px 0; text-align: center; color: var(--text-sub); font-size: .9rem; }
.profile-section { padding: 24px; margin-bottom: 16px; }
.card-title { font-size: .95rem; font-weight: 600; color: var(--text-heading); margin: 0; }
.section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.section-actions { display: flex; gap: 6px; }
.profile-hero { display: flex; align-items: center; justify-content: space-between; padding: 28px 32px; margin-bottom: 24px; }
.hero-left { display: flex; align-items: center; gap: 20px; }
.hero-avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 700; flex-shrink: 0; }
.hero-name { font-size: 1.3rem; font-weight: 700; color: var(--text-heading); margin: 0 0 6px; }
.hero-meta { display: flex; gap: 8px; align-items: center; }
.hero-badge { font-size: .72rem; padding: 2px 10px; border-radius: 10px; background: var(--bg-blue); color: var(--accent); font-weight: 600; }
.profile-body { display: flex; gap: 24px; align-items: flex-start; }
.profile-left { flex: 1; min-width: 0; }
.profile-right { width: 340px; flex-shrink: 0; }
.profile-value { font-size: 1rem; color: var(--text); }
.account-bound { display: flex; flex-direction: column; gap: 10px; }
.account-row { display: flex; justify-content: space-between; font-size: .88rem; color: var(--text); }
.account-row span { color: var(--text-sub); }
.account-row code { font-family: monospace; font-size: .8rem; color: var(--accent); }
.badge-ok { font-size: .72rem; padding: 1px 8px; border-radius: 8px; background: #dcfce7; color: #166534; font-weight: 600; }
.edit-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.edit-form .edit-row { margin-bottom: 10px; }
.edit-form label { display: block; font-size: .8rem; color: var(--text-sub); margin-bottom: 3px; }
.edit-input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: .88rem; width: 200px; font-family: inherit; }
.error { color: #dc3545; font-size: .82rem; }
.text-muted { font-size: .8rem; color: var(--text-sub); line-height: 1.5; }
.security-info { display: flex; flex-direction: column; gap: 8px; }
.sec-row { display: flex; justify-content: space-between; font-size: .88rem; }
.sec-row span { color: var(--text-sub); }
.sec-row code { font-family: monospace; font-size: .78rem; color: var(--accent); }
.btn-primary { padding: 8px 20px; border: none; border-radius: 10px; background: var(--accent); color: #fff; font-size: .88rem; cursor: pointer; font-family: inherit; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-sm { padding: 5px 12px; font-size: .8rem; border-radius: 8px; }
.btn-ghost { padding: 8px 18px; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--text); font-size: .85rem; cursor: pointer; font-family: inherit; }
.btn-ghost.btn-sm { padding: 5px 12px; font-size: .8rem; border-radius: 8px; }
.btn-ghost:hover { background: var(--bg-card2); }
@media (max-width: 768px) {
  .profile-body { flex-direction: column; }
  .profile-right { width: 100%; }
  .profile-hero { flex-direction: column; gap: 12px; align-items: flex-start; }
}
</style>
