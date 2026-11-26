/**
 * 回放全屏 / 屏幕方向生命周期（2D 与 3D 共用同一套产品语义）。
 *
 * 事实源永远是浏览器：`document.fullscreenElement` + `fullscreenchange`。
 * **不维护手工 `isFullscreen = !isFullscreen`**——用户可以从浏览器 UI、ESC、Android 系统手势
 * 或 OS 层退出全屏，手动布尔值会与真实状态脱节。
 *
 * 手机形态（`usePlaybackPhoneForm`，见 shared/breakpoints 的 PLAYBACK_MOBILE_QUERY）才尝试锁横屏：
 *   · 平板 / 桌面**绝不**请求方向锁（触屏 ≠ 手机）；
 *   · 锁必须在 **fullscreen 成功之后**才请求（顺序错了安卓上会直接被拒）；
 *   · 锁失败（系统旋转锁定 / 不支持）不影响已建立的全屏会话，用户物理转屏即可。
 * 退出全屏、组件卸载、生命周期失活都会 `unlock()`，绝不把应用留在锁死方向上。
 *
 * 不做 CSS `rotate()` 假横屏：那是伪造，会破坏命中测试与安全区。
 *
 * @param {object} options
 * @param {() => (Element|null)} options.target          全屏目标（回放根，不是整个应用外壳）
 * @param {import('vue').Ref<boolean>|{value:boolean}} options.isPhone 是否手机形态（决定是否锁横屏）
 * @param {() => boolean} [options.isActive]             生命周期闸门（如 capability 是否仍激活）
 * @param {(fullscreen: boolean) => void} [options.onChange] 全屏状态变化后的布局反应
 *        （2D 需要在新形态下重算几何）。**唯一的 fullscreenchange 监听点就在这里**——
 *        调用方不要再自己 addEventListener，否则同一事件会有两个监听、且退出解锁路径分叉。
 */
import { computed, inject, onScopeDispose, readonly, ref } from 'vue'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import type { Ref } from 'vue'
import { useReplayAutoFullscreen } from './useReplayAutoFullscreen.js'

let orientationOwner: symbol | null = null

export interface PlaybackFullscreenOptions {
  target: () => Element | null
  isPhone?: Ref<boolean> | { value: boolean }
  isActive?: () => boolean
  onChange?: (fullscreen: boolean) => void
  pseudoFallback?: boolean
  auto?: () => { token: number; key: unknown; ready: boolean; active: boolean }
}

const PSEUDO_FALLBACK_DELAY_MS = 700
const PSEUDO_SCROLL_LOCK_ATTR = 'data-pb-pseudo-fullscreen'

