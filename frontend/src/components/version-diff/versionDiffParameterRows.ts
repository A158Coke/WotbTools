import { tankCategory } from '../../utils/tankopediaQuery.js'
import type { DiffChange, DiffConfigKey } from './versionDiffFormat.js'

interface VehicleFlags {
  premium?: boolean
  collector?: boolean
}

type DiffSchema = { added: Record<string, unknown>; removed: Record<string, unknown> }

function categoryChanges(changes: DiffChange[], schema?: DiffSchema, flags?: VehicleFlags) {
  const premium = changes.find(change => change.path === 'is_premium')
  const collector = changes.find(change => change.path === 'is_collector')
  const first = changes.find(change => change === premium || change === collector)
  if (!first) return changes
  function flagAt(path: string, row: DiffChange | undefined, side: 'old' | 'new', fallback: boolean | undefined) {
    if (row) return typeof row[side] === 'boolean' ? row[side] : undefined
    // A field present on only one side is recorded in the schema, not in the numeric/identity diff.
    if (schema?.added && schema.removed && !Object.hasOwn(schema.added, path) && !Object.hasOwn(schema.removed, path)) return fallback
    return undefined
  }
  const categoryAt = (side: 'old' | 'new') => {
    const is_premium = flagAt('is_premium', premium, side, flags?.premium)
    const is_collector = flagAt('is_collector', collector, side, flags?.collector)
    // The encyclopedia gives premium precedence and requires both flags for the regular category.
    if (is_premium === undefined && is_collector === true) return 'unknown'
    return tankCategory({ is_premium, is_collector })
  }
  const old = categoryAt('old')
  const next = categoryAt('new')
  if (old === 'unknown' || next === 'unknown') return changes
  return changes.flatMap(change => {
    if (change === first && old !== next) return [{ path: 'vehicle_category', category: 'identity', old, new: next }]
    return change === premium || change === collector ? [] : [change]
  })
}

export function tankRows(detail: unknown, flags?: VehicleFlags): DiffChange[] {
  const rows: DiffChange[] = []
  const source = (detail ?? {}) as { changes?: DiffChange[]; schema?: DiffSchema; configs?: { configs?: Array<{ key?: DiffConfigKey; changes?: DiffChange[] }> }; research?: { changes?: DiffChange[] } }
  for (const change of categoryChanges(source.changes || [], source.schema, flags)) {
    rows.push({ ...change, scope: 'summary', displayPath: change.path })
  }
  const detailSource = (detail ?? {}) as { configs?: { configs?: Array<{ key?: DiffConfigKey; changes?: DiffChange[] }> } }
  for (const config of detailSource.configs?.configs || []) {
    const configName = config.key?.gun || config.key?.turret || ''
    for (const change of config.changes || []) {
      rows.push({
        ...change,
        scope: 'config',
        config: config.key,
        configLabel: configName,
        displayPath: change.path,
      })
    }
  }
  for (const change of source.research?.changes || []) {
    rows.push({ ...change, scope: 'research', displayPath: `research.${change.path}` })
  }
  return rows
}

// Both sides must resolve to the same exported turret/gun pair before replacing a summary projection.
function configIdentity(turret: unknown, gun: unknown): string | undefined {
  if (Number.isInteger(turret) && Number.isInteger(gun)) return String(turret) + '/' + String(gun)
  return undefined
}

export function diffConfigIdentity(key?: DiffConfigKey) {
  return configIdentity(key?.turretLocal, key?.gunLocal)
}

type ExportedConfig = { turret_local?: number; gun_local?: number }

function exportedTopConfig(configs?: ExportedConfig[]) {
  if (!Array.isArray(configs)) return
  // dump-tank-data enumerates turrets and guns in the same order as the summary resolver.
  const top = configs.at(-1)
  const identity = configIdentity(top?.turret_local, top?.gun_local)
  if (identity && configs.filter(item => configIdentity(item?.turret_local, item?.gun_local) === identity).length === 1) {
    return identity
  }
  return undefined
}

export function matchingTopConfig(oldConfigs?: ExportedConfig[], newConfigs?: ExportedConfig[]) {
  const oldTop = exportedTopConfig(oldConfigs)
  return oldTop === exportedTopConfig(newConfigs) ? oldTop : undefined
}

