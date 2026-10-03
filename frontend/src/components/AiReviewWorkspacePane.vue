<!--
  回放工作台 · AI 复盘：为当前目标回放在本机建立 AI 输入（结算事实 + client canonical AI projection，
  replay-local/ai），交给 AiReviewPanel 发起分析。服务器没有 parser——文件不出本机，只上传投影。
  公开显示、登录后使用；时间轴不可用 / 解析失败只显示原因，不回退服务端。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { AgentWasmVersionMismatchError } from '../api/agent-replay-facets.js'
import { ReplayEngineUnavailableError } from '../replay-local/parseReplays.js'
import { AiProjectionUnavailableError, buildLocalAiReviewInput } from '../replay-local/ai/index.js'
import type { AiReviewProjection } from '../types/ai-review.js'
import AiReviewPanel from './AiReviewPanel.vue'
import AppButton from './AppButton.vue'

const props = defineProps({
  /** 目标回放（单场）；null = 尚未选择 */
  file: { type: Object as () => File | null, default: null },
  /** 能力面板是否可见（不可见时不解析） */
  active: { type: Boolean, default: false },
  /** 多文件未选场次等阻断原因（已本地化） */
  blockedReason: { type: String, default: '' },
})


const { t } = useI18n()
const { authenticated, login } = useAuth()

const input = ref<AiReviewProjection | null>(null)
const errorKey = ref('')
let builtFile: File | null = null
let seq = 0

const projectionError = computed(() => (errorKey.value ? t(errorKey.value) : ''))

async function build() {
  const file = props.file
  if (!file || !props.active || props.blockedReason || !authenticated.value || builtFile === file) return
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
    // 版本不一致优先于通用引擎错误：刷新页面即可拿到与本 build 同身份的 Agent 产物
    errorKey.value = e instanceof AgentWasmVersionMismatchError ? 'workspace.ai_engine_version_mismatch'
      : e instanceof ReplayEngineUnavailableError ? 'workspace.ai_engine_unavailable'
        : e instanceof AiProjectionUnavailableError ? 'workspace.ai_projection_unavailable'
          : 'workspace.ai_projection_failed'
  }
}

/**
 * 重建本地 AI 输入（面板失败态里的「重试」动作）：
 * 投影构建是可重复的本机解析，重跑一次即可区分「一次性失败」与「这份回放真的建不起来」。
 * 必须先清空 builtFile——build() 靠它去重，不清会让按钮变成假的。
 */
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
    // 退出登录使在途结果失效，重新登录仍可为同一文件构建输入。
    seq++
    builtFile = null
    input.value = null
    errorKey.value = ''
  }
})
watch(() => [props.file, props.active, props.blockedReason, authenticated.value], () => { void build() }, { immediate: true })
</script>

<template>
  <div class="ai-workspace-pane" data-testid="ws-ai">
    <div v-if="!authenticated" class="ai-login" data-testid="ai-login-required">
      <p class="ws-note">{{ $t('workspace.ai_login_required') }}</p>
      <AppButton data-testid="ai-login" @click="login('ai-review')">{{ $t('app.login') }}</AppButton>
    </div>
    <p v-else-if="blockedReason" class="ws-note" data-testid="ai-blocked">{{ blockedReason }}</p>
    <AiReviewPanel
      v-else
      :file="file ?? undefined"
      :projection="input"
      :projection-error="projectionError"
      @rebuild-projection="rebuildProjection"
    />
  </div>
</template>

<style scoped>
.ai-login { display: grid; justify-items: center; gap: var(--space-3); padding: var(--space-8) var(--space-4); }
</style>
