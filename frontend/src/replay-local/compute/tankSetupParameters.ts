import { computeCharacteristics } from './characteristics'
import { baseSelection, buildComputeInput } from './tankSetupCore'
import type { SetupSelection } from './tankSetupTypes'


export interface ParamRow {
  key: string
  value: number | null
  base: number | null
  delta: number | null
  good: boolean | null
  digits: number
  unit: string | null
}

export interface ParamGroup {
  group: string
  rows: ParamRow[]
}

const PARAM_FORMAT_OVERRIDES: Record<string, any> = {
  dispersionMoving: { digits: 3, biggerIsBetter: false },
  dispersionHullTraversing: { digits: 3, biggerIsBetter: false },
  dispersionTurretTraversing: { digits: 3, biggerIsBetter: false },
  dispersionShooting: { digits: 3, biggerIsBetter: false },
  dispersionGunDamaged: { digits: 3, biggerIsBetter: false },
  movingShotInvisibility: { units: 'PERCENT', biggerIsBetter: true },
  fireInvisibility: { units: 'PERCENT', biggerIsBetter: true },
  gunClipDamage: { digits: 0, biggerIsBetter: true },
  gunEffectiveDamagePerMin: { digits: 0, biggerIsBetter: true },
  effectivePowerFirm: { digits: 2, units: 'HORSE_POWER_PER_TON', biggerIsBetter: true },
  effectiveTraverseFirm: { digits: 2, units: 'DEGREE_PER_SECOND', biggerIsBetter: true },
  effectivePowerMedium: { digits: 2, units: 'HORSE_POWER_PER_TON', biggerIsBetter: true },
  effectiveTraverseMedium: { digits: 2, units: 'DEGREE_PER_SECOND', biggerIsBetter: true },
  effectivePowerSoft: { digits: 2, units: 'HORSE_POWER_PER_TON', biggerIsBetter: true },
  effectiveTraverseSoft: { digits: 2, units: 'DEGREE_PER_SECOND', biggerIsBetter: true },
  gunTraverseSpeed: { digits: 2, units: 'DEGREE_PER_SECOND', biggerIsBetter: true },
  tankWidth: { digits: 2, units: 'METER', biggerIsBetter: false },
  tankLength: { digits: 2, units: 'METER', biggerIsBetter: false },
  tankHeight: { digits: 2, units: 'METER', biggerIsBetter: false },
  tankVolume: { digits: 2, units: 'CUBIC_METER', biggerIsBetter: false },
  gunAimingTime: { units: 'SECOND' },
  gunShellReloadTime: { units: 'SECOND' },
  gunClipReloadTime: { units: 'SECOND' },
  gunClipShellReloadTime: { units: 'SECOND' },
  gunClipBurstReloadTime: { units: 'SECOND' },
  gunCommonReloadTime: { units: 'SECOND' },
  timeBetweenPumpShots: { units: 'SECOND' },
  reloadingShellTime0: { units: 'SECOND' },
  reloadingShellTime1: { units: 'SECOND' },
  reloadingShellTime2: { units: 'SECOND' },
  reloadingShellTime3: { units: 'SECOND' },
  reloadingShellTime4: { units: 'SECOND' },
  reloadingShellTime5: { units: 'SECOND' },
  circularVisionRadius: { units: 'METER' },
  gunShotDispersionRadius: { units: 'METER' },
}

const PARAM_GROUP_ORDER = ['protectability', 'mobility', 'gun']

