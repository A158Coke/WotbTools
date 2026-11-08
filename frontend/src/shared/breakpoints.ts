/**
 * 三档断点（docs/frontend/design-language.md §6）的 JS 侧唯一来源。
 * CSS 侧由 stylelint（media-feature-name-value-allowed-list）锁定为同样的 768 / 1200。
 */
export const BREAKPOINT_MEDIUM = 768
export const BREAKPOINT_EXPANDED = 1200

export type BreakpointTier = 'compact' | 'medium' | 'expanded'

/**
 * 2D 回放的 mobile 形态（审计 PB-07：布局按可用空间，交互尺寸按输入方式，两者分开）：
 * 宽度 < 768，或触屏且高度 ≤ 500（手机横屏 / 全屏横屏）。768–1199 一律 tablet，≥1200 一律 pc；
 * iPad / Android 平板因此拿到 tablet 形态，触屏只额外放大点击区域。
 */
export const PLAYBACK_MOBILE_QUERY = `(max-width: ${BREAKPOINT_MEDIUM - 0.02}px), (pointer: coarse) and (max-height: 500px)`

/**
 * 抽屉外壳（design-language §9 L1 / L3）：手机竖屏（宽 < 768）与手机横屏（触屏、横向、高 ≤ 520，
 * 不论宽度——iPhone 横屏 844×340 也在内）都用顶栏左上菜单按钮 + 左侧抽屉，没有侧边栏，也没有底部常驻栏。
 * 平板（触屏但高度 > 520）与桌面保持左侧边栏。CSS 侧同一条件在 styles/tokens/scale.css。
 */
export const SHELL_DRAWER_QUERY = `(max-width: ${BREAKPOINT_MEDIUM - 0.02}px), (pointer: coarse) and (orientation: landscape) and (max-height: 520px)`
