<script setup>
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleHelp, Play } from 'lucide-vue-next'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { ONBOARDING_KEY, REPLACE_DECLINED } from '../shared/onboarding.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { useForcedLandscape } from '../composables/useForcedLandscape.js'
import { loadOfficialDemo } from '../replay-local/demo.js'
import { mapLabel } from '../utils/helpers.js'
import { defineLazyModule, reloadForFreshBundle } from '../utils/lazyModule.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useAuth } from '../composables/useAuth.js'
import { useConfirm } from '../composables/useConfirm.js'
import { useReplayWorkspace } from '../composables/useReplayWorkspace.js'
import { useNativeReplayImport } from '../composables/useNativeReplayImport.js'
import { useMountedWhenActive } from '../composables/useMountedWhenActive.js'
import { usePointer } from '../composables/useBreakpoint.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { resetViewerClocks, viewerClocks } from '../scene/playback/viewerClockSync.js'
import ReplayPage from './ReplayPage.vue'
import FileDrop from './FileDrop.vue'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import ReplayCapabilityTabs from './ReplayCapabilityTabs.vue'
import { useReplayViewerState, useReplayAutoCenter, useReplayIngest } from '../composables/useReplayOrchestration.js'
import { useReplayImmersive } from '../composables/useReplayImmersive.js'
import ReplayViewerPanel from './ReplayViewerPanel.vue'
import RotatePrompt from './RotatePrompt.vue'
import { showToast } from '../composables/useToast.js'
import { notify } from '../composables/useNotifications.js'
import ReplayCollectionManager from './ReplayCollectionManager.vue'
import ReplayCapabilityAuthGate from './ReplayCapabilityAuthGate.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import BattlePicker from './BattlePicker.vue'
import { battlePickerOptions, buildSeriesOverview, replayCollectionRows } from '../utils/replaySeries.js'

/**
 * 审计 PF-02：能力面板的代码块都不进主包（2D 回放带约 2.5MB 地图语义数据；3D 带 Three.js；
 * 射击带装甲与弹表；AI 带 SSE 与投影）。
 *
 * 懒加载边界：部署换掉 chunk 文件名后，旧页面进入能力时必然 404——必须变成可恢复的失败态，
 * 不能让 Vue 渲染中断（那会把整个工作台打成空壳，见 utils/lazyModule.ts 的说明）。
 * generation 与 recovery 由该边界自己拥有，工作台不重复管理。
 */
/** 五个能力面板都是异步组件（审计 PF-02）：测试只验证工作台的编排与 props 接线。 */
defineOptions({ name: 'ReplayWorkspace' })

const props = defineProps({
  /** 初始能力：data / playback / 3d / shots / ai（由路由 view 派生）。 */
  initialCapability: { type: String, default: 'data' },
})

const navigate = inject(NAVIGATE_VIEW_KEY, null)
const onboarding = inject(ONBOARDING_KEY, null)
const { confirm } = useConfirm()
const { t, locale } = useI18n()
const { authenticated, tokenParsed } = useAuth()
const { availability } = useFeatureGate()
const autoStartUserId = computed(() => (authenticated.value && tokenParsed.value?.sub ? String(tokenParsed.value.sub) : ''))
const threeAvailability = computed(() => availability(Feature.PLAYBACK_3D))
const aiAvailability = computed(() => availability(Feature.AI_REVIEW))
const threeBlocked = computed(() => !threeAvailability.value.available ? t(threeAvailability.value.messageKey) : '')
const aiBlocked = computed(() => !aiAvailability.value.available ? t(aiAvailability.value.messageKey) : '')

/**
 * Workspace 持有唯一一份 replay selection 与本地分析结果（服务器没有 parser：文件不出本机，
 * 匿名即可用，不等登录）。五个能力共享这份状态——选择一次、只分析一次、不重新选文件。
 * 直接子组件通过显式 props 消费，不再通过 string provide/inject 隐藏依赖。
 */
const workspace = useReplayWorkspace(props.initialCapability || 'data')

