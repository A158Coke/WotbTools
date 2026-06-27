<script setup>
import { onMounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth.js'

const {
  initPromise,
  login,
  logout,
  isAuthenticated,
  userName,
  initError,
} = useAuth()

const pageReady = ref(false)
const authenticated = ref(false)
const user = ref('')
const loginStarted = ref(false)

onMounted(async () => {
  const loggedIn = await initPromise

  authenticated.value = Boolean(loggedIn || isAuthenticated())
  user.value = userName()
  pageReady.value = true

  if (!authenticated.value && !loginStarted.value && !initError.value) {
    loginStarted.value = true
    await login()
  }
})

function doLogout() {
  logout()
}

function retryLogin() {
  loginStarted.value = true
  login()
}
</script>

<template>
  <div class="wrap profile-page">
    <div class="profile-card" v-if="authenticated">
      <div class="profile-avatar"></div>
      <h2 class="profile-name">{{ user || 'WotBTools User' }}</h2>
      <p class="profile-status">已登录</p>
      <button class="sm ghost" style="margin-top:12px" @click="doLogout">登出</button>
    </div>

    <div class="profile-card" v-else>
      <template v-if="initError">
        <p style="color:red">认证失败，请刷新重试</p>
        <button class="sm primary" style="margin-top:12px" @click="retryLogin">重新登录</button>
      </template>
      <template v-else>
        <p>{{ pageReady ? '正在跳转登录...' : '正在初始化登录...' }}</p>
      </template>
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