type ConfigDiff = {
  configs?: { key?: DiffConfigKey; changes?: DiffChange[] }[]
  added?: unknown[]
  removed?: unknown[]
  unpairedOld?: unknown[]
  unpairedNew?: unknown[]
}

export function onlyPairedConfig(configs?: ConfigDiff) {
  if (configs?.configs?.length !== 1 || configs.added?.length || configs.removed?.length
    || configs.unpairedOld?.length || configs.unpairedNew?.length) return
  return diffConfigIdentity(configs.configs[0].key)
}

function summaryConfigPath(path?: string): string | undefined {
  if (path === 'gun_depression') return 'pitch_limits.max'
  if (path === 'gun_elevation') return 'pitch_limits.min'
  if (path === 'turret_traverse_speed' || path === 'view_range') return path
  // Upgraded *_top fields have their own bonuses. This only matches base shell data.
  if (/^shells\.[^.]+\.(damage|penetration|module_damage|explosion_radius|caliber|normalization|ricochet)$/.test(path || '')) return path
  return undefined
}

export function needsTopConfig(detail: { changes?: DiffChange[]; configs?: ConfigDiff }) {
  if (onlyPairedConfig(detail.configs)) return false
  const paths = new Set(detail.configs?.configs?.flatMap(config => config.changes?.map(row => row.path) || []))
  return detail.changes?.some(row => {
    const source = summaryConfigPath(row.path)
    return source !== undefined && paths.has(source.startsWith('pitch_limits.') ? 'pitch_limits' : source)
  }) ?? false
}

function pitchRecord(value: unknown): Record<string, unknown> | undefined {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

function pitchRows(row: DiffChange): DiffChange[] {
  const path = row.displayPath || row.changePath || row.path || ''
  if (path !== 'pitch_limits') return [row]
  const before = pitchRecord(row.old)
  const after = pitchRecord(row.new)
  if (!before || !after) return [row]
  const rows: DiffChange[] = []
  const push = (field: string, old: unknown, next: unknown) => {
    if (Object.is(old, next)) return
    rows.push({ ...row, old, new: next, displayPath: path + '.' + field })
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'front' || key === 'back') {
      const oldSector = pitchRecord(before[key])
      const newSector = pitchRecord(after[key])
      if ((oldSector || before[key] == null) && (newSector || after[key] == null)) {
        for (const edge of new Set([...Object.keys(oldSector || {}), ...Object.keys(newSector || {})])) {
          push(key + '.' + edge, oldSector?.[edge], newSector?.[edge])
        }
        continue
      }
    }
    push(key, before[key], after[key])
  }
  return rows
}

export function parameterRows(rows: DiffChange[], topConfig?: string): DiffChange[] {
  const expanded = rows.flatMap(pitchRows)
  const topRows = new Map<string, DiffChange>()
  const apDamageConfigs = new Set<DiffConfigKey>()
  for (const row of expanded) {
    if (row.scope !== 'config' || !row.config) continue
    if (row.displayPath && topConfig && diffConfigIdentity(row.config) === topConfig) topRows.set(row.displayPath, row)
    if (row.path === 'shells.ap.damage') apDamageConfigs.add(row.config)
  }
  const configRowsUsed = new Set<DiffChange>()
  const vehicleFieldsUsed = new Set<string>()
  // Prefer the configuration's precision, while keeping summary fields in their original order.
  return expanded.flatMap(change => {
    const alias = change.scope === 'summary' ? summaryConfigPath(change.path) : undefined
    const row = (alias ? topRows.get(alias) : undefined) ?? change
    if (row.scope !== 'config') return [row]
    if (configRowsUsed.has(row)) return []
    configRowsUsed.add(row)
    if (row.path === 'standard_damage' && row.config && apDamageConfigs.has(row.config)) return []
    // The exporter copies vehicle-wide fields into every turret/gun configuration.
    const field = row.path || ''
    if (['hull_hp', 'weight', 'tracks'].includes(field) || field.startsWith('engines.')) {
      if (vehicleFieldsUsed.has(field)) return []
      vehicleFieldsUsed.add(field)
      return [{ ...row, scope: 'vehicle', config: undefined, configLabel: undefined }]
    }
    return [row !== change && row.category !== change.category ? { ...row, category: change.category } : row]
  })
}

export function isPitchChange(row: DiffChange) {
  const path = row.displayPath || row.changePath || row.path || ''
  return path === 'gun_depression' || path === 'gun_elevation' || path.startsWith('pitch_limits.')
}
