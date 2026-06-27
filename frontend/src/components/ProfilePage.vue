<script setup>
import { useAuth } from '../composables/useAuth.js'

const { isAuthenticated, userName, logout } = useAuth()
</script>

<template>
  <div class="wrap profile-page">
    <div class="profile-card">
      <div class="profile-avatar"></div>
      <h2 v-if="isAuthenticated()" class="profile-name">{{ userName() }}</h2>
      <h2 v-else class="profile-name">游客</h2>
      <p class="profile-status">{{ isAuthenticated() ? '已登录' : '未登录' }}</p>
      <button v-if="isAuthenticated()" class="sm ghost" style="margin-top:12px" @click="logout">登出</button>
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
