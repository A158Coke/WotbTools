import { paramDeltaGood } from '../../replay-local/compute/tankSetupParameters.js'
import { tankNationLabel, tankTypeLabel } from '../../scene/tankMeta.js'
import { romanLevel } from '../../utils/tierFormat.js'
import type { Exists, Translate } from './versionDiffFormat.js'

export function fmtDiffValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    if (Number.isInteger(value)) return String(value)
    const rounded = Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2)
    return rounded.replace(/\.?0+$/, '')
  }
  if (typeof value === 'boolean') return value ? '✓' : '—'
  if (Array.isArray(value) || typeof value === 'object') {
    const text = JSON.stringify(value)
    return text.length > 140 ? `${text.slice(0, 137)}…` : text
  }
  return String(value)
}

export function deltaDiffValue(oldValue: unknown, newValue: unknown): string {
  if (typeof oldValue !== 'number' || typeof newValue !== 'number') return ''
  const delta = newValue - oldValue
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return ''
  const text = Number.isInteger(delta) ? String(delta) : delta.toFixed(2).replace(/\.?0+$/, '')
  return delta > 0 ? `+${text}` : text
}


type DiffMeasurement = { unit: string; scale?: number; digits?: number }

const hitPoints = { unit: 'HIT_POINTS' }
const millimeters = { unit: 'MILLIMETER' }
const seconds = { unit: 'SECOND', digits: 3 }
const degrees = { unit: 'DEGREE' }
const traverse = { unit: 'DEGREE_PER_SECOND' }
const speed = { unit: 'KILOMETER_PER_HOUR' }
const length = { unit: 'METER', digits: 3 }
const power = { unit: 'HORSE_POWER' }
const mass = { unit: 'TON', scale: 1 / 1000, digits: 3 }
const fraction = { unit: 'PERCENT', scale: 100, digits: 3 }

const TANK_MEASUREMENTS: Record<string, DiffMeasurement> = {
  hp: hitPoints, hull_hp: hitPoints, turret_health: hitPoints, standard_damage: hitPoints,
  speed_forward: speed, speed_reverse: speed,
  hull_traverse: traverse, turret_traverse_speed: traverse,
  view_range: length, dispersion: length,
  gun_depression: degrees, gun_elevation: degrees,
  reload_time: seconds, aim_time: seconds, burst_interval: seconds, burst_group_interval: seconds,
  caliber: millimeters, gun_thickness: millimeters,
  weight: mass, turret_weight: mass,
}

const SHELL_MEASUREMENTS: Record<string, DiffMeasurement> = {
  penetration: millimeters, penetration_top: millimeters, penetration_far: millimeters,
  damage: hitPoints, damage_top: hitPoints, module_damage: hitPoints,
  caliber: millimeters, normalization: degrees, ricochet: degrees,
  velocity: { unit: 'METER_PER_SECOND' }, explosion_radius: length, range: length,
}

const RESEARCH_MEASUREMENTS: Record<string, DiffMeasurement> = {
  reloadTime: seconds, aimingTime: seconds, power, maxHealth: hitPoints, rotationSpeed: traverse,
  weight: mass, fireStartingChance: fraction, circularVisionRadius: length,
}

export const PITCH_LEAF = /^(?:(front|back)\.)?(min|max|range)$/

function pitchField(field: string) {
  return PITCH_LEAF.exec(field)?.[2]
}

function pitchPathField(path: string) {
  if (path.startsWith('pitch_limits.')) return path.slice('pitch_limits.'.length)
  return /^research\.gun:.+?\.stats\.pitchLimits\.(.+)$/.exec(path)?.[1]
}

function measurementForPath(path: string): DiffMeasurement | undefined {
  const pitch = pitchPathField(path)
  if (pitch) {
    const edge = pitchField(pitch)
    if (edge === 'min') return { ...degrees, scale: -1 }
    if (edge === 'max' || pitch === 'front.range' || pitch === 'back.range' || pitch === 'transition') return degrees
  }
  if (/^armor\.(hull|turret)\.(front|sides|rear)$/.test(path)) return millimeters
  const shell = /^shells\.[^.]+\.([^.]+)$/.exec(path)
  if (shell) return Object.hasOwn(SHELL_MEASUREMENTS, shell[1]) ? SHELL_MEASUREMENTS[shell[1]] : undefined
  const engine = /^engines\..+\.(power|fire_chance)$/.exec(path)
  if (engine) return engine[1] === 'power' ? power : fraction
  const research = /^research\.(?:module|gun|turret):.+\.stats\.([^.]+)$/.exec(path)
  if (research) return Object.hasOwn(RESEARCH_MEASUREMENTS, research[1]) ? RESEARCH_MEASUREMENTS[research[1]] : undefined
  if (path === 'research.hull.weight') return mass
  if (path === 'research.hull.hp') return hitPoints
  if (/^research\.invisibility\.(still|moving|firePenalty)$/.test(path)) return fraction
  if (/^research\.speedLimits\.(forward|backward)$/.test(path)) return speed
  return Object.hasOwn(TANK_MEASUREMENTS, path) ? TANK_MEASUREMENTS[path] : undefined
}

