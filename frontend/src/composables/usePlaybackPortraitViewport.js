/**
 * 回放 workspace 的**视口朝向**。
 *
 * 为什么它不是「又一个断点」：正方形 Stage 的两种呈现由**朝向**决定，不由宽度决定——
 *
 *   竖屏手机 = 纵向流（HUD / 正方形 Stage / 传输控件 / 详情 inline / Team 1 / Team 2，超出就滚）
 *   横屏与宽档 = `Team 1 | 正方形 Stage | Team 2`
 *
 * 手机横屏内宽可以超过 768（844×390），所以「宽 < 768」既不能当竖屏判据、也不能拿
 * `PLAYBACK_MOBILE_QUERY` 反推（那条查询的第二个分支专为触屏矮视口而设，与朝向无关）。
 * 于是这里同时要求两件事：媒体查询命中 **且** 真实布局视口确实窄于 768。
 * 第二道判断不是冗余——它挡住了「查询被桩成一律命中」这类环境下把宽屏误判成竖屏的可能，
 * 而误判的代价是一整块布局（详情浮窗 vs 流内内容块）走错分支。
 *
 * 无 `matchMedia` 的环境退化为「非竖屏」，即按宽档三段式呈现。
 */
import { onScopeDispose, readonly, ref } from 'vue'

/** 竖屏判据的宽度上限：与 shared/breakpoints 的 mobile 档一致（唯一事实源是那条查询本身）。 */
export const PLAYBACK_PORTRAIT_QUERY = '(orientation: portrait) and (width < 768px)'
const PORTRAIT_MAX_WIDTH = 768

export function usePlaybackPortraitViewport() {
  const isPortrait = ref(false)
  if (typeof window === 'undefined') return { isPortrait: readonly(isPortrait) }

  const read = () => {
    if (typeof window.matchMedia !== 'function') return false
    if (!window.matchMedia(PLAYBACK_PORTRAIT_QUERY).matches) return false
    const width = Number(window.innerWidth)
    return !Number.isFinite(width) || width < PORTRAIT_MAX_WIDTH
  }
  isPortrait.value = read()

  const query = typeof window.matchMedia === 'function' ? window.matchMedia(PLAYBACK_PORTRAIT_QUERY) : null
  const onQueryChange = () => { isPortrait.value = read() }
  const onResize = () => { isPortrait.value = read() }
  query?.addEventListener?.('change', onQueryChange)
  window.addEventListener?.('resize', onResize)
  window.addEventListener?.('orientationchange', onResize)
  onScopeDispose(() => {
    query?.removeEventListener?.('change', onQueryChange)
    window.removeEventListener?.('resize', onResize)
    window.removeEventListener?.('orientationchange', onResize)
  })
  return { isPortrait: readonly(isPortrait) }
}
