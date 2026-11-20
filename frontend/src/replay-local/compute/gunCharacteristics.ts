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
  // DPM（BK resolveDpm）：regular 单发；autoloader 整匣循环；autoreloader 取最短单发循环
  let dpm: number | null = null
  let shotsPerMinute = reload && reload > 0 ? Math.round((60 / reload) * 100) / 100 : null
  if (hasShell && damage != null) {
    if (cycle.type === 'regular') {
      dpm = reload ? Math.round(damage * 60 / reload) : null
    } else if (cycle.type === 'autoloader' && cycle.shellCount > 0) {
      // 整匣循环（BK resolveDpm）：无连发组 = reload + (n-1)×弹间；
      // PomPom = reload + (组数-1)×弹间 + 组数×(每组发数-1)×组内弹间
      //（组内连发比扳机间隔快，按普通弹夹算会把组内时间重复计一遍，DPM 显著偏低）。
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
  // 自动装填炮“有效 DPM”（BK dpmEffective 的 60 s 窗口模型）：只有 autoreloader 有。
  // BK 的分支条件是**原始**逐发装填（不乘系数）比较首两发；窗口与已打出的弹药数
  // 取整匣，末发/首发耗时按分支选择（装填最长的一发决定循环）。少于两发时公式
  // 无定义——留 null（fail-closed，不臆造）。
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

/**
 * 客户端弹种词表（tank/{id}.json shells[].type）→ 校准弹系数（BK resolvePenetrationCoefficient）。
 * AP 族（ap / ap_premium / ap_cr / ap_cr_premium）×1.06；HEAT 族（hc / hc_premium / atgm_heat）
 * 与 HE 族（he / he_premium）×1.07。
 */
export function penetrationCoefficient(type: string | null | undefined, calibrated: unknown) {
  if (!calibrated || !type) return 1
  return /^ap/.test(type) ? 1.06 : 1.07
}
