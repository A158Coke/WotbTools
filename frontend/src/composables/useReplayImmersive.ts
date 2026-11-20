import { inject, nextTick, computed, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { useForcedLandscape } from './useForcedLandscape.js'
import { usePlaybackPhoneForm } from './usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from './usePlaybackPortraitViewport.js'
import { usePointer } from './useBreakpoint.js'

// 手机横屏沉浸态 + 强制横屏 + 自动全屏序号（从 useReplayOrchestration 拆出，行数预算 500）。
// 外壳本身（显隐与 token 归零）由 AppShell 独占；workspaceContentEl 来自 useReplayAutoCenter。
export interface ReplayImmersiveOptions {
  activeCapability: Ref<string>
  playbackMounted: Ref<boolean>
  threeMounted: Ref<boolean>
  workspaceReady: Ref<boolean>
}

/** replayed workspace store 的沉浸态清理入口（cancelRemove 归 workspace 所有）。 */
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
// events 深链复用 2D 播放 pane（playbackMounted 在 events 下为 true）：它不是独立能力页，
// 而是同一 2D 视图的事件流入口，设备行为必须与 playback 一致。
const replayPaneShown = computed(() =>
  ((activeCapability.value === 'playback' || activeCapability.value === 'events') && playbackMounted.value)
  || (activeCapability.value === '3d' && threeMounted.value))
const wantsImmersive = computed(() =>
  pageActive.value && isPhone.value && !isPortrait.value && coarse.value && workspaceReady.value && replayPaneShown.value)
watch(wantsImmersive, (on) => {
  shellChrome?.request(shellOwner, on)
  // 进入沉浸态时把回放区对齐到视口顶端（仅边沿触发一次，不监听滚动）
  if (on) nextTick(() => workspaceContentEl.value?.scrollIntoView?.({ block: 'start' }))
}, { immediate: true })
// 强制横屏（design-language §9）：iPhone Safari 在 2D / 3D 回放显示且竖屏时提示旋转（退出动作回到赛后数据，主要数据能力在竖屏仍可达）；
// 其它设备（桌面、平板、Android 浏览器）不受影响。
// Android 手机 App（4.x）：查看器内非全屏锁竖屏，全屏由 MainActivity.enterFullscreen 锁横屏并在退出时还原；
// 空查看器 / 解析中也锁竖屏，所以 androidActive 不依赖 workspaceReady。iPhone Safari 的旋转提示仍按原条件。
// 查看器「进入键」：playback 与 events 是同一 2D pane 的两条路由，彼此切换不得重复申请自动全屏；
// 外部→2D、2D↔3D↔射击 才是新的进入机会。
const VIEWER_GROUPS: Record<string, '2d' | '3d' | 'shots'> = {
  playback: '2d', events: '2d', '3d': '3d', shots: 'shots',
}
const viewerCapabilityShown = computed(() => Object.hasOwn(VIEWER_GROUPS, activeCapability.value))
const forcedLandscape = useForcedLandscape(
  computed(() => pageActive.value && workspaceReady.value && replayPaneShown.value),
  { androidOrientation: 'portrait', androidActive: computed(() => pageActive.value && viewerCapabilityShown.value) },
)
// 自动全屏的「进入查看器」事件序号：每次切入 2D / 3D / 射击复现（含从赛果解析 / AI 复盘跳入）递增一次；
// 查看器在成功就绪时按 (序号, 回放身份) 消费，主动退出全屏后不会因仍然 Ready 再次进入。
const autoFullscreenToken = ref(0)
watch(activeCapability, (cap, previous) => {
  const group = VIEWER_GROUPS[cap]
  if (!group) return
  // 同一 2D pane 的路由切换（playback ↔ events）不是新的进入机会；
  // 主动退出全屏后的浏览器前进/后退因此不会再次请求全屏。
  if (previous !== undefined && VIEWER_GROUPS[previous] === group) return
  autoFullscreenToken.value++
}, { immediate: true })
onActivated(() => { pageActive.value = true })
onDeactivated(() => {
  pageActive.value = false
  // 确认框 portal 到 body，KeepAlive 停用不会带走它。
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
