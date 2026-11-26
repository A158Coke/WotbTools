import type { UpgradeDefinition, UpgradeSelection, UpgradeValue } from './tankUpgradeTypes'
import { child, finite, record, records, type Data } from './tankUpgradeData'

export const HIT_TRIGGER_ATTRIBUTES = new Set([
  'SAS_ALLOW_ACTIVATE_ON_HIT',
  'EXTERNAL_AMMO_MODULE_ALLOW_NON_DAMAGING_HITS',
])

function shotInterval(clip: unknown): number | null {
  if (!record(clip) || !finite(clip.count) || !Number.isInteger(clip.count) || clip.count < 2
    || !finite(clip.rate) || clip.rate <= 0) return null
  const seconds = 60 / clip.rate
  return finite(seconds) ? seconds : null
}

function mainGunClip(modules: Data): Data | undefined {
  const guns = records(modules.turrets).flatMap(turret => records(turret.guns))
  return guns.length === 1 ? child(child(guns[0], 'stats'), 'clip') : undefined
}

type MechanicParameter = string | ((item: Data, modules: Data) => number | null)

function boundAuxiliaryGun(item: Data): Data | undefined {
  const reference = child(child(item, 'script'), 'params')?.gun
  const gun = child(item, 'auxiliaryGun')
  return typeof reference === 'string' && reference.trim() && gun?.reference === reference ? gun : undefined
}

function auxiliaryValue(field: 'reloadTime' | 'clip' | 'burst' | 'damage' | 'speed' | 'acceleration'): MechanicParameter {
  return item => {
    const gun = boundAuxiliaryGun(item)
    if (!gun) return null
    if (field === 'clip' || field === 'burst') return shotInterval(gun[field])
    if (field === 'reloadTime') return finite(gun.reloadTime) ? gun.reloadTime : null
    if (!Array.isArray(gun.shots) || gun.shots.length !== 1) return null
    const shot = gun.shots[0]
    if (!record(shot) || typeof shot.stem !== 'string' || !shot.stem.trim()) return null
    return finite(shot[field]) ? shot[field] : null
  }
}

