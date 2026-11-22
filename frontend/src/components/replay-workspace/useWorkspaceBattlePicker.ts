/**
 * ReplayWorkspace —— 单场能力选择器可见性与跨面板 seek（拆分自 ReplayWorkspace.vue，行为原样）。
 * 单场能力（2D 回放 / 3D 回放 / 射击分析 / AI 复盘）共用的场次选择器判据与「在 2D 中查看 /
 * 跳到此刻」动作。
 */
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
  /** 模块加载失败态（design-language §10）：说清发生了什么 + 下一步怎么做。
   *  失败态是**持久的**：切走再切回来仍然显示，只有用户明确选择才算处理过——
   *  自动清状态只会把「有提示的失败」变成「没有提示的空白」。generation 与 recovery 由
   *  `lazyModule` 自己拥有（见其文件头），Workspace 不重复管理。
   *  触发条件是「页面还跑着上一次部署的 bundle，而 chunk 已被新部署替换」——重新加载必然修好，
   *  所以主操作是重新加载；「重试」只覆盖网络瞬断（同一 URL 再试一次即可）。 */
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
    // 事件流 = 本地解析能力（playbackSession.loadScene），不随联网可用性隐藏；
    // 与 shots 同款登录/示例资格 + 模块加载状态判据。
    if (cap === 'events') return ctx.canUseDemoCapabilities.value && !eventsLoadError.value
    return ctx.aiAvailability.value.available && !aiLoadError.value
  })
  const battlePickerTestId = computed(() => ({ playback: 'playback', '3d': 'replay3d', events: 'events', shots: 'shots', ai: 'ai' })[ctx.activeCapability.value] + '-battle-picker')

  /** AI 复盘关键回合 →「在 2D 中查看」：切到 2D 能力页并按战斗时钟定位（BattlePlaybackPanel.seekTo 监听变化）。 */
  const playbackSeek = ref<number | null>(null)
  async function viewIn2d(sec: number) {
    await ctx.setCapability('playback')
    playbackSeek.value = null
    await nextTick()
    playbackSeek.value = sec
  }

  /** 事件流 →「跳到此刻」：切到 3D 并请求场景 seek（Replay3DPane 监听 pending3dSeek）。
   *  seek 属于场景句柄（sceneApi 由 3D 面板持有），工作台只做 tab 切换与请求转交。 */
  /** 一次性 seek 请求：id 单调递增——3D 面板按 id 只消费一次，切回 3D 不得重放旧请求。 */
  const pending3dSeek = ref<{ id: number; sec: number } | null>(null)
  let seekSeq = 0
  async function view3dAt(sec: number) {
    await ctx.setCapability('3d')
    pending3dSeek.value = { id: ++seekSeq, sec }
    await nextTick()
  }
  // 换回放：旧场的 seek 请求随之作废
  watch(ctx.targetFile, () => { pending3dSeek.value = null })

  return {
    paneLoadError,
    playbackLoadError, threeLoadError, shotsLoadError, aiLoadError, eventsLoadError,
    showBattlePicker, battlePickerTestId,
    playbackSeek, pending3dSeek, viewIn2d, view3dAt,
  }
}
