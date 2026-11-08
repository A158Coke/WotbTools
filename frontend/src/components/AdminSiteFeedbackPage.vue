<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { siteFeedbackReasons, feedbackStatuses, listSiteFeedback, getSiteFeedback, deleteSiteFeedback, updateSiteFeedbackStatus, type FeedbackStatus, type SiteFeedbackDetail, type SiteFeedbackItem, type SiteFeedbackReason } from '../api/site-feedback.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { apiErrorLabel } from '../utils/display.js'
import { normalizeApiError } from '../utils/http.js'
import AppDialog from './AppDialog.vue'

const { t, te } = useI18n()
const { requireFeature, availability } = useFeatureGate()
const items = ref<SiteFeedbackItem[]>([]), page = ref(0), totalPages = ref(0), totalItems = ref(0), reason = ref<SiteFeedbackReason | ''>('')
const loading = ref(false), error = ref(''), detail = ref<SiteFeedbackDetail | null>(null), confirmId = ref<string | null>(null), deleting = ref(false)
const loaded = ref(false), savingStatus = ref<Record<string, boolean>>({})
let hasLoadedOnce = false
let blockedInitialLoad = false
let generation = 0
let detailGeneration = 0
let statusEpoch = 0
const confirmedStatuses = new Map<string, { status: FeedbackStatus; epoch: number }>()
const detailVersions = new Map<string, number>()

/** 4xx means the server explicitly rejected the write; anything else may have committed. */
function isDefiniteStatusRejection(cause: unknown): boolean {
  const status = normalizeApiError(cause).status
  return status !== null && status >= 400 && status < 500
}

/** Discard only in-flight detail reads for the record whose status just changed. */
function invalidateDetailRequests(id: string): void {
  detailVersions.set(id, (detailVersions.get(id) ?? 0) + 1)
}

function applyConfirmedStatuses(list: SiteFeedbackItem[], startedEpoch: number): SiteFeedbackItem[] {
  return list.map(item => {
    const confirmed = confirmedStatuses.get(item.id)
    if (!confirmed) return item
    if (confirmed.epoch <= startedEpoch) { confirmedStatuses.delete(item.id); return item }
    return { ...item, status: confirmed.status }
  })
}
async function load(): Promise<void> {
  const current = ++generation
  const statusEpochAtStart = statusEpoch
  if (!requireFeature(Feature.ADMIN_SITE_FEEDBACK)) {
    if (!hasLoadedOnce) blockedInitialLoad = true
    loading.value = false
    return
  }
  blockedInitialLoad = false
  loading.value = true; error.value = ''
  try {
    const result = await listSiteFeedback(page.value, reason.value)
    if (current !== generation) return
    if (result.page > 0 && result.items.length === 0 && result.page >= result.totalPages) {
      page.value = Math.max(0, result.totalPages - 1)
      await load()
      return
    }
    items.value = applyConfirmedStatuses(result.items, statusEpochAtStart); totalPages.value = result.totalPages; totalItems.value = result.totalItems
    loaded.value = true; hasLoadedOnce = true
  } catch (cause) { if (current === generation) error.value = apiErrorLabel(t, te, cause) }
  finally { if (current === generation) loading.value = false }
}
function clearResults() { items.value = []; totalPages.value = 0; totalItems.value = 0; loaded.value = false; error.value = '' }
function filterChanged() { page.value = 0; clearResults(); void load() }
function move(delta: number) { page.value += delta; clearResults(); void load() }
function previewText(value: string | null) {
  const chars = [...(value || '')]
  return chars.length > 120 ? `${chars.slice(0, 120).join('')}…` : (value || '—')
}
function reasonLabels(codes: readonly SiteFeedbackReason[]) {
  return codes.map(code => t(`siteFeedback.reasons.${code}`)).join(', ')
}
async function changeStatus(item: SiteFeedbackItem, event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement
  const next = select.value as FeedbackStatus
  const previous = item.status
  if (next === previous || savingStatus.value[item.id]) { select.value = previous; return }
  if (!requireFeature(Feature.ADMIN_SITE_FEEDBACK)) { select.value = previous; return }
  savingStatus.value = { ...savingStatus.value, [item.id]: true }
  error.value = ''
  try {
    await updateSiteFeedbackStatus(item.id, next)
    statusEpoch++
    // A detail GET for this record started before confirmation may still deliver the old status.
    invalidateDetailRequests(item.id)
    confirmedStatuses.set(item.id, { status: next, epoch: statusEpoch })
    const target = items.value.find(entry => entry.id === item.id)
    if (target) target.status = next
    if (detail.value && detail.value.id === item.id) detail.value = { ...detail.value, status: next }
  } catch (cause) {
    if (isDefiniteStatusRejection(cause)) {
      select.value = previous
      error.value = apiErrorLabel(t, te, cause)
    } else {
      await reconcileStatus(item, select, previous)
    }
  } finally {
    const rest = { ...savingStatus.value }
    delete rest[item.id]
    savingStatus.value = rest
  }
}
async function reconcileStatus(item: SiteFeedbackItem, select: HTMLSelectElement, previous: FeedbackStatus): Promise<void> {
  try {
    const result = await getSiteFeedback(item.id)
    statusEpoch++
    invalidateDetailRequests(item.id)
    confirmedStatuses.set(item.id, { status: result.status, epoch: statusEpoch })
    const target = items.value.find(entry => entry.id === item.id)
    if (target) target.status = result.status
    select.value = result.status
    if (detail.value && detail.value.id === item.id) detail.value = { ...detail.value, status: result.status }
  } catch {
    select.value = previous
    error.value = t('siteFeedback.statusUnconfirmed')
  }
}
async function showDetail(id: string): Promise<void> {
  const current = ++detailGeneration
  const detailVersion = detailVersions.get(id) ?? 0
  const statusEpochAtStart = statusEpoch
  if (!requireFeature(Feature.ADMIN_SITE_FEEDBACK)) return
  error.value = ''
  try {
    const result = await getSiteFeedback(id)
    if (current !== detailGeneration || detailVersion !== (detailVersions.get(id) ?? 0)) return
    const confirmed = confirmedStatuses.get(result.id)
    detail.value = confirmed && confirmed.epoch > statusEpochAtStart ? { ...result, status: confirmed.status } : result
  } catch (cause) {
    if (current === detailGeneration && detailVersion === (detailVersions.get(id) ?? 0)) error.value = apiErrorLabel(t, te, cause)
  }
}
function closeDetail() { detailGeneration++; detail.value = null }
async function remove() {
  if (deleting.value || !confirmId.value || !requireFeature(Feature.ADMIN_SITE_FEEDBACK)) return
  deleting.value = true; error.value = ''
  try { await deleteSiteFeedback(confirmId.value); confirmId.value = null; closeDetail(); await load() }
  catch (cause) { error.value = apiErrorLabel(t, te, cause) }
  finally { deleting.value = false }
}
onMounted(load)
watch(() => availability(Feature.ADMIN_SITE_FEEDBACK).available, available => {
  if (available && blockedInitialLoad && !hasLoadedOnce && !loading.value) void load()
})
onBeforeUnmount(() => { generation++; detailGeneration++ })
</script>

