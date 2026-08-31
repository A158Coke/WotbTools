const PLAYBACK_SPEEDS = Object.freeze([0.5, 1, 2, 4])

export function clampPlaybackTime(sec, duration) {
  const max = Number.isFinite(duration) ? Math.max(0, duration) : 0
  const value = Number.isFinite(sec) ? sec : 0
  return Math.min(max, Math.max(0, value))
}

export function advancePlaybackTime(current, duration, deltaMs, speed) {
  const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0
  const rate = Number.isFinite(speed) ? Math.max(0, speed) : 0
  return clampPlaybackTime(current + (delta / 1000) * rate, duration)
}

export function nextPlaybackSpeed(current) {
  const index = PLAYBACK_SPEEDS.indexOf(current)
  return PLAYBACK_SPEEDS[(index < 0 ? 0 : index + 1) % PLAYBACK_SPEEDS.length]
}
