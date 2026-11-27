<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { feedbackReasons, feedbackStatuses, listFeedback, getFeedback, deleteFeedback, updateFeedbackStatus, type FeedbackReason, type FeedbackStatus } from '../api/ai-review-feedback.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { apiErrorLabel } from '../utils/display.js'
import { normalizeApiError } from '../utils/http.js'
import AdminDangerZone from './AdminDangerZone.vue'
import AdminDetailDrawer from './AdminDetailDrawer.vue'
import AdminFilterBar from './AdminFilterBar.vue'
import SegmentedControl from './SegmentedControl.vue'
import AppButton from './AppButton.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import { isRowControlClick, rowOpenTarget } from './adminListRow'
import './admin-list.css'

type FeedbackPage = Awaited<ReturnType<typeof listFeedback>>
type FeedbackItem = FeedbackPage['items'][number]
type FeedbackDetail = Awaited<ReturnType<typeof getFeedback>>

const { t, te } = useI18n()
const { requireFeature, availability } = useFeatureGate()
const items = ref<FeedbackItem[]>([]), page = ref(0), totalPages = ref(0), totalItems = ref(0), reason = ref<FeedbackReason | ''>('')
const loading = ref(false), error = ref(''), deleting = ref(false)
const selected = ref<FeedbackItem | null>(null), detail = ref<FeedbackDetail | null>(null)
const pageRoot = ref<HTMLElement | null>(null)
const returnFocus = ref<HTMLElement | null>(null)
const dangerZone = ref<InstanceType<typeof AdminDangerZone> | null>(null)
const loaded = ref(false), savingStatus = ref<Record<string, boolean>>({})
const pendingDetailId = ref<FeedbackItem['id'] | null>(null)
let hasLoadedOnce = false
let blockedInitialLoad = false
let generation = 0
let detailGeneration = 0
let statusEpoch = 0
const confirmedStatuses = new Map<string, { status: FeedbackStatus; epoch: number }>()
const detailVersions = new Map<string, number>()

function isDefiniteStatusRejection(cause: unknown): boolean {
  const status = normalizeApiError(cause).status
  return status !== null && status >= 400 && status < 500
}

function invalidateDetailRequests(id: string): void {
  detailVersions.set(id, (detailVersions.get(id) ?? 0) + 1)
}

