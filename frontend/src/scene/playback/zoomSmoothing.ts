
export interface ZoomSmoother {
  push(factor: number): void
  advance(dt: number): number
  active(): boolean
  reset(): void
}

export const ZOOM_SMOOTH_TAU_SEC = 0.09
export const ZOOM_SETTLE_LOG_EPS = 0.004
const FLY_EVENT_FACTOR_MAX = 0.3
const FLY_EVENT_DELTA_SCALE = 0.0012

function toLogBudget(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return 0
  return Math.log(factor)
}

export function createZoomSmoother(tau = ZOOM_SMOOTH_TAU_SEC): ZoomSmoother {
  let remaining = 0
  return {
    push(factor) {
      remaining += toLogBudget(factor)
    },
    advance(dt) {
      if (remaining === 0) return 1
      if (Math.abs(remaining) <= ZOOM_SETTLE_LOG_EPS) {
        const settled = Math.exp(remaining)
        remaining = 0
        return settled
      }
      const take = remaining * (1 - Math.exp(-Math.max(0, dt) / tau))
      remaining -= take
      return Math.exp(take)
    },
    active() { return remaining !== 0 },
    reset() { remaining = 0 },
  }
}

export function flyWheelFactor(deltaY: number): number {
  const step = Math.max(-FLY_EVENT_FACTOR_MAX, Math.min(FLY_EVENT_FACTOR_MAX, deltaY * FLY_EVENT_DELTA_SCALE))
  return 1 + step
}

export const FLY_SETTLE_EPS = 0.01

export interface FlyZoomSmoother {
  pushDisplacement(amount: number): void
  advance(dt: number): number
  active(): boolean
  reset(): void
}

export function createFlyZoomSmoother(tau = ZOOM_SMOOTH_TAU_SEC): FlyZoomSmoother {
  let remaining = 0
  return {
    pushDisplacement(amount) {
      if (!Number.isFinite(amount)) return
      remaining += amount
    },
    advance(dt) {
      if (remaining === 0) return 0
      if (Math.abs(remaining) <= FLY_SETTLE_EPS) {
        const settled = remaining
        remaining = 0
        return settled
      }
      const take = remaining * (1 - Math.exp(-Math.max(0, dt) / tau))
      remaining -= take
      return take
    },
    active() { return remaining !== 0 },
    reset() { remaining = 0 },
  }
}

export function orbitWheelFactor(deltaY: number, zoomSpeed = 1): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1
  const scale = Math.pow(0.95, Math.max(0, zoomSpeed) * Math.abs(deltaY) * 0.01)
  return deltaY > 0 ? 1 / scale : scale
}
