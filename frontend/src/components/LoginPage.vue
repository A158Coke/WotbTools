<script setup>
import { useAuth } from '../composables/useAuth.js'

const { login, loginWithWargaming } = useAuth()

function loginWithQq() {
  login('profile')
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h2 class="login-title">{{ $t('login.title') }}</h2>

      <section class="login-section">
        <h3 class="login-heading">{{ $t('login.cnPlayers') }}</h3>
        <button class="btn-primary login-btn" @click="loginWithQq">
          {{ $t('login.qqLogin') }}
        </button>
      </section>

      <section class="login-section">
        <h3 class="login-heading">{{ $t('login.wgLogin') }}</h3>
        <button class="btn-primary login-btn" @click="loginWithWargaming('ASIA', 'profile')">
          {{ $t('login.wgAsia') }}
        </button>
        <button class="btn-primary login-btn" @click="loginWithWargaming('EU', 'profile')">
          {{ $t('login.wgEurope') }}
        </button>
        <button class="btn-primary login-btn" @click="loginWithWargaming('NA', 'profile')">
          {{ $t('login.wgNorthAmerica') }}
        </button>
      </section>

      <p class="login-note">{{ $t('login.independentAccountNote') }}</p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  max-width: 480px;
  margin: 0 auto;
  padding: 40px 20px;
}
.login-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 28px 24px;
  box-shadow: var(--surface-shadow);
}
.login-title {
  margin: 0 0 18px;
  font-size: 1.15rem;
  color: var(--text-heading);
}
.login-section {
  margin-bottom: 18px;
}
.login-heading {
  margin: 0 0 8px;
  font-size: .9rem;
  color: var(--text-label);
}
.login-btn {
  width: 100%;
}
.login-note {
  margin: 10px 0 0;
  font-size: .82rem;
  color: var(--text-muted);
  line-height: 1.55;
}
</style>
