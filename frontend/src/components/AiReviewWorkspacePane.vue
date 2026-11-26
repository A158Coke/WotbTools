<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useAuth } from '../composables/useAuth.js'
import { AgentWasmVersionMismatchError } from '../api/agent-replay-facets.js'
import { ReplayEngineUnavailableError } from '../replay-local/parseReplays.js'
import { AiProjectionUnavailableError, buildLocalAiReviewInput } from '../replay-local/ai/index.js'
import type { AiReviewProjection } from '../types/ai-review.js'
import AiReviewPanel from './AiReviewPanel.vue'
import AppButton from './AppButton.vue'

const props = defineProps({
  file: { type: Object as () => File | null, default: null },
  active: { type: Boolean, default: false },
  blockedReason: { type: String, default: '' },
})
const emit = defineEmits<{ 'view-2d': [sec: number] }>()


const { t } = useI18n()
const { authenticated, login } = useAuth()
const { availability, requireFeature } = useFeatureGate()
const online = computed(() => availability(Feature.AI_REVIEW))
function loginOnline() {
  if (requireFeature(Feature.AI_REVIEW)) login('ai-review')
}

const input = ref<AiReviewProjection | null>(null)
const errorKey = ref('')
let builtFile: File | null = null
let seq = 0

const projectionError = computed(() => (errorKey.value ? t(errorKey.value) : ''))
const paneReady = computed(() => !online.value.available || !authenticated.value || !props.file
  || !!errorKey.value || !!input.value)

async function build() {
  const file = props.file
  if (!online.value.available || !file || !props.active || props.blockedReason || !authenticated.value || builtFile === file) return
  builtFile = file
  const mine = ++seq
  input.value = null
  errorKey.value = ''
  try {
    const built = await buildLocalAiReviewInput(file)
    if (mine !== seq) return
    input.value = built
  } catch (e) {
    if (mine !== seq) return
    console.warn('[ai-local] projection failed', e)
    builtFile = null
    errorKey.value = e instanceof AgentWasmVersionMismatchError ? 'workspace.ai_engine_version_mismatch'
      : e instanceof ReplayEngineUnavailableError ? 'workspace.ai_engine_unavailable'
        : e instanceof AiProjectionUnavailableError ? 'workspace.ai_projection_unavailable'
          : 'workspace.ai_projection_failed'
  }
}

function rebuildProjection() {
  seq++
  builtFile = null
  input.value = null
  errorKey.value = ''
  void build()
}

watch(() => props.file, () => {
  seq++
  builtFile = null
  input.value = null
  errorKey.value = ''
})
watch(authenticated, (signedIn) => {
  if (!signedIn) {
    seq++
    builtFile = null
    input.value = null
    errorKey.value = ''
  }
})
watch(() => [props.file, props.active, props.blockedReason, authenticated.value, online.value.available], () => { void build() }, { immediate: true })
</script>

<template>
  <div class="ai-workspace-pane" data-testid="ws-ai" :data-pane-ready="paneReady ? 'true' : undefined">
    <template v-if="!online.available">
      <p v-if="!online.pending" class="ws-note" data-testid="ai-connectivity">{{ $t(online.messageKey!) }}</p>
    </template>
    <div v-else-if="!authenticated" class="ai-login" data-testid="ai-login-required">
      <p class="ws-note">{{ $t('workspace.ai_login_required') }}</p>
      <AppButton data-testid="ai-login" @click="loginOnline">{{ $t('app.login') }}</AppButton>
    </div>
    <p v-else-if="blockedReason" class="ws-note" data-testid="ai-blocked">{{ blockedReason }}</p>
    <AiReviewPanel
      v-else
      :file="file ?? undefined"
      :projection="input"
      :projection-error="projectionError"
      can-view-in2d
      @rebuild-projection="rebuildProjection"
      @view-2d="sec => emit('view-2d', sec)"
    />
  </div>
</template>

<style scoped>
.ai-login { display: grid; justify-items: center; gap: var(--space-3); padding: var(--space-8) var(--space-4); }
</style>
