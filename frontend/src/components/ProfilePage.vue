<script setup>
import { onMounted, ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import * as api from '../utils/api.js'

const { t } = useI18n()
const { initPromise, login, logout, isAuthenticated, userName, token, initError } = useAuth()

const phase = ref('init')
const user = ref('')
const me = ref(null)
const wotbAccount = ref(null)
const recentRecords = ref([])
const loginStarted = ref(false)

const stats = computed(() => ({
  leaderboard: me.value?.totalRecords ?? '--',
  maxDamage: me.value?.maxDamage ?? '--',
  accountBound: wotbAccount.value ? t('profile.bound') : t('profile.notBound'),
  notify: t('profile.notEnabled'),
}))

onMounted(async () => {
  try {
    const loggedIn = await initPromise
    if (loggedIn || isAuthenticated()) {
      user.value = userName() || 'WoTBTools User'
      phase.value = 'done'
      loadProfileData()
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

async function loadProfileData() {
  try { me.value = await api.getMe(token()) } catch {}
  try { wotbAccount.value = await api.getWotbAccount(token()) } catch {}
  try { recentRecords.value = (await api.getMyRecords(token())).slice(0, 5) } catch {}
}

function doLogin() {
  if (loginStarted.value) return
  loginStarted.value = true
  login()
}

function doLogout() { logout() }
function goReplay() {
  const url = new URL(window.location.origin)
  url.searchParams.set('view', 'replay')
  window.location.href = url.toString()
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

    <div v-else class="profile-main">
      <div class="profile-card profile-hero">
        <div class="hero-left">
          <div class="hero-avatar">{{ (user||'?')[0] }}</div>
          <div class="hero-identity">
            <h2 class="hero-name">{{ user }}</h2>
            <div class="hero-meta">
              <span class="hero-badge">Keycloak</span>
              <span class="hero-status">{{ $t('app.profile') }}</span>
            </div>
          </div>
        </div>
        <button class="btn-ghost" @click="doLogout">{{ $t('profile.logout') }}</button>
      </div>

      <div class="profile-body">
        <div class="profile-left">
          <div class="profile-card profile-section">
            <h3 class="card-title">{{ $t('profile.wotbTitle') }}</h3>
            <div v-if="wotbAccount" class="account-bound">
              <div class="account-row"><span>{{ $t('profile.nickname') }}</span><strong>{{ wotbAccount.nickname || '--' }}</strong></div>
              <div class="account-row"><span>{{ $t('profile.accountId') }}</span><code>{{ wotbAccount.accountId || '--' }}</code></div>
              <div class="account-row"><span>{{ $t('profile.status') }}</span><span class="badge-ok">{{ $t('profile.bound') }}</span></div>
            </div>
            <div v-else class="profile-empty">
              <p>{{ $t('profile.wotbNotBound') }}</p>
              <p class="text-muted">{{ $t('profile.wotbNotBoundDesc') }}</p>
              <button class="btn-primary btn-sm" @click="goReplay">{{ $t('profile.goReplay') }}</button>
            </div>
          </div>

          <div class="profile-card profile-section">
            <h3 class="card-title">{{ $t('profile.recentTitle') }}</h3>
            <div v-if="recentRecords.length" class="records-table-wrap">
              <table class="records-table">
                <thead><tr><th>{{ $t('profile.tank') }}</th><th>{{ $t('profile.damage') }}</th><th>{{ $t('profile.map') }}</th><th>{{ $t('profile.version') }}</th></tr></thead>
                <tbody>
                  <tr v-for="r in recentRecords" :key="r.id">
                    <td>{{ r.tankName || '--' }}</td><td>{{ r.damageDealt || '--' }}</td><td>{{ r.map || '--' }}</td><td>{{ r.version || '--' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="profile-empty">
              <p>{{ $t('profile.recentEmpty') }}</p>
              <p class="text-muted">{{ $t('profile.recentEmptyDesc') }}</p>
            </div>
          </div>
        </div>

        <div class="profile-right">
          <div class="profile-card profile-section">
            <h3 class="card-title">{{ $t('profile.statsTitle') }}</h3>
            <div class="stat-grid">
              <div class="stat-card"><div class="stat-val">{{ stats.leaderboard }}</div><div class="stat-label">{{ $t('profile.leaderboardRecords') }}</div></div>
              <div class="stat-card"><div class="stat-val">{{ stats.maxDamage }}</div><div class="stat-label">{{ $t('profile.maxDamage') }}</div></div>
              <div class="stat-card"><div class="stat-val">{{ stats.accountBound }}</div><div class="stat-label">{{ $t('profile.boundAccount') }}</div></div>
              <div class="stat-card"><div class="stat-val">{{ stats.notify }}</div><div class="stat-label">{{ $t('profile.notifyStatus') }}</div></div>
            </div>
          </div>

          <div class="profile-card profile-section">
            <h3 class="card-title">{{ $t('profile.qqTitle') }}</h3>
            <div class="profile-empty">
              <p>{{ $t('profile.qqNotBound') }}</p>
              <p class="text-muted" style="text-align:left;line-height:1.6">{{ $t('profile.qqDesc') }}</p>
              <button class="btn-ghost btn-sm" disabled>{{ $t('profile.qqSoon') }}</button>
            </div>
          </div>

          <div class="profile-card profile-section">
            <h3 class="card-title">{{ $t('profile.securityTitle') }}</h3>
            <div class="security-info">
              <div class="sec-row"><span>{{ $t('profile.loginMethod') }}</span><strong>Keycloak</strong></div>
              <div class="sec-row"><span>{{ $t('profile.authService') }}</span><code>auth.wotbtools.com</code></div>
            </div>
            <p class="text-muted text-sm">{{ $t('profile.securityDesc') }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-page { max-width: 1120px; margin: 0 auto; padding: 24px 20px 64px; }
.profile-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; }
.profile-message { max-width: 400px; margin: 60px auto; padding: 40px; text-align: center; }
.profile-empty { padding: 24px 0; text-align: center; color: var(--text-sub); font-size: .9rem; }
.profile-empty p { margin: 0 0 8px; }
.profile-section { padding: 24px; margin-bottom: 16px; }
.card-title { font-size: .95rem; font-weight: 600; color: var(--text-heading); margin: 0 0 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.profile-hero { display: flex; align-items: center; justify-content: space-between; padding: 28px 32px; margin-bottom: 24px; }
.hero-left { display: flex; align-items: center; gap: 20px; }
.hero-avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 700; flex-shrink: 0; }
.hero-name { font-size: 1.3rem; font-weight: 700; color: var(--text-heading); margin: 0 0 6px; }
.hero-meta { display: flex; gap: 8px; align-items: center; }
.hero-badge { font-size: .72rem; padding: 2px 10px; border-radius: 10px; background: var(--bg-blue); color: var(--accent); font-weight: 600; }
.hero-status { font-size: .78rem; color: var(--text-sub); }
.profile-body { display: flex; gap: 24px; align-items: flex-start; }
.profile-left { flex: 1; min-width: 0; }
.profile-right { width: 360px; flex-shrink: 0; }
.account-bound { display: flex; flex-direction: column; gap: 10px; }
.account-row { display: flex; justify-content: space-between; font-size: .88rem; color: var(--text); }
.account-row span { color: var(--text-sub); }
.account-row code { font-family: monospace; font-size: .8rem; color: var(--accent); }
.badge-ok { font-size: .72rem; padding: 1px 8px; border-radius: 8px; background: #dcfce7; color: #166534; font-weight: 600; }
.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.stat-card { background: var(--bg-card2); border-radius: 12px; padding: 16px; text-align: center; }
.stat-val { font-size: 1.4rem; font-weight: 700; color: var(--text-heading); }
.stat-label { font-size: .75rem; color: var(--text-sub); margin-top: 4px; }
.records-table-wrap { overflow-x: auto; }
.records-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
.records-table th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--text-sub); font-weight: 600; }
.records-table td { padding: 6px 8px; border-bottom: 1px solid var(--border-light); color: var(--text); }
.security-info { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.sec-row { display: flex; justify-content: space-between; font-size: .88rem; }
.sec-row span { color: var(--text-sub); }
.sec-row code { font-family: monospace; font-size: .78rem; color: var(--accent); }
.btn-primary { padding: 8px 20px; border: none; border-radius: 10px; background: var(--accent); color: #fff; font-size: .88rem; cursor: pointer; font-family: inherit; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: .4; cursor: default; }
.btn-ghost { padding: 8px 18px; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--text); font-size: .85rem; cursor: pointer; font-family: inherit; }
.btn-ghost:hover { background: var(--bg-card2); }
.btn-ghost:disabled { opacity: .4; cursor: default; }
.btn-sm { padding: 5px 14px; font-size: .8rem; border-radius: 8px; }
.text-error { color: var(--error); }
.text-muted { color: var(--text-muted); font-size: .82rem; }
.text-sm { font-size: .78rem; }
@media (max-width: 768px) {
  .profile-body { flex-direction: column; }
  .profile-right { width: 100%; }
  .profile-hero { flex-direction: column; text-align: center; gap: 16px; }
  .hero-left { flex-direction: column; }
  .stat-grid { grid-template-columns: 1fr 1fr; }
}
</style>
