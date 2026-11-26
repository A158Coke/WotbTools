import { inject, nextTick, computed, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { useForcedLandscape } from './useForcedLandscape.js'
import { usePlaybackPhoneForm } from './usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from './usePlaybackPortraitViewport.js'
import { usePointer } from './useBreakpoint.js'

export interface ReplayImmersiveOptions {
  activeCapability: Ref<string>
  playbackMounted: Ref<boolean>
  threeMounted: Ref<boolean>
  workspaceReady: Ref<boolean>
}

export interface ReplayWorkspaceLike {
  replay: { cancelRemove: () => void }
}

export function useReplayImmersive(
  workspaceContentEl: Ref<HTMLElement | null>,
  workspace: ReplayWorkspaceLike,
  { activeCapability, playbackMounted, threeMounted, workspaceReady }: ReplayImmersiveOptions,
) {
const shellChrome = inject(SHELL_CHROME_KEY, null)
const shellOwner = Symbol('replay-workspace')
const { isPhone } = usePlaybackPhoneForm()
const { isPortrait } = usePlaybackPortraitViewport()
const { coarse } = usePointer()
const pageActive = ref(true)
const replayPaneShown = computed(() =>
  ((activeCapability.value === 'playback' || activeCapability.value === 'events') && playbackMounted.value)
  || (activeCapability.value === '3d' && threeMounted.value))
const wantsImmersive = computed(() =>
  pageActive.value && isPhone.value && !isPortrait.value && coarse.value && workspaceReady.value && replayPaneShown.value)
watch(wantsImmersive, (on) => {
  shellChrome?.request(shellOwner, on)
  if (on) nextTick(() => workspaceContentEl.value?.scrollIntoView?.({ block: 'start' }))
}, { immediate: true })
const VIEWER_GROUPS: Record<string, '2d' | '3d' | 'shots'> = {
  playback: '2d', events: '2d', '3d': '3d', shots: 'shots',
}
const viewerCapabilityShown = computed(() => Object.hasOwn(VIEWER_GROUPS, activeCapability.value))
const forcedLandscape = useForcedLandscape(
  computed(() => pageActive.value && workspaceReady.value && replayPaneShown.value),
  { androidOrientation: 'portrait', androidActive: computed(() => pageActive.value && viewerCapabilityShown.value) },
)
const autoFullscreenToken = ref(0)
watch(activeCapability, (cap, previous) => {
  const group = VIEWER_GROUPS[cap]
  if (!group) return
  if (previous !== undefined && VIEWER_GROUPS[previous] === group) return
  autoFullscreenToken.value++
}, { immediate: true })
onActivated(() => { pageActive.value = true })
onDeactivated(() => {
  pageActive.value = false
  workspace.replay.cancelRemove()
})
onUnmounted(() => {
  shellChrome?.request(shellOwner, false)
})
  return {
    pageActive, autoFullscreenToken, forcedLandscape, wantsImmersive,
    releaseShell: () => shellChrome?.request(shellOwner, false),
  }
}