const MECHANIC_PARAMETERS: Record<string, [string, string, MechanicParameter]> = {
  EXTERNAL_AMMO_MODULE_GUN_IN_CLIP_RELOAD_TIME: ['provisions', 'externalAmmoModule', (_item, modules) => shotInterval(mainGunClip(modules))],
  EXTERNAL_AMMO_MODULE_ALLOW_NON_DAMAGING_HITS: ['provisions', 'externalAmmoModule', 'allowNonDamagingHits'],
  SHELL_OVERHEAT_ACTIVATION_DELAY: ['provisions', 'shellOverheat', 'chargeActivationDelay'],
  SHELL_OVERHEAT_CHARGE_TIME: ['provisions', 'shellOverheat', 'maxChargeAccumulationTimeFromStart'],
  SHELL_OVERHEAT_MAX_TANK_SPEED: ['provisions', 'shellOverheat', 'maxSpeedForChargeAccumulation'],
  SHELL_OVERHEAT_MIN_ALPHA_BOOST: ['provisions', 'shellOverheat', 'maxBoostToMinimumAlpha'],
  AUXILLIARY_WEAPONS_GUN_BURST_INTERVAL: ['consumables', 'auxilliaryWeapons', auxiliaryValue('burst')],
  AUXILLIARY_WEAPONS_GUN_DAMAGE: ['consumables', 'auxilliaryWeapons', auxiliaryValue('damage')],
  AUXILLIARY_WEAPONS_GUN_RELOAD_TIME: ['consumables', 'auxilliaryWeapons', auxiliaryValue('reloadTime')],
  UNGUIDED_ROCKET_ACCELERATION: ['consumables', 'unguidedRocket', auxiliaryValue('acceleration')],
  UNGUIDED_ROCKET_CONTAINER_RELOAD: ['consumables', 'unguidedRocket', auxiliaryValue('reloadTime')],
  UNGUIDED_ROCKET_DAMAGE: ['consumables', 'unguidedRocket', auxiliaryValue('damage')],
  UNGUIDED_ROCKET_INITIAL_SPEED: ['consumables', 'unguidedRocket', auxiliaryValue('speed')],
  UNGUIDED_ROCKET_INTERCLIP_RELOAD: ['consumables', 'unguidedRocket', auxiliaryValue('clip')],
  BURST_MODE_REQUIRED_PENETRATIONS: ['provisions', 'burstMode', 'requiredDamagingPenetrations'],
  BURST_MODE_INTERVAL: ['provisions', 'burstMode', 'burstInterval'],
  BURST_MODE_TARGET_ORDER: ['provisions', 'burstMode', 'targetOrder'],
  COMBAT_FRENZY_RELOAD_SPEED_BONUS_PER_STACK: ['provisions', 'combatFrenzy', 'reloadSpeedBonusPerStack'],
  COMBAT_FRENZY_MAX_STACKS: ['provisions', 'combatFrenzy', 'maxStacks'],
  COMBAT_FRENZY_ALLOW_SWITCH_AFTER_KILL: ['provisions', 'combatFrenzy', 'allowSwitchAfterKill'],
  RAMMING_CONFIGURATION_RAMMING_DAMAGE_BONUS: ['provisions', 'rammingConfiguration', 'rammingDamageBonus'],
  RAMMING_CONFIGURATION_RAMMING_TRACK_DAMAGE_BONUS: ['provisions', 'rammingConfiguration', 'rammingTrackDamageBonus'],
  RAMMING_CONFIGURATION_RAMMING_DAMAGE_REDUCTION: ['provisions', 'rammingConfiguration', 'rammingDamageReduction'],
  SAS_DURATION: ['provisions', 'steadyAimSystem', 'duration'],
  SAS_AIMING_SPEED: ['provisions', 'steadyAimSystem', 'aimingSpeed'],
  SAS_GUN_DISPERSION: ['provisions', 'steadyAimSystem', 'gunDispersionModifier'],
  SAS_ALLOW_ACTIVATE_ON_HIT: ['provisions', 'steadyAimSystem', 'activateWithoutDamage'],
  RECHARGEABLE_NITRO_COOLING_DURATION: ['consumables', 'rechargeableNitro', 'coolingDuration'],
  RECHARGEABLE_NITRO_HEATING_DURATION: ['consumables', 'rechargeableNitro', 'duration'],
  RECHARGEABLE_NITRO_FWD_SPEED_LIMIT_FACTOR: ['consumables', 'rechargeableNitro', 'fwdSpeedLimitFactor'],
  RECHARGEABLE_NITRO_ROTATION_SPEED_FACTOR: ['consumables', 'rechargeableNitro', 'rotationSpeedFactor'],
}

export function boundAbility(modules: unknown, catalog: unknown, kind: string, ability: string): Data | undefined {
  if (!record(modules) || !record(catalog) || typeof modules.gameVersion !== 'string' || !modules.gameVersion
    || catalog[`${kind}GameVersion`] !== modules.gameVersion
    || !Array.isArray(modules.vehicleAbilities) || !modules.vehicleAbilities.includes(ability)) return undefined
  return records(catalog[kind]).find(item => item.stem === ability && item.isAbility === true)
}

function mechanicInitial(name: string, modifier: UpgradeDefinition['modifier'], modules: unknown, catalog: unknown): UpgradeValue | null {
  const mapping = MECHANIC_PARAMETERS[name]
  if (!mapping || !record(modules)) return null
  const [kind, ability, parameter] = mapping
  const item = boundAbility(modules, catalog, kind, ability)
  if (!item) return null
  const raw = typeof parameter === 'function' ? parameter(item, modules) : child(child(item, 'script'), 'params')?.[parameter]
  if (modifier === 'MODIFIER_BOOLEAN') {
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'string' && /^(true|false)$/i.test(raw.trim())) return raw.trim().toLowerCase() === 'true'
    return null
  }
  if (finite(raw)) return raw
  return typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null
}

export function upgradeMechanicEffects(selection: UpgradeSelection, modules?: unknown, catalog?: unknown): Array<{
  name: string; modifier: UpgradeDefinition['modifier']; current: UpgradeValue | null
  initial: UpgradeValue | null; value: UpgradeValue | null
}> {
  if (!selection.available || !selection.supported) return []
  const names = new Set(selection.nodes.flatMap(node => node.attributes
    .filter(attr => !selection.attributeDefinitions[attr.name]?.script).map(attr => attr.name)))
  return [...names].map(name => {
    const modifier = selection.attributeDefinitions[name]!.modifier
    const current = selection.mechanicsAttributes[name] ?? null
    const initial = mechanicInitial(name, modifier, modules, catalog)
    const value = initial == null ? null : current == null ? initial
      : modifier === 'MODIFIER_BOOLEAN' ? current
        : modifier === 'MODIFIER_MULTIPLY' ? Number(initial) * Number(current) : Number(initial) + Number(current)
    return { name, modifier, current, initial, value }
  })
}

