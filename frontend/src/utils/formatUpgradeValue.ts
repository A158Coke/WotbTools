import { fmtNum } from '../scene/tankMeta'
import { HIT_TRIGGER_ATTRIBUTES } from '../replay-local/compute/tankUpgrades'

type Translate = (key: string, params?: Record<string, string>) => string

// Units for XI values in the client hangar and the vehicle's upgrade attributes.
const units: Record<string, string> = {
  AUXILLIARY_WEAPONS_GUN_RELOAD_TIME: 'SECOND',
  AUXILLIARY_WEAPONS_GUN_BURST_INTERVAL: 'SECOND',
  AUXILLIARY_WEAPONS_GUN_DAMAGE: 'HIT_POINTS',
  EXTERNAL_AMMO_MODULE_GUN_IN_CLIP_RELOAD_TIME: 'SECOND',
  SHELL_OVERHEAT_MAX_TANK_SPEED: 'KILOMETER_PER_HOUR',
  SHELL_OVERHEAT_CHARGE_TIME: 'SECOND',
  SHELL_OVERHEAT_ACTIVATION_DELAY: 'SECOND',
  UNGUIDED_ROCKET_ACCELERATION: 'METER_PER_SECOND_SQUARED',
  UNGUIDED_ROCKET_INITIAL_SPEED: 'METER_PER_SECOND',
  UNGUIDED_ROCKET_DAMAGE: 'HIT_POINTS',
  UNGUIDED_ROCKET_INTERCLIP_RELOAD: 'SECOND',
  UNGUIDED_ROCKET_CONTAINER_RELOAD: 'SECOND',
  ATTRIBUTE_NAME_BACKWARD_MAX_SPEED: 'KILOMETER_PER_HOUR',
}
const percentAttributes = new Set([
  'COMBAT_FRENZY_RELOAD_SPEED_BONUS_PER_STACK', 'SAS_AIMING_SPEED', 'SAS_GUN_DISPERSION',
  'ATTRIBUTE_NAME_FIRE_START_CHANCE', 'SHELL_OVERHEAT_MIN_ALPHA_BOOST',
])

export function formatUpgradeValue(
  t: Translate, name: string, value: number | boolean | null, modifier?: string,
): string {
  if (value == null) return '—'
  if (typeof value === 'boolean') {
    // 命中触发二态属性走共享枚举（SSOT = tankUpgrades.ts），新增属性名只改一处。
    if (HIT_TRIGGER_ATTRIBUTES.has(name)) {
      return t(`agentTanks.configurator.upgrade_trigger_${value ? 'hit' : 'damage'}`)
    }
    const key = name === 'COMBAT_FRENZY_ALLOW_SWITCH_AFTER_KILL' ? (value ? 'yes' : 'no') : (value ? 'enabled' : 'disabled')
    return t(`agentTanks.configurator.upgrade_${key}`)
  }
  if (modifier === 'MODIFIER_MULTIPLY') return `×${fmtNum(value, 3)}`
  const sign = modifier && value > 0 ? '+' : ''
  const percent = `${sign}${fmtNum(value * 100, 3)}`
  if (percentAttributes.has(name)) {
    return modifier ? t('agentTanks.configurator.upgrade_percentage_points', { value: percent }) : `${percent}%`
  }
  if (name === 'ATTRIBUTE_NAME_TURRET_ROTATION_SPEED_FACTOR_BONUS') return `${percent}%`
  const unit = /^ATTRIBUTE_NAME_SHELL_PIERCING_POWER_(100|500)_SLOT_[123]$/.test(name) ? 'MILLIMETER' : units[name]
  const number = `${sign}${fmtNum(value, 3)}`
  return unit ? `${number} ${t(`agentTanks.units.${unit}`)}` : number
}
