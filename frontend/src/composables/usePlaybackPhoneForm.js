/**
 * 回放 **form factor**（与输入方式、视口形状一起决定，不只看宽度）。
 *
 * 为什么不能只看 `width < 768`：手机竖屏 412×915 点 Fullscreen 后变成 915×412——
 * 纯宽度的断点会突然判成 tablet，把刚收起来的 controls 又全部展开。
 * 2D 回放早就用 `PLAYBACK_MOBILE_QUERY` 处理了这件事（宽度 < 768，**或**触屏且视口高
 * ≤ 500，后者命中手机横屏 / 全屏横屏）。本模块把它做成 2D / 3D 共用的 reactive 读法，
 * 避免 3D 另立一套判断规则。
 *
 * 布局（compact / medium / expanded 三档）仍由 `useBreakpoint` 负责；本模块只回答
 * 「这是不是**手机形态的回放**」——两者用途不同，不要互相替代。
 */
import { onScopeDispose, readonly, ref } from 'vue'
import { PLAYBACK_MOBILE_QUERY } from '../shared/breakpoints.js'

/**
 * 手机形态回放的媒体查询（shared/breakpoints 是唯一事实源；测试据此断言）。
 * 触屏是必要条件：桌面把窗口压到 ≤500 高仍走桌面形态（触屏 + 矮视口才是手机横屏特征）。
 */
export const PLAYBACK_PHONE_QUERY = PLAYBACK_MOBILE_QUERY

/**
 * 当前是否为手机形态回放。响应式跟随 `matchMedia` 变化（旋转、全屏进出、窗口缩放都会触发）。
 * 在无 `matchMedia` 的环境（SSR / 部分测试环境）退化为 `false`，即按宽档呈现。
 */
export function usePlaybackPhoneForm() {
  const isPhone = ref(false)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { isPhone: readonly(isPhone) }
  }
  const query = window.matchMedia(PLAYBACK_PHONE_QUERY)
  isPhone.value = query.matches
  const update = () => { isPhone.value = query.matches }
  query.addEventListener?.('change', update)
  onScopeDispose(() => query.removeEventListener?.('change', update))
  return { isPhone: readonly(isPhone) }
}
