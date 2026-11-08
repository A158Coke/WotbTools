<script setup lang="ts">
// 站点反馈管理（列表模板，docs/frontend/ui-system.md「管理后台列表模板」）：
// 页头 → 原因筛选 → 表格（小屏卡片）→ 分页；点行在右侧抽屉看原文，删除在抽屉底部（两段式确认）。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { siteFeedbackReasons, listSiteFeedback, getSiteFeedback, deleteSiteFeedback, type SiteFeedbackReason } from '../api/site-feedback.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { apiErrorLabel } from '../utils/display.js'
import AdminDangerZone from './AdminDangerZone.vue'
import AdminDetailDrawer from './AdminDetailDrawer.vue'
import AdminFilterBar from './AdminFilterBar.vue'
import AppButton from './AppButton.vue'
import PageHeader from './PageHeader.vue'
import { isRowControlClick, rowOpenTarget } from './adminListRow'
import './admin-list.css'

type FeedbackPage = Awaited<ReturnType<typeof listSiteFeedback>>
type FeedbackItem = FeedbackPage['items'][number]
type FeedbackDetail = Awaited<ReturnType<typeof getSiteFeedback>>

const { t, te } = useI18n()
const { requireFeature, availability } = useFeatureGate()
const items = ref<FeedbackItem[]>([]), page = ref(0), totalPages = ref(0), totalItems = ref(0), reason = ref<SiteFeedbackReason | ''>('')
const loading = ref(false), error = ref(''), deleting = ref(false)
const selected = ref<FeedbackItem | null>(null), detail = ref<FeedbackDetail | null>(null)
const returnFocus = ref<HTMLElement | null>(null)
const dangerZone = ref<InstanceType<typeof AdminDangerZone> | null>(null)
const loaded = ref(false)
let hasLoadedOnce = false
let blockedInitialLoad = false
let generation = 0
let detailGeneration = 0

