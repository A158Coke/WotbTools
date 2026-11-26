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

export function formatShotBattleClock(timeS: number, battleStartRaw: number): string {
  const start = Number.isFinite(battleStartRaw) ? battleStartRaw : 0
  return formatPlaybackClock(Math.max(0, timeS - start))
}

export function formatPlaybackClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
