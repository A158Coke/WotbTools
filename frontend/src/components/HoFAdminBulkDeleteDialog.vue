<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { components } from '../api/generated/http-contract.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { apiErrorCodeLabel, apiErrorLabel } from '../utils/display.js'
import { hofAdminBulkDeleteRecords } from '../api/hall-of-fame.js'
import AppDialog from './AppDialog.vue'
import { MODERATION_DOMAINS, reasonError, type ModerationKind } from './HoFAdminModeration.js'

const props = defineProps<{ domain: 'records' | ModerationKind; ids: number[] }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ settled: [failedIds: number[]] }>()

const { t, te } = useI18n()
const { requireFeature } = useFeatureGate()

const confirmText = ref('')
const deleting = ref(false)
const result = ref<components['schemas']['BulkDeleteResult'] | null>(null)
const msg = ref('')
const reason = ref('')
const reasonText = ref('')

const moderation = computed(() => (props.domain === 'records' ? null : MODERATION_DOMAINS[props.domain]))
const reasonPrefix = computed(() => moderation.value?.prefix ?? 'hundredAdmin')
const failures = computed(() => (result.value?.results || []).filter(item => !item.deleted))

function reset() {
  confirmText.value = ''
  result.value = null
  msg.value = ''
  deleting.value = false
  reason.value = ''
  reasonText.value = ''
}

watch(open, (value) => { if (value) reset() })

function cancel() {
  open.value = false
  reset()
}

async function confirm() {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  const ids = [...props.ids]
  if (!open.value || !ids.length || deleting.value || confirmText.value !== 'DELETE') return
  const text = reasonText.value.trim()
  const domain = moderation.value
  if (domain) {
    const invalid = reasonError(t, reasonPrefix.value, 'delete', reason.value, reasonText.value)
    if (invalid) {
      msg.value = invalid
      return
    }
  }
  deleting.value = true
  msg.value = ''
  try {
    result.value = domain
      ? await domain.bulkDelete(ids, { reason: reason.value, ...(text ? { reasonText: text } : {}) })
      : await hofAdminBulkDeleteRecords(ids)
  } catch (e) {
    msg.value = apiErrorLabel(t, te, e)
    return
  } finally {
    deleting.value = false
  }
  const failed = new Set(failures.value.map(item => item.id))
  confirmText.value = ''
  emit('settled', ids.filter(id => failed.has(id)))
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="$t('hofAdmin.bulkDeleteTitle')"
    tone="danger"
    class="hof-delete-modal bulk-delete-modal"
    @close="!deleting && cancel()"
  >
    <p class="hof-delete-msg">
      {{ moderation
        ? $t('hofAdmin.bulkDeleteHintModeration', { count: ids.length })
        : $t('hofAdmin.bulkDeleteHint', { count: ids.length }) }}
    </p>
    <template v-if="moderation">
      <label class="hundred-reason-label">{{ $t(`${reasonPrefix}.deleteReason`) }}</label>
      <select v-model="reason">
        <option value="">{{ $t(`${reasonPrefix}.deleteReasonRequired`) }}</option>
        <option v-for="(label, key) in $tm(`${reasonPrefix}.deleteReasonOptions`)" :key="key" :value="key">{{ label }}</option>
      </select>
      <textarea v-model="reasonText" rows="2" :placeholder="$t(`${reasonPrefix}.deleteReasonPlaceholder`)"></textarea>
    </template>
    <template v-if="result">
      <p class="hof-bulk-summary">{{ $t('hofAdmin.bulkSummary', { requested: result.requested, deleted: result.deleted, failed: result.failed }) }}</p>
      <div v-if="failures.length" class="hof-bulk-failures">
        <p class="hof-delete-msg">{{ $t('hofAdmin.bulkFailures') }}</p>
        <ul>
          <li v-for="item in failures" :key="item.id">
            #{{ item.id }} — {{ apiErrorCodeLabel(t, te, item.errorCode) }}
          </li>
        </ul>
      </div>
    </template>
    <template v-else>
      <p v-if="msg" class="error">{{ msg }}</p>
      <label>{{ $t('hofAdmin.bulkDeleteConfirmInput') }}</label>
      <input v-model="confirmText" class="admin-confirm-input" placeholder="DELETE" />
    </template>
    <div class="modal-actions">
      <button class="btn-sm" :disabled="deleting" @click="cancel">
        {{ result ? $t('hofAdmin.close') : $t('hofAdmin.cancel') }}
      </button>
      <button
        v-if="!result"
        class="btn-sm danger"
        :disabled="deleting || confirmText !== 'DELETE'"
        @click="confirm"
      >
        {{ deleting ? $t('hofAdmin.bulkDeleting') : $t('hofAdmin.bulkDelete') }}
      </button>
    </div>
  </AppDialog>
</template>

<style scoped src="./HoFAdminShared.css"></style>