function applyConfirmedStatuses(list: FeedbackItem[], startedEpoch: number): FeedbackItem[] {
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
  if (!requireFeature(Feature.ADMIN_AI_FEEDBACK)) {
    if (!hasLoadedOnce) blockedInitialLoad = true
    loading.value = false
    return
  }
  blockedInitialLoad = false
  loading.value = true; error.value = ''
  try {
    const result = await listFeedback(page.value, reason.value)
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
function removeReasonChip() { reason.value = ''; filterChanged() }
function move(delta: number) { page.value += delta; clearResults(); void load() }
function previewText(value: string | null) {
  const chars = [...(value || '')]
  return chars.length > 120 ? `${chars.slice(0, 120).join('')}…` : (value || '—')
}
function reasonLabels(codes: readonly FeedbackReason[]) {
  return codes.map(code => t(`aiFeedback.reasons.${code}`)).join(', ')
}
function fmtTime(value: string) { return new Date(value).toLocaleString() }
function reasonChips() {
  return reason.value ? [{ key: 'reason', label: `${t('aiFeedback.filter')}: ${t(`aiFeedback.reasons.${reason.value}`)}` }] : []
}

function statusOptions(id: string) {
  return feedbackStatuses.map(value => ({ value, label: t('aiFeedback.status.' + value), disabled: !!savingStatus.value[id] }))
}

function applyStatus(id: string, status: FeedbackStatus): void {
  statusEpoch++
  invalidateDetailRequests(id)
  confirmedStatuses.set(id, { status, epoch: statusEpoch })
  const target = items.value.find(entry => entry.id === id)
  if (target) target.status = status
  if (selected.value && selected.value.id === id) selected.value = { ...selected.value, status }
  if (detail.value && detail.value.id === id) detail.value = { ...detail.value, status }
  else if (pendingDetailId.value === id && selected.value?.id === id) void loadDetail(id)
}
async function changeStatus(item: FeedbackItem, next: FeedbackStatus): Promise<void> {
  if (next === item.status || savingStatus.value[item.id] || !requireFeature(Feature.ADMIN_AI_FEEDBACK)) return
  savingStatus.value = { ...savingStatus.value, [item.id]: true }
  error.value = ''
  try {
    await updateFeedbackStatus(item.id, next)
    applyStatus(item.id, next)
  } catch (cause) {
    if (isDefiniteStatusRejection(cause)) {
      error.value = apiErrorLabel(t, te, cause)
    } else {
      await reconcileStatus(item)
    }
  } finally {
    const rest = { ...savingStatus.value }
    delete rest[item.id]
    savingStatus.value = rest
  }
}
async function reconcileStatus(item: FeedbackItem): Promise<void> {
  try {
    const result = await getFeedback(item.id)
    applyStatus(item.id, result.status)
  } catch {
    error.value = t('aiFeedback.statusUnconfirmed')
  }
}

async function loadDetail(id: FeedbackItem['id']): Promise<void> {
  const current = ++detailGeneration
  const detailVersion = detailVersions.get(id) ?? 0
  const statusEpochAtStart = statusEpoch
  if (!requireFeature(Feature.ADMIN_AI_FEEDBACK)) return
  error.value = ''
  try {
    const result = await getFeedback(id)
    if (current !== detailGeneration || detailVersion !== (detailVersions.get(id) ?? 0)) return
    const confirmed = confirmedStatuses.get(result.id)
    detail.value = confirmed && confirmed.epoch > statusEpochAtStart ? { ...result, status: confirmed.status } : result
  } catch (cause) {
    if (current === detailGeneration && detailVersion === (detailVersions.get(id) ?? 0)) error.value = apiErrorLabel(t, te, cause)
  } finally {
    if (pendingDetailId.value === id && current === detailGeneration) pendingDetailId.value = null
  }
}

function openDetail(item: FeedbackItem, event?: Event) {
  returnFocus.value = event ? rowOpenTarget(event) : null
  selected.value = item; detail.value = null; deleting.value = false
  dangerZone.value?.reset()
  pendingDetailId.value = item.id
  void loadDetail(item.id)
}
function onRowClick(item: FeedbackItem, event: Event) { if (!isRowControlClick(event)) void openDetail(item, event) }
function closeDetail() { if (deleting.value) return; detailGeneration++; selected.value = null; detail.value = null; pendingDetailId.value = null }
async function remove() {
  const target = selected.value
  if (deleting.value || !target || !requireFeature(Feature.ADMIN_AI_FEEDBACK)) return
  deleting.value = true; error.value = ''
  try {
    await deleteFeedback(target.id)
    returnFocus.value = pageRoot.value
    deleting.value = false
    closeDetail()
    await load()
  } catch (cause) { error.value = apiErrorLabel(t, te, cause) }
  finally { deleting.value = false }
}
onMounted(load)
watch(() => availability(Feature.ADMIN_AI_FEEDBACK).available, available => {
  if (available && blockedInitialLoad && !hasLoadedOnce && !loading.value) void load()
})
onBeforeUnmount(() => { generation++; detailGeneration++; pendingDetailId.value = null })
</script>

<template>
  <section ref="pageRoot" class="feedback-admin admin-page" tabindex="-1" :aria-label="$t('aiFeedback.adminTitle')">
    <ShowcaseHero compact section="admin" :kicker="$t('aiFeedback.adminKicker')" :title="$t('aiFeedback.adminTitle')">
      <template #actions>
        <AppButton size="sm" :disabled="loading" @click="load">{{ $t('aiFeedback.refresh') }}</AppButton>
      </template>
    </ShowcaseHero>
    <AdminFilterBar :chips="reasonChips()" @remove="removeReasonChip">
      <label class="admin-list-field">
        <span>{{ $t('aiFeedback.filter') }}</span>
        <select v-model="reason" class="admin-list-input" data-testid="feedback-reason-filter" @change="filterChanged">
          <option value="">{{ $t('aiFeedback.all') }}</option>
          <option v-for="item in feedbackReasons" :key="item" :value="item">{{ $t(`aiFeedback.reasons.${item}`) }}</option>
        </select>
      </label>
    </AdminFilterBar>
    <p v-if="error && !selected" class="admin-list-status is-error" role="alert">{{ error }}</p>
    <p v-if="loading" class="admin-list-empty" role="status">{{ $t('aiFeedback.loading') }}</p>
    <p v-else-if="loaded && !items.length" class="admin-list-empty">{{ $t('aiFeedback.empty') }}</p>
    <div v-if="items.length" class="admin-list-table-wrap">
      <table class="admin-list-table">
        <thead><tr><th>{{ $t('aiFeedback.created') }}</th><th>{{ $t('aiFeedback.filter') }}</th><th>{{ $t('aiFeedback.comment') }}</th><th>{{ $t('aiFeedback.model') }}</th><th>{{ $t('aiFeedback.statusLabel') }}</th></tr></thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" class="is-clickable" :class="{ 'is-active': selected?.id === item.id }" @click="onRowClick(item, $event)">
            <td class="cell-primary"><button type="button" class="admin-list-open" data-testid="feedback-row-open" @click="openDetail(item, $event)">{{ fmtTime(item.createdAt) }}</button></td>
            <td :data-label="$t('aiFeedback.filter')">{{ reasonLabels(item.reasonCodes) }}</td>
            <td class="is-wrap" :data-label="$t('aiFeedback.comment')">{{ previewText(item.feedbackText) }}</td>
            <td :data-label="$t('aiFeedback.model')">{{ item.model || '—' }}</td>
            <td class="feedback-status-cell" :data-label="$t('aiFeedback.statusLabel')">
              <SegmentedControl :model-value="item.status" :options="statusOptions(item.id)" wrap
                :ariaLabel="$t('aiFeedback.statusLabel')" @update:model-value="changeStatus(item, $event)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="loaded || page > 0" class="admin-list-pagination">
      <span v-if="loaded">{{ page + 1 }} / {{ Math.max(totalPages, 1) }} · {{ totalItems }}</span>
      <span v-else>{{ page + 1 }}</span>
      <div class="admin-list-pagination-controls">
        <AppButton size="sm" :disabled="loading || page === 0" @click="move(-1)">{{ $t('aiFeedback.previous') }}</AppButton>
        <AppButton size="sm" :disabled="!loaded || loading || page + 1 >= totalPages" @click="move(1)">{{ $t('aiFeedback.next') }}</AppButton>
      </div>
    </div>

    <AdminDetailDrawer :open="!!selected" :title="$t('aiFeedback.detail')" :return-focus-to="returnFocus" @close="closeDetail">
      <template v-if="selected">
        <section class="admin-list-section">
          <dl class="admin-list-dl">
            <dt>{{ $t('aiFeedback.created') }}</dt><dd>{{ fmtTime(selected.createdAt) }}</dd>
            <dt>{{ $t('aiFeedback.model') }}</dt><dd>{{ selected.model || '—' }}</dd>
            <dt>{{ $t('aiFeedback.filter') }}</dt><dd>{{ reasonLabels(selected.reasonCodes) }}</dd>
          </dl>
        </section>
        <p v-if="!detail && !error" class="admin-list-muted" role="status">{{ $t('aiFeedback.loading') }}</p>
        <template v-if="detail">
          <p class="admin-list-muted" data-testid="feedback-detail-status">{{ $t('aiFeedback.statusLabel') }}: {{ $t('aiFeedback.status.' + detail.status) }}</p>
          <section class="admin-list-section"><h3 class="admin-list-section-title">{{ $t('aiFeedback.comment') }}</h3><pre class="admin-list-pre">{{ detail.feedbackText || '—' }}</pre></section>
          <section class="admin-list-section"><h3 class="admin-list-section-title">{{ $t('aiFeedback.snapshot') }}</h3><pre class="admin-list-pre">{{ detail.aiResponseText }}</pre></section>
        </template>
      </template>
      <template #footer>
        <p v-if="error && selected" class="admin-list-error" role="alert">{{ error }}</p>
        <AdminDangerZone
          ref="dangerZone"
          :action-label="$t('aiFeedback.delete')"
          :hint="$t('aiFeedback.deleteHint')"
          :message="$t('aiFeedback.deleteConfirm')"
          :busy="deleting"
          @confirm="remove"
        />
      </template>
    </AdminDetailDrawer>
  </section>
</template>
