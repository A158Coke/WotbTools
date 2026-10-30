<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { feedbackReasons, createFeedback } from '../api/ai-review-feedback.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { apiErrorLabel } from '../utils/display.js'
import AppDialog from './AppDialog.vue'

const props = defineProps({ open: Boolean, snapshot: { type: String, default: '' } })
const emit = defineEmits(['close', 'success'])
const { t, te } = useI18n()
const { requireFeature } = useFeatureGate()
const reasons = ref([])
const feedbackText = ref('')
const busy = ref(false)
const error = ref('')
let generation = 0
const valid = computed(() => (reasons.value.length > 0 || feedbackText.value.trim() !== '')
  && [...feedbackText.value].length <= 4000 && [...props.snapshot].length <= 200000 && props.snapshot.trim() !== '')

watch(() => props.open, open => {
  generation++
  if (open) { reasons.value = []; feedbackText.value = ''; error.value = '' }
})
function toggle(reason) {
  reasons.value = reasons.value.includes(reason) ? reasons.value.filter(item => item !== reason) : [...reasons.value, reason]
}
async function submit() {
  if (busy.value || !valid.value || !requireFeature(Feature.AI_FEEDBACK)) return
  busy.value = true
  const current = generation
  error.value = ''
  try {
    await createFeedback({ reasonCodes: reasons.value, feedbackText: feedbackText.value || null, aiResponseText: props.snapshot, model: null })
    if (current === generation) {
      reasons.value = []; feedbackText.value = ''
      emit('success')
    }
  } catch (cause) { if (current === generation) error.value = apiErrorLabel(t, te, cause) }
  finally { busy.value = false }
}
</script>

<template>
  <AppDialog :open="open" :title="$t('aiFeedback.title')" :close-on-scrim="false" @close="!busy && emit('close')">
    <p>{{ $t('aiFeedback.question') }}</p>
    <p>{{ $t('aiFeedback.snapshotNotice') }}</p>
    <div class="reasons">
      <button v-for="reason in feedbackReasons" :key="reason" type="button" :aria-pressed="reasons.includes(reason)" :disabled="busy" @click="toggle(reason)">
        {{ $t(`aiFeedback.reasons.${reason}`) }}
      </button>
    </div>
    <label for="feedback-text">{{ $t('aiFeedback.comment') }}</label>
    <textarea id="feedback-text" v-model="feedbackText" rows="5" :disabled="busy" />
    <p v-if="[...feedbackText].length > 4000 || [...snapshot].length > 200000" role="alert">{{ $t('aiFeedback.tooLong') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="actions">
      <button type="button" :disabled="busy" @click="emit('close')">{{ $t('aiFeedback.cancel') }}</button>
      <button type="button" :disabled="busy || !valid" @click="submit">{{ $t('aiFeedback.submit') }}</button>
    </div>
  </AppDialog>
</template>

<style scoped>
.reasons { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
.reasons button[aria-pressed="true"] { border-color:var(--accent); color:var(--accent-dark); }
textarea { display:block; width:100%; box-sizing:border-box; margin-top:8px; }
.actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
</style>
