import type { UpgradeSelection } from './tankUpgradeTypes'
import { child, cloneData, finite, record, records, type Data } from './tankUpgradeData'
import { resolveUpgradeSelection } from './tankUpgradeSelection'

function change(target: Data | undefined, key: string, transform: (value: number) => number): void {
  if (target && finite(target[key])) target[key] = transform(target[key])
}
function changeAll(target: Data | undefined, transform: (value: number) => number): void {
  if (target) for (const key of Object.keys(target)) change(target, key, transform)
}
function changePitch(pitch: Data | undefined, up: number, down: number): void {
  if (!pitch) return
  change(pitch, 'min', value => value - up); change(pitch, 'max', value => value + down)
  for (const [key, value] of Object.entries(pitch)) {
    if (key !== 'min' && key !== 'max' && record(value)) changePitch(value, up, down)
  }
}
function scaleArmor(detail: Data, factor: number): void {
  for (const section of ['hull', 'turret']) changeAll(child(detail.armor, section), value => value * factor)
  changeAll(child(child(detail, 'armor_model')?.hull, 'plates'), value => value * factor)
  for (const side of ['left_track', 'right_track']) change(child(detail.armor_model, 'chassis'), side, value => value * factor)
  for (const cfg of records(detail.configs)) {
    changeAll(child(cfg, 'turret_plates'), value => value * factor)
    changeAll(child(cfg, 'gun_plates'), value => value * factor)
    change(cfg, 'gun_thickness', value => value * factor)
  }
}

