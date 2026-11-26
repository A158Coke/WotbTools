import { mobilityRows, positive, terrains, type Mobility } from './mobility'
import { calculateGunDamageRate, penetrationCoefficient } from './gunCharacteristics'
export { penetrationCoefficient } from './gunCharacteristics'
import { degressiveStat, isConditionalCrewSkill, progressiveStat } from './crewStats'

export { degressiveStat, progressiveStat }

export function viewRangeBonusByClass(vehicleClass: string | null | undefined) {
  if (vehicleClass === 'lightTank') return 0.11
  if (vehicleClass === 'mediumTank') return 0.08
  if (vehicleClass === 'heavyTank') return 0.06
  return 0.04
}

export function invisibilityBonusFor(values: Record<string, unknown> | null | undefined, vehicleClass: string | null | undefined) {
  if (!values || !vehicleClass) return 0
  const raw = values[vehicleClass] ?? (vehicleClass === 'SPG' ? values['AT-SPG'] : undefined)
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

export function crewLevelIncreaseFromScript(script: { params?: { bonusValues?: { crewLevelIncrease?: unknown } } } | null | undefined) {
  const bonus = script?.params?.bonusValues?.crewLevelIncrease
  const v = bonus == null ? null : Number(bonus)
  return v == null || Number.isNaN(v) ? null : v / 100
}

import type { ComputeInput, TankCharacteristics } from './characteristicsTypes'
export type { ComputeInput, TankCharacteristics } from './characteristicsTypes'

function coeff(...effects: Array<[boolean, number]>): number {
  return effects.reduce((acc, e) => acc + (e[0] ? e[1] : 0), 1)
}

import { tankDimensions } from './tankDimensions'
export { tankDimensions } from './tankDimensions'
export type { TankDimensions } from './tankDimensions'

export function computeCharacteristics(input: ComputeInput): TankCharacteristics {
  const { modules } = input
  const turret = modules.turrets?.[input.turretIdx]
  const gun = turret?.guns?.[input.gunIdx]
  const engine = modules.engines?.[input.engineIdx]
  const track = modules.chassis?.[input.trackIdx]
  if (!turret || !gun || !engine || !track) {
    return {}
  }

  const ids = new Set(input.deviceIds)
  const has = (id: number) => ids.has(id)
  const hasProvision = (stem: string) => input.provisionStems.includes(stem)
  const hasConsumable = (stem: string) => input.consumableStems.includes(stem)
  const skill = (id: string) => {
    if (isConditionalCrewSkill(id) && input.conditionalSkills !== true) return 0
    const level = Number(input.skillLevels?.[id]) || 0
    return Math.min(7, Math.max(0, level))
  }
  const skillRate = (id: string, key: string) => {
    const value = Number(input.skillEffects?.[id]?.effects?.[key])
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  let crewBonus = 0
  for (const stem of input.provisionStems) {
    const inc = crewLevelIncreaseFromScript(input.provisionScripts[stem])
    if (inc != null) crewBonus += inc
  }
  if (has(102)) crewBonus += 0.08
  const commanderMastery = 1 + crewBonus
  const roleMul = (role: string) => (input.crewRoles.includes(role) ? 1.1 : 1.0)
  const loaderMastery = commanderMastery * roleMul('loader')
  const gunnerMastery = commanderMastery * roleMul('gunner')
  const driverMastery = commanderMastery * roleMul('driver')
  const loaderDeg = degressiveStat(loaderMastery)
  const gunnerDeg = degressiveStat(gunnerMastery)
  const driverDeg = degressiveStat(driverMastery)
  const gunnerProg = progressiveStat(gunnerMastery)
  const driverProg = progressiveStat(driverMastery)
  const commanderProg = progressiveStat(commanderMastery)

  const hpCoeff = coeff(
    [hasProvision('smallHPStock'), 0.03],
    [hasProvision('largeHPStock'), 0.06],
    [has(111), 0.05], // highQualityAssembly
  )
  const maxHealth = Math.round(((modules.hull?.hp ?? 0) + (turret.stats?.maxHealth ?? 0)) * hpCoeff)
  const hasTurret = modules.hasTurret !== false

  const radio = modules.radios?.[0]
  const fuelTank = modules.fuelTanks?.[0]
  const componentWeights = (engineWeight: number | undefined, trackWeight: number | undefined, turretWeight: number | undefined, gunWeight: number | undefined) =>
    [modules.hull?.weight, engineWeight, trackWeight, turretWeight, gunWeight, radio?.stats?.weight, fuelTank?.stats?.weight]
  const massParts = componentWeights(engine.stats?.weight, track.stats?.weight, turret.stats?.weight, gun.stats?.weight)
  const sumWeights = (parts: Array<number | undefined>): number => parts.reduce<number>((total, value) => total + (value ?? 0), 0)
  const weightKg = sumWeights(massParts)
  const weightT = weightKg / 1000

  const enginePowerCoeff = coeff(
    [has(117), 0.06],
    [hasConsumable('freeAfterburning'), Number(input.consumableScripts.freeAfterburning?.params?.enginePowerIncrease ?? 1.1) - 1],
    [hasConsumable('afterburning'), Number(input.consumableScripts.afterburning?.params?.bonusValues?.enginePowerIncrease ?? 20) / 100],
    [hasConsumable('improvedAfterburning'), Number(input.consumableScripts.improvedAfterburning?.params?.enginePowerIncrease ?? 1.35) - 1],
    [hasProvision('regular_fuel'), 0.03],
    [hasProvision('improved_fuel'), 0.1],
    [hasProvision('gearOil'), 0.03],
    [hasProvision('improvedGearOil'), 0.06],
  )
  const baseEnginePower = engine.stats?.power ?? 0
  const enginePower = baseEnginePower * enginePowerCoeff *
    (1 + skill('surrounded_by_enemy') * skillRate('surrounded_by_enemy', 'enginePowerFactorPerLevel'))

  const reloadBase = gun.stats?.reloadTime ?? 0
  const cycle: NonNullable<ComputeInput['gunCycle']> = input.gunCycle || {
    type: 'regular', reload: reloadBase, intraClip: 0, shellCount: 0, shellReloads: [],
    burstGroupCount: 0, burstGroupInterval: 0,
  }
  const isMagazine = cycle.type !== 'regular'
  const adrenaline = hasConsumable('berserk') && cycle.type === 'regular' ? 0.17 : 0
  const reloadCoeff = coeff([has(100), -0.05]) * (1 + loaderDeg)
  const reloadSkillFactor = isMagazine
    ? 1
    : (1 + skill('battle_rage') * skillRate('battle_rage', 'reloadFactorPerLevel')) *
      (1 + skill('desperado') * skillRate('desperado', 'gunReloadTimeFactorPerLevel'))
  const reload = reloadBase > 0
    ? (reloadCoeff * reloadBase) / (1 + adrenaline) / reloadSkillFactor
    : null
  const intraClipFactor = (() => {
    if (!hasConsumable('newAutoloader')) return 1
    const factor = Number(input.consumableScripts?.newAutoloader?.params?.clipReloadTimeFactor)
    return Number.isFinite(factor) && factor > 0 ? factor : 1
  })()
  const intraClip = cycle.intraClip * intraClipFactor
  const clipShellCount = isMagazine && cycle.shellCount > 0 ? cycle.shellCount : null
  const burstGroupSize = cycle.type === 'autoloader' && (cycle.burstGroupCount || 0) > 1
    ? (cycle.burstGroupCount as number)
    : 0
  const burstGroupsPerClip = burstGroupSize > 0 && cycle.shellCount % burstGroupSize === 0
    ? cycle.shellCount / burstGroupSize
    : null
  const burstGroupInterval = burstGroupSize > 0 && (cycle.burstGroupInterval || 0) > 0
    ? (cycle.burstGroupInterval as number)
    : null
  const clipShotsSpan = burstGroupSize > 0
    ? burstGroupsPerClip != null && burstGroupsPerClip > 1
    : true
  const clipShellReload = cycle.type === 'autoloader' && intraClip > 0 && clipShotsSpan ? intraClip : null
  const clipReload = cycle.type === 'autoloader'
    ? (cycle.reload > 0 ? cycle.reload * reloadCoeff : null)
    : cycle.type === 'autoreloader' && cycle.shellReloads.length > 0
      ? cycle.shellReloads.reduce((acc, value) => acc + value, 0) * reloadCoeff
      : null
  const pumpReloads = cycle.type === 'autoreloader'
    ? cycle.shellReloads.map(value => value * reloadCoeff)
    : []

  const aimTime = (gun.stats?.aimingTime ?? 0) *
    coeff([has(104), -0.12], [hasConsumable('fireControlSystem'), -0.3]) *
    (1 + gunnerDeg) /
    (1 + skill('deadly_accuracy') * skillRate('deadly_accuracy', 'aimingFactorPerLevel'))
  const dispersion = (gun.stats?.shotDispersionRadius ?? 0) *
    coeff([has(106), -0.11], [hasConsumable('fireControlSystem'), -0.3]) *
    (1 + gunnerDeg)
  const gunFactors = gun.stats?.dispersionFactors || {}
  const trackFactors = track.stats?.dispersionFactors || {}
  const dynamicDispersion = (factor: any, skillId: string) => {
    const value = Number(factor)
    if (!Number.isFinite(value) || value <= 0) return null
    const reduction = skill(skillId) * skillRate(skillId, 'shotDispersionFactorPerLevel')
    const multiplier = coeff([has(105), -0.17], [reduction > 0, -reduction])
    return Math.round(value * multiplier * 1000) / 1000
  }
  const dispersionMoving = dynamicDispersion(trackFactors.vehicleMovement, 'smooth_driving')
  const dispersionHullTraversing = dynamicDispersion(trackFactors.vehicleRotation, 'smooth_turn')
  const dispersionTurretTraversing = dynamicDispersion(gunFactors.turretRotation, 'smooth_turret')
  const dispersionShooting = dynamicDispersion(gunFactors.afterShot, 'soft_recoil')
  const dispersionGunDamaged = (() => {
    const value = Number(gunFactors.whileGunDamaged)
    if (!Number.isFinite(value) || value <= 0) return null
    return Math.round(value * coeff([has(105), -0.17]) * 1000) / 1000
  })()

  const viewRange = (turret.stats?.circularVisionRadius ?? 0) *
    coeff([has(114), viewRangeBonusByClass(input.vehicleClass)]) *
    (1 + commanderProg) *
    (1 + skill('deadly_accuracy') * skillRate('deadly_accuracy', 'visionRadiusFactorPerLevel'))

  const paint = input.camouflage ? invisibilityBonusFor(input.paintInvisibility, input.vehicleClass) : 0
  const netBonus = has(115) ? invisibilityBonusFor(input.camouflageNet?.bonus, input.vehicleClass) : 0
  const netMoving = netBonus
  const netStill = netBonus * (Number(input.camouflageNet?.activateBonusFactor) || 0)
  const camoSkill = 1 + skill('camouflage') * skillRate('camouflage', 'camouflageFactorPerLevel')
  const baseStill = (modules.invisibility?.still ?? 0) * camoSkill
  const baseMoving = (modules.invisibility?.moving ?? 0) * camoSkill
  const camoStill = baseStill + paint + netStill
  const camoMoving = baseMoving + paint + netMoving
  const shotFactor = Number(gun.stats?.invisibilityFactorAtShot)
  const hasShotFactor = Number.isFinite(shotFactor) && shotFactor > 0
  const camoShot = hasShotFactor ? camoStill * shotFactor : camoStill
  const camoShotMoving = hasShotFactor ? camoMoving * shotFactor : null
  const firePenalty = Number(modules.invisibility?.firePenalty)
  const camoOnFire = Number.isFinite(firePenalty) && firePenalty > 0 ? camoStill * firePenalty : null

  const fwdBias =
    (hasConsumable('improvedAfterburning') ? Number(input.consumableScripts.improvedAfterburning?.params?.fwdSpeedLimitBias ?? 4) : 0) +
    (hasProvision('gearOil') ? 2 : 0) +
    (hasProvision('improvedGearOil') ? 4 : 0)
  const bkwdBias =
    (hasConsumable('improvedAfterburning') ? 8 : 0) +
    (hasProvision('gearOil') ? 2 : 0) +
    (hasProvision('improvedGearOil') ? 4 : 0)
  const maxFrontSpeed = (modules.speedLimits?.forward ?? 0) + fwdBias
  const maxBackSpeed = (modules.speedLimits?.backward ?? 0) + bkwdBias

  const turretCoeff = coeff([hasProvision('regular_fuel'), 0.03], [hasProvision('improved_fuel'), 0.1]) *
    (1 + gunnerProg)
  const turretRotationSpeed = (turret.stats?.rotationSpeed ?? 0) * turretCoeff *
    (1 + skill('close_combat_master') * skillRate('close_combat_master', 'turretRotationSpeedFactorPerLevel'))
  const gunRotationSpeed = Number(gun.stats?.rotationSpeed)
  const gunTraverseSpeed = Number.isFinite(gunRotationSpeed) && gunRotationSpeed > 0
    ? gunRotationSpeed * turretCoeff
    : null
  const hullCoeff = coeff(
    [has(116), 0.12],
    [hasConsumable('improvedAfterburning'), 0.05],
    [skill('virtuoso') > 0, skill('virtuoso') * skillRate('virtuoso', 'rotationSpeedFactorPerLevel')],
  )
  const stockEngine = modules.engines?.[0]
  const stockTrack = modules.chassis?.[0]
  const stockTurret = modules.turrets?.[0]
  const stockGun = stockTurret?.guns?.[0]
  const stockParts = componentWeights(stockEngine?.stats?.weight, stockTrack?.stats?.weight, stockTurret?.stats?.weight, stockGun?.stats?.weight)
  const stockWeightKg = sumWeights(stockParts)
  const stockEnginePower = input.stockEnginePower ?? stockEngine?.stats?.power ?? baseEnginePower
  const stockWeightRatio = stockWeightKg > 0 && weightKg > 0 ? stockWeightKg / weightKg : 1
  const stockPowerRatio = stockEnginePower > 0 ? baseEnginePower / stockEnginePower : 1
  const configuredTurn = (track.stats?.rotationSpeed ?? 0) * hullCoeff * stockPowerRatio
  const chassiRotationSpeed = configuredTurn * (1 + driverProg) * stockWeightRatio

  const resist = track.stats?.terrainResistance
  const grousers = has(123)
  const suspension = grousers ? [1.2, 1.15, 1.3] : [1, 1, 1]
  const [suspFirm, suspMedium, suspSoft] = suspension.map(bonus => (1 + driverDeg) / bonus)
  const rawFirm = (resist?.[0] ?? 0) * suspFirm
  const rawMedium = (resist?.[1] ?? 0) * suspMedium
  const rawSoft = (resist?.[2] ?? 0) * suspSoft

  const shell = input.standardShell
  const calibrated = has(103)
  const penCoeff = penetrationCoefficient(shell?.type, calibrated)
  const penetration = shell ? shell.penetration * penCoeff : null
  const tungstenFactor = (() => {
    if (!hasConsumable('tungstenTip')) return 1
    const params = input.consumableScripts?.tungstenTip?.params
    const min = Number(params?.minDamageFactor)
    const max = Number(params?.maxDamageFactor)
    return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0 ? (min + max) / 2 : 1
  })()
  const damage = shell ? shell.damage * tungstenFactor : null
  const clipDamage = isMagazine && cycle.shellCount > 0 && damage != null
    ? Math.round(damage * cycle.shellCount * 100) / 100
    : null
  const { dpm, shotsPerMinute, dpmEffective } = calculateGunDamageRate(
    cycle, reload, damage, !!shell, reloadCoeff, intraClip, intraClipFactor,
  )
  const shellVelocityFactor = 1 + (has(107) ? 0.35 : 0) + (hasProvision('gunPowder') ? 0.35 : 0)
  const shellVelocity = shell?.velocity != null ? shell.velocity * shellVelocityFactor : null
  const farPenetrationFalloffFactor = has(107) ? 0.4 : 1

  const armorFactor = Number(input.armorFactor) > 0 ? Number(input.armorFactor) : 1
  const armorValue = (v: number | null | undefined) => (v == null ? null : Math.round(v * armorFactor * 100) / 100)
  const armor = input.armor || null

  const fireChance = (engine.stats?.fireStartingChance ?? 0) * (hasProvision('safety_set') ? 0.8 : 1)
  const repairBase = Number(track.stats?.hysteresisHealth) > 0 && Number(track.stats?.healthRegenPerSec) > 0
    ? Number(track.stats.hysteresisHealth) / Number(track.stats.healthRegenPerSec)
    : null
  const repairSpeed = (has(113) ? 1.2 : 1) *
    (1 + skill('repair') * skillRate('repair', 'repairSpeedFactorPerLevel')) *
    (hasProvision('safety_set') ? 1.1 : 1)
  const chassisRepairTime = repairBase == null ? null : repairBase / repairSpeed

  const yaw = turret.stats?.yawLimits
  const yawLeft = Array.isArray(yaw) && yaw.length === 2 ? Math.abs(yaw[0]) : null
  const yawRight = Array.isArray(yaw) && yaw.length === 2 ? yaw[1] : null

  const pitch = gun.stats?.pitchLimits
  const defaultPitch = Number(modules.initialTurretRotation?.pitch) || 0
  const upperBuff = has(122) ? 4 : 0
  const lowerBuff = has(122) ? 3 : 0
  const pitchUp = pitch ? Math.abs(pitch.min) - defaultPitch + upperBuff : null
  const pitchDown = pitch ? pitch.max + defaultPitch + lowerBuff : null

  const dimensions = tankDimensions(modules, turret, track)

  const bfDriver = 0.57 + 0.43 * driverMastery
  const knownMass = (parts: unknown[]) => parts.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0)
  const mobility: Mobility = {
    mass: knownMass(massParts) && positive(weightT) ? weightT : null,
    power: enginePower,
    limit: positive(modules.speedLimits?.forward) ? maxFrontSpeed : null,
    permeability: { Firm: null, Medium: null, Soft: null },
    traverse: { Firm: null, Medium: null, Soft: null },
  }
  for (const [i, ground] of terrains.entries()) {
    const raw = resist?.[i]
    if (positive(raw)) mobility.permeability[ground] = 100 * bfDriver * suspension[i] / raw
  }
  const radioWeight = radio?.stats?.weight
  const turn = configuredTurn * bfDriver * (stockWeightKg - radioWeight) / (weightKg - radioWeight)
  for (const ground of terrains) {
    const c = mobility.permeability[ground]
    const medium = mobility.permeability.Medium
    if (positive(turn) && positive(c) && positive(medium) && positive(resist?.[0]) && positive(resist?.[1])
        && positive(stockEngine?.stats?.power) && positive(stockEnginePower) && positive(baseEnginePower) && positive(mobility.mass) && knownMass(stockParts)) {
      mobility.traverse[ground] = turn * resist[0] / resist[1] * c / medium
    }
  }
  return {
    _mobility: mobility,
    ...mobilityRows(mobility),
    maxHealth,
    hasTurret,
    weight: Math.round(weightT * 100) / 100,
    enginePower: Math.round(enginePower * 10) / 10,
    thrustToWeightRatio: weightT > 0 ? Math.round((enginePower / weightT) * 100) / 100 : null,
    chassisRepairTime: chassisRepairTime == null ? null : Math.round(chassisRepairTime * 1000) / 1000,
    gunShellReloadTime: isMagazine || reload == null ? null : Math.round(reload * 1000) / 1000,
    gunCommonDamagePerMin: dpm,
    gunEffectiveDamagePerMin: dpmEffective,
    gunClipDamage: clipDamage,
    gunShotsPerMinute: shotsPerMinute,
    gunClipShellCount: clipShellCount,
    gunClipBurstCount: burstGroupsPerClip,
    gunBurstShellCount: burstGroupSize > 0 ? burstGroupSize : null,
    gunClipBurstReloadTime: burstGroupInterval,
    gunClipShellReloadTime: clipShellReload,
    gunClipReloadTime: clipReload,
    timeBetweenPumpShots: cycle.type === 'autoreloader' && intraClip > 0 ? intraClip : null,
    reloadingShellTime0: pumpReloads[0] ?? null,
    reloadingShellTime1: pumpReloads[1] ?? null,
    reloadingShellTime2: pumpReloads[2] ?? null,
    reloadingShellTime3: pumpReloads[3] ?? null,
    reloadingShellTime4: pumpReloads[4] ?? null,
    reloadingShellTime5: pumpReloads[5] ?? null,
    turretYawLeftLimit: yawLeft,
    turretYawRightLimit: yawRight,
    baseShellAvgPiercingPower: penetration == null ? null : Math.round(penetration * 100) / 100,
    baseShellAvgDamage: damage,
    baseShellAvgSpeed: shellVelocity == null ? null : Math.round(shellVelocity),
    gunAimingTime: Math.round(aimTime * 1000) / 1000,
    gunShotDispersionRadius: Math.round(dispersion * 1000) / 1000,
    dispersionMoving,
    dispersionHullTraversing,
    dispersionTurretTraversing,
    dispersionShooting,
    dispersionGunDamaged,
    circularVisionRadius: Math.round(viewRange * 10) / 10,
    stillInvisibility: Math.round(camoStill * 10000) / 100,
    movingInvisibility: Math.round(camoMoving * 10000) / 100,
    shotInvisibility: Math.round(camoShot * 10000) / 100,
    movingShotInvisibility: camoShotMoving == null ? null : Math.round(camoShotMoving * 10000) / 100,
    fireInvisibility: camoOnFire == null ? null : Math.round(camoOnFire * 10000) / 100,
    maxFrontSpeed: Math.round(maxFrontSpeed * 100) / 100,
    maxBackSpeed: Math.round(maxBackSpeed * 100) / 100,
    chassiRotationSpeed: Math.round(chassiRotationSpeed * 1000) / 1000,
    turretRotationSpeed: Math.round(turretRotationSpeed * 1000) / 1000,
    gunTraverseSpeed: gunTraverseSpeed == null ? null : Math.round(gunTraverseSpeed * 1000) / 1000,
    terrainPermeabilityFirm: rawFirm > 0 ? Math.round((100 / rawFirm) * 10) / 10 : null,
    terrainPermeabilityMedium: rawMedium > 0 ? Math.round((100 / rawMedium) * 10) / 10 : null,
    terrainPermeabilitySoft: rawSoft > 0 ? Math.round((100 / rawSoft) * 10) / 10 : null,
    engineFireStartingChance: Math.round(fireChance * 10000) / 100,
    tankWidth: dimensions == null ? null : Math.round(dimensions.width * 100) / 100,
    tankLength: dimensions == null ? null : Math.round(dimensions.length * 100) / 100,
    tankHeight: dimensions == null ? null : Math.round(dimensions.height * 100) / 100,
    tankVolume: dimensions == null ? null : Math.round(dimensions.volume * 100) / 100,
    gunPitchUpLimit: pitchUp,
    gunPitchDownLimit: pitchDown,
    turretArmorFront: armorValue(armor?.turret?.front),
    turretArmorSide: armorValue(armor?.turret?.sides),
    turretArmorRear: armorValue(armor?.turret?.rear),
    hullArmorFront: armorValue(armor?.hull?.front),
    hullArmorSide: armorValue(armor?.hull?.sides),
    hullArmorRear: armorValue(armor?.hull?.rear),
    _damageCoeff: tungstenFactor,
    _shellVelocityFactor: shellVelocityFactor,
    _farPenetrationFalloffFactor: farPenetrationFalloffFactor,
    _weightKg: weightKg,
    _crewBonus: Math.round(crewBonus * 1000) / 1000,
    _susp: { firm: suspFirm, medium: suspMedium, soft: suspSoft },
  }
}
