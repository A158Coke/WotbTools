import type { ComputeInput } from './characteristicsTypes'

export function calculateGunDamageRate(
  cycle: NonNullable<ComputeInput['gunCycle']>,
  reload: number | null,
  damage: number | null,
  hasShell: boolean,
  reloadCoeff: number,
  intraClip: number,
  intraClipFactor: number,
) {
  let dpm: number | null = null
  let shotsPerMinute = reload && reload > 0 ? Math.round((60 / reload) * 100) / 100 : null
  if (hasShell && damage != null) {
    if (cycle.type === 'regular') {
      dpm = reload ? Math.round(damage * 60 / reload) : null
    } else if (cycle.type === 'autoloader' && cycle.shellCount > 0) {
      const groupCount = (cycle.burstGroupCount || 0) > 1
        ? cycle.shellCount / (cycle.burstGroupCount as number)
        : 0
      let cycleTime = cycle.reload * reloadCoeff
      if (groupCount > 0) {
        cycleTime += (groupCount - 1) * intraClip +
          groupCount * ((cycle.burstGroupCount as number) - 1) * (cycle.burstGroupInterval || 0)
      } else {
        cycleTime += Math.max(0, cycle.shellCount - 1) * intraClip
      }
      dpm = cycleTime > 0 ? Math.round((damage * cycle.shellCount * 60) / cycleTime) : null
      shotsPerMinute = cycleTime > 0 ? Math.round((cycle.shellCount * 60 / cycleTime) * 100) / 100 : null
    } else if (cycle.type === 'autoreloader' && cycle.shellReloads.length > 0) {
      const perShell = cycle.shellReloads.map((value, index) => value * reloadCoeff + (index > 0 ? intraClip : 0))
      const best = Math.min(...perShell.filter(value => value > 0))
      dpm = Number.isFinite(best) && best > 0 ? Math.round(damage * 60 / best) : null
      shotsPerMinute = Number.isFinite(best) && best > 0 ? Math.round((60 / best) * 100) / 100 : null
    }
  }
  let dpmEffective: number | null = null
  if (cycle.type === 'autoreloader' && cycle.shellReloads.length >= 2 && damage != null) {
    const reloads = cycle.shellReloads
    const rawIntra = cycle.intraClip
    const longFirst = reloads[0] > reloads[1] + rawIntra
    const denominatorReload = longFirst ? reloads[reloads.length - 1] : reloads[0]
    const denominator = denominatorReload * reloadCoeff + rawIntra * intraClipFactor
    const window = 60 - (reloads.length - 2) * rawIntra * intraClipFactor
    dpmEffective = denominator > 0
      ? Math.round(((damage / denominator) * window + damage * (reloads.length - 1)) * 100) / 100
      : null
  }
  return { dpm, shotsPerMinute, dpmEffective }
}

export function penetrationCoefficient(type: string | null | undefined, calibrated: unknown) {
  if (!calibrated || !type) return 1
  return /^ap/.test(type) ? 1.06 : 1.07
}