const TANK_PARAM_KEYS: Readonly<Record<string, string>> = {
  hp: 'maxHealth', hull_hp: 'maxHealth', turret_health: 'maxHealth',
  speed_forward: 'maxFrontSpeed', speed_reverse: 'maxBackSpeed',
  hull_traverse: 'chassiRotationSpeed', turret_traverse_speed: 'turretRotationSpeed',
  view_range: 'circularVisionRadius', weight: 'weight', turret_weight: 'weight',
  gun_depression: 'gunPitchDownLimit', gun_elevation: 'gunPitchUpLimit',
  reload_time: 'gunShellReloadTime', aim_time: 'gunAimingTime',
  dispersion: 'gunShotDispersionRadius', dpm: 'gunCommonDamagePerMin',
  standard_damage: 'baseShellAvgDamage', burst_interval: 'gunClipBurstReloadTime',
  burst_group_interval: 'gunClipShellReloadTime', burst_size: 'gunBurstShellCount',
  burst_group_count: 'gunClipBurstCount', clip: 'gunClipShellCount',
  'research.hull.hp': 'maxHealth', 'research.hull.weight': 'weight',
  'research.invisibility.still': 'stillInvisibility', 'research.invisibility.moving': 'movingInvisibility',
  'research.speedLimits.forward': 'maxFrontSpeed', 'research.speedLimits.backward': 'maxBackSpeed',
}

const SHELL_PARAM_KEYS: Readonly<Record<string, string>> = {
  penetration: 'baseShellAvgPiercingPower', penetration_far: 'baseShellAvgPiercingPower',
  penetration_top: 'baseShellAvgPiercingPower', damage: 'baseShellAvgDamage',
  damage_top: 'baseShellAvgDamage', velocity: 'baseShellAvgSpeed',
}

const RESEARCH_PARAM_KEYS: Readonly<Record<string, string>> = {
  reloadTime: 'gunShellReloadTime', aimingTime: 'gunAimingTime', power: 'enginePower',
  maxHealth: 'maxHealth', rotationSpeed: 'turretRotationSpeed', weight: 'weight',
  fireStartingChance: 'engineFireStartingChance', circularVisionRadius: 'circularVisionRadius',
}

function encyclopediaParamKey(path: string) {
  if (Object.hasOwn(TANK_PARAM_KEYS, path)) return TANK_PARAM_KEYS[path]
  const pitch = pitchPathField(path)
  if (pitchField(pitch ?? '') === 'min') return 'gunPitchUpLimit'
  if (pitchField(pitch ?? '') === 'max') return 'gunPitchDownLimit'
  const shell = /^shells\.[^.]+\.([^.]+)$/.exec(path)
  if (shell && Object.hasOwn(SHELL_PARAM_KEYS, shell[1])) return SHELL_PARAM_KEYS[shell[1]]
  if (/^engines\..+\.power$/.test(path)) return 'enginePower'
  if (/^engines\..+\.fire_chance$/.test(path)) return 'engineFireStartingChance'
  const research = /^research\.(?:module|gun|turret):.+\.stats\.([^.]+)$/.exec(path)
  if (research && Object.hasOwn(RESEARCH_PARAM_KEYS, research[1])) return RESEARCH_PARAM_KEYS[research[1]]
  return undefined
}

function diffDeltaGood(path: string, amount: number | null, format: Record<string, unknown> | null) {
  const key = encyclopediaParamKey(path)
  const entry = key && format && Object.hasOwn(format, key) ? format[key] : null
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const direction = 'biggerIsBetter' in entry ? entry.biggerIsBetter : undefined
  if (direction !== undefined && typeof direction !== 'boolean') return null
  return paramDeltaGood(amount, direction)
}

const VEHICLE_CATEGORY_LABELS = {
  premium: 'versionDiff.fields.isPremium',
  collector: 'versionDiff.fields.isCollector',
  regular: 'versionDiff.fields.regularVehicle',
} as const

function vehicleValue(path: string, value: unknown, t: Translate, te: Exists) {
  if (path === 'tier' && typeof value === 'number') return romanLevel(value) || fmtDiffValue(value)
  if (typeof value !== 'string') return fmtDiffValue(value)
  if (path === 'type') return tankTypeLabel(t, te, value)
  if (path === 'nation') return tankNationLabel(t, te, value)
  if (path === 'vehicle_category' && Object.hasOwn(VEHICLE_CATEGORY_LABELS, value)) {
    return t(VEHICLE_CATEGORY_LABELS[value as keyof typeof VEHICLE_CATEGORY_LABELS])
  }
  return value
}

export function diffStatValues(path: string, oldValue: unknown, newValue: unknown, t: Translate, paramFormat: Record<string, unknown> | null = null, te: Exists = () => false) {
  if (['vehicle_category', 'tier', 'type', 'nation'].includes(path)) {
    return { old: vehicleValue(path, oldValue, t, te), new: vehicleValue(path, newValue, t, te), delta: '', unit: '', good: null }
  }
  const spec = measurementForPath(path)
  const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  const rawDelta = numeric(oldValue) && numeric(newValue) ? newValue - oldValue : null
  if (!spec || !(numeric(oldValue) || numeric(newValue))) {
    const delta = deltaDiffValue(oldValue, newValue)
    const good = delta ? diffDeltaGood(path, rawDelta, paramFormat) : null
    return { old: fmtDiffValue(oldValue), new: fmtDiffValue(newValue), delta, unit: '', good }
  }
  const scale = spec.scale ?? 1
  const digits = spec.digits ?? 2
  const format = (value: number) => String(Number(value.toFixed(digits)))
  const display = (value: unknown) => numeric(value) ? format(value * scale) : fmtDiffValue(value)
  const amount = rawDelta === null ? null : Number((rawDelta * scale).toFixed(digits))
  let delta = amount ? (amount > 0 ? '+' : '') + format(amount) : ''
  if (delta && spec.unit === 'PERCENT') delta = t('agentTanks.configurator.upgrade_percentage_points', { value: delta })
  const good = diffDeltaGood(path, amount, paramFormat)
  return { old: display(oldValue), new: display(newValue), delta, unit: t('agentTanks.units.' + spec.unit), good }
}
