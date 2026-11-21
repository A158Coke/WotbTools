/**
 * ReplayWorkspace —— 手机横屏沉浸态申请与强制横屏提示（拆分自 ReplayWorkspace.vue，行为原样）。
 * AppShell 是显隐与 token 归零的唯一 owner，这里只申请 / 释放。
 */
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
export function useWorkspaceShellChrome({ activeCapability, playbackMounted, threeMounted, workspaceReady, workspaceContentEl }) {
  const shellChrome = inject(SHELL_CHROME_KEY, null)
  const shellOwner = Symbol('replay-workspace')
  const { isPhone } = usePlaybackPhoneForm()
  const { isPortrait } = usePlaybackPortraitViewport()
  const { coarse } = usePointer()
  const pageActive = ref(true)
  const replayPaneShown = computed(() =>
    (activeCapability.value === 'playback' && playbackMounted.value) || (activeCapability.value === '3d' && threeMounted.value))
  /**
   * 手机横屏回放沉浸态：正方形地图只受纵向预算约束，顶栏 + Tab 栏（104px）是最大的单项消耗。
   * 2D / 3D 回放已就绪且设备是触屏手机横屏时向外壳申请沉浸；任何条件失效、离开页面或被 KeepAlive
   * 停用都立即释放。外壳本身（显隐与 token 归零）由 AppShell 独占。
   */
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
  const VIEWER_CAPABILITIES = new Set(['playback', '3d', 'shots'])
  const viewerCapabilityShown = computed(() => VIEWER_CAPABILITIES.has(activeCapability.value))
  const forcedLandscape = useForcedLandscape(
    computed(() => pageActive.value && workspaceReady.value && replayPaneShown.value),
    { androidOrientation: 'portrait', androidActive: computed(() => pageActive.value && viewerCapabilityShown.value) },
  )
  // 自动全屏的「进入查看器」事件序号：每次切入 2D / 3D / 射击复现（含从赛果解析 / AI 复盘跳入）递增一次；
  // 查看器在成功就绪时按 (序号, 回放身份) 消费，主动退出全屏后不会因仍然 Ready 再次进入。
  const autoFullscreenToken = ref(0)
  watch(activeCapability, (cap) => { if (VIEWER_CAPABILITIES.has(cap)) autoFullscreenToken.value++ }, { immediate: true })
  onActivated(() => { pageActive.value = true })
  onDeactivated(() => { pageActive.value = false })
  onUnmounted(() => { shellChrome?.request(shellOwner, false) })

  return { pageActive, forcedLandscape, autoFullscreenToken, disposeShellChrome: () => shellChrome?.request(shellOwner, false) }
}
