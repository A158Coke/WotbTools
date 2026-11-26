import { ref, useId, watch, type Ref } from 'vue'

export function usePlaybackWorkspaceToggles({ phoneLandscape, onCollapse }: {
  phoneLandscape: Ref<boolean>
  onCollapse: () => void
}) {
  const controlsCollapsed = ref(false)
  const controlsContentId = useId()
  function toggleControlsCollapsed() {
    controlsCollapsed.value = !controlsCollapsed.value
    if (controlsCollapsed.value) onCollapse()
  }

  const rosterLanesOpen = ref(!phoneLandscape.value)
  watch(phoneLandscape, (landscape) => { rosterLanesOpen.value = !landscape })
  function toggleRosterLanes() { rosterLanesOpen.value = !rosterLanesOpen.value }

  return { controlsCollapsed, controlsContentId, toggleControlsCollapsed, rosterLanesOpen, toggleRosterLanes }
}
