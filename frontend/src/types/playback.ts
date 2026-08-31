/** Shared, render-neutral contracts for the Battle Playback projection. */

export type PlaybackSpeed = 0.5 | 1 | 2 | 4

/** Battle-relative timestamp and map coordinates returned by a playback query. */
export interface PlaybackPosition {
  x: number
  y: number
  timeSec: number
}

/** Direction sample after the V2 query has applied its knowledge boundary. */
export interface PlaybackDirection {
  hullYawDeg: number | null
  turretRelativeYawDeg: number | null
  timeSec: number
}

export interface PlaybackHpLoss {
  fromSec: number
  toSec: number
  hpLoss: number
}

export interface PlaybackMarkerStyle {
  left: string
  top: string
  transform: string
}
