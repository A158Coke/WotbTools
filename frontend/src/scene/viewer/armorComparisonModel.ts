import type { TankArmorConfig, TankArmorData } from './armorPlateModel.js'

export type ComparisonSide = 0 | 1
type VersionValues = { old?: unknown; new?: unknown }
type ModuleChange = VersionValues & { module: string }
type PlateChange = ModuleChange & { plate: string }
type RevisionConfig = TankArmorConfig & { turret_local?: number; gun_local?: number; label?: string; turret_name?: string }

export interface ComparisonTank extends TankArmorData {
  model_url?: string
  visual_model_url?: string
  configs?: RevisionConfig[]
}

export interface ArmorDiffDetail {
  armor?: {
    model?: {
      changed?: boolean
      plates?: PlateChange[]
      addedPlates?: (PlateChange & { thickness?: number })[]
      removedPlates?: (PlateChange & { thickness?: number })[]
      primary?: ModuleChange[]
      spaced?: ModuleChange[]
      chassis?: { field: string; old?: unknown; new?: unknown }[]
    }
  }
  configs?: {
    configs?: {
      key: { turretLocal?: number; gunLocal?: number; gun?: string; turret?: string }
      changes: (VersionValues & { path: string; category: string })[]
    }[]
  }
}

export type ArmorChangeKind = 'thickness' | 'added' | 'removed' | 'primary' | 'spaced' | 'chassis'

const KIND_PRIORITY: Record<ArmorChangeKind, number> = {
  thickness: 3, added: 2, removed: 2, primary: 1, chassis: 1, spaced: 0,
}

export interface ArmorChangeValue {
  module: string
  plate: string
  left: number | null
  right: number | null
  kind: ArmorChangeKind
}

export interface ArmorComparisonChoice {
  key: string
  label: string
  configs: [RevisionConfig, RevisionConfig]
  highlights: [Set<string>, Set<string>]
  /** key → 改动板件在该侧的厚度值；标注与文字列表共用这份口径。 */
  changes: Map<string, ArmorChangeValue>
}

export function armorPlateKey(section: string, id: string | number) {
  return section + ':' + id
}

function configKey(turret: number | undefined, gun: number | undefined) {
  return Number.isInteger(turret) && Number.isInteger(gun) ? turret + '/' + gun : null
}

function indexConfigs(tank: ComparisonTank) {
  const index = new Map<string, RevisionConfig | null>()
  for (const config of tank.configs || []) {
    const key = configKey(config.turret_local, config.gun_local)
    if (key !== null) index.set(key, index.has(key) ? null : config)
  }
  return index
}

function plateId(value: unknown) {
  const id = String(value).replace(/^armor_/, '')
  return /^\d+$/.test(id) ? id : null
}

