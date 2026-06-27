<script setup>
import { onMounted, ref } from 'vue'
import Keycloak from 'keycloak-js'

const phase = ref('init')
const user = ref('')
const error = ref('')

onMounted(async () => {
  console.log('[Profile] mounted')

  const kc = new Keycloak({
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
      kc.login({ redirectUri: window.location.origin + '/?view=profile' })
    }
  } catch (e) {
    console.error('[Profile] init error:', e)
    error.value = String(e)
    phase.value = 'error'
  }
})
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
    </div>
    <div class="profile-card" v-else>
      <p>{{ phase === 'login' ? '正在跳转登录…' : '加载中…' }}</p>
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