const PARAM_ROWS: Array<{ group: string; key: string }> = [
  { group: 'protectability', key: 'maxHealth' },
  { group: 'protectability', key: 'engineFireStartingChance' },
  { group: 'protectability', key: 'chassisRepairTime' },
  { group: 'protectability', key: 'circularVisionRadius' },
  { group: 'protectability', key: 'stillInvisibility' },
  { group: 'protectability', key: 'movingInvisibility' },
  { group: 'protectability', key: 'shotInvisibility' },
  { group: 'protectability', key: 'movingShotInvisibility' },
  { group: 'protectability', key: 'fireInvisibility' },
  { group: 'protectability', key: 'tankLength' },
  { group: 'protectability', key: 'tankWidth' },
  { group: 'protectability', key: 'tankHeight' },
  { group: 'protectability', key: 'tankVolume' },
  { group: 'gun', key: 'gunCommonDamagePerMin' },
  { group: 'gun', key: 'gunEffectiveDamagePerMin' },
  { group: 'gun', key: 'gunShellReloadTime' },
  { group: 'gun', key: 'gunClipReloadTime' },
  { group: 'gun', key: 'gunClipShellCount' },
  { group: 'gun', key: 'gunClipBurstCount' },
  { group: 'gun', key: 'gunBurstShellCount' },
  { group: 'gun', key: 'gunClipShellReloadTime' },
  { group: 'gun', key: 'timeBetweenPumpShots' },
  { group: 'gun', key: 'gunClipBurstReloadTime' },
  { group: 'gun', key: 'reloadingShellTime0' },
  { group: 'gun', key: 'reloadingShellTime1' },
  { group: 'gun', key: 'reloadingShellTime2' },
  { group: 'gun', key: 'reloadingShellTime3' },
  { group: 'gun', key: 'reloadingShellTime4' },
  { group: 'gun', key: 'reloadingShellTime5' },
  { group: 'gun', key: 'gunClipDamage' },
  { group: 'gun', key: 'gunAimingTime' },
  { group: 'gun', key: 'gunShotDispersionRadius' },
  { group: 'gun', key: 'dispersionMoving' },
  { group: 'gun', key: 'dispersionHullTraversing' },
  { group: 'gun', key: 'dispersionTurretTraversing' },
  { group: 'gun', key: 'dispersionShooting' },
  { group: 'gun', key: 'dispersionGunDamaged' },
  { group: 'gun', key: 'gunPitchUpLimit' },
  { group: 'gun', key: 'gunPitchDownLimit' },
  { group: 'gun', key: 'turretYawLeftLimit' },
  { group: 'gun', key: 'turretYawRightLimit' },
  { group: 'mobility', key: 'maxFrontSpeed' },
  { group: 'mobility', key: 'maxBackSpeed' },
  { group: 'mobility', key: 'weight' },
  { group: 'mobility', key: 'thrustToWeightRatio' },
  { group: 'mobility', key: 'effectivePowerFirm' },
  { group: 'mobility', key: 'effectivePowerMedium' },
  { group: 'mobility', key: 'effectivePowerSoft' },
  { group: 'mobility', key: 'effectiveTraverseFirm' },
  { group: 'mobility', key: 'effectiveTraverseMedium' },
  { group: 'mobility', key: 'effectiveTraverseSoft' },
  { group: 'mobility', key: 'enginePower' },
  { group: 'mobility', key: 'turretRotationSpeed' },
  { group: 'mobility', key: 'gunTraverseSpeed' },
  { group: 'mobility', key: 'chassiRotationSpeed' },
  { group: 'mobility', key: 'terrainPermeabilityFirm' },
  { group: 'mobility', key: 'terrainPermeabilityMedium' },
  { group: 'mobility', key: 'terrainPermeabilitySoft' },
]

export const ARMOR_ROWS = ['front', 'side', 'rear'] as const

function roundDigits(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function paramDeltaGood(delta: number | null, biggerIsBetter = true): boolean | null {
  if (delta == null || delta === 0 || !Number.isFinite(delta)) return null
  return biggerIsBetter ? delta > 0 : delta < 0
}

export function paramGroups(current: Record<string, any>, base: Record<string, any>, format: any): ParamGroup[] {
  const groups: ParamGroup[] = []
  const byGroup = new Map<string, ParamRow[]>()
  const swapTraverse = current?.hasTurret === false && typeof current?.gunTraverseSpeed === 'number'
  for (const spec of PARAM_ROWS) {
    if (spec.key === 'turretRotationSpeed' && swapTraverse) continue
    if (spec.key === 'gunTraverseSpeed' && !swapTraverse) continue
    const value = current?.[spec.key]
    if (value == null || typeof value !== 'number') continue
    const override = PARAM_FORMAT_OVERRIDES[spec.key] || {}
    const fmt = format?.[spec.key] ? { ...override, ...format[spec.key] } : override
    const digits = Number.isInteger(fmt.digits) ? fmt.digits : (fmt.units === 'PERCENT' ? 1 : 0)
    const baseValue = base?.[spec.key]
    const delta = typeof baseValue === 'number' ? roundDigits(value - baseValue, digits) : null
    const biggerIsBetter = fmt.biggerIsBetter !== false
    const good = paramDeltaGood(delta, biggerIsBetter)
    const row: ParamRow = {
      key: spec.key,
      value,
      base: typeof baseValue === 'number' ? baseValue : null,
      delta,
      good,
      digits,
      unit: fmt.units || null,
    }
    if (!byGroup.has(spec.group)) {
      byGroup.set(spec.group, [])
      groups.push({ group: spec.group, rows: byGroup.get(spec.group)! })
    }
    byGroup.get(spec.group)!.push(row)
  }
  return groups.sort((a, b) => PARAM_GROUP_ORDER.indexOf(a.group) - PARAM_GROUP_ORDER.indexOf(b.group))
}

export function computeSetupPair({ detail, modules, selection, catalog }: {
  detail: any
  modules: any
  selection: SetupSelection
  catalog: any
}) {
  const current = computeCharacteristics(buildComputeInput({ detail, modules, selection, catalog }))
  const baseSel = baseSelection({ detail, modules })
  const base = baseSel
    ? computeCharacteristics(buildComputeInput({ detail, modules, selection: baseSel, catalog }))
    : {}
  return { current, base }
}

export interface ArmorCell {
  value: number | null
  delta: number | null
  good: boolean | null
}

export function armorRows(current: Record<string, any>, base: Record<string, any>) {
  const cell = (key: string): ArmorCell => {
    const value = current?.[key]
    if (value == null || typeof value !== 'number') return { value: null, delta: null, good: null }
    const baseValue = base?.[key]
    const delta = typeof baseValue === 'number' ? Math.round((value - baseValue) * 100) / 100 : null
    return { value, delta, good: paramDeltaGood(delta) }
  }
  const cap = (part: string) => part[0].toUpperCase() + part.slice(1)
  return (['front', 'side', 'rear'] as const).map(part => ({
    part,
    turret: cell(`turretArmor${cap(part)}`),
    hull: cell(`hullArmor${cap(part)}`),
  }))
}
