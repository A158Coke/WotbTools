
export type PlaybackSpeed = 0.5 | 1 | 2 | 4

export interface PlaybackPosition {
  x: number
  y: number
  timeSec: number
}

export interface PlaybackDirection {
  hullYawDeg: number | null
  turretRelativeYawDeg: number | null
  timeSec: number
}
