import type { PlaybackSpeed } from '../types/playback.js'

const PLAYBACK_SPEEDS: readonly PlaybackSpeed[] = Object.freeze([0.5, 1, 2, 4])

export function clampPlaybackTime(sec: number, duration: number): number {
  const max = Number.isFinite(duration) ? Math.max(0, duration) : 0
  const value = Number.isFinite(sec) ? sec : 0
  return Math.min(max, Math.max(0, value))
}

export function advancePlaybackTime(
  current: number,
  duration: number,
  deltaMs: number,
  speed: number,
): number {
  const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0
  const rate = Number.isFinite(speed) ? Math.max(0, speed) : 0
  return clampPlaybackTime(current + (delta / 1000) * rate, duration)
}

export function nextPlaybackSpeed(current: PlaybackSpeed): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.indexOf(current)
  return PLAYBACK_SPEEDS[(index < 0 ? 0 : index + 1) % PLAYBACK_SPEEDS.length]
}