async function load(): Promise<void> {
  const current = ++generation
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
    items.value = result.items; totalPages.value = result.totalPages; totalItems.value = result.totalItems
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
function reasonLabels(codes: readonly SiteFeedbackReason[]) {
  return codes.map(code => t(`siteFeedback.reasons.${code}`)).join(', ')
}
function fmtTime(value: string) { return new Date(value).toLocaleString() }
function reasonChips() {
  return reason.value ? [{ key: 'reason', label: `${t('siteFeedback.filter')}: ${t(`siteFeedback.reasons.${reason.value}`)}` }] : []
}

/** 点行 / 主列按钮：抽屉立即打开显示列表字段，原文随后由详情请求补上。 */
async function openDetail(item: FeedbackItem, event?: Event) {
  const current = ++detailGeneration
  returnFocus.value = event ? rowOpenTarget(event) : null
  selected.value = item; detail.value = null; deleting.value = false
  dangerZone.value?.reset()
  if (!requireFeature(Feature.ADMIN_SITE_FEEDBACK)) return
  error.value = ''
  try { const result = await getSiteFeedback(item.id); if (current === detailGeneration) detail.value = result }
  catch (cause) { if (current === detailGeneration) error.value = apiErrorLabel(t, te, cause) }
}
function onRowClick(item: FeedbackItem, event: Event) { if (!isRowControlClick(event)) void openDetail(item, event) }
function closeDetail() { if (deleting.value) return; detailGeneration++; selected.value = null; detail.value = null }
async function remove() {
  const target = selected.value
  if (deleting.value || !target || !requireFeature(Feature.ADMIN_SITE_FEEDBACK)) return
  deleting.value = true; error.value = ''
  try { await deleteSiteFeedback(target.id); deleting.value = false; closeDetail(); await load() }
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
  <section class="feedback-admin admin-page">
    <PageHeader :kicker="$t('siteFeedback.adminKicker')" :title="$t('siteFeedback.adminTitle')" :description="$t('siteFeedback.adminDescription')">
      <template #actions>
        <AppButton size="sm" :disabled="loading" @click="load">{{ $t('siteFeedback.refresh') }}</AppButton>
      </template>
    </PageHeader>
    <AdminFilterBar :chips="reasonChips()" @remove="removeReasonChip">
      <label class="admin-list-field">
        <span>{{ $t('siteFeedback.filter') }}</span>
        <select v-model="reason" class="admin-list-input" data-testid="feedback-reason-filter" @change="filterChanged">
          <option value="">{{ $t('siteFeedback.all') }}</option>
          <option v-for="item in siteFeedbackReasons" :key="item" :value="item">{{ $t(`siteFeedback.reasons.${item}`) }}</option>
        </select>
      </label>
    </AdminFilterBar>
    <p v-if="error && !selected" class="admin-list-status is-error" role="alert">{{ error }}</p>
    <p v-if="loading" class="admin-list-empty" role="status">{{ $t('siteFeedback.loading') }}</p>
    <p v-else-if="loaded && !items.length" class="admin-list-empty">{{ $t('siteFeedback.empty') }}</p>
    <div v-if="items.length" class="admin-list-table-wrap">
      <table class="admin-list-table">
        <thead><tr><th>{{ $t('siteFeedback.created') }}</th><th>{{ $t('siteFeedback.filter') }}</th><th>{{ $t('siteFeedback.comment') }}</th><th>{{ $t('siteFeedback.page') }}</th></tr></thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" class="is-clickable" :class="{ 'is-active': selected?.id === item.id }" @click="onRowClick(item, $event)">
            <td class="cell-primary"><button type="button" class="admin-list-open" data-testid="feedback-row-open" @click="openDetail(item, $event)">{{ fmtTime(item.createdAt) }}</button></td>
            <td :data-label="$t('siteFeedback.filter')">{{ reasonLabels(item.reasonCodes) }}</td>
            <td class="is-wrap" :data-label="$t('siteFeedback.comment')">{{ previewText(item.feedbackText) }}</td>
            <td :data-label="$t('siteFeedback.page')">{{ item.pageView || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="loaded || page > 0" class="admin-list-pagination">
      <span v-if="loaded">{{ page + 1 }} / {{ Math.max(totalPages, 1) }} · {{ totalItems }}</span>
      <span v-else>{{ page + 1 }}</span>
      <div class="admin-list-pagination-controls">
        <AppButton size="sm" :disabled="loading || page === 0" @click="move(-1)">{{ $t('siteFeedback.previous') }}</AppButton>
        <AppButton size="sm" :disabled="!loaded || loading || page + 1 >= totalPages" @click="move(1)">{{ $t('siteFeedback.next') }}</AppButton>
      </div>
    </div>

    <AdminDetailDrawer :open="!!selected" :title="$t('siteFeedback.detail')" :return-focus-to="returnFocus" @close="closeDetail">
      <template v-if="selected">
        <section class="admin-list-section">
          <dl class="admin-list-dl">
            <dt>{{ $t('siteFeedback.created') }}</dt><dd>{{ fmtTime(selected.createdAt) }}</dd>
            <dt>{{ $t('siteFeedback.page') }}</dt><dd>{{ selected.pageView || '—' }}</dd>
            <dt>{{ $t('siteFeedback.filter') }}</dt><dd>{{ reasonLabels(selected.reasonCodes) }}</dd>
          </dl>
        </section>
        <p v-if="!detail && !error" class="admin-list-muted" role="status">{{ $t('siteFeedback.loading') }}</p>
        <template v-if="detail">
          <section class="admin-list-section"><h3 class="admin-list-section-title">{{ $t('siteFeedback.comment') }}</h3><pre class="admin-list-pre">{{ detail.feedbackText || '—' }}</pre></section>
        </template>
      </template>
      <template #footer>
        <p v-if="error && selected" class="admin-list-error" role="alert">{{ error }}</p>
        <AdminDangerZone
          ref="dangerZone"
          :action-label="$t('siteFeedback.delete')"
          :hint="$t('siteFeedback.deleteHint')"
          :message="$t('siteFeedback.deleteConfirm')"
          :busy="deleting"
          @confirm="remove"
        />
      </template>
    </AdminDetailDrawer>
  </section>
</template>