type MechanicRow = {
  name: string; initial: UpgradeValue | null; value: UpgradeValue | null
  current?: UpgradeValue | null; modifier?: UpgradeDefinition['modifier']
}

function baseRow(name: string, raw: unknown): MechanicRow {
  const value = finite(raw) ? raw : null
  return { name, initial: value, value }
}

export function mechanicParameterGroups(selection: UpgradeSelection, modules: unknown, catalog: unknown) {
  const effects = upgradeMechanicEffects(selection, modules, catalog)
  const groups: { label?: string; index?: number; rows: MechanicRow[] }[] = []
  if (!selection.available || !selection.supported || !record(modules)) return groups
  const remaining = new Map(effects.map(effect => [effect.name, effect]))
  for (const ability of ['auxilliaryWeapons', 'unguidedRocket']) {
    const item = boundAbility(modules, catalog, 'consumables', ability)
    if (!item) continue
    const gun = boundAuxiliaryGun(item)
    const rocket = ability === 'unguidedRocket'
    const damage = rocket ? 'UNGUIDED_ROCKET_DAMAGE' : 'AUXILLIARY_WEAPONS_GUN_DAMAGE'
    const interval = rocket ? 'UNGUIDED_ROCKET_INTERCLIP_RELOAD' : 'AUXILLIARY_WEAPONS_GUN_BURST_INTERVAL'
    const reload = rocket ? 'UNGUIDED_ROCKET_CONTAINER_RELOAD' : 'AUXILLIARY_WEAPONS_GUN_RELOAD_TIME'
    const shots = records(gun?.shots).filter(shot => typeof shot.stem === 'string' && shot.stem.trim())
    const unique = shots.length === 1 && Array.isArray(gun?.shots) && gun.shots.length === 1
    const take = (name: string, raw: unknown, applicable = true): MechanicRow => {
      const effect = applicable ? remaining.get(name) : undefined
      if (effect) remaining.delete(name)
      return effect ?? baseRow(name, raw)
    }
    for (const [index, shot] of (shots.length ? shots : [{} as Data]).entries()) {
      const rows = [baseRow('AUX_SHELL_TYPE', shot.type_id), baseRow('AUX_PENETRATION', shot.penetration)]
      if (finite(shot.penetration_far) && shot.penetration_far !== shot.penetration)
        rows.push(baseRow('AUX_PENETRATION_FAR', shot.penetration_far))
      rows.push(take(damage, shot.damage, unique || !shots.length))
      rows.push(rocket ? take('UNGUIDED_ROCKET_INITIAL_SPEED', shot.speed, unique || !shots.length) : baseRow('AUX_SPEED', shot.speed))
      if (rocket) rows.push(take('UNGUIDED_ROCKET_ACCELERATION', shot.acceleration, unique || !shots.length), baseRow('AUX_MAX_SPEED', shot.maxSpeed))
      rows.push(baseRow('AUX_RANGE', shot.maxDistance))
      groups.push({ label: 'mechanic_ammunition', index: shots.length > 1 ? index + 1 : undefined, rows })
    }
    const seq = child(gun, rocket ? 'clip' : 'burst')
    groups.push({ label: 'mechanic_firing', rows: [baseRow('AUX_COUNT', seq?.count),
      take(interval, shotInterval(seq)), take(reload, gun?.reloadTime)] })
  }
  const ammo = boundAbility(modules, catalog, 'provisions', 'externalAmmoModule')
  const rows: MechanicRow[] = [...remaining.values()]
  if (ammo) {
    const count = mainGunClip(modules)?.count
    const bonus = child(child(ammo, 'script'), 'params')?.clipSizeBonus
    const extra = finite(bonus) ? bonus : typeof bonus === 'string' && bonus.trim() ? Number(bonus) : NaN
    rows.push(baseRow('CLIP_CAPACITY', count), baseRow('ENHANCED_CLIP_CAPACITY',
      finite(count) && Number.isInteger(extra) ? count + extra : null))
  }
  if (rows.length) groups.push({ rows })
  return groups
}
