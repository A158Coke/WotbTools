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
import { computed, onScopeDispose, readonly, ref } from 'vue'
import type { Ref } from 'vue'
import { useReplayAutoFullscreen } from './useReplayAutoFullscreen.js'

// Orientation is browser-global; only the consumer that requested its current
// lock may release it. Hidden keep-alive panes must not unlock the visible pane.
let orientationOwner: symbol | null = null

/** usePlaybackFullscreen 的装配参数（见文件头产品语义注释）。 */
export interface PlaybackFullscreenOptions {
  /** 全屏目标（回放根，不是整个应用外壳）；响应式 getter */
  target: () => Element | null
  /** 是否手机形态（决定是否锁横屏） */
  isPhone?: Ref<boolean> | { value: boolean }
  /** 生命周期闸门（如 capability 是否仍激活） */
  isActive?: () => boolean
  /** 全屏状态变化后的布局反应（2D 需要在新形态下重算几何）。唯一的 fullscreenchange 监听点 */
  onChange?: (fullscreen: boolean) => void
  /**
   * 元素级 Fullscreen API 不可用（iPhone Safari 的 `<div>`）或请求被拒绝（权限 / 嵌入环境 / 自动化浏览器）时，
   * 降级为 CSS 伪全屏：由宿主按 `pseudoFullscreen` 给 target 绑 `pb-pseudo-fullscreen` 类（样式见 playback-workspace.css，铺满视口；不在这里手动改 class，Vue 重渲染会覆盖）、锁住文档滚动、Esc 退出。
   * 默认关闭——只有宿主 CSS 已支持该类的场景（2D 回放）才开启，其余场景保持「API 不可用就不画按钮」。
   */
  pseudoFallback?: boolean
  /**
   * 回放查看器的「成功就绪 → 自动全屏」（仅 Android 手机 App 生效，见 useReplayAutoFullscreen）。
   * 响应式 getter：`token` 是工作台的进入事件序号，`key` 是回放身份，`ready` 必须是**成功**就绪
   * （不是 data-pane-ready），`active` 是能力是否仍激活。省略 = 不自动进入。
   */
  auto?: () => { token: number; key: unknown; ready: boolean; active: boolean }
}

/** 原生全屏请求悬挂超过此时长仍未进入 → 降级伪全屏 */
const PSEUDO_FALLBACK_DELAY_MS = 700
const PSEUDO_SCROLL_LOCK_ATTR = 'data-pb-pseudo-fullscreen'

