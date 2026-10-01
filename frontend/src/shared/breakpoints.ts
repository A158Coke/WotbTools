/**
 * 三档断点（docs/frontend/design-language.md §6）的 JS 侧唯一来源。
 * CSS 侧由 stylelint（media-feature-name-value-allowed-list）锁定为同样的 768 / 1200。
 */
export const BREAKPOINT_MEDIUM = 768
export const BREAKPOINT_EXPANDED = 1200

export type BreakpointTier = 'compact' | 'medium' | 'expanded'
