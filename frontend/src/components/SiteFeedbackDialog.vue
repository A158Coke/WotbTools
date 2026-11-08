<script setup lang="ts">
import { showToast } from '../composables/useToast.js'
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { siteFeedbackReasons, createSiteFeedback, type SiteFeedbackReason } from '../api/site-feedback.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { apiErrorLabel } from '../utils/display.js'
import AppDialog from './AppDialog.vue'

// 打开时才由外壳挂载，关闭即卸载：表单状态不需要手动重置。
const props = defineProps<{ pageView: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t, te } = useI18n()
const { requireFeature } = useFeatureGate()
const navigate = inject(NAVIGATE_VIEW_KEY, null)
const reasons = ref<SiteFeedbackReason[]>([])
const feedbackText = ref('')
const busy = ref(false)
const error = ref('')
const sent = ref(false)
const tooLong = computed(() => [...feedbackText.value].length > 4000)
const valid = computed(() => (reasons.value.length > 0 || feedbackText.value.trim() !== '') && !tooLong.value)

function toggle(reason: SiteFeedbackReason) {
  reasons.value = reasons.value.includes(reason) ? reasons.value.filter(item => item !== reason) : [...reasons.value, reason]
}
function openContact() {
  emit('close')
  navigate?.('contact')
}
async function submit() {
  if (busy.value || !valid.value || !requireFeature(Feature.SITE_FEEDBACK)) return
  busy.value = true
  error.value = ''
  try {
    await createSiteFeedback({ reasonCodes: reasons.value, feedbackText: feedbackText.value || null, pageView: props.pageView })
    sent.value = true
    showToast({ id: 'site-feedback', tone: 'success', titleKey: 'toast.feedbackSent' })
  } catch (cause) { error.value = apiErrorLabel(t, te, cause) }
  finally { busy.value = false }
}
</script>

<template>
  <AppDialog open :title="$t('siteFeedback.title')" :close-on-scrim="false" @close="!busy && emit('close')">
    <template v-if="sent">
      <p role="status">{{ $t('siteFeedback.success') }}</p>
      <div class="actions"><button type="button" @click="emit('close')">{{ $t('siteFeedback.close') }}</button></div>
    </template>
    <template v-else>
      <p>{{ $t('siteFeedback.question') }}</p>
      <p>{{ $t('siteFeedback.notice') }} <button type="button" class="contact-link" data-testid="site-feedback-contact" :disabled="busy" @click="openContact">{{ $t('siteFeedback.contactLink') }}</button></p>
      <div class="reasons">
        <button v-for="reason in siteFeedbackReasons" :key="reason" type="button" :aria-pressed="reasons.includes(reason)" :disabled="busy" @click="toggle(reason)">
          {{ $t(`siteFeedback.reasons.${reason}`) }}
        </button>
      </div>
      <label for="site-feedback-text">{{ $t('siteFeedback.comment') }}</label>
      <textarea id="site-feedback-text" v-model="feedbackText" rows="5" :disabled="busy" />
      <p v-if="tooLong" role="alert">{{ $t('siteFeedback.tooLong') }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" :disabled="busy" @click="emit('close')">{{ $t('siteFeedback.cancel') }}</button>
        <button type="button" :disabled="busy || !valid" @click="submit">{{ $t('siteFeedback.submit') }}</button>
      </div>
    </template>
  </AppDialog>
</template>

<style scoped>
.contact-link { padding:0; border:0; background:transparent; color:var(--color-accent-text); font:inherit; text-decoration:underline; cursor:pointer; }
.reasons { display:flex; flex-wrap:wrap; gap:var(--space-2); margin:var(--space-3) 0; }
.reasons button[aria-pressed="true"] { border-color:var(--color-accent); color:var(--color-accent-text); }
textarea { display:block; width:100%; box-sizing:border-box; margin-top:var(--space-2); }
.actions { display:flex; justify-content:flex-end; gap:var(--space-2); margin-top:var(--space-3); }
</style>
