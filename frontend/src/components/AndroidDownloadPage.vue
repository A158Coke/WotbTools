<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { resolveApiUrl } from '../platform/runtime.js'
import { useAuth } from '../composables/useAuth.js'
import { Download } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import PageHeader from './PageHeader.vue'

const { t } = useI18n()
const { isAuthenticated, login, initPromise } = useAuth()

/** 与本地 nginx 静态托管 / Android 壳使用的同一份 release metadata（规格 §91）。 */
const MANIFEST_URL = '/download/android/version.json'

const manifest = ref(null)
const loadFailed = ref(false)
/** 登录门禁状态：checking（鉴权检查中）| ready（已登录）| required（需登录）。 */
const authState = ref('checking')

async function loadManifest() {
  try {
    const res = await fetch(resolveApiUrl(MANIFEST_URL), { credentials: 'omit' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    manifest.value = await res.json()
  } catch {
    loadFailed.value = true
  }
}

onMounted(async () => {
  // 公开入口，登录门禁：未登录时显示登录说明卡（登录后回本页）。
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
  // 审计 PG-03：未登录时显示说明与登录按钮，不自动跳转 Keycloak（design-language §10）
  authState.value = 'required'
})
</script>

<template>
  <main class="android-page layout-content">
    <PageHeader :title="t('android.title')" :description="t('android.description')" />

    <section v-if="isAndroidApp()" class="installed-banner" data-testid="android-installed">
      <p>{{ t('android.installed') }}</p>
    </section>

    <section v-else-if="authState === 'required'" class="login-gate" data-testid="android-login-required">
      <p>{{ t('android.login_required') }}</p>
      <AppButton variant="primary" data-testid="android-login-btn" @click="login('android')">
        {{ t('app.login') }}
      </AppButton>
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
      <p v-if="manifest.releaseNotes" class="release-notes">
        {{ t('android.release_notes') }}<br />
        <span>{{ manifest.releaseNotes }}</span>
      </p>
      <div class="download-actions">
        <AppButton v-if="manifest.apkUrl" variant="primary" size="lg" :href="manifest.apkUrl" data-testid="android-download-link">
          <Download :size="20" aria-hidden="true" />{{ t('android.download') }}
        </AppButton>
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
.android-page { max-width: calc(var(--reading-measure) + var(--gutter) * 2); color: var(--color-text-primary); font: var(--type-body); }
.download-card, .installed-banner, .unavailable, .login-gate {
  padding: var(--space-6);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}
.download-card > p { margin: 0 0 var(--space-4); color: var(--color-text-secondary); }
.download-card > p:last-child { margin-bottom: 0; }
.login-gate { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.login-gate p, .installed-banner p, .unavailable p { margin: 0; }
.latest { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
.latest strong { color: var(--color-text-primary); font: var(--type-h1); font-variant-numeric: tabular-nums; }
.release-notes { line-height: var(--line-height-prose); }
.release-notes span { white-space: pre-wrap; overflow-wrap: anywhere; }
.download-actions { margin: var(--space-6) 0; }
.muted { color: var(--color-text-secondary); }
.sha { padding-top: var(--space-4); border-top: 1px solid var(--color-border-subtle); font: var(--type-caption); }
.sha code { display: block; margin-top: var(--space-2); color: var(--color-text-secondary); font-family: var(--font-family-mono); overflow-wrap: anywhere; }
@media (width < 768px) {
  .download-card, .installed-banner, .unavailable, .login-gate { padding: var(--space-4); }
}
</style>
