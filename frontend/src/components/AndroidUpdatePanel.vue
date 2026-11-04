<script setup lang="ts">
import { computed } from 'vue'
import AppSheet from './AppSheet.vue'
import type { AndroidUpdateController } from '../shared/androidUpdate.js'

const props = defineProps<{ update: AndroidUpdateController }>()
const snapshot = computed(() => props.update.snapshot.value)
const download = computed(() => snapshot.value?.download)
const checking = computed(() => props.update.checking.value
  || (snapshot.value?.checkState === 'checking' && !props.update.error.value))
const canDownload = computed(() => snapshot.value && ['optional', 'mandatory'].includes(snapshot.value.state)
  && ['idle', 'downloadFailed', 'verifyFailed'].includes(snapshot.value.download.state))
const canInstall = computed(() => download.value?.taskToken
  && ['ready', 'installPermissionRequired', 'installRequestFailed'].includes(download.value.state)
  && download.value.failureReason !== 'unsupportedArtifact')
const selectingPackage = computed(() => download.value?.state === 'selectingPackage')
const replaceUnsupported = computed(() => !selectingPackage.value && download.value?.failureReason === 'unsupportedArtifact')
const checkingFailed = computed(() => props.update.error.value === 'unavailable'
  || snapshot.value?.checkState === 'failed')

function bytes(value: number | null | undefined): string {
  return value == null ? '—' : `${(value / 1_000_000).toFixed(1)} MB`
}
</script>

<template>
  <AppSheet :open="update.panelOpen.value" :return-focus-to="update.returnFocusTo.value" :title="$t('androidUpdate.title')" visible-title @close="update.close">
    <section class="android-update" data-testid="android-update-panel">
      <dl v-if="snapshot" class="android-update-versions">
        <div><dt>{{ $t('androidUpdate.current') }}</dt><dd data-testid="update-current-version">{{ snapshot.currentVersionName }}</dd></div>
        <div v-if="snapshot.latestVersionName"><dt>{{ $t('androidUpdate.latest') }}</dt><dd>{{ snapshot.latestVersionName }}</dd></div>
        <div v-if="snapshot.publishedAt"><dt>{{ $t('androidUpdate.publishedAt') }}</dt><dd><time :datetime="snapshot.publishedAt">{{ snapshot.publishedAt }}</time></dd></div>
      </dl>
      <p role="status" aria-live="polite" data-testid="update-check-status">
        {{ checking ? $t('androidUpdate.checking') : checkingFailed ? $t('androidUpdate.checkFailed') : $t(`androidUpdate.state.${snapshot?.state ?? 'unknown'}`) }}
      </p>
      <p v-if="checkingFailed" class="android-update-hint">{{ $t('androidUpdate.checkRetryHint') }}</p>
      <p v-if="update.error.value === 'rejected'" role="alert">{{ $t('androidUpdate.actionRejected') }}</p>
      <p v-if="update.acting.value" role="status">{{ $t(update.error.value === 'confirming' ? 'androidUpdate.actionConfirming' : 'androidUpdate.actionProcessing') }}</p>
      <p v-if="snapshot?.releaseNotes" class="android-update-notes">{{ snapshot.releaseNotes }}</p>
      <section v-if="download && download.state !== 'idle'" class="android-update-download" data-testid="update-download">
        <h3 v-if="download.versionName">{{ $t('androidUpdate.packageVersion', { version: download.versionName }) }}</h3>
        <p role="status" aria-live="polite">{{ $t(`androidUpdate.downloadState.${download.state}`) }}</p>
        <template v-if="['queued', 'downloading', 'downloadingDelta', 'paused'].includes(download.state)">
          <progress :value="download.progressPercent ?? undefined" :max="100" :aria-label="$t('androidUpdate.progress')" />
          <p data-testid="update-progress">{{ download.progressPercent == null ? $t('androidUpdate.unknownProgress') : `${download.progressPercent}%` }} · {{ bytes(download.downloadedBytes) }} / {{ bytes(download.totalBytes) }}</p>
        </template>
        <p v-if="download.failureReason" class="android-update-hint" data-testid="update-failure">{{ $t(`androidUpdate.failure.${download.failureReason}`) }}</p>
      </section>
      <div class="android-update-actions">
        <button type="button" class="btn btn-secondary" :disabled="checking || update.acting.value || selectingPackage" data-testid="update-refresh" @click="update.refresh">{{ $t('androidUpdate.check') }}</button>
        <button v-if="canDownload || replaceUnsupported" type="button" class="btn btn-primary" :disabled="update.acting.value" data-testid="update-download-action" @click="update.download">{{ $t(replaceUnsupported ? 'androidUpdate.replaceDownload' : 'androidUpdate.download') }}</button>
        <button v-if="canInstall" type="button" class="btn btn-primary" :disabled="update.acting.value" data-testid="update-install" @click="update.install">{{ $t(download?.state === 'installPermissionRequired' ? 'androidUpdate.allowInstall' : 'androidUpdate.install') }}</button>
        <button v-if="snapshot?.state === 'optional'" type="button" class="btn btn-secondary" :disabled="update.acting.value || selectingPackage" data-testid="update-later" @click="update.dismiss(); update.close()">{{ $t('androidUpdate.later') }}</button>
        <button type="button" class="btn btn-secondary" data-testid="update-close" @click="update.close">{{ $t('androidUpdate.close') }}</button>
      </div>
    </section>
  </AppSheet>
</template>

<style scoped>
.android-update { display: grid; gap: var(--space-3); }
.android-update p { margin: 0; }
.android-update-versions { display: grid; gap: var(--space-2); margin: 0; }
.android-update-versions > div { display: flex; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.android-update-versions dt, .android-update-hint { color: var(--color-text-secondary); }
.android-update-versions dd { margin: 0; overflow-wrap: anywhere; }
.android-update-notes { white-space: pre-wrap; overflow-wrap: anywhere; }
.android-update-download { display: grid; gap: var(--space-2); }
.android-update-download h3 { margin: 0; font: var(--type-h3); }
.android-update-download progress { width: 100%; accent-color: var(--color-accent); }
.android-update-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.android-update-actions button { min-height: var(--hit-min-comfortable); }
</style>
