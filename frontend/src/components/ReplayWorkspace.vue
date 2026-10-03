<script setup>
import { computed, inject, nextTick, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { mapLabel } from '../utils/helpers.js'
import { defineLazyModule, reloadForFreshBundle } from '../utils/lazyModule.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useAuth } from '../composables/useAuth.js'
import { useReplayWorkspace } from '../composables/useReplayWorkspace.js'
import { useNativeReplayImport } from '../composables/useNativeReplayImport.js'
import { useMountedWhenActive } from '../composables/useMountedWhenActive.js'
import ReplayPage from './ReplayPage.vue'
import FileDrop from './FileDrop.vue'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import ReplayCapabilityTabs from './ReplayCapabilityTabs.vue'
import ReplayCapabilityAuthGate from './ReplayCapabilityAuthGate.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import PageHeader from './PageHeader.vue'
import BattlePicker from './BattlePicker.vue'
import { battlePickerOptions, buildSeriesOverview } from '../utils/replaySeries.js'

/**
 * 审计 PF-02：能力面板的代码块都不进主包（2D 回放带约 2.5MB 地图语义数据；3D 带 Three.js；
 * 射击带装甲与弹表；AI 带 SSE 与投影）。
 *
 * 懒加载边界：部署换掉 chunk 文件名后，旧页面进入能力时必然 404——必须变成可恢复的失败态，
 * 不能让 Vue 渲染中断（那会把整个工作台打成空壳，见 utils/lazyModule.ts 的说明）。
 * generation 与 recovery 由该边界自己拥有，工作台不重复管理。
 */
const playbackModule = defineLazyModule(() => import('./BattlePlaybackPanel.vue'))
const threeModule = defineLazyModule(() => import('./Replay3DPane.vue'))
const shotsModule = defineLazyModule(() => import('./ReplayShotsPane.vue'))
const aiModule = defineLazyModule(() => import('./AiReviewWorkspacePane.vue'))
const BattlePlaybackPanel = playbackModule.component
const Replay3DPane = threeModule.component
const ReplayShotsPane = shotsModule.component
const AiReviewWorkspacePane = aiModule.component

defineOptions({ name: 'ReplayWorkspace' })

const props = defineProps({
  /** 初始能力：data / playback / 3d / shots / ai（由路由 view 派生）。 */
  initialCapability: { type: String, default: 'data' },
})

const navigate = inject(NAVIGATE_VIEW_KEY, null)
const { t, locale } = useI18n()
const { authenticated } = useAuth()
const { availability, requireFeature } = useFeatureGate()
const onlineFeatures = { '3d': Feature.PLAYBACK_3D, ai: Feature.AI_REVIEW }
const threeAvailability = computed(() => availability(Feature.PLAYBACK_3D))
const aiAvailability = computed(() => availability(Feature.AI_REVIEW))
const threeBlocked = computed(() => !threeAvailability.value.available ? t(threeAvailability.value.messageKey) : blockedReason.value)
const aiBlocked = computed(() => !aiAvailability.value.available ? t(aiAvailability.value.messageKey) : blockedReason.value)

/**
 * Workspace 持有唯一一份 replay selection 与本地分析结果（服务器没有 parser：文件不出本机，
 * 匿名即可用，不等登录）。五个能力共享这份状态——选择一次、只分析一次、不重新选文件。
 * 直接子组件通过显式 props 消费，不再通过 string provide/inject 隐藏依赖。
 */
const workspace = useReplayWorkspace(props.initialCapability || 'data')

const {
  files, loading, error, resp, updateFiles,
  analysis, analyze, cancelAnalysis, dismissAnalysis,
} = workspace.replay

/**
 * Android 外部 replay 完整自动解析契约：
 * pending File 导入 → 替换当前 selection → 本机分析一次 → data tab 展示结果。
 * 仅在 Android external intent 触发（isAndroidApp()); 普通 Web/FileDrop 手动选文件不经过此回调，
 * 保持现有手动 UX。绝不自动启动 AI Review。
 *
 * 返回值是 Native pending 的 ACK 唯一依据：本机分析完成（无论有没有有效场次）才返回 true——
 * 重新导入同一份不会有不同结果；回放引擎装载失败（可重试）不 ACK，保留 pending。
 */
async function importPendingFile(file) {
  workspace.setWorkspaceTab('data')
  updateFiles([file])
  const result = await analyze()
  return result?.completed === true
}

const { consumePendingWhenReady } = useNativeReplayImport({
  isReady: () => true,
  onPendingFile: importPendingFile,
  onReadError: (reason) => {
    error.value = reason === 'native-client-upgrade-required'
      ? t('workspace.native_client_upgrade_required')
      : t('workspace.native_replay_read_failed')
  },
})

/**
 * 五个能力始终公开显示。数据 / 2D 匿名可用；3D / 射击 / AI 登录后使用，
 * 管理员角色不改变工作台能力。登录门禁位于实际解析与场景挂载之前。
 */
const capabilityOptions = [
  { key: 'data', labelKey: 'workspace.tab_data' },
  { key: 'playback', labelKey: 'workspace.tab_playback' },
  { key: '3d', labelKey: 'workspace.tab_3d' },
  { key: 'shots', labelKey: 'workspace.tab_shots' },
  { key: 'ai', labelKey: 'workspace.tab_ai' },
]

/**
 * 能力面板首次进入时才挂载（代码块按需加载、不进主包），之后切走只隐藏：
 * 停渲染但不销毁会话——切回不重新要求文件、不重新解析、保留 timeline / 相机。
 * 退出登录卸载受保护面板，工作台持有的 replay selection / 数据结果继续保留。
 */
const activeCapability = workspace.activeWorkspaceTab
const playbackMounted = useMountedWhenActive(() => activeCapability.value === 'playback')
// 远端能力同时受两条独立门禁约束：登录（main：3D / 射击 / AI 登录后使用）与连通性（本分支：
// ONLINE_REQUIRED 功能在非-online 时连挂载都不做）。两者都必须成立才挂载。
const threeMounted = useMountedWhenActive(() =>
  authenticated.value && activeCapability.value === '3d' && threeAvailability.value.available)
const shotsMounted = useMountedWhenActive(() => authenticated.value && activeCapability.value === 'shots')
const aiMounted = useMountedWhenActive(() =>
  authenticated.value && activeCapability.value === 'ai' && aiAvailability.value.available)

/**
 * 能力模块加载失败态（design-language §10）：说清发生了什么 + 下一步怎么做。
 *
 * 失败态是**持久的**：切走再切回来仍然显示，只有用户明确选择才算处理过——
 * 自动清状态只会把「有提示的失败」变成「没有提示的空白」。generation 与 recovery 由
 * `lazyModule` 自己拥有（见其文件头），Workspace 不重复管理。
 *
 * 触发条件是「页面还跑着上一次部署的 bundle，而 chunk 已被新部署替换」——重新加载必然修好，
 * 所以主操作是重新加载；「重试」只覆盖网络瞬断（同一 URL 再试一次即可）。
 */
function paneLoadError(module) {
  return module.error.value ? 'workspace.pane_load_failed' : ''
}
const playbackLoadError = computed(() => paneLoadError(playbackModule))
const threeLoadError = computed(() => paneLoadError(threeModule))
const shotsLoadError = computed(() => paneLoadError(shotsModule))
const aiLoadError = computed(() => paneLoadError(aiModule))

/** 重试：由 lazyModule 创建新一代 async wrapper（不是重复跑一次 import）。 */
async function retryPane(module) {
  await module.retry()
}

/** 模板直接消费的 workspace 权威 ref（顶层绑定，模板自动解包 ref）。 */
const currentBattleId = workspace.currentBattleId

/**
 * 单场能力（2D 回放 / 3D 回放 / 射击分析 / AI 复盘）共用的场次选择器：只列解析成功的场次
 * （failed / duplicate 不入列），选项文案与数据模式一致（第 N 场 · 地图 · 胜方 · 时间）。
 * 数据模式的选择器在 ReplayPage 工具栏里。
 */
const battleOptions = computed(() =>
  battlePickerOptions(buildSeriesOverview(resp.value), { t, locale: locale.value, mapLabel }))
function onBattleSelect(sourceId) {
  workspace.selectBattle(sourceId)
}

/** 单场能力的目标文件：单文件直接用；多文件须先选场次（本机解析单场） */
const targetFile = computed(() => workspace.currentTargetFile.value)
const blockedReason = computed(() =>
  files.value.length > 1 && !targetFile.value ? t('workspace.single_replay_required') : '')

const VIEW_BY_CAPABILITY = Object.freeze({
  data: 'replay',
  playback: 'battle-playback',
  '3d': 'agent-replay',
  shots: 'agent-shots',
  ai: 'ai-review',
})

/** capability → 路由 view（Back / Forward 与深链仍由 Vue Router 唯一持有）。 */
function viewFor(cap) {
  return VIEW_BY_CAPABILITY[cap] || 'replay'
}

async function setCapability(key) {
  if (key === activeCapability.value) return
  workspace.setWorkspaceTab(key)
  if (onlineFeatures[key]) requireFeature(onlineFeatures[key])
  if (navigate) navigate(viewFor(key))
}

async function onPreview() {
  await analyze()
}

function onFileRemoveRequest(f) {
  workspace.replay.askRemoveFile(f)
}

function confirmRemove() {
  workspace.replay.confirmRemove()
}

function clearSelection() {
  updateFiles([])
}

/** 上传条是唯一的清空入口（带确认）；清空时同时复位所有单场能力的引用。 */
function onFilesUpdate(next) {
  if (!next.length) clearSelection()
  else updateFiles(next)
}

/** 挂载后消费 Android pending replay（本机分析，不依赖登录状态）。 */
onMounted(() => nextTick(() => consumePendingWhenReady()))

watch(() => props.initialCapability, (val) => {
  if (val) {
    workspace.setWorkspaceTab(val)
    if (onlineFeatures[val]) requireFeature(onlineFeatures[val])
  }
}, { immediate: true })

</script>

<template>
  <div class="layout-data-workspace replay-workspace">
    <PageHeader :title="$t('workspace.title')" />
    <ReplayCapabilityTabs :options="capabilityOptions" :active-capability="activeCapability" @select="setCapability" />

    <div class="workspace-source">
      <FileDrop
        :files="files"
        :loading="loading"
        :confirm-remove="!!resp"
        :compact="!!resp"
        :allow-folder="activeCapability === 'data'"
        @update:files="onFilesUpdate"
        @preview="onPreview"
        @remove-request="onFileRemoveRequest"
      />
      <ReplayProcessingPanel
        :analysis="analysis"
        :result="resp"
        @cancel="cancelAnalysis"
        @dismiss="dismissAnalysis"
      />
      <Banner v-if="error" tone="danger" data-testid="ws-error">
        <p>{{ error }}</p>
        <template v-if="error === t('workspace.native_replay_read_failed')" #actions>
          <AppButton size="sm" data-testid="ws-native-retry" @click="consumePendingWhenReady">{{ $t('workspace.native_replay_retry') }}</AppButton>
        </template>
      </Banner>
    </div>

    <div class="workspace-content">
      <ReplayPage
        v-show="activeCapability === 'data'"
        data-testid="ws-data"
        :embedded="true"
        :replay-context="workspace.replay"
        :workspace-context="workspace"
      />
      <div v-show="activeCapability === 'playback'" class="capability-pane" data-testid="ws-playback">
        <Banner v-if="playbackLoadError" tone="danger" data-testid="ws-playback-load-error">
          <p>{{ $t(playbackLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-playback-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-playback-load-retry" @click="retryPane(playbackModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <BattlePicker
          v-else-if="battleOptions.length > 1"
          class="single-battle-picker"
          :options="battleOptions"
          :model-value="currentBattleId"
          :aria-label="$t('workspace.battle_picker')"
          data-testid="playback-battle-picker"
          @update:model-value="onBattleSelect"
        />
        <BattlePlaybackPanel
          v-if="playbackMounted && !playbackLoadError"
          :file="targetFile"
          :active="activeCapability === 'playback'"
          :blocked-reason="blockedReason"
        />
      </div>
      <div v-show="activeCapability === '3d'" class="capability-pane" data-testid="ws-3d">
        <!-- 顺序即优先级：连通性（capability SSOT）→ 登录门禁 → 加载错误 → 面板。
             非-online 时既不给登录入口、也不挂载 3D（远端资源所需的连接不存在）。 -->
        <Banner v-if="!threeAvailability.available" tone="info" data-testid="ws-3d-connectivity">
          <p>{{ $t(threeAvailability.messageKey) }}</p>
        </Banner>
        <ReplayCapabilityAuthGate
          v-else-if="!authenticated && activeCapability === '3d'"
          :title="$t('workspace.tab_3d')"
          :description="$t('workspace.login_required_3d')"
          login-destination="agent-replay"
        />
        <Banner v-else-if="authenticated && threeLoadError" tone="danger" data-testid="ws-3d-load-error">
          <p>{{ $t(threeLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-3d-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-3d-load-retry" @click="retryPane(threeModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <BattlePicker
          v-else-if="authenticated && battleOptions.length > 1"
          class="single-battle-picker"
          :options="battleOptions"
          :model-value="currentBattleId"
          :aria-label="$t('workspace.battle_picker')"
          data-testid="replay3d-battle-picker"
          @update:model-value="onBattleSelect"
        />
        <Replay3DPane
          v-if="authenticated && threeMounted && !threeLoadError"
          :file="targetFile"
          :active="activeCapability === '3d' && threeAvailability.available"
          :blocked-reason="threeBlocked"
        />
      </div>
      <div v-show="activeCapability === 'shots'" class="capability-pane" data-testid="ws-shots">
        <ReplayCapabilityAuthGate
          v-if="!authenticated && activeCapability === 'shots'"
          :title="$t('workspace.tab_shots')"
          :description="$t('workspace.login_required_shots')"
          login-destination="agent-shots"
        />
        <Banner v-else-if="authenticated && shotsLoadError" tone="danger" data-testid="ws-shots-load-error">
          <p>{{ $t(shotsLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-shots-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-shots-load-retry" @click="retryPane(shotsModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <BattlePicker
          v-else-if="authenticated && battleOptions.length > 1"
          class="single-battle-picker"
          :options="battleOptions"
          :model-value="currentBattleId"
          :aria-label="$t('workspace.battle_picker')"
          data-testid="shots-battle-picker"
          @update:model-value="onBattleSelect"
        />
        <ReplayShotsPane
          v-if="authenticated && shotsMounted && !shotsLoadError"
          :file="targetFile"
          :active="activeCapability === 'shots'"
          :blocked-reason="blockedReason"
          :navigate="navigate"
        />
      </div>
      <div v-show="activeCapability === 'ai'" class="capability-pane" data-testid="ws-ai">
        <Banner v-if="!aiAvailability.available" tone="info" data-testid="ws-ai-connectivity">
          <p>{{ $t(aiAvailability.messageKey) }}</p>
        </Banner>
        <Banner v-else-if="aiLoadError" tone="danger" data-testid="ws-ai-load-error">
          <p>{{ $t(aiLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-ai-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-ai-load-retry" @click="retryPane(aiModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <BattlePicker
          v-else-if="battleOptions.length > 1"
          class="single-battle-picker"
          :options="battleOptions"
          :model-value="currentBattleId"
          :aria-label="$t('workspace.battle_picker')"
          data-testid="ai-battle-picker"
          @update:model-value="onBattleSelect"
        />
        <AiReviewWorkspacePane
          v-if="aiMounted && !aiLoadError"
          :file="targetFile"
          :active="activeCapability === 'ai' && aiAvailability.available"
          :blocked-reason="aiBlocked"
        />
      </div>
    </div>

    <RemoveConfirmModal :pending="workspace.replay.pendingRemove.value" @confirm="confirmRemove" @cancel="workspace.replay.cancelRemove" />
  </div>
</template>

<style scoped>
.replay-workspace { padding-right: var(--pd-drawer-offset, 0px); }
.workspace-source { display: grid; gap: var(--space-3); margin-bottom: var(--space-4); }
.workspace-status { margin: 0; padding: var(--space-12) var(--space-4); color: var(--color-text-secondary); font: var(--type-body); text-align: center; }
.capability-pane { margin-top: var(--space-1); }
.single-battle-picker { margin-bottom: var(--space-3); }
</style>
