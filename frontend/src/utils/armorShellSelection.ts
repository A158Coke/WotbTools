/**
 * 换配置时是否让 URL 的 shell 失效。
 *
 * 弹种下标属于当前射手弹表：射手换炮必然改变弹表；普通同车检视未独立选炮时，
 * 射手弹表跟随受击方配置（tankViewer.applyConfig 的 same-tank 同步分支）。
 * 一旦存在显式 scfg，或射击方与受击方不是同一辆车，受击方换配置不会改变射手
 * 弹表，此时必须保留已选弹种，否则 HUD 回退到第 0 枚而场景仍用旧下标。
 */
export function shouldResetShellOnConfigChange({
  side,
  configChanged,
  sameTank,
  explicitShooterConfig,
}) {
  if (!configChanged) return false
  if (side === 'shooter') return true
  return sameTank && !explicitShooterConfig
}
