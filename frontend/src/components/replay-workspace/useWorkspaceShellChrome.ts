import { computed, inject, nextTick, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
import { SHELL_CHROME_KEY } from '../../shared/shellChrome.js'
import { useForcedLandscape } from '../../composables/useForcedLandscape.js'
import { usePointer } from '../../composables/useBreakpoint.js'
import { usePlaybackPhoneForm } from '../../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../../composables/usePlaybackPortraitViewport.js'

/**
 * @param {{
 *  activeCapability: Ref<string>,
 *  playbackMounted: Ref<boolean>,
 *  threeMounted: Ref<boolean>,
 *  workspaceReady: Ref<boolean>,
 *  workspaceContentEl: Ref<HTMLElement|null>,
 * }} ctx
 */
export function useWorkspaceShellChrome({ activeCapability, playbackMounted, threeMounted, workspaceReady, workspaceContentEl }: {
  activeCapability: import('vue').Ref<string>
  playbackMounted: import('vue').Ref<boolean>
  threeMounted: import('vue').Ref<boolean>
  workspaceReady: import('vue').Ref<boolean>
  workspaceContentEl: import('vue').Ref<HTMLElement | null>
}) {
  const shellChrome = inject(SHELL_CHROME_KEY, null)
  const shellOwner = Symbol('replay-workspace')
  const { isPhone } = usePlaybackPhoneForm()
  const { isPortrait } = usePlaybackPortraitViewport()
  const { coarse } = usePointer()
  const pageActive = ref(true)
  const replayPaneShown = computed(() =>
    (activeCapability.value === 'playback' && playbackMounted.value) || (activeCapability.value === '3d' && threeMounted.value))
  const wantsImmersive = computed(() =>
    pageActive.value && isPhone.value && !isPortrait.value && coarse.value && workspaceReady.value && replayPaneShown.value)
  watch(wantsImmersive, (on) => {
    shellChrome?.request(shellOwner, on)
    if (on) nextTick(() => workspaceContentEl.value?.scrollIntoView?.({ block: 'start' }))
  }, { immediate: true })
  const VIEWER_CAPABILITIES = new Set(['playback', '3d', 'shots'])
  const viewerCapabilityShown = computed(() => VIEWER_CAPABILITIES.has(activeCapability.value))
  const forcedLandscape = useForcedLandscape(
    computed(() => pageActive.value && workspaceReady.value && replayPaneShown.value),
    { androidOrientation: 'portrait', androidActive: computed(() => pageActive.value && viewerCapabilityShown.value) },
  )
  const autoFullscreenToken = ref(0)
  watch(activeCapability, (cap) => { if (VIEWER_CAPABILITIES.has(cap)) autoFullscreenToken.value++ }, { immediate: true })
  onActivated(() => { pageActive.value = true })
  onDeactivated(() => { pageActive.value = false })
  onUnmounted(() => { shellChrome?.request(shellOwner, false) })

  return {
    pageActive, forcedLandscape, autoFullscreenToken, wantsImmersive,
    disposeShellChrome: () => shellChrome?.request(shellOwner, false),
  }
}
