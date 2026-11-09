<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { postUsageEvents } from '../api/usage-events.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { resolveApiUrl } from '../platform/runtime.js'
import { Download } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import ShowcaseHero from './ShowcaseHero.vue'

const { t, locale } = useI18n()

/** 与本地 nginx 静态托管 / Android 壳使用的同一份 release metadata（规格 §91）。 */
const MANIFEST_URL = '/download/android/version.json'

const manifest = ref(null)
const loadFailed = ref(false)

async function loadManifest() {
  try {
    const res = await fetch(resolveApiUrl(MANIFEST_URL), { credentials: 'omit' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    manifest.value = await res.json()
  } catch {
    loadFailed.value = true
  }
}

function recordDownloadClick() {
  // 这个页面的最终 APK 按钮是 Android downloads 唯一产品统计口径。
  // 独立事件与旧版 page-open telemetry 在协议层区分，历史页面打开不会污染点击指标。
  // 直接 best-effort + keepalive 上报，不走 5 秒 usage queue，也绝不阻塞链接跳转。
  try {
    void postUsageEvents([{
      event_id: crypto.randomUUID(),
      event: 'android_download_click',
      platform: 'web',
      feature: 'android_download',
      occurred_at: new Date().toISOString(),
    }]).catch(() => {})
  } catch {
    // Telemetry failure must never prevent the APK navigation.
  }
}

/** APK 大小：manifest.apkSizeBytes 换算成 MB（缺失时不显示，不伪造）。 */
const apkSize = computed(() => {
  const bytes = Number(manifest.value?.apkSizeBytes)
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }).format(bytes / 1048576)} MB`
})
const downloadLabel = computed(() => [t('android.downloadApk'), manifest.value?.latestVersionName, apkSize.value].filter(Boolean).join(' · '))
const installSteps = ['android.step1', 'android.step2', 'android.step3']

onMounted(loadManifest)
</script>

<template>
  <main class="android-page layout-content">
    <ShowcaseHero section="community" :kicker="t('android.nav')" :title="t('android.heroTitle')" :description="t('android.description')" />

    <section v-if="isAndroidApp()" class="installed-banner" data-testid="android-installed">
      <p>{{ t('android.installed') }}</p>
    </section>

    <template v-else-if="manifest">
      <section class="download-card" data-testid="android-download-card">
        <p class="latest">
          {{ t('android.latest_version') }} <strong>{{ manifest.latestVersionName }}</strong>
          <span v-if="manifest.publishedAt" class="published">
            {{ t('android.published') }}
            <time :datetime="manifest.publishedAt">{{ new Date(manifest.publishedAt).toLocaleDateString(locale) }}</time>
          </span>
        </p>
        <div class="download-actions">
          <AppButton v-if="manifest.apkUrl" variant="primary" size="lg" :href="manifest.apkUrl" data-testid="android-download-link" @click="recordDownloadClick">
            <Download :size="20" aria-hidden="true" />{{ downloadLabel }}
          </AppButton>
          <span v-else class="muted">{{ t('android.apk_unavailable') }}</span>
          <span v-if="manifest.apkUrl" class="wifi-hint">{{ t('android.wifiHint') }}</span>
        </div>
      </section>

      <section class="download-card" :aria-label="t('android.stepsTitle')">
        <h2>{{ t('android.stepsTitle') }}</h2>
        <ol class="install-steps">
          <li v-for="(key, index) in installSteps" :key="key"><span class="step-index" aria-hidden="true">{{ index + 1 }}</span>{{ t(key) }}</li>
        </ol>
      </section>

      <section class="download-card">
        <h2>{{ t('android.release_notes') }}</h2>
        <p class="release-notes" data-testid="android-release-notes">{{ manifest.releaseNotes || t('android.noReleaseNotes') }}</p>
        <details v-if="manifest.sha256" class="sha">
          <summary>{{ t('android.verifyFile') }}</summary>
          <p>{{ t('android.sha256') }}</p>
          <code>{{ manifest.sha256 }}</code>
        </details>
      </section>
    </template>

    <section v-else class="unavailable" data-testid="android-unavailable">
      <p>{{ loadFailed ? t('android.unavailable') : t('android.loading') }}</p>
    </section>
  </main>
</template>

<style scoped>
.android-page { display: grid; gap: var(--space-4); max-width: calc(var(--reading-measure) + var(--gutter) * 2); color: var(--color-text-primary); font: var(--type-body); }
.android-page :deep(.showcase-hero) { margin-block-end: 0; }
.download-card, .installed-banner, .unavailable {
  padding: var(--space-6);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}
.download-card h2 { margin: 0 0 var(--space-3); font: var(--type-h3); }
.installed-banner p, .unavailable p { margin: 0; }
.latest { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; margin: 0; color: var(--color-text-secondary); }
.latest strong { color: var(--color-text-primary); font: var(--type-h1); font-variant-numeric: tabular-nums; }
.published { font: var(--type-caption); }
.download-actions { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-5); }
.wifi-hint { color: var(--color-text-secondary); font: var(--type-caption); }
.install-steps { display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.install-steps li { display: flex; align-items: center; gap: var(--space-3); }
.step-index { display: inline-flex; flex: none; align-items: center; justify-content: center; inline-size: var(--space-8); block-size: var(--space-8); border-radius: var(--radius-full); corner-shape: round; background: var(--color-surface-2); color: var(--color-accent-text); font-weight: 700; }
.release-notes { margin: 0; color: var(--color-text-secondary); line-height: var(--line-height-prose); white-space: pre-wrap; overflow-wrap: anywhere; }
.muted { color: var(--color-text-secondary); }
.sha { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--color-border-subtle); font: var(--type-caption); }
.sha summary { min-height: var(--control-h-sm); color: var(--color-text-secondary); cursor: pointer; }
.sha p { margin: var(--space-2) 0 0; }
.sha code { display: block; margin-top: var(--space-1); color: var(--color-text-secondary); font-family: var(--font-family-mono); overflow-wrap: anywhere; }
@media (width < 768px) {
  .download-card, .installed-banner, .unavailable { padding: var(--space-4); }
  .download-actions :deep(.app-button) { inline-size: 100%; }
  .wifi-hint { inline-size: 100%; text-align: center; }
}
</style>