function plateValue(tank: ComparisonTank, config: RevisionConfig | undefined, module: string, plate: string): number | null {
  let value: unknown
  if (module === 'hull') value = tank.armor_model?.hull?.plates?.[plate]
  else if (module === 'chassis') {
    const chassis = tank.armor_model?.chassis
    value = plate === 'leftTrack' ? chassis?.left_track : plate === 'rightTrack' ? chassis?.right_track : undefined
  } else {
    const plates = module === 'turret' ? config?.turret_plates : config?.gun_plates
    value = plates?.[plate]
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function setChange(
  changes: ArmorComparisonChoice['changes'],
  module: string,
  plate: string,
  left: number | null,
  right: number | null,
  kind: ArmorChangeKind,
) {
  const key = armorPlateKey(module, plate)
  const entry = changes.get(key)
  if (!entry) {
    changes.set(key, { module, plate, left, right, kind })
    return
  }
  if (left !== null) entry.left = left
  if (right !== null) entry.right = right
  // 同一块板可能同时命中多类改动（如厚度变了且进出间隙表）；保留语义更强的类别，
  // spaced 只负责"没有数值也要标出来"。
  if (KIND_PRIORITY[kind] > KIND_PRIORITY[entry.kind]) entry.kind = kind
}

function spacedPlates(value: unknown) {
  return new Set(Array.isArray(value) ? value.map(plateId).filter(id => id !== null) : [])
}

function highlightSpaced(
  highlights: ArmorComparisonChoice['highlights'],
  changes: ArmorComparisonChoice['changes'],
  module: string,
  change: VersionValues,
) {
  const old = spacedPlates(change.old)
  const next = spacedPlates(change.new)
  for (const id of new Set([...old, ...next])) {
    if (old.has(id) === next.has(id)) continue
    for (const side of highlights) side.add(armorPlateKey(module, id))
    // 间隙增删没有厚度语义，但仍然要在画内标注出来。
    setChange(changes, module, id, null, null, 'spaced')
  }
}

function highlightThickness(highlights: ArmorComparisonChoice['highlights'], module: string, change: VersionValues) {
  if (!change.old || !change.new || typeof change.old !== 'object' || typeof change.new !== 'object') return
  const old = change.old as Record<string, unknown>
  const next = change.new as Record<string, unknown>
  for (const id of new Set([...Object.keys(old), ...Object.keys(next)])) {
    if (plateId(id) !== id || old[id] === next[id]) continue
    if (Number.isFinite(old[id])) highlights[0].add(armorPlateKey(module, id))
    if (Number.isFinite(next[id])) highlights[1].add(armorPlateKey(module, id))
  }
}

function modelHighlights(
  detail: ArmorDiffDetail,
  singleConfiguration: boolean,
  tanks: [ComparisonTank, ComparisonTank],
  configs: [RevisionConfig, RevisionConfig],
): ArmorComparisonChoice['highlights'] & { changes: ArmorComparisonChoice['changes'] } {
  const highlights: ArmorComparisonChoice['highlights'] = [new Set(), new Set()]
  const changes: ArmorComparisonChoice['changes'] = new Map()
  const model = detail.armor?.model
  const matchesModule = (change: ModuleChange) => change.module === 'hull' || singleConfiguration
  for (const change of model?.plates || []) {
    if (!matchesModule(change)) continue
    for (const side of highlights) side.add(armorPlateKey(change.module, change.plate))
    setChange(changes, change.module, change.plate,
      typeof change.old === 'number' ? change.old : null,
      typeof change.new === 'number' ? change.new : null, 'thickness')
  }
  for (const change of model?.removedPlates || []) {
    if (!matchesModule(change)) continue
    highlights[0].add(armorPlateKey(change.module, change.plate))
    setChange(changes, change.module, change.plate,
      typeof change.thickness === 'number' ? change.thickness : null, null, 'removed')
  }
  for (const change of model?.addedPlates || []) {
    if (!matchesModule(change)) continue
    highlights[1].add(armorPlateKey(change.module, change.plate))
    setChange(changes, change.module, change.plate,
      null, typeof change.thickness === 'number' ? change.thickness : null, 'added')
  }
  for (const change of model?.primary || []) {
    if (!matchesModule(change)) continue
    const old = plateId(change.old)
    const next = plateId(change.new)
    if (old) {
      highlights[0].add(armorPlateKey(change.module, old))
      setChange(changes, change.module, old,
        plateValue(tanks[0], configs[0], change.module, old), null, 'primary')
    }
    if (next) {
      highlights[1].add(armorPlateKey(change.module, next))
      setChange(changes, change.module, next,
        null, plateValue(tanks[1], configs[1], change.module, next), 'primary')
    }
  }
  for (const change of model?.spaced || []) {
    if (matchesModule(change)) highlightSpaced(highlights, changes, change.module, change)
  }
  for (const change of model?.chassis || []) {
    const id = change.field === 'left_track' ? 'leftTrack' : change.field === 'right_track' ? 'rightTrack' : null
    if (id) {
      for (const side of highlights) side.add(armorPlateKey('chassis', id))
      setChange(changes, 'chassis', id,
        typeof change.old === 'number' ? change.old : null,
        typeof change.new === 'number' ? change.new : null, 'chassis')
    }
  }
  return Object.assign(highlights, { changes })
}

export function armorComparisonChoices(old: ComparisonTank, next: ComparisonTank, detail: ArmorDiffDetail) {
  const [from, to] = [indexConfigs(old), indexConfigs(next)]
  const singleConfiguration = old.configs?.length === 1 && next.configs?.length === 1
  const details = new Map((detail.configs?.configs || [])
    .map(entry => [configKey(entry.key.turretLocal, entry.key.gunLocal), entry]))
  const choices: ArmorComparisonChoice[] = []
  for (const [key, nextConfig] of to) {
    const oldConfig = from.get(key)
    if (!oldConfig || !nextConfig) continue
    const highlights = modelHighlights(detail, singleConfiguration, [old, next], [oldConfig, nextConfig])
    const changes = highlights.changes
    for (const change of details.get(key)?.changes || []) {
      if (change.category !== 'armor') continue
      const match = /^(gun|turret)_(plates|spaced)$/.exec(change.path)
      if (match?.[2] === 'plates') {
        highlightThickness(highlights, match[1], change)
        const oldPlates = (change.old && typeof change.old === 'object' ? change.old : {}) as Record<string, unknown>
        const nextPlates = (change.new && typeof change.new === 'object' ? change.new : {}) as Record<string, unknown>
        for (const id of new Set([...Object.keys(oldPlates), ...Object.keys(nextPlates)])) {
          if (plateId(id) !== id || oldPlates[id] === nextPlates[id]) continue
          setChange(changes, match[1], id,
            typeof oldPlates[id] === 'number' ? oldPlates[id] as number : null,
            typeof nextPlates[id] === 'number' ? nextPlates[id] as number : null, 'thickness')
        }
      }
      if (match?.[2] === 'spaced') highlightSpaced(highlights, changes, match[1], change)
    }
    choices.push({
      key,
      label: [nextConfig.turret_name, nextConfig.label].filter(Boolean).join(' · '),
      configs: [oldConfig, nextConfig],
      highlights: [highlights[0], highlights[1]],
      changes,
    })
  }
  // Keep the existing viewer's last configuration as the default when no localized
  // change identifies a better match.
  return choices.reverse().sort((a, b) =>
    Number(b.highlights.some(side => side.size)) - Number(a.highlights.some(side => side.size)))
}

export function armorCompareWidth(width: number, percent: number) {
  return Math.round(width * Math.max(0, Math.min(100, percent)) / 100)
}

