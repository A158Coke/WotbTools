/** Battle Playback compatibility facade for presentation math, events, and view utilities. */

export type { RouteLike } from './battlePlaybackMotion.js'
export { positionAt, trustedPositionAt, recentPositionTrails, recentPositionTrailsFromPose } from './battlePlaybackMotion.js'
export { tracerLines } from './battlePlaybackTracer.js'
export { normalizeDeg, screenRotation, turretWorldYawDeg, zoomViewAt, clampViewPan } from './battlePlaybackView.js'
export { teamPointsAt, eventsCrossed, FLOAT_DMG_MS, GHOST_MS, FLASH_MS, BURST_MS, KILL_FEED_MS, transientsActive, activeFeed, pushFeed } from './battlePlaybackEvents.js'
export { formatPlaybackClock as formatClock } from './playbackClock'
