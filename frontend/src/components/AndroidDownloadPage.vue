<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { postUsageEvents } from '../api/usage-events.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { resolveApiUrl } from '../platform/runtime.js'
import { Download } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import PageHeader from './PageHeader.vue'

const { t } = useI18n()

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

onMounted(loadManifest)
</script>

<template>
  <main class="android-page layout-content">
    <PageHeader :title="t('android.title')" :description="t('android.description')" />

    <section v-if="isAndroidApp()" class="installed-banner" data-testid="android-installed">
      <p>{{ t('android.installed') }}</p>
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
        <AppButton v-if="manifest.apkUrl" variant="primary" size="lg" :href="manifest.apkUrl" data-testid="android-download-link" @click="recordDownloadClick">
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
.download-card, .installed-banner, .unavailable {
  padding: var(--space-6);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}
.download-card > p { margin: 0 0 var(--space-4); color: var(--color-text-secondary); }
.download-card > p:last-child { margin-bottom: 0; }
.installed-banner p, .unavailable p { margin: 0; }
.latest { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
.latest strong { color: var(--color-text-primary); font: var(--type-h1); font-variant-numeric: tabular-nums; }
.release-notes { line-height: var(--line-height-prose); }
.release-notes span { white-space: pre-wrap; overflow-wrap: anywhere; }
.download-actions { margin: var(--space-6) 0; }
.muted { color: var(--color-text-secondary); }
.sha { padding-top: var(--space-4); border-top: 1px solid var(--color-border-subtle); font: var(--type-caption); }
.sha code { display: block; margin-top: var(--space-2); color: var(--color-text-secondary); font-family: var(--font-family-mono); overflow-wrap: anywhere; }
@media (width < 768px) {
  .download-card, .installed-banner, .unavailable { padding: var(--space-4); }
}
</style>
