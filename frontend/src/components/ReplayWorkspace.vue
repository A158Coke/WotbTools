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

defineOptions({ name: 'ReplayWorkspace' })

const props = defineProps({
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

const workspace = useReplayWorkspace(props.initialCapability || 'data')

const {
  files, loading, error, resp, updateFiles, changeFiles, updateDemoFile, isDemoSelection, selectionRevision,
  analysis, analyze, cancelAnalysis,
} = workspace.replay

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

const shellChrome = inject(SHELL_CHROME_KEY, null)
const shellOwner = Symbol('replay-workspace')
const { isPhone } = usePlaybackPhoneForm()
function registerOnboarding() { onboarding?.registerWorkspace(onboardingWorkspace) }
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
.workspace-rotate-prompt { position: fixed; inset: calc(var(--header-block) + env(safe-area-inset-top)) 0 0; z-index: var(--z-sticky); background: var(--color-canvas); }
.workspace-head { display: grid; gap: var(--space-2); margin-bottom: var(--space-4); }
.workspace-head > .showcase-hero-host { margin-block-end: 0; }
.workspace-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.workspace-source { display: grid; gap: var(--space-3); margin-bottom: var(--space-4); }
.workspace-demo-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.workspace-demo-label { color: var(--color-text-secondary); font: var(--type-caption); }
.capability-pane { margin-top: var(--space-1); scroll-margin-top: calc(var(--header-h, 0px) + env(safe-area-inset-top)); }
.workspace-file-controls:has(.dropzone, .banner) { margin-bottom: var(--space-4); }
.workspace-sessionbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-3); }
.single-battle-picker { flex: 1; min-width: 0; }
@media (width < 768px) {
  .single-battle-picker { flex-basis: 100%; }
  .workspace-toolbar { justify-content: flex-start; }
  .workspace-capabilities { flex-basis: 100%; order: -1; }
}
</style>
