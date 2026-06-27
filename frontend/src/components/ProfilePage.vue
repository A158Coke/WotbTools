<script setup>
import { onMounted, ref, computed } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import * as api from '../utils/api.js'

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
  accountBound: wotbAccount.value ? '已绑定' : '未绑定',
  notify: '未开启',
}))

onMounted(async () => {
  try {
    const loggedIn = await initPromise
    if (loggedIn || isAuthenticated()) {
      user.value = userName() || 'WoTBTools User'
      phase.value = 'done'
      // 尝试加载 profile 数据（404 容错）
      loadProfileData()
    } else if (initError.value) {
      phase.value = 'error'
    } else {
      phase.value = 'login'
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

function doLogout() {
  logout()
}

function goReplay() {
  const url = new URL(window.location.origin)
  url.searchParams.set('view', 'replay')
  window.location.href = url.toString()
}
</script>

<template>
  <div class="profile-page">
    <!-- Loading -->
    <div v-if="phase === 'init'" class="profile-empty">正在初始化登录...</div>

    <!-- Error -->
    <div v-else-if="phase === 'error'" class="profile-card profile-message">
      <p class="text-error">认证失败，请刷新重试</p>
      <button class="btn-primary" @click="doLogin">重新登录</button>
    </div>

    <!-- Login required -->
    <div v-else-if="phase === 'login'" class="profile-card profile-message">
      <p>正在跳转登录...</p>
      <button class="btn-primary" @click="doLogin">手动登录</button>
    </div>

    <!-- Authenticated -->
    <div v-else class="profile-main">
      <!-- Hero Card -->
      <div class="profile-card profile-hero">
        <div class="hero-left">
          <div class="hero-avatar">{{ (user||'?')[0] }}</div>
          <div class="hero-identity">
            <h2 class="hero-name">{{ user }}</h2>
            <div class="hero-meta">
              <span class="hero-badge">Keycloak</span>
              <span class="hero-status">已登录</span>
            </div>
          </div>
        </div>
        <button class="btn-ghost" @click="doLogout">登出</button>
      </div>

      <div class="profile-body">
        <!-- Left column -->
        <div class="profile-left">
          <!-- WoTB Account binding -->
          <div class="profile-card profile-section">
            <h3 class="card-title">玩家账号</h3>
            <div v-if="wotbAccount" class="account-bound">
              <div class="account-row"><span>昵称</span><strong>{{ wotbAccount.nickname || '--' }}</strong></div>
              <div class="account-row"><span>Account ID</span><code>{{ wotbAccount.accountId || '--' }}</code></div>
              <div class="account-row"><span>状态</span><span class="badge-ok">已绑定</span></div>
            </div>
            <div v-else class="profile-empty">
              <p>尚未绑定 WoTB 玩家账号</p>
              <p class="text-muted">上传自己的 replay 后，可将解析出的玩家账号绑定到当前用户。</p>
              <button class="btn-primary btn-sm" @click="goReplay">去上传 Replay</button>
            </div>
          </div>

          <!-- Recent Records -->
          <div class="profile-card profile-section">
            <h3 class="card-title">最近记录</h3>
            <div v-if="recentRecords.length" class="records-table-wrap">
              <table class="records-table">
                <thead><tr><th>车辆</th><th>伤害</th><th>地图</th><th>版本</th></tr></thead>
                <tbody>
                  <tr v-for="r in recentRecords" :key="r.id">
                    <td>{{ r.tankName || '--' }}</td>
                    <td>{{ r.damageDealt || '--' }}</td>
                    <td>{{ r.map || '--' }}</td>
                    <td>{{ r.version || '--' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="profile-empty">
              <p>暂无个人记录</p>
              <p class="text-muted">登录后上传自己的 replay，未来可在此查看战绩。</p>
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div class="profile-right">
          <!-- Stats grid -->
          <div class="profile-card profile-section">
            <h3 class="card-title">数据概览</h3>
            <div class="stat-grid">
              <div class="stat-card"><div class="stat-val">{{ stats.leaderboard }}</div><div class="stat-label">排行榜记录</div></div>
              <div class="stat-card"><div class="stat-val">{{ stats.maxDamage }}</div><div class="stat-label">最高伤害</div></div>
              <div class="stat-card"><div class="stat-val">{{ stats.accountBound }}</div><div class="stat-label">绑定账号</div></div>
              <div class="stat-card"><div class="stat-val">{{ stats.notify }}</div><div class="stat-label">通知状态</div></div>
            </div>
          </div>

          <!-- QQ Notification -->
          <div class="profile-card profile-section">
            <h3 class="card-title">QQ 通知</h3>
            <div class="profile-empty">
              <p>未绑定</p>
              <p class="text-muted" style="text-align:left;line-height:1.6">
                后续可用于：<br>
                · replay 解析完成提醒<br>
                · 排行榜记录被超过提醒<br>
                · 账号安全/系统通知
              </p>
              <button class="btn-ghost btn-sm" disabled>即将支持</button>
            </div>
          </div>

          <!-- Account Security -->
          <div class="profile-card profile-section">
            <h3 class="card-title">账号安全</h3>
            <div class="security-info">
              <div class="sec-row"><span>登录方式</span><strong>Keycloak</strong></div>
              <div class="sec-row"><span>认证服务</span><code>auth.wotbtools.com</code></div>
            </div>
            <p class="text-muted text-sm">本工具不保存你的密码，所有认证由 Keycloak 提供。</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-page { max-width: 1120px; margin: 0 auto; padding: 24px 20px 64px; }

/* Shared cards */
.profile-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; }
.profile-message { max-width: 400px; margin: 60px auto; padding: 40px; text-align: center; }
.profile-empty { padding: 24px 0; text-align: center; color: var(--text-sub); font-size: .9rem; }
.profile-empty p { margin: 0 0 8px; }
.profile-section { padding: 24px; margin-bottom: 16px; }

.card-title { font-size: .95rem; font-weight: 600; color: var(--text-heading); margin: 0 0 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }

/* Hero */
.profile-hero { display: flex; align-items: center; justify-content: space-between; padding: 28px 32px; margin-bottom: 24px; }
.hero-left { display: flex; align-items: center; gap: 20px; }
.hero-avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 700; flex-shrink: 0; }
.hero-name { font-size: 1.3rem; font-weight: 700; color: var(--text-heading); margin: 0 0 6px; }
.hero-meta { display: flex; gap: 8px; align-items: center; }
.hero-badge { font-size: .72rem; padding: 2px 10px; border-radius: 10px; background: var(--bg-blue); color: var(--accent); font-weight: 600; }
.hero-status { font-size: .78rem; color: var(--text-sub); }

/* Body layout */
.profile-body { display: flex; gap: 24px; align-items: flex-start; }
.profile-left { flex: 1; min-width: 0; }
.profile-right { width: 360px; flex-shrink: 0; }

/* WoTB account */
.account-bound { display: flex; flex-direction: column; gap: 10px; }
.account-row { display: flex; justify-content: space-between; font-size: .88rem; color: var(--text); }
.account-row span { color: var(--text-sub); }
.account-row code { font-family: monospace; font-size: .8rem; color: var(--accent); }
.badge-ok { font-size: .72rem; padding: 1px 8px; border-radius: 8px; background: #dcfce7; color: #166534; font-weight: 600; }

/* Stats */
.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.stat-card { background: var(--bg-card2); border-radius: 12px; padding: 16px; text-align: center; }
.stat-val { font-size: 1.4rem; font-weight: 700; color: var(--text-heading); }
.stat-label { font-size: .75rem; color: var(--text-sub); margin-top: 4px; }

/* Records table */
.records-table-wrap { overflow-x: auto; }
.records-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
.records-table th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--text-sub); font-weight: 600; }
.records-table td { padding: 6px 8px; border-bottom: 1px solid var(--border-light); color: var(--text); }

/* Security */
.security-info { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.sec-row { display: flex; justify-content: space-between; font-size: .88rem; }
.sec-row span { color: var(--text-sub); }
.sec-row code { font-family: monospace; font-size: .78rem; color: var(--accent); }

/* Buttons */
.btn-primary { padding: 8px 20px; border: none; border-radius: 10px; background: var(--accent); color: #fff; font-size: .88rem; cursor: pointer; font-family: inherit; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: .4; cursor: default; }
.btn-ghost { padding: 8px 18px; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--text); font-size: .85rem; cursor: pointer; font-family: inherit; }
.btn-ghost:hover { background: var(--bg-card2); }
.btn-ghost:disabled { opacity: .4; cursor: default; }
.btn-sm { padding: 5px 14px; font-size: .8rem; border-radius: 8px; }

/* Utils */
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
