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
