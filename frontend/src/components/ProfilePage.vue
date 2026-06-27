<script setup>
import { ref, onMounted } from 'vue'
import Keycloak from 'keycloak-js'

const kc = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
})

const authenticated = ref(false)
const user = ref('')

onMounted(async () => {
  try {
    await kc.init({ onLoad: 'check-sso', pkceMethod: 'S256', silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html' })
    authenticated.value = kc.authenticated ?? false
    if (authenticated.value) {
      user.value = kc.tokenParsed?.preferred_username || kc.tokenParsed?.name || ''
    } else {
      // 未登录 → 跳 KC
      kc.login({ redirectUri: window.location.origin + '/?view=profile' })
    }
  } catch {
    // init 失败也跳 KC
    kc.login({ redirectUri: window.location.origin + '/?view=profile' })
  }
})

function doLogout() {
  kc.logout({ redirectUri: window.location.origin })
}
</script>

<template>
  <div class="wrap profile-page">
    <div class="profile-card" v-if="authenticated">
      <div class="profile-avatar"></div>
      <h2 class="profile-name">{{ user }}</h2>
      <p class="profile-status">已登录</p>
      <button class="sm ghost" style="margin-top:12px" @click="doLogout">登出</button>
    </div>
    <div class="profile-card" v-else>
      <p>正在跳转登录…</p>
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
