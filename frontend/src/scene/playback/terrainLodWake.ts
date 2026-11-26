
import { TERRAIN_LOD_MIN_INTERVAL_MS } from '../terrainMesh.js'

export interface TerrainLodWake {
  scheduleElapsed(sinceSwapMs: number): void
  cancel(): void
  readonly pending: boolean
}

interface WakeTimers {
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export function createTerrainLodWake(
  invalidate: () => void,
  destroyed: () => boolean,
  timers: WakeTimers = {},
): TerrainLodWake {
  const setTimer = timers.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = timers.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let handle: unknown = null

  function cancel() {
    if (handle === null) return
    clearTimer(handle)
    handle = null
  }

  return {
    scheduleElapsed(sinceSwapMs) {
      cancel()
      const delay = Math.max(0, TERRAIN_LOD_MIN_INTERVAL_MS - sinceSwapMs)
      handle = setTimer(() => {
        handle = null
        if (!destroyed()) invalidate()
      }, delay)
    },
    cancel,
    get pending() { return handle !== null },
  }
}