const {
  files, loading, error, resp, updateFiles, changeFiles, updateDemoFile, isDemoSelection, selectionRevision,
  analysis, analyze, cancelAnalysis,
} = workspace.replay

// 编排拆分（2026-11-20 行数预算 500）：能力/挂载/失败态/场次/seek 同步 → useReplayViewerState；
// 惰性模块表 = 五个 defineLazyModule 的稳定组件（错误态按模块检索）。
const playbackModule = defineLazyModule(() => import('./BattlePlaybackPanel.vue'))
const threeModule = defineLazyModule(() => import('./Replay3DPane.vue'))
const shotsModule = defineLazyModule(() => import('./ReplayShotsPane.vue'))
const aiModule = defineLazyModule(() => import('./AiReviewWorkspacePane.vue'))
const eventsModule = defineLazyModule(() => import('./ReplayEventStreamPane.vue'))
const modules = { playback: playbackModule, three: threeModule, shots: shotsModule, ai: aiModule, events: eventsModule }
const ReplayEventStreamPane = eventsModule.component
const BattlePlaybackPanel = playbackModule.component
const Replay3DPane = threeModule.component
const ReplayShotsPane = shotsModule.component
const AiReviewWorkspacePane = aiModule.component
const viewer = useReplayViewerState(workspace, modules, { navigate, onboarding })
const {
  capabilityOptions, activeCapability, canUseDemoCapabilities, viewerActive, viewerMode, activeTab,
  viewerMounted, playbackMounted, threeMounted, shotsMounted, eventsMounted, aiMounted,
  playbackLoadError, threeLoadError, shotsLoadError, aiLoadError, eventsLoadError, retryPane,
  currentBattleId, battleOptions, onBattleSelect, targetFile,
  initialLoading, openFailed, contentVisible, demoEntryVisible, pending3dSeek,
  sourcePicker, collectionManager, collectionRows, collectionProgress,
  failedReplayCount, acknowledgedResult, partialFailureVisible,
  showBattlePicker, battlePickerTestId,
  playbackSeek, playbackSeekRequest, viewerShotFacet, viewerKillFacet,
  viewIn2d, onTabSelect, setViewerMode, applyCapabilityFromRoute, onEventSeek, setCapability,
} = viewer
const { workspaceContentEl } = useReplayAutoCenter({ activeCapability, initialLoading })
const { demoLoading, demoError, onDemoClick, importPendingFile, loadDemo, markDisposed, abortDemo } = useReplayIngest(
  workspace, { t, confirm, onboarding, setCapability },
)
const { pageActive, autoFullscreenToken, releaseShell, forcedLandscape, wantsImmersive } = useReplayImmersive(
  workspaceContentEl,
  workspace,
  { activeCapability, playbackMounted, threeMounted, workspaceReady: viewer.workspaceReady },
)

const { consumePendingWhenReady, importing: nativeImporting } = useNativeReplayImport({
  isReady: () => true,
  onPendingFile: importPendingFile,
  onReadError: (reason) => {
    error.value = reason === 'native-client-upgrade-required'
      ? t('workspace.native_client_upgrade_required')
      : t('workspace.native_replay_read_failed')
  },
})

function confirmRemove() {
  workspace.replay.confirmRemove()
}

function clearSelection() {
  updateFiles([])
}

/** 选择即加载：这里是普通选择的唯一入口，Demo 与 Android 各自负责自己的那一次加载。 */
function onFilesUpdate(next) {
  if (!next.length) {
    clearSelection()
  } else if (files.value.length) {
    void changeFiles(next)
  } else {
    updateFiles(next)
    void analyze()
  }
}

/** 没有手动解析入口后，「已取消」无处可去：取消就是不打开这批回放。 */
function onCancelLoading() {
  cancelAnalysis()
  clearSelection()
}

async function onRemoveFile(file) {
  if (resp.value) {
    await nextTick()
    workspace.replay.askRemoveFile(file)
    return
  }
  onFilesUpdate(files.value.filter(item => item !== file))
}

async function openOtherReplay() {
  clearSelection()
  await nextTick()
  sourcePicker.value?.chooseFiles()
}

