<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { feedbackReasons, listFeedback, getFeedback, deleteFeedback } from '../api/ai-review-feedback.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { apiErrorLabel } from '../utils/display.js'
import AppDialog from './AppDialog.vue'

const { t, te } = useI18n()
const { requireFeature } = useFeatureGate()
const items = ref([]), page = ref(0), totalPages = ref(0), totalItems = ref(0), reason = ref('')
const loading = ref(false), error = ref(''), detail = ref(null), confirmId = ref(null), deleting = ref(false)
let generation = 0
let detailGeneration = 0

async function load() {
  const current = ++generation
  if (!requireFeature(Feature.ADMIN_AI_FEEDBACK)) { loading.value = false; return }
  loading.value = true; error.value = ''
  try {
    const result = await listFeedback(page.value, reason.value)
    if (current !== generation) return
    if (result.page > 0 && result.items.length === 0 && result.page >= result.totalPages) {
      page.value = Math.max(0, result.totalPages - 1)
      await load()
      return
    }
    items.value = result.items; totalPages.value = result.totalPages; totalItems.value = result.totalItems
  } catch (cause) { if (current === generation) error.value = apiErrorLabel(t, te, cause) }
  finally { if (current === generation) loading.value = false }
}
function filterChanged() { page.value = 0; void load() }
function move(delta) { page.value += delta; void load() }
async function showDetail(id) {
  const current = ++detailGeneration
  if (!requireFeature(Feature.ADMIN_AI_FEEDBACK)) return
  error.value = ''
  try { const result = await getFeedback(id); if (current === detailGeneration) detail.value = result }
  catch (cause) { if (current === detailGeneration) error.value = apiErrorLabel(t, te, cause) }
}
function closeDetail() { detailGeneration++; detail.value = null }
async function remove() {
  if (deleting.value || !confirmId.value || !requireFeature(Feature.ADMIN_AI_FEEDBACK)) return
  deleting.value = true; error.value = ''
  try { await deleteFeedback(confirmId.value); confirmId.value = null; closeDetail(); await load() }
  catch (cause) { error.value = apiErrorLabel(t, te, cause) }
  finally { deleting.value = false }
}
onMounted(load)
onBeforeUnmount(() => { generation++; detailGeneration++ })
</script>

<template>
  <section class="feedback-admin">
    <h1>{{ $t('aiFeedback.adminTitle') }}</h1>
    <label>{{ $t('aiFeedback.filter') }}
      <select v-model="reason" @change="filterChanged">
        <option value="">{{ $t('aiFeedback.all') }}</option>
        <option v-for="item in feedbackReasons" :key="item" :value="item">{{ $t(`aiFeedback.reasons.${item}`) }}</option>
      </select>
    </label>
    <button type="button" :disabled="loading" @click="load">{{ $t('aiFeedback.refresh') }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">{{ $t('aiFeedback.loading') }}</p>
    <p v-else-if="!items.length">{{ $t('aiFeedback.empty') }}</p>
    <div class="table-wrap">
      <table v-if="items.length">
        <thead><tr><th>{{ $t('aiFeedback.created') }}</th><th>{{ $t('aiFeedback.filter') }}</th><th>{{ $t('aiFeedback.comment') }}</th><th>Model</th><th>{{ $t('aiFeedback.actions') }}</th></tr></thead>
        <tbody><tr v-for="item in items" :key="item.id">
          <td>{{ new Date(item.createdAt).toLocaleString() }}</td>
          <td>{{ item.reasonCodes.map(code => $t(`aiFeedback.reasons.${code}`)).join(', ') }}</td>
          <td class="preview">{{ item.feedbackText || '—' }}</td><td>{{ item.model || '—' }}</td>
          <td><button type="button" @click="showDetail(item.id)">{{ $t('aiFeedback.view') }}</button> <button type="button" @click="confirmId = item.id">{{ $t('aiFeedback.delete') }}</button></td>
        </tr></tbody>
      </table>
    </div>
    <div class="pages"><button type="button" :disabled="loading || page === 0" @click="move(-1)">{{ $t('aiFeedback.previous') }}</button>
      <span>{{ page + 1 }} / {{ Math.max(totalPages, 1) }} · {{ totalItems }}</span>
      <button type="button" :disabled="loading || page + 1 >= totalPages" @click="move(1)">{{ $t('aiFeedback.next') }}</button></div>
    <AppDialog :open="!!detail" :title="$t('aiFeedback.detail')" size="lg" @close="closeDetail">
      <template v-if="detail">
        <p>{{ $t('aiFeedback.created') }}: {{ new Date(detail.createdAt).toLocaleString() }}</p>
        <p>Model: {{ detail.model || '—' }}</p>
        <p>{{ detail.reasonCodes.map(code => $t(`aiFeedback.reasons.${code}`)).join(', ') }}</p>
        <h3>{{ $t('aiFeedback.comment') }}</h3><pre>{{ detail.feedbackText || '—' }}</pre>
        <h3>{{ $t('aiFeedback.snapshot') }}</h3><pre>{{ detail.aiResponseText }}</pre>
      </template>
    </AppDialog>
    <AppDialog :open="!!confirmId" :title="$t('aiFeedback.delete')" tone="danger" @close="!deleting && (confirmId = null)">
      <p>{{ $t('aiFeedback.deleteConfirm') }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="button" :disabled="deleting" @click="confirmId = null">{{ $t('aiFeedback.cancel') }}</button>
      <button type="button" :disabled="deleting" @click="remove">{{ $t('aiFeedback.delete') }}</button>
    </AppDialog>
  </section>
</template>

<style scoped>
.feedback-admin { padding: 20px; max-width: 1200px; margin: auto; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); }
.preview { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pages { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style>
