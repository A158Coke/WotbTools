import { computed, nextTick, ref, watch, type Ref } from 'vue'

export interface WorkspaceBattlePickerCtx {
  activeCapability: Ref<string>
  battleOptions: Ref<unknown[]>
  canUseDemoCapabilities: Ref<boolean>
  threeAvailability: Ref<{ available: boolean }>
  aiAvailability: Ref<{ available: boolean }>
  playbackLoadError: Ref<string>
  threeLoadError: Ref<string>
  shotsLoadError: Ref<string>
  eventsLoadError: Ref<string>
  aiLoadError: Ref<string>
  targetFile: Ref<unknown>
  setCapability: (key: string) => Promise<void>
  playbackModule: { error: Ref<string> }
  threeModule: { error: Ref<string> }
  shotsModule: { error: Ref<string> }
  aiModule: { error: Ref<string> }
  eventsModule: { error: Ref<string> }
}

export function useWorkspaceBattlePicker(ctx: WorkspaceBattlePickerCtx) {
  function paneLoadError(module: { error: Ref<string> }) {
    return module.error.value ? 'workspace.pane_load_failed' : ''
  }
  const playbackLoadError = computed(() => paneLoadError(ctx.playbackModule))
  const threeLoadError = computed(() => paneLoadError(ctx.threeModule))
  const shotsLoadError = computed(() => paneLoadError(ctx.shotsModule))
  const aiLoadError = computed(() => paneLoadError(ctx.aiModule))
  const eventsLoadError = computed(() => paneLoadError(ctx.eventsModule))

  const showBattlePicker = computed(() => {
    const cap = ctx.activeCapability.value
    if (cap === 'data' || !ctx.battleOptions.value.length) return false
    if (cap === 'playback') return !playbackLoadError.value
    if (cap === '3d') return ctx.canUseDemoCapabilities.value && ctx.threeAvailability.value.available && !threeLoadError.value
    if (cap === 'shots') return ctx.canUseDemoCapabilities.value && !shotsLoadError.value
    if (cap === 'events') return ctx.canUseDemoCapabilities.value && !eventsLoadError.value
    return ctx.aiAvailability.value.available && !aiLoadError.value
  })
  const battlePickerTestId = computed(() => ({ playback: 'playback', '3d': 'replay3d', events: 'events', shots: 'shots', ai: 'ai' })[ctx.activeCapability.value] + '-battle-picker')

  const playbackSeek = ref<number | null>(null)
  async function viewIn2d(sec: number) {
    await ctx.setCapability('playback')
    playbackSeek.value = null
    await nextTick()
    playbackSeek.value = sec
  }

  const pending3dSeek = ref<{ id: number; sec: number } | null>(null)
  let seekSeq = 0
  async function view3dAt(sec: number) {
    await ctx.setCapability('3d')
    pending3dSeek.value = { id: ++seekSeq, sec }
    await nextTick()
  }
  watch(ctx.targetFile, () => { pending3dSeek.value = null })

  return {
    paneLoadError,
    playbackLoadError, threeLoadError, shotsLoadError, aiLoadError, eventsLoadError,
    showBattlePicker, battlePickerTestId,
    playbackSeek, pending3dSeek, viewIn2d, view3dAt,
  }
}
