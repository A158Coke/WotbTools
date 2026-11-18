/** BlitzInfo WG handling_run_ups / handling_hull_traverse, kernel SHA e8c87476 (see docs). */
export const terrains = ['Firm', 'Medium', 'Soft'] as const
export type Terrain = typeof terrains[number]
export const stepSeconds = 0.02
export interface Mobility {
  power: number
  mass: number | null
  limit: number | null
  permeability: Record<Terrain, number | null>
  traverse: Record<Terrain, number | null>
}

export function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function effectivePower(input: Mobility, terrain: Terrain) {
  const c = input.permeability[terrain]
  return positive(input.power) && positive(input.mass) && positive(c) ? input.power / input.mass * c / 100 : null
}

export function mobilityRows(input: Mobility) {
  const rows: Record<string, number | null> = {}
  for (const terrain of terrains) {
    rows['effectivePower' + terrain] = effectivePower(input, terrain)
    rows['effectiveTraverse' + terrain] = input.traverse[terrain]
  }
  return rows
}

export interface Phase { start: number; input: Mobility | null }
export type RunStatus = 'reached' | 'unreachable' | 'window' | 'unsupported' | 'missing'
export interface Run {
  speeds: number[]
  status: RunStatus
  upper: number | null
  reached: number | null
  near: number | null
}

function dynamics(input: Mobility | null, ground: Terrain) {
  if (!input) return null
  const c = input.permeability[ground]
  if (!positive(c) || !positive(input.mass) || !positive(input.power) || !positive(input.limit)) return null
  const power = input.power * 735.5 * 1.25 / (1000 * input.mass)
  const drag = 0.8583750000000001 * 100 / c
  const upper = Math.min(power, 15.94125) <= drag ? 0 : Math.min(input.limit, 3.6 * power / drag)
  return { power, drag, upper, limit: input.limit / 3.6 }
}

/** Phases are ordered by start time. Only the initial state can imply a whole-run upper bound. */
export function simulate(phases: Phase[], ground: Terrain, seconds = 90): Run {
  const result: Run = { speeds: [], status: 'missing', upper: null, reached: null, near: null }
  if (!phases.length || phases[0].start !== 0 || !positive(seconds)) return result
  let phase = 0
  let state = dynamics(phases[phase].input, ground)
  if (!state) {
    if (phases.length > 1 && phases[0].input == null) result.status = 'unsupported'
    return result
  }
  const constant = phases.length === 1
  result.upper = constant ? state.upper : null
  result.status = constant && state.upper < state.limit * 3.6 - 1e-9 ? 'unreachable' : 'window'
  result.speeds.push(0)
  let speed = 0
  for (let tick = 1; tick <= Math.floor(seconds / stepSeconds); tick++) {
    const end = tick * stepSeconds
    let time = (tick - 1) * stepSeconds
    while (time < end) {
      const next = phases[phase + 1]
      if (next && next.start <= time) {
        phase++
        state = dynamics(next.input, ground)
        if (!state || speed > state.limit + 1e-9) {
          result.status = 'unsupported'
          return result
        }
        continue
      }
      const until = next ? Math.min(end, next.start) : end
      const acceleration = Math.min(state.power / Math.max(speed, 1), 15.94125) - state.drag
      speed = Math.max(0, Math.min(state.limit, speed + acceleration * (until - time)))
      time = until
    }
    result.speeds.push(speed * 3.6)
    if (constant && result.near == null && state.upper > 0 && speed >= state.upper * 0.97 / 3.6 - 1e-9) result.near = end
    if (constant && result.status !== 'unreachable' && result.reached == null && speed >= state.limit - 1e-9) {
      result.status = 'reached'
      result.reached = end
    }
  }
  return result
}

export function speedAt(speeds: number[], time: number) {
  const index = time / stepSeconds
  if (!speeds.length || index < 0 || index > speeds.length - 1 + 1e-9) return null
  const lo = Math.min(Math.floor(index), speeds.length - 1)
  return speeds[lo] + ((speeds[lo + 1] ?? speeds[lo]) - speeds[lo]) * (index - lo)
}

/** Equal sample runs become intervals. Sign changes interpolate between the original samples. */
export function intersections(a: number[], b: number[]) {
  const matches: Array<[number, number]> = []
  let start = -1
  let last = 0
  const count = Math.min(a.length, b.length)
  for (let i = 0; i < count; i++) {
    const diff = a[i] - b[i]
    const equal = Math.abs(diff) <= 1e-8
    if (equal && start < 0) start = i
    if (!equal && start >= 0) {
      if (i > 1) matches.push([start * stepSeconds, (i - 1) * stepSeconds])
      start = -1
    } else if (!equal && i && diff * last < 0) {
      const time = (i - 1 + last / (last - diff)) * stepSeconds
      matches.push([time, time])
    }
    last = diff
  }
  if (start >= 0 && count > 1) matches.push([start * stepSeconds, (count - 1) * stepSeconds])
  return matches
}
