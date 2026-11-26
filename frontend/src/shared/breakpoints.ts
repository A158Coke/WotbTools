export const BREAKPOINT_MEDIUM = 768
export const BREAKPOINT_EXPANDED = 1200

export type BreakpointTier = 'compact' | 'medium' | 'expanded'

export const PLAYBACK_MOBILE_QUERY = `(max-width: ${BREAKPOINT_MEDIUM - 0.02}px), (pointer: coarse) and (max-height: 500px)`

export const SHELL_DRAWER_QUERY = `(max-width: ${BREAKPOINT_MEDIUM - 0.02}px), (pointer: coarse) and (orientation: landscape) and (max-height: 520px)`
