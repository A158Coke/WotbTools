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
  // front/back 等扇区只有角度端点变化；yaw/from/to 等扇区边界保持原值。
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

/**
 * 只在 detail 和 modules 均为 XI 且具可靠升级元数据时投影。
 * 未知脚本/坏数据不产生部分结果；调用方据 supported 显示不可用。
 */
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
      // ADD 指节点奖励相加；FireStartChangeUpgrade 把总奖励乘到原始概率。
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
  // 弹种伤害/装填被节点改过之后，`dpm` 与 `standard_damage` 必须同一次重算——否则
  // 同一页会出现“伤害 600 / 装填 11.5 / DPM 2732”这种三量互不成立的组合（2732 是
  // stock 的 560×60/12.3）。口径与包内 `dump-tank-data` 完全一致：标准弹 = 优先 ap、
  // 否则首个非金币弹、再否则最大伤害；DPM = 标准弹伤害 × 60 / 装填（连发炮恒为 null）。
  if (configs.length) {
    configs.forEach(cfg => {
      if (!record(cfg) || !Array.isArray(cfg.shells)) return
      const standard = standardDamageOf(cfg.shells)
      if (standard != null) change(cfg, 'standard_damage', () => standard)
      // 连发炮（包内 `is_burst`）的 dpm 恒为 null——投影同样置空，不保留可能过期的数字。
      if (cfg.is_burst === true) { cfg.dpm = null; return }
      const reload = cfg.reload_time
      if (!finite(reload) || reload <= 0) return
      if (standard != null) change(cfg, 'dpm', () => Math.round(standard * 60 / reload))
    })
  }
  return { detail: projectedDetail, modules: projectedModules, selection }
}

/**
 * 配置的“标准弹”伤害（DPM/Alpha 基准）：与 Rust `dump-tank-data` 同序——优先 `ap`、
 * 否则首个非金币弹（type 含 premium 不算）、再否则最大伤害；整表不可解析返回 null。
 */
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
