<script setup>
import { computed, defineAsyncComponent, inject, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { mapLabel } from '../utils/helpers.js'
import { useAuth } from '../composables/useAuth.js'
import { useReplayWorkspace } from '../composables/useReplayWorkspace.js'
import { useNativeReplayImport } from '../composables/useNativeReplayImport.js'
import ReplayPage from './ReplayPage.vue'
import FileUploader from './FileUploader.vue'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import ReplayCapabilityTabs from './ReplayCapabilityTabs.vue'
import AppButton from './AppButton.vue'
// 审计 PF-02：2D 回放（含约 2.5MB 的地图语义数据）只在进入 2D 回放模式时加载，不进主包。
const BattlePlaybackPanel = defineAsyncComponent(() => import('./BattlePlaybackPanel.vue'))
// AI 复盘面板（本机建立 canonical AI 投影 + SSE 流）同样按需加载。
const AiReviewWorkspacePane = defineAsyncComponent(() => import('./AiReviewWorkspacePane.vue'))
import Banner from './Banner.vue'
import PageHeader from './PageHeader.vue'
import BattlePicker from './BattlePicker.vue'
import { battlePickerOptions, buildSeriesOverview } from '../utils/replaySeries.js'

defineOptions({ name: 'ReplayWorkspace' })

const props = defineProps({
  /** 初始能力：data / ai / playback（由路由 view 派生）。 */
  initialCapability: { type: String, default: 'data' },
})

const navigate = inject(NAVIGATE_VIEW_KEY, null)
const { t, locale } = useI18n()
const { isAdmin } = useAuth()

/**
 * Workspace 持有唯一一份 replay selection 与本地分析结果（服务器没有 parser：文件不出本机，
 * 匿名即可用，不等登录）。data / ai / playback 三个能力共享这份状态——选择一次、只分析一次。
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
 * 仅在 Android external intent 触发（isAndroidApp()); 普通 Web/FileUploader 手动选文件不经过此回调，
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
 * 模式：数据 · 2D 回放 · 3D 回放* · 射击分析* · AI 复盘（* 仅管理员）。
 * 3D / 射击目前仍是独立页面（各自读取本地文件），切换时导航过去；嵌入工作台留到 L6。
 */
const NAVIGATION_ONLY_CAPABILITIES = Object.freeze({ '3d': 'agent-replay', shots: 'agent-shots' })
const capabilityOptions = computed(() => [
  { key: 'data', labelKey: 'workspace.tab_data' },
  { key: 'playback', labelKey: 'workspace.tab_playback' },
  ...(isAdmin.value
    ? [{ key: '3d', labelKey: 'workspace.tab_3d' }, { key: 'shots', labelKey: 'workspace.tab_shots' }]
    : []),
  { key: 'ai', labelKey: 'workspace.tab_ai' },
])

const activeCapability = workspace.activeWorkspaceTab
/** 2D 回放面板首次进入时才挂载（之后保留状态，切走只是隐藏），它的代码块因此不随工作台加载。 */
const playbackMounted = ref(activeCapability.value === 'playback')
watch(activeCapability, (cap) => { if (cap === 'playback') playbackMounted.value = true })
const aiMounted = ref(activeCapability.value === 'ai')
watch(activeCapability, (cap) => { if (cap === 'ai') aiMounted.value = true })

/** 模板直接消费的 workspace 权威 ref（顶层绑定，模板自动解包 ref）。 */
const currentBattleId = workspace.currentBattleId

/**
 * 2D 回放的场次选择器：只列解析成功的场次（failed / duplicate 不入列），
 * 选项文案与数据模式一致（第 N 场 · 地图 · 胜方 · 时间）。数据模式的选择器在 ReplayPage 工具栏里。
 */
const playbackBattleOptions = computed(() =>
  battlePickerOptions(buildSeriesOverview(resp.value), { t, locale: locale.value, mapLabel }))
function onBattleSelect(sourceId) {
  workspace.selectBattle(sourceId)
}

/** 2D 回放 / AI 复盘的目标文件：单文件直接用；多文件须先选场次（本机解析单场） */
const playbackFile = computed(() => workspace.currentTargetFile.value)
const playbackBlockedReason = computed(() =>
  files.value.length > 1 && !playbackFile.value ? t('workspace.single_replay_required') : '')

const VIEW_BY_CAPABILITY = Object.freeze({ data: 'replay', ai: 'ai-review', playback: 'battle-playback' })

/** capability → 路由 view。 */
function viewFor(cap) {
  return VIEW_BY_CAPABILITY[cap] || 'replay'
}

async function setCapability(key) {
  if (key === activeCapability.value) return
  if (NAVIGATION_ONLY_CAPABILITIES[key]) {
    if (navigate) navigate(NAVIGATION_ONLY_CAPABILITIES[key])
    return
  }
  workspace.setWorkspaceTab(key)
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

/** 上传条是唯一的清空入口（带确认）；清空时同时复位 2D 回放引用。 */
function onFilesUpdate(next) {
  if (!next.length) clearSelection()
  else updateFiles(next)
}

/** 挂载后消费 Android pending replay（本机分析，不依赖登录状态）。 */
onMounted(() => nextTick(() => consumePendingWhenReady()))

watch(() => props.initialCapability, (val) => {
  if (val) workspace.setWorkspaceTab(val)
}, { immediate: true })

</script>

<template>
  <div class="layout-data-workspace replay-workspace">
    <PageHeader :title="$t('workspace.title')" />
    <ReplayCapabilityTabs :options="capabilityOptions" :active-capability="activeCapability" @select="setCapability" />

    <div class="workspace-source">
      <FileUploader
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
        <BattlePicker
          v-if="playbackBattleOptions.length > 1"
          class="playback-picker"
          :options="playbackBattleOptions"
          :model-value="currentBattleId"
          :aria-label="$t('workspace.battle_picker')"
          data-testid="playback-battle-picker"
          @update:model-value="onBattleSelect"
        />
        <BattlePlaybackPanel
          v-if="playbackMounted"
          :file="playbackFile"
          :active="activeCapability === 'playback'"
          :blocked-reason="playbackBlockedReason"
        />
      </div>
      <div v-show="activeCapability === 'ai'" class="capability-pane">
        <BattlePicker
          v-if="playbackBattleOptions.length > 1"
          class="playback-picker"
          :options="playbackBattleOptions"
          :model-value="currentBattleId"
          :aria-label="$t('workspace.battle_picker')"
          data-testid="ai-battle-picker"
          @update:model-value="onBattleSelect"
        />
        <AiReviewWorkspacePane
          v-if="aiMounted"
          :file="playbackFile"
          :active="activeCapability === 'ai'"
          :blocked-reason="playbackBlockedReason"
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
.playback-picker { margin-bottom: var(--space-3); }
</style>
