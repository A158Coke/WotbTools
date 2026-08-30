<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { useAuth } from '../composables/useAuth.js'

const { t } = useI18n()
const { isAuthenticated, login, initPromise } = useAuth()

/** 与本地 nginx 静态托管 / Android 壳使用的同一份 release metadata（规格 §91）。 */
const MANIFEST_URL = '/download/android/version.json'

const manifest = ref(null)
const loadFailed = ref(false)
/** 登录门禁状态：checking（鉴权检查中）| ready（已登录）| required（需登录）。 */
const authState = ref('checking')
let loginAttempted = false

async function loadManifest() {
  try {
    const res = await fetch(MANIFEST_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    manifest.value = await res.json()
  } catch {
    loadFailed.value = true
  }
}

onMounted(async () => {
  // 公开入口，登录门禁：未登录访问 /download/android 自动跳 Keycloak（登录后回本页）。
  try {
    await initPromise
  } catch {
    // Keycloak init 失败视作未登录。
  }
  if (isAuthenticated()) {
    authState.value = 'ready'
    await loadManifest()
    return
  }
  authState.value = 'required'
  if (!loginAttempted) {
    loginAttempted = true
    login('android').catch(() => {})
  }
})
</script>

<template>
  <main class="layout-content">
    <header>
      <p class="kicker">{{ t('android.kicker') }}</p>
      <h1>{{ t('android.title') }}</h1>
      <p>{{ t('android.description') }}</p>
    </header>

    <section v-if="isAndroidApp()" class="installed-banner" data-testid="android-installed">
      <p>{{ t('android.installed') }}</p>
    </section>

    <section v-else-if="authState === 'required'" class="login-gate" data-testid="android-login-required">
      <p>{{ t('android.login_required') }}</p>
      <button class="btn primary" data-testid="android-login-btn" @click="login('android')">
        {{ t('app.login') }}
      </button>
    </section>

    <section v-else-if="authState === 'checking'" class="unavailable" data-testid="android-auth-checking">
      <p>{{ t('android.loading') }}</p>
    </section>

    <section v-else-if="manifest" class="download-card" data-testid="android-download-card">
      <p class="latest">
        {{ t('android.latest_version') }} <strong>{{ manifest.latestVersionName }}</strong>
      </p>
      <p v-if="manifest.publishedAt">
        {{ t('android.published') }}
        <time :datetime="manifest.publishedAt">{{ new Date(manifest.publishedAt).toLocaleDateString() }}</time>
      </p>
      <p v-if="manifest.releaseNotes">
        {{ t('android.release_notes') }}<br />
        <span>{{ manifest.releaseNotes }}</span>
      </p>
      <div class="download-actions">
        <a v-if="manifest.apkUrl" class="btn primary" :href="manifest.apkUrl" data-testid="android-download-link">
          {{ t('android.download') }}
        </a>
        <span v-else class="muted">{{ t('android.apk_unavailable') }}</span>
      </div>
      <p v-if="manifest.sha256" class="sha">
        {{ t('android.sha256') }}<br />
        <code>{{ manifest.sha256 }}</code>
      </p>
    </section>

    <section v-else class="unavailable" data-testid="android-unavailable">
      <p>{{ loadFailed ? t('android.unavailable') : t('android.loading') }}</p>
    </section>
  </main>
</template>

<style scoped>
.layout-content { max-width: 980px; }
.kicker { color: var(--text-sub); text-transform: uppercase; letter-spacing: 2px; }
.download-card, .installed-banner, .unavailable {
  margin-top: 18px; padding: 20px 22px; border: 1px solid var(--border);
  border-radius: 9px; background: var(--bg-card);
}
.login-gate {
  margin-top: 18px; padding: 20px 22px; border: 1px solid var(--border);
  border-radius: 9px; background: var(--bg-card);
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.login-gate p { margin: 0; }
.latest { font-size: 1.1rem; }
.download-actions { margin: 16px 0; }
.sha { margin-top: 12px; word-break: break-all; color: var(--text-sub); font-size: .85rem; }
.sha code { word-break: break-all; }
</style>