export function projectTankUpgrades<D, M>(detail: D, modules: M, mode?: unknown, choices?: unknown): {
  detail: D; modules: M; selection: UpgradeSelection
} {
  const selection = resolveUpgradeSelection(modules, mode, choices)
  if (!record(detail) || detail.tier !== 11 || !selection.available || !selection.supported || selection.mode === 'stock') {
    return { detail, modules, selection }
  }
  const projectedDetail = cloneData(detail)
  const projectedModules = cloneData(modules)
  if (!record(projectedDetail) || !record(projectedModules)) return { detail, modules, selection }
  const configs = records(projectedDetail.configs)
  const engines = records(projectedModules.engines)
  const tracks = records(projectedModules.chassis)
  const turrets = records(projectedModules.turrets)
  const guns = turrets.flatMap(t => records(t.guns))
  const hasStats = (items: Data[], key: string) => items.length > 0 && items.every(item => finite(child(item, 'stats')?.[key]))
  const missing: string[] = []
  for (const name of Object.keys(selection.attributes)) {
    const def = selection.attributeDefinitions[name]!
    const p = def.params || {}
    let valid = true
    switch (def.script) {
      case 'MaxHealthUpgrade': valid = finite(child(projectedModules, 'hull')?.hp); break
      case 'EnginePowerUpgrade': valid = hasStats(engines, 'power'); break
      case 'FireStartChangeUpgrade': valid = hasStats(engines, 'fireStartingChance'); break
      case 'SpeedLimitUpgrade': valid = finite(child(projectedModules, 'speedLimits')?.[p.type!]); break
      case 'VehicleDataPhysicsMultiplicativeBonus': valid = hasStats(tracks, 'rotationSpeed'); break
      case 'VehicleDataMiscAttrAdditiveBonus': valid = hasStats(guns, 'reloadTime')
        && configs.length > 0 && configs.every(cfg => finite(cfg.reload_time)); break
      case 'PumpGunReloadUpgrade': valid = configs.length > 0 && configs.every(cfg => Array.isArray(cfg.burst_reloads)
        && cfg.burst_reloads.length > 0 && cfg.burst_reloads.every(finite)); break
      case 'UpperPitchLimitsUpgrade': case 'LowerPitchLimitsUpgrade':
        valid = guns.length > 0 && guns.every(gun => {
          const pitch = child(child(gun, 'stats'), 'pitchLimits'); return finite(pitch?.min) && finite(pitch?.max)
        }) && configs.length > 0 && configs.every(cfg => {
          const pitch = child(cfg, 'pitch_limits'); return finite(pitch?.min) && finite(pitch?.max)
        }); break
      case 'VehicleDataMiscAttrMultiplicativeBonus':
        if (p.attrName === 'shotDispersionAngleFactor') valid = hasStats(guns, 'shotDispersionRadius')
        if (p.attrName === 'gunAimingTimeFactor') valid = hasStats(guns, 'aimingTime')
        if (p.attrName === 'turret/rotationSpeed') valid = hasStats(turrets, 'rotationSpeed')
        if (p.attrName === 'armorHomogenizationFactor') valid = !!child(projectedDetail.armor, 'hull')
          || !!child(child(projectedDetail, 'armor_model')?.hull, 'plates')
        break
      case 'TankFactorsUpgrade': {
        const items = p.factorName?.startsWith('gun/') ? guns : tracks
        const key = p.factorName === 'gun/shotDispersionFactors/turretRotation' ? 'turretRotation'
          : p.factorName?.includes('/movement/') ? 'vehicleMovement' : 'vehicleRotation'
        valid = items.length > 0 && items.every(item => finite(child(child(item, 'stats'), 'dispersionFactors')?.[key])); break
      }
      case 'ShellDamageUpgrade': case 'ShellSpeedUpgrade': case 'ShellPiercingPowerUpgrade': {
        const key = def.script === 'ShellDamageUpgrade' ? 'damage' : def.script === 'ShellSpeedUpgrade' ? 'velocity'
          : p.distance === '500' ? 'penetration_far' : 'penetration'
        valid = configs.length > 0 && configs.every(cfg => {
          const shell: unknown = Array.isArray(cfg.shells) ? cfg.shells[Number(p.slotIndex)] : undefined
          return record(shell) && finite(shell[key])
        }); break
      }
    }
    if (!valid) missing.push(`Missing upgrade projection source: ${name}`)
  }
  if (missing.length) {
    selection.supported = false; selection.unsupported.push(...missing)
    return { detail, modules, selection }
  }
  const statChange = (items: Data[], key: string, fn: (n: number) => number) => items.forEach(item => change(child(item, 'stats'), key, fn))
  for (const [name, rawValue] of Object.entries(selection.attributes)) {
    const def = selection.attributeDefinitions[name]!
    if (!def.script || def.script === 'DeviceAttributeUpgrade' || typeof rawValue !== 'number') continue
    const value = rawValue
    const add = (n: number) => n + value
    const multiply = (n: number) => n * (1 + value)
    const p = def.params || {}
    switch (def.script) {
      case 'MaxHealthUpgrade': change(child(projectedModules, 'hull'), 'hp', add); change(projectedDetail, 'hp', add); break
      case 'EnginePowerUpgrade': statChange(engines, 'power', add); change(projectedDetail, 'engine_power', add); break
      case 'FireStartChangeUpgrade': statChange(engines, 'fireStartingChance', multiply); break
      case 'SpeedLimitUpgrade':
        change(child(projectedModules, 'speedLimits'), p.type!, add)
        change(projectedDetail, p.type === 'forward' ? 'speed_forward' : 'speed_reverse', add); break
      case 'VehicleDataPhysicsMultiplicativeBonus': statChange(tracks, 'rotationSpeed', multiply); break
      case 'VehicleDataMiscAttrAdditiveBonus':
        statChange(guns, 'reloadTime', add)
        configs.forEach(cfg => change(cfg, 'reload_time', add)); change(projectedDetail, 'reload_time', add); break
      case 'PumpGunReloadUpgrade':
        configs.forEach(cfg => { if (Array.isArray(cfg.burst_reloads)) cfg.burst_reloads = cfg.burst_reloads.map(v => finite(v) ? add(v) : v) }); break
      case 'UpperPitchLimitsUpgrade': case 'LowerPitchLimitsUpgrade': {
        const up = def.script === 'UpperPitchLimitsUpgrade' ? value : 0
        const down = def.script === 'LowerPitchLimitsUpgrade' ? value : 0
        guns.forEach(gun => changePitch(child(child(gun, 'stats'), 'pitchLimits'), up, down))
        configs.forEach(cfg => changePitch(child(cfg, 'pitch_limits'), up, down))
        change(projectedDetail, 'gun_elevation', n => n + up); change(projectedDetail, 'gun_depression', n => n + down)
        break
      }
      case 'VehicleDataMiscAttrMultiplicativeBonus':
        if (p.attrName === 'armorHomogenizationFactor') scaleArmor(projectedDetail, 1 + value)
        if (p.attrName === 'shotDispersionAngleFactor') {
          statChange(guns, 'shotDispersionRadius', multiply)
          configs.forEach(cfg => change(cfg, 'dispersion', multiply)); change(projectedDetail, 'dispersion', multiply)
        }
        if (p.attrName === 'gunAimingTimeFactor') {
          statChange(guns, 'aimingTime', multiply)
          configs.forEach(cfg => change(cfg, 'aim_time', multiply)); change(projectedDetail, 'aim_time', multiply)
        }
        if (p.attrName === 'turret/rotationSpeed') statChange(turrets, 'rotationSpeed', multiply)
        break
      case 'TankFactorsUpgrade': {
        const items = p.factorName?.startsWith('gun/') ? guns : tracks
        const key = p.factorName === 'gun/shotDispersionFactors/turretRotation' ? 'turretRotation'
          : p.factorName?.includes('/movement/') ? 'vehicleMovement' : 'vehicleRotation'
        items.forEach(item => change(child(child(item, 'stats'), 'dispersionFactors'), key, n => n * value))
        break
      }
      case 'ShellDamageUpgrade': case 'ShellSpeedUpgrade': case 'ShellPiercingPowerUpgrade': {
        const key = def.script === 'ShellDamageUpgrade' ? 'damage' : def.script === 'ShellSpeedUpgrade' ? 'velocity'
          : p.distance === '500' ? 'penetration_far' : 'penetration'
        configs.forEach(cfg => { if (Array.isArray(cfg.shells)) {
          const shell: unknown = cfg.shells[Number(p.slotIndex)]
          if (record(shell)) change(shell, key, add)
        } })
        break
      }
    }
  }
  if (configs.length) {
    configs.forEach(cfg => {
      if (!record(cfg) || !Array.isArray(cfg.shells)) return
      const standard = standardDamageOf(cfg.shells)
      if (standard != null) change(cfg, 'standard_damage', () => standard)
      if (cfg.is_burst === true) { cfg.dpm = null; return }
      const reload = cfg.reload_time
      if (!finite(reload) || reload <= 0) return
      if (standard != null) change(cfg, 'dpm', () => Math.round(standard * 60 / reload))
    })
  }
  return { detail: projectedDetail, modules: projectedModules, selection }
}

function standardDamageOf(shells: unknown[]): number | null {
  const rows = shells.filter(record)
  if (!rows.length) return null
  const damage = (row: Data): number | null => (typeof row.type === 'string' && finite(row.damage) ? row.damage : null)
  const ap = rows.find(row => row.type === 'ap')
  if (ap) { const d = damage(ap); if (d != null) return d }
  const nonPremium = rows.find(row => typeof row.type === 'string' && !row.type.includes('premium'))
  if (nonPremium) { const d = damage(nonPremium); if (d != null) return d }
  const values = rows.map(damage).filter((v): v is number => v != null)
  return values.length ? Math.max(...values) : null
}
