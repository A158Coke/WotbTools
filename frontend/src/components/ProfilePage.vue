<script setup>
import { onMounted, ref } from 'vue'
import Keycloak from 'keycloak-js'

const phase = ref('init')
const user = ref('')
const error = ref('')
let kc = null

onMounted(async () => {
  console.log('[Profile] mounted')

  kc = new Keycloak({
    url: 'https://auth.wotbtools.com',
    realm: 'wotbtools',
    clientId: 'wotbtools-web',
  })

  try {
    console.log('[Profile] calling kc.init')
    const loggedIn = await kc.init({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
    })
    console.log('[Profile] kc.init done, loggedIn:', loggedIn)

    if (loggedIn) {
      user.value = kc.tokenParsed?.preferred_username || kc.tokenParsed?.name || 'WoTBTools User'
      phase.value = 'done'
    } else {
      phase.value = 'login'
    }
  } catch (e) {
    console.error('[Profile] init error:', e)
    error.value = String(e)
    phase.value = 'error'
  }
})

function doLogin() {
  if (kc) kc.login({ redirectUri: window.location.origin + '/?view=profile' })
}

function doLogout() {
  if (kc) kc.logout({ redirectUri: 'https://wotbtools.com' })
}
</script>

<template>
  <div class="wrap profile-page">
    <div class="profile-card" v-if="phase === 'error'">
      <p style="color:red">错误: {{ error }}</p>
    </div>
    <div class="profile-card" v-else-if="phase === 'done'">
      <div class="profile-avatar"></div>
      <h2 class="profile-name">{{ user }}</h2>
      <p class="profile-status">已登录</p>
      <button class="sm ghost" style="margin-top:12px" @click="doLogout">登出</button>
    </div>
    <div class="profile-card" v-else-if="phase === 'login'">
      <p>未登录</p>
      <button class="lg" style="margin-top:12px" @click="doLogin">登入</button>
    </div>
    <div class="profile-card" v-else>
      <p>加载中…</p>
    </div>
  </div>
</template>

<style scoped>
.profile-page { display: flex; justify-content: center; padding-top: 40px; }
.profile-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 12px; padding: 32px 40px; text-align: center;
  min-width: 280px;
}
.profile-avatar {
  width: 64px; height: 64px; border-radius: 50%;
  background: var(--accent); margin: 0 auto 16px;
}
.profile-name { font-size: 1.2rem; color: var(--text-heading); margin: 0 0 8px; }
.profile-status { font-size: .9rem; color: var(--text-sub); margin: 0; }
</style>