function onWorkspaceDrop(event) {
  sourcePicker.value?.addDropped(event.dataTransfer?.files)
}

/** 挂载后消费 Android pending replay（本机分析，不依赖登录状态）。 */
onMounted(() => nextTick(() => consumePendingWhenReady()))

const onboardingWorkspace = {
  hasFiles: () => files.value.length > 0,
  busy: () => loading.value || demoLoading.value || nativeImporting?.value === true,
  selectionIdentity: () => selectionRevision.value,
  loadDemo,
  setCapability,
  chooseOwnReplay: async () => {
    if (isDemoSelection.value) clearSelection()
    await setCapability('data')
    await nextTick()
    sourcePicker.value?.chooseFiles()
  },
}

/**
 * 手机横屏回放沉浸态：正方形地图只受纵向预算约束，顶栏 + Tab 栏（104px）是最大的单项消耗。
 * 2D / 3D 回放已就绪且设备是触屏手机横屏时向外壳申请沉浸；任何条件失效、离开页面或被 KeepAlive
 * 停用都立即释放。外壳本身（显隐与 token 归零）由 AppShell 独占。
 */
const shellChrome = inject(SHELL_CHROME_KEY, null)
const shellOwner = Symbol('replay-workspace')
const { isPhone } = usePlaybackPhoneForm()
function registerOnboarding() { onboarding?.registerWorkspace(onboardingWorkspace) }
// 回放工作台的页面滚动条出现/消失会让整页横移 15px（收起传输条动画实测 1265→1280→1265）：
// 仅在本工作台挂载期间给 html 挂 `replay-scrollbar-reserve` 预留滚动条槽位（见 app-shell.css），
// 离开（含 KeepAlive 停用）立即还原——后台抽屉等其它页面保持原贴边契约。
const SCROLLBAR_RESERVE_CLASS = 'replay-scrollbar-reserve'
onMounted(() => {
  registerOnboarding()
  document.documentElement.classList.add(SCROLLBAR_RESERVE_CLASS)
})
onActivated(() => {
  registerOnboarding()
  document.documentElement.classList.add(SCROLLBAR_RESERVE_CLASS)
})
onDeactivated(() => document.documentElement.classList.remove(SCROLLBAR_RESERVE_CLASS))
onUnmounted(() => {
  releaseShell()
  markDisposed()
  abortDemo()
  onboarding?.registerWorkspace(null)
  document.documentElement.classList.remove(SCROLLBAR_RESERVE_CLASS)
})

// URL（浏览器前进/后退/深链）是能力的来源：交给 orchestration 处理，
// 2D↔3D 与面板按钮共用同一份时钟交接（不反向 navigate）。
watch(() => props.initialCapability, (val) => {
  if (val) applyCapabilityFromRoute(val)
}, { immediate: true })

</script>

