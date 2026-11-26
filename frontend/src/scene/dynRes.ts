export interface DynResOptions {
  ceilDpr: number
  floorDpr?: number
  step?: number
  downMs?: number
  upMs?: number
  windowN?: number
  cooldownFrames?: number
}

export interface DynResController {
  dpr(): number
  frame(dtMs: number): number | null
}

export function createDynRes({
  ceilDpr,
  floorDpr = 1,
  step = 0.25,
  downMs = 22,
  upMs = 17,
  windowN = 45,
  cooldownFrames = 60,
}: DynResOptions): DynResController {
  if (!(ceilDpr > floorDpr)) throw new Error(`dynRes: 无调整空间 (ceil ${ceilDpr} ≤ floor ${floorDpr})`)
  let dpr = ceilDpr
  const window: number[] = []
  let cooldown = 0
  return {
    dpr: () => dpr,
    frame(dtMs: number): number | null {
      window.push(dtMs)
      if (window.length > windowN) window.shift()
      if (cooldown > 0) { cooldown -= 1; return null }
      if (window.length < windowN) return null
      const mean = window.reduce((a, b) => a + b, 0) / window.length
      if (mean > downMs && dpr > floorDpr) {
        dpr = Math.max(floorDpr, Math.round((dpr - step) * 100) / 100)
      } else if (mean < upMs && dpr < ceilDpr) {
        dpr = Math.min(ceilDpr, Math.round((dpr + step) * 100) / 100)
      } else {
        return null
      }
      window.length = 0
      cooldown = cooldownFrames
      return dpr
    },
  }
}