export function usePlaybackFullscreen({ target, isPhone, isActive = () => true, onChange, auto, pseudoFallback = false }: PlaybackFullscreenOptions) {
  /** 与 `document.fullscreenElement` 同步；由 fullscreenchange 驱动 */
  const nativeFullscreen = ref(ownsFullscreen())
  /** CSS 伪全屏（仅 pseudoFallback 开启且原生全屏不可用 / 被拒时进入） */
  const pseudoFullscreen = ref(false)
  const isFullscreen = computed(() => nativeFullscreen.value || pseudoFullscreen.value)
  const owner = Symbol('playback-fullscreen')

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

  /**
   * 仅手机形态、且**当前确实拥有全屏**时锁横屏。三层前置条件缺一不可：
   * 生命周期有效 → 本回放根就是 fullscreenElement → 手机形态。
   * （第三条不依赖 innerWidth：手机全屏横屏后内宽可 >768，按宽度判会错判成平板。）
   */
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

  /** 唯一的状态同步点：任何来源的全屏变化都经这里 */
  function onFullscreenChange() {
    nativeFullscreen.value = ownsFullscreen()
    if (!nativeFullscreen.value) unlockOrientation()
    // 迟到的原生全屏成功时让位给它（不再叠着伪全屏）
    if (nativeFullscreen.value && pseudoFullscreen.value) { setPseudoFullscreen(false); return }
    onChange?.(isFullscreen.value)
  }

  /** 伪全屏：类 + 文档滚动锁都挂在这里，进出对称，卸载时一并清掉 */
  function setPseudoFullscreen(on: boolean) {
    if (pseudoFullscreen.value === on) return
    const el = target()
    if (on && (!el || typeof document === 'undefined')) return
    pseudoFullscreen.value = on
    if (typeof document !== 'undefined') {
      if (on) {
        document.documentElement.setAttribute(PSEUDO_SCROLL_LOCK_ATTR, '')
        document.addEventListener('keydown', onPseudoKeydown)
      } else {
        document.documentElement.removeAttribute(PSEUDO_SCROLL_LOCK_ATTR)
        document.removeEventListener('keydown', onPseudoKeydown)
      }
    }
    onChange?.(isFullscreen.value)
  }
  /** Esc 退出伪全屏；别的层（菜单 / 对话框）已处理的 Esc 不抢 */
  function onPseudoKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    setPseudoFullscreen(false)
  }

  if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', onFullscreenChange)
  onScopeDispose(() => {
    if (typeof document !== 'undefined') document.removeEventListener('fullscreenchange', onFullscreenChange)
    setPseudoFullscreen(false)
    // 卸载时绝不把应用留在锁死方向上
    unlockOrientation()
  })

  /**
   * 全屏 API 在本平台是否真的可用（不可用时不渲染看似可点的按钮）。
   *
   * 导出为 **computed boolean**（不是函数）：函数对象恒真，`v-if="fullscreenSupported"`
   * 这种写法会永远成立——3D 面板曾因此在不支持 Fullscreen 的平台上仍然画出全屏按钮。
   * 布尔值也让两端模板写法一致，不再靠调用方记得加 `()`。`target()` 是响应式的，
   * 挂载后拿到真实元素时会自动重算。
   */
  const fullscreenSupported = computed(() => {
    const el = target()
    return typeof document !== 'undefined' && el != null && (pseudoFallback || typeof el.requestFullscreen === 'function')
  })

  /**
   * 只在本回放根**确实是** fullscreenElement 时退出（别的元素的全屏不碰）。
   * 供宿主在能力切走 / KeepAlive 停用时调用：被缓存的组件不会卸载，卸载路径的兜底退出不会发生。
   */
  function exitOwnedFullscreen() {
    setPseudoFullscreen(false)
    if (!ownsFullscreen() || typeof document.exitFullscreen !== 'function') return
    try {
      const p = document.exitFullscreen()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch { /* unsupported browsers may throw */ }
  }

  /** 卸载 / 失活后迟到的 requestFullscreen 完成不得让非激活查看器留在全屏 */
  let disposed = false
  onScopeDispose(() => { disposed = true })

  /**
   * 幂等的「进入」。**resolve 的是真实结果，不是「请求已发出」**：
   * 仅当 `requestFullscreen()` 成功且完成时本回放根确实是 `document.fullscreenElement`、生命周期仍有效才 `true`；
   * 已全屏 / 别的元素在全屏 / 失活 / API 缺失 / 被拒绝都 `false`（不抛出，不重试）。
   * 全屏状态仍只由 `fullscreenchange` 驱动（isFullscreen），这里的结果只用于观察。
   * 迟到的成功（期间已失活或卸载）会立刻退出本回放拥有的全屏。`toggleFullscreen` 行为不变。
   */
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
    if (typeof document === 'undefined') return
    const el = target()
    if (!el) return
    if (pseudoFullscreen.value) { setPseudoFullscreen(false); return }
    if (document.fullscreenElement && document.fullscreenElement !== el) return
    if (document.fullscreenElement === el) {
      if (typeof document.exitFullscreen === 'function') {
        try {
          const p = document.exitFullscreen()
          if (p && typeof p.catch === 'function') p.catch(() => {})
        } catch { /* unsupported browsers may throw */ }
      }
      return
    }
    // 原生请求失败（API 缺失 / 同步抛出 / Promise 被拒）或悬挂不落定（部分嵌入 / 自动化环境实测既不
    // resolve 也不 reject，按钮表现为「点了没反应」）→ 伪全屏降级；不开降级则保持原行为（静默）。
    let settled = false
    const fallback = () => {
      if (settled) return
      settled = true
      if (pseudoFallback && isActive() && !disposed && !ownsFullscreen()) setPseudoFullscreen(true)
    }
    if (typeof el.requestFullscreen !== 'function') { fallback(); return }
    try {
      const p = el.requestFullscreen()
      // 顺序要求：**全屏成功之后**才请求方向锁
      if (p && typeof p.then === 'function') {
        const timer = pseudoFallback ? setTimeout(fallback, PSEUDO_FALLBACK_DELAY_MS) : null
        p.then(() => { settled = true; if (timer) clearTimeout(timer); lockOrientation() }).catch(() => { if (timer) clearTimeout(timer); fallback() })
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
    /** 当前处于 CSS 伪全屏（宿主据此绑定 pb-pseudo-fullscreen 类） */
    pseudoFullscreen: readonly(pseudoFullscreen),
    fullscreenSupported,
    toggleFullscreen,
    enterFullscreen,
    exitOwnedFullscreen,
    /** 供测试与外部退出路径显式解锁 */
    unlockOrientation,
  }
}