<template>
  <div class="layout-data-workspace replay-workspace" @dragover.prevent @drop.prevent="onWorkspaceDrop">
    <div class="workspace-head">
      <ShowcaseHero v-if="!wantsImmersive && !forcedLandscape.blocked.value" compact section="replay" :kicker="$t('nav.replay')" :title="$t('workspace.title')" />
      <div class="workspace-toolbar">
        <ReplayCapabilityTabs class="workspace-capabilities" data-tour="workspace-capabilities" :options="capabilityOptions" :active-capability="activeTab" @select="onTabSelect" />
        <AppButton v-if="onboarding" variant="ghost" size="sm" data-tour="workspace-help" @click="onboarding.openDirectory()">
          <CircleHelp :size="16" aria-hidden="true" />{{ $t('onboarding.help') }}
        </AppButton>
        <ReplayCollectionManager
          v-if="files.length"
          ref="collectionManager"
          data-tour="workspace-file-controls"
          :rows="collectionRows"
          :progress="collectionProgress"
          :disabled="initialLoading"
          :folder-available="sourcePicker?.folderAvailable ?? false"
          :demo-disabled="demoLoading || loading"
          @add-files="sourcePicker?.chooseFiles()"
          @add-folder="sourcePicker?.chooseFolder()"
          @open-demo="onDemoClick"
          @remove="onRemoveFile"
          @clear="clearSelection"
        />
      </div>
    </div>

    <div v-if="demoEntryVisible || demoError" class="workspace-source">
      <div v-if="demoEntryVisible" class="workspace-demo-actions">
        <AppButton size="sm" data-tour="workspace-demo" data-testid="workspace-demo" :disabled="demoLoading || loading" @click="onDemoClick">
          <Play :size="16" aria-hidden="true" />{{ $t(demoLoading ? 'onboarding.demo_loading' : 'onboarding.demo_action') }}
        </AppButton>
      </div>
      <Banner v-if="demoError" tone="danger" data-testid="workspace-demo-error"><p>{{ demoError }}</p></Banner>
    </div>

    <div class="workspace-file-controls" :data-tour="files.length ? undefined : 'workspace-file-controls'" data-testid="workspace-file-controls">
      <FileDrop ref="sourcePicker" :files="files" :loading="loading" @update:files="onFilesUpdate" />
    </div>

    <div v-if="initialLoading || openFailed || partialFailureVisible || error" class="workspace-source">
      <ReplayProcessingPanel
        v-if="initialLoading || openFailed"
        :analysis="analysis"
        :file-count="files.length"
        @cancel="onCancelLoading"
        @retry="analyze"
        @open-other="openOtherReplay"
        @clear="clearSelection"
      />
      <Banner v-if="partialFailureVisible" tone="warning" data-testid="workspace-partial-failure">
        <p>{{ $t('workspace.partial_failure', { count: failedReplayCount }) }}</p>
        <template #actions>
          <AppButton size="sm" data-testid="partial-failure-view" @click="collectionManager?.open()">{{ $t('workspace.partial_failure_view') }}</AppButton>
          <AppButton variant="ghost" size="sm" data-testid="partial-failure-ack" @click="acknowledgedResult = resp">{{ $t('workspace.partial_failure_ack') }}</AppButton>
        </template>
      </Banner>
      <Banner v-if="error" tone="danger" data-testid="ws-error">
        <p>{{ error }}</p>
        <template v-if="error === t('workspace.native_replay_read_failed')" #actions>
          <AppButton size="sm" data-testid="ws-native-retry" @click="consumePendingWhenReady">{{ $t('workspace.native_replay_retry') }}</AppButton>
        </template>
      </Banner>
    </div>

    <RotatePrompt
      v-if="forcedLandscape.blocked.value"
      class="workspace-rotate-prompt"
      :device="forcedLandscape.device.value"
      :action-label="$t('workspace.rotate_view_data')"
      @action="setCapability('data')"
    />

    <div v-if="showBattlePicker || isDemoSelection" class="workspace-sessionbar">
      <BattlePicker
        v-if="showBattlePicker"
        class="single-battle-picker"
        :options="battleOptions"
        :model-value="currentBattleId"
        :aria-label="$t('workspace.battle_picker')"
        :data-testid="battlePickerTestId"
        @update:model-value="onBattleSelect"
      />
      <span v-if="isDemoSelection" class="workspace-demo-label" data-testid="workspace-demo-label">{{ $t('onboarding.demo_label') }}</span>
    </div>

    <div v-show="contentVisible" ref="workspaceContentEl" class="workspace-content">
      <ReplayPage
        v-show="activeCapability === 'data'"
        :active="activeCapability === 'data'"
        data-testid="ws-data"
        :embedded="true"
        :replay-context="workspace.replay"
        :workspace-context="workspace"
      />
      <!-- 统一回放面板（2D / 3D / 事件流深链共用；2026-11-19 用户要求仿地图预览排版）：
           头部 2D/3D 切换与「显示事件信息」开关、两个 pane 都挂载仅 v-show；播放条在窗口下方通栏（3D docked）；
           事件流默认隐藏（v-show 保留筛选/分页状态），开启后自然流在面板下方；agent-events 深链自动打开。 -->
      <div v-show="viewerActive" class="capability-pane" data-testid="ws-replay">
        <ReplayViewerPanel
          v-if="viewerMounted"
          :mode="viewerMode"
          :events-focused="activeCapability === 'events'"
          @update:mode="setViewerMode"
        >
          <template #viewer-2d="{ showEventMarkers }">
            <Banner v-if="playbackLoadError" tone="danger" data-testid="ws-playback-load-error">
              <p>{{ $t(playbackLoadError) }}</p>
              <template #actions>
                <AppButton size="sm" data-testid="ws-playback-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
                <AppButton size="sm" variant="ghost" data-testid="ws-playback-load-retry" @click="retryPane(playbackModule)">{{ $t('workspace.pane_retry') }}</AppButton>
              </template>
            </Banner>
            <BattlePlaybackPanel
              v-if="playbackMounted && !playbackLoadError"
              :playback-session="workspace.playbackSession"
              :file="targetFile"
              :active="viewerActive && viewerMode === '2d'"
              :seek-to="playbackSeek"
              :seek-request="playbackSeekRequest"
              :facet-shots="viewerShotFacet"
              :facet-kills="viewerKillFacet"
              :show-event-markers="showEventMarkers"
              :auto-fullscreen-token="autoFullscreenToken"
            />
          </template>
          <template #viewer-3d="{ showEventMarkers }">
            <!-- 顺序即优先级：连通性（capability SSOT）→ 登录门禁 → 加载错误 → 面板。
                 非-online 时既不给登录入口、也不挂载 3D（远端资源所需的连接不存在）。
                 首次检测未完成（pending）时保持中性空白：不下连通性结论，也不落到登录门禁。 -->
            <template v-if="!threeAvailability.available">
              <Banner v-if="!threeAvailability.pending" tone="info" data-testid="ws-3d-connectivity">
                <p>{{ $t(threeAvailability.messageKey) }}</p>
              </Banner>
            </template>
            <ReplayCapabilityAuthGate
              v-else-if="!canUseDemoCapabilities && viewerMode === '3d'"
              :title="$t('workspace.tab_3d')"
              :description="$t('workspace.login_required_3d')"
              login-destination="agent-replay"
            />
            <Banner v-else-if="threeLoadError" tone="danger" data-testid="ws-3d-load-error">
              <p>{{ $t(threeLoadError) }}</p>
              <template #actions>
                <AppButton size="sm" data-testid="ws-3d-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
                <AppButton size="sm" variant="ghost" data-testid="ws-3d-load-retry" @click="retryPane(threeModule)">{{ $t('workspace.pane_retry') }}</AppButton>
              </template>
            </Banner>
            <Replay3DPane
              v-if="canUseDemoCapabilities && threeMounted && !threeLoadError"
              :playback-session="workspace.playbackSession"
              :file="targetFile"
              :active="pageActive && viewerActive && viewerMode === '3d' && threeAvailability.available"
              :blocked-reason="threeBlocked"
              :auto-fullscreen-token="autoFullscreenToken"
              :pending-seek="pending3dSeek"
              :show-event-markers="showEventMarkers"
              :auto-start-user-id="autoStartUserId"
            />
          </template>
          <template #events>
            <!-- events 深链保留完整登录门禁；2D/3D 下的匿名单只看一行提示，
                 不在播放器下方再放一个登录卡片。 -->
            <ReplayCapabilityAuthGate
              v-if="!canUseDemoCapabilities && activeCapability === 'events'"
              :title="$t('workspace.tab_events')"
              :description="$t('workspace.login_required_events')"
              login-destination="agent-events"
            />
            <p v-else-if="!canUseDemoCapabilities" class="ws-note" data-testid="ws-events-login-note">
              {{ $t('workspace.login_required_events') }}
            </p>
            <Banner v-else-if="eventsLoadError" tone="danger" data-testid="ws-events-load-error">
              <p>{{ $t(eventsLoadError) }}</p>
              <template #actions>
                <AppButton size="sm" data-testid="ws-events-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
                <AppButton size="sm" variant="ghost" data-testid="ws-events-load-retry" @click="retryPane(eventsModule)">{{ $t('workspace.pane_retry') }}</AppButton>
              </template>
            </Banner>
            <ReplayEventStreamPane
              v-else-if="eventsMounted"
              embedded
              :file="targetFile"
              :active="viewerActive"
              :page-active="pageActive"
              :playback-session="workspace.playbackSession"
              :navigate="navigate"
              @seek="onEventSeek"
            />
          </template>
        </ReplayViewerPanel>
      </div>
      <div v-show="activeCapability === 'shots'" class="capability-pane" data-testid="ws-shots">
        <ReplayCapabilityAuthGate
          v-if="!canUseDemoCapabilities && activeCapability === 'shots'"
          :title="$t('workspace.tab_shots')"
          :description="$t('workspace.login_required_shots')"
          login-destination="agent-shots"
        />
        <Banner v-else-if="canUseDemoCapabilities && shotsLoadError" tone="danger" data-testid="ws-shots-load-error">
          <p>{{ $t(shotsLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-shots-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-shots-load-retry" @click="retryPane(shotsModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <ReplayShotsPane
          v-if="canUseDemoCapabilities && shotsMounted && !shotsLoadError"
          :file="targetFile"
          :active="activeCapability === 'shots'"
          :navigate="navigate"
          :auto-fullscreen-token="autoFullscreenToken"
        />
      </div>
      <div v-show="activeCapability === 'ai'" class="capability-pane" data-testid="ws-ai">
        <template v-if="!aiAvailability.available">
          <Banner v-if="!aiAvailability.pending" tone="info" data-testid="ws-ai-connectivity">
            <p>{{ $t(aiAvailability.messageKey) }}</p>
          </Banner>
        </template>
        <Banner v-else-if="aiLoadError" tone="danger" data-testid="ws-ai-load-error">
          <p>{{ $t(aiLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-ai-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-ai-load-retry" @click="retryPane(aiModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <AiReviewWorkspacePane
          v-if="aiMounted && !aiLoadError"
          :file="targetFile"
          :active="activeCapability === 'ai' && aiAvailability.available"
          :blocked-reason="aiBlocked"
          @view-2d="viewIn2d"
        />
      </div>
    </div>

    <RemoveConfirmModal :pending="workspace.replay.pendingRemove.value" @confirm="confirmRemove" @cancel="workspace.replay.cancelRemove" />
  </div>
</template>

<style scoped>
.replay-workspace { padding-right: var(--pd-drawer-offset, 0px); }
/* 竖屏旋转提示盖在顶栏之下的整块可视区上（回放面板保持挂载，横过来即继续） */
.workspace-rotate-prompt { position: fixed; inset: calc(var(--header-block) + env(safe-area-inset-top)) 0 0; z-index: var(--z-sticky); background: var(--color-canvas); }
.workspace-head { display: grid; gap: var(--space-2); margin-bottom: var(--space-4); }
.workspace-head > .showcase-hero-host { margin-block-end: 0; }
.workspace-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.workspace-source { display: grid; gap: var(--space-3); margin-bottom: var(--space-4); }
.workspace-demo-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.workspace-demo-label { color: var(--color-text-secondary); font: var(--type-caption); }
/* 自动居中用 scrollIntoView 定位 pane 本身：`block: 'start'` 会贴到视口顶端，
   必须让出固定顶栏 + 刘海，否则高 pane 的顶部内容被压在 AppTopBar 下面。 */
.capability-pane { margin-top: var(--space-1); scroll-margin-top: calc(var(--header-h, 0px) + env(safe-area-inset-top)); }
/* 文件控件平时只有隐藏 input；有拖放区或校验提示时才占位。 */
.workspace-file-controls:has(.dropzone, .banner) { margin-bottom: var(--space-4); }
/* A single compact session row serves every single-battle capability. */
.workspace-sessionbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-3); }
.single-battle-picker { flex: 1; min-width: 0; }
@media (width < 768px) {
  .single-battle-picker { flex-basis: 100%; }
  .workspace-toolbar { justify-content: flex-start; }
  /* 手机：能力切换独占一整行，帮助与管理回放排在下一行。 */
  .workspace-capabilities { flex-basis: 100%; order: -1; }
}
</style>