<template>
  <section class="feedback-admin">
    <h1>{{ $t('siteFeedback.adminTitle') }}</h1>
    <label>{{ $t('siteFeedback.filter') }}
      <select v-model="reason" @change="filterChanged">
        <option value="">{{ $t('siteFeedback.all') }}</option>
        <option v-for="item in siteFeedbackReasons" :key="item" :value="item">{{ $t(`siteFeedback.reasons.${item}`) }}</option>
      </select>
    </label>
    <button type="button" :disabled="loading" @click="load">{{ $t('siteFeedback.refresh') }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">{{ $t('siteFeedback.loading') }}</p>
    <p v-else-if="loaded && !items.length">{{ $t('siteFeedback.empty') }}</p>
    <div class="table-wrap">
      <table v-if="items.length">
        <thead><tr><th>{{ $t('siteFeedback.created') }}</th><th>{{ $t('siteFeedback.filter') }}</th><th>{{ $t('siteFeedback.comment') }}</th><th>{{ $t('siteFeedback.page') }}</th><th>{{ $t('siteFeedback.statusLabel') }}</th><th>{{ $t('siteFeedback.actions') }}</th></tr></thead>
        <tbody><tr v-for="item in items" :key="item.id">
          <td>{{ new Date(item.createdAt).toLocaleString() }}</td>
          <td>{{ reasonLabels(item.reasonCodes) }}</td>
          <td class="preview">{{ previewText(item.feedbackText) }}</td><td>{{ item.pageView || '—' }}</td>
          <td><select class="status-select" :value="item.status" :disabled="!!savingStatus[item.id]" :aria-label="$t('siteFeedback.statusLabel')" @change="changeStatus(item, $event)"><option v-for="value in feedbackStatuses" :key="value" :value="value">{{ $t(`siteFeedback.status.${value}`) }}</option></select></td>
          <td><button type="button" @click="showDetail(item.id)">{{ $t('siteFeedback.view') }}</button> <button type="button" @click="confirmId = item.id">{{ $t('siteFeedback.delete') }}</button></td>
        </tr></tbody>
      </table>
    </div>
    <div v-if="loaded || page > 0" class="pages"><button type="button" :disabled="loading || page === 0" @click="move(-1)">{{ $t('siteFeedback.previous') }}</button>
      <span v-if="loaded">{{ page + 1 }} / {{ Math.max(totalPages, 1) }} · {{ totalItems }}</span>
      <span v-else>{{ page + 1 }}</span>
      <button type="button" :disabled="!loaded || loading || page + 1 >= totalPages" @click="move(1)">{{ $t('siteFeedback.next') }}</button></div>
    <AppDialog :open="!!detail" :title="$t('siteFeedback.detail')" size="lg" @close="closeDetail">
      <template v-if="detail">
        <p>{{ $t('siteFeedback.created') }}: {{ new Date(detail.createdAt).toLocaleString() }}</p>
        <p>{{ $t('siteFeedback.page') }}: {{ detail.pageView || '—' }}</p>
        <p>{{ $t('siteFeedback.statusLabel') }}: {{ $t('siteFeedback.status.' + detail.status) }}</p>
        <p>{{ reasonLabels(detail.reasonCodes) }}</p>
        <h3>{{ $t('siteFeedback.comment') }}</h3><pre>{{ detail.feedbackText || '—' }}</pre>
      </template>
    </AppDialog>
    <AppDialog :open="!!confirmId" :title="$t('siteFeedback.delete')" tone="danger" @close="!deleting && (confirmId = null)">
      <p>{{ $t('siteFeedback.deleteConfirm') }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="button" :disabled="deleting" @click="confirmId = null">{{ $t('siteFeedback.cancel') }}</button>
      <button type="button" :disabled="deleting" @click="remove">{{ $t('siteFeedback.delete') }}</button>
    </AppDialog>
  </section>
</template>

<style scoped>
.feedback-admin { padding: var(--space-5); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin-top: var(--space-4); }
th, td { text-align: left; padding: var(--space-2); border-bottom: 1px solid var(--color-border-subtle); }
.preview { overflow-wrap: anywhere; }
.status-select { min-width: 7rem; }
.pages { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-4); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style>