export function usePlaybackFullscreen({ target, isPhone, isActive = () => true, onChange, auto, pseudoFallback = false }: PlaybackFullscreenOptions) {
  const nativeFullscreen = ref(ownsFullscreen())
  const pseudoFullscreen = ref(false)
  const isFullscreen = computed(() => nativeFullscreen.value || pseudoFullscreen.value)
  const owner = Symbol('playback-fullscreen')
  const shellChrome = inject(SHELL_CHROME_KEY, null)

  let requestGeneration = 0
  let sessionGeneration: number | null = null
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null
  function cancelPendingRequest() {
    requestGeneration += 1
    if (fallbackTimer !== null) clearTimeout(fallbackTimer)
    fallbackTimer = null
  }

  const phoneForm = () => !!isPhone?.value
  function ownsFullscreen() {
    const el = target()
    return typeof document !== 'undefined' && el != null && document.fullscreenElement === el
  }

  function unlockOrientation() {
    if (orientationOwner !== owner) return
    orientationOwner = null
    const orientation = typeof screen !== 'undefined' ? screen.orientation : null
    if (orientation && typeof (orientation as ScreenOrientation & { unlock?: () => void }).unlock === 'function') {
      try { (orientation as ScreenOrientation & { unlock: () => void }).unlock() } catch { /* unsupported browsers may throw */ }
    }
  }

  function lockOrientation() {
    if (!isActive()) return
    if (!ownsFullscreen()) return
    if (!phoneForm()) return
    const orientation = typeof screen !== 'undefined' ? screen.orientation : null
    const lockable = orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | null
    if (!lockable || typeof lockable.lock !== 'function') return
    try {
      const result = lockable.lock('landscape')
      orientationOwner = owner
      if (result && typeof result.catch === 'function') {
        result.catch(() => { if (orientationOwner === owner) orientationOwner = null })
      }
    } catch { /* unsupported browsers may throw */ }
  }

  function onFullscreenChange() {
    nativeFullscreen.value = ownsFullscreen()
    if (!nativeFullscreen.value) {
      sessionGeneration = null
      unlockOrientation()
    }
    if (nativeFullscreen.value && pseudoFullscreen.value) { setPseudoFullscreen(false); return }
    onChange?.(isFullscreen.value)
  }

  function setPseudoFullscreen(on: boolean) {
    if (pseudoFullscreen.value === on) return
    const el = target()
    if (on && (!el || typeof document === 'undefined')) return
    pseudoFullscreen.value = on
    shellChrome?.request(owner, on)
    if (typeof document !== 'undefined') {
      if (on) {
        document.documentElement.setAttribute(PSEUDO_SCROLL_LOCK_ATTR, '')
        window.addEventListener('keydown', onPseudoKeydown)
      } else {
        document.documentElement.removeAttribute(PSEUDO_SCROLL_LOCK_ATTR)
        window.removeEventListener('keydown', onPseudoKeydown)
      }
    }
    onChange?.(isFullscreen.value)
  }
  function onPseudoKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    exitOwnedFullscreen()
  }

  if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', onFullscreenChange)
  onScopeDispose(() => {
    if (typeof document !== 'undefined') document.removeEventListener('fullscreenchange', onFullscreenChange)
    cancelPendingRequest()
    setPseudoFullscreen(false)
    unlockOrientation()
  })

  const fullscreenSupported = computed(() => {
    const el = target()
    return typeof document !== 'undefined' && el != null && (pseudoFallback || typeof el.requestFullscreen === 'function')
  })

  function exitOwnedFullscreen() {
    cancelPendingRequest()
    setPseudoFullscreen(false)
    if (!ownsFullscreen() || typeof document.exitFullscreen !== 'function') return
    try {
      const p = document.exitFullscreen()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch { /* unsupported browsers may throw */ }
  }

  let disposed = false
  onScopeDispose(() => { disposed = true })

  async function enterFullscreen(): Promise<boolean> {
    if (typeof document === 'undefined' || !isActive() || disposed) return false
    const el = target()
    if (!el || document.fullscreenElement || typeof el.requestFullscreen !== 'function') return false
    try {
      await el.requestFullscreen()
    } catch { return false }
    if (disposed || !isActive() || !ownsFullscreen()) {
      if (ownsFullscreen()) exitOwnedFullscreen()
      return false
    }
    lockOrientation()
    return true
  }

  function toggleFullscreen() {
    if (typeof document === 'undefined' || disposed || !isActive()) return
    const el = target()
    if (!el) return
    if (pseudoFullscreen.value) { exitOwnedFullscreen(); return }
    if (document.fullscreenElement && document.fullscreenElement !== el) return
    if (document.fullscreenElement === el) {
      cancelPendingRequest()
      if (typeof document.exitFullscreen === 'function') {
        try {
          const p = document.exitFullscreen()
          if (p && typeof p.catch === 'function') p.catch(() => {})
        } catch { /* unsupported browsers may throw */ }
      }
      return
    }
    cancelPendingRequest()
    const generation = requestGeneration
    let settled = false
    const fallback = () => {
      if (settled || generation !== requestGeneration) return
      settled = true
      if (fallbackTimer !== null) clearTimeout(fallbackTimer)
      fallbackTimer = null
      if (pseudoFallback && isActive() && !disposed && !document.fullscreenElement) setPseudoFullscreen(true)
    }
    if (typeof el.requestFullscreen !== 'function') { fallback(); return }
    try {
      const p = el.requestFullscreen()
      if (p && typeof p.then === 'function') {
        fallbackTimer = pseudoFallback ? setTimeout(fallback, PSEUDO_FALLBACK_DELAY_MS) : null
        p.then(() => {
          if (generation !== requestGeneration || disposed || !isActive()) {
            if (ownsFullscreen() && (sessionGeneration === null || sessionGeneration === generation)) exitOwnedFullscreen()
            return
          }
          settled = true
          sessionGeneration = generation
          if (fallbackTimer !== null) clearTimeout(fallbackTimer)
          fallbackTimer = null
          lockOrientation()
        }).catch(fallback)
      } else {
        lockOrientation()
      }
    } catch { fallback() }
  }

  if (auto) {
    useReplayAutoFullscreen({
      token: () => auto().token,
      key: () => auto().key,
      ready: () => auto().ready,
      active: () => auto().active,
      enter: enterFullscreen,
    })
  }

  return {
    isFullscreen,
    pseudoFullscreen: readonly(pseudoFullscreen),
    fullscreenSupported,
    toggleFullscreen,
    enterFullscreen,
    exitOwnedFullscreen,
    unlockOrientation,
  }
}
