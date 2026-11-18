import { computed, onMounted, ref } from 'vue'
import { assetProvider } from '../scene/assetProvider.js'
import { computeCharacteristics } from '../replay-local/compute/characteristics'
import { consumableTiming, encodeDevices, presetSlots } from '../replay-local/compute/tankSetup'

import type { ComputeInput } from '../replay-local/compute/characteristics'
import type { SetupResolved, SetupSelection } from '../replay-local/compute/tankSetup'
import type { Mobility, Phase } from '../replay-local/compute/mobility'

type Item = { stem: string; name_en?: string; 'name_zh-Hans'?: string }
export type ItemCatalog = { devices: Item[]; provisions: Item[]; consumables: Item[] }
export type Activations = Record<string, number>
type Configuration = ReturnType<typeof selectionQuery>
export interface ComparisonEntry {
  id: string
  tank: number
  dataset: string
  config?: Configuration
  stems?: string[]
  seriesIndex?: number
  alias?: string
  activations: Activations
}
interface VehicleArgs {
  id: string
  name: string
  color: string
  summary: string
  input: ComputeInput | null
  loading?: boolean
  catalog?: ItemCatalog | null
  activations?: Activations
}
export type VehicleCurve = ReturnType<typeof mobilityVehicle>
export type BoostOption = ReturnType<typeof boostOptions>[number]
export const modelRevision = 'BF · e8c87476'
const stamp = ref<string | null>(null)
let pending: Promise<Record<string, unknown>> | null = null
export async function loadMobilityDataset() {
  try {
    pending ??= assetProvider.json('/version.json')
    const data = await pending
    if (data.client && String(data.client).toLowerCase() !== 'wg') { pending = null; return }
    if (typeof data.dataset_id === 'string' && typeof data.release === 'string') {
      stamp.value = 'WG · ' + data.dataset_id + ' · ' + data.release
    } else pending = null
  } catch { pending = null }
}

export function useMobilityDataset() {
  onMounted(loadMobilityDataset)
  return computed(() => stamp.value)
}

export function selectionQuery(next: SetupSelection) {
  return {
    config: next.config, engine: next.engine, track: next.track, shell: next.shell,
    dev: encodeDevices(next.devices), cons: next.consumables, prov: next.provisions,
    skills: next.skills, conditionalSkills: next.conditionalSkills, camo: next.camouflage,
    upgrade: next.upgrade, abilities: next.abilities || [],
  }
}

export function moduleIdentity(modules: ComputeInput['modules'], selection: SetupSelection): string[] {
  const turret = modules?.turrets?.[selection.turret]
  return [turret?.stem, turret?.guns?.[selection.gun]?.stem, modules?.engines?.[selection.engine]?.stem,
    modules?.chassis?.[selection.track]?.stem]
}

const seriesColors = [
  'var(--color-info)', 'color-mix(in srgb, var(--color-warning) 62%, var(--color-danger))',
  'color-mix(in srgb, var(--color-info) 55%, var(--color-danger))', 'var(--color-success)',
]
export function vehicleColor(id: string, index?: number) {
  if (index !== undefined && seriesColors[index]) return seriesColors[index]
  // Stable across filtering, moving and restoring a vehicle.
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const hue = index !== undefined && index >= 4 ? ((index - 4) * 137.507764 + 60) % 360 : hash % 360
  return `light-dark(hsl(${hue} 65% 30%), hsl(${hue} 75% 72%))`
}

export function snapshot(tank: number, modules: ComputeInput['modules'], selection: SetupResolved, dataset: string, activations: Activations = {}): ComparisonEntry {
  return { id: crypto.randomUUID(), seriesIndex: 0, tank, dataset, config: selectionQuery(selection),
    stems: moduleIdentity(modules, selection), activations }
}

export function describeSetup(modules: ComputeInput['modules'], selection: SetupResolved, catalog: ItemCatalog | null, locale: string, translate: (key: string) => string) {
  if (!selection?.canConfigure || !modules || !catalog) return ''
  const title = (stem: string, list: Item[]) => {
    const item = list?.find(v => v.stem === stem)
    return item?.[locale === 'zh' ? 'name_zh-Hans' : 'name_en'] || item?.name_en || stem
  }
  const slots = presetSlots(modules, catalog)
  const devices = selection.devices.flatMap((side, i) => {
    if (side == null) return []
    const stem = slots[i]?.[side === 0 ? 'left' : 'right']
    return stem ? [title(stem, catalog.devices)] : []
  })
  const turret = modules.turrets?.[selection.turret]
  const parts: Item[] = [turret, turret?.guns?.[selection.gun], modules.engines?.[selection.engine], modules.chassis?.[selection.track]].filter(Boolean)
  const partNames = parts.map(part => part[locale === 'zh' ? 'name_zh-Hans' : 'name_en'] || part.name_en || part.stem)
  const group = (key: string, values: string[]) => values.length ? translate('agentTanks.configurator.' + key) + ' · ' + values.join(', ') : ''
  return [partNames.join(' / '), group('equipment', devices),
    group('provisions', selection.provisions.map(stem => title(stem, catalog.provisions))),
    group('consumables', selection.consumables.map(stem => title(stem, catalog.consumables))),
    group('crew_skills', Object.entries(selection.skills).map(([skill, level]) => skill + ' ' + level)),
    selection.conditionalSkills ? translate('agentTanks.configurator.skill_triggers') : '',
    selection.upgrade, ...(selection.abilities || [])].filter(Boolean).join(' · ')
}

export function matchesSnapshot(entry: ComparisonEntry, modules: ComputeInput['modules'], selection: SetupResolved, catalog?: ItemCatalog) {
  if (!selection?.canConfigure || !Array.isArray(entry.stems)) return false
  if (Object.entries(entry.activations || {}).some(([stem, at]) =>
    !selection.consumables.includes(stem) || !Number.isFinite(at) || at < 0)) return false
  if (catalog) {
    const slots = presetSlots(modules, catalog)
    const available = new Set(catalog.devices.map(device => device.stem))
    if (selection.devices.some((side, i) =>
      side != null && !available.has(slots[i]?.[side === 0 ? 'left' : 'right']))) return false
  }
  const saved = entry.config
  if (!saved) return false
  const actual = selectionQuery(selection)
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  return equal(moduleIdentity(modules, selection), entry.stems) &&
    (Object.keys(actual) as (keyof Configuration)[]).every(k => equal(actual[k], saved[k]))
}

function validEntry(value: unknown): value is ComparisonEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<ComparisonEntry>
  if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || !Number.isSafeInteger(Number(entry.tank)) || Number(entry.tank) <= 0 || typeof entry.tank !== 'number' ||
      typeof entry.dataset !== 'string' || (entry.alias !== undefined && typeof entry.alias !== 'string') ||
      (entry.seriesIndex !== undefined && (!Number.isSafeInteger(entry.seriesIndex) || entry.seriesIndex < 0))) return false
  if (entry.config == null) return true
  const config = entry.config
  return typeof config === 'object' && typeof config.dev === 'string' && /^[-01]{0,9}$/.test(config.dev) &&
    [config.prov, config.cons].every(list => Array.isArray(list) && list.every(s => typeof s === 'string')) &&
    [config.engine, config.track, config.config].every(v => Number.isSafeInteger(v) && v >= 0) &&
    Array.isArray(entry.stems) && entry.stems.length === 4 && entry.stems.every(stem => typeof stem === 'string')
}


export interface CrewSettings {
  skills: Record<string, number>
  conditionalSkills: boolean
}
export interface ComparisonDocument {
  v: 2
  entries: ComparisonEntry[]
  crew: CrewSettings
  legacyCrewOverrides?: Record<string, CrewSettings>
}
export type ComparisonLoad =
  | { status: 'ready'; document: ComparisonDocument }
  | { status: 'missing' | 'invalid' | 'unsupported' }

export function emptyCrew(): CrewSettings {
  return { skills: {}, conditionalSkills: false }
}
export function emptyComparison(): ComparisonDocument {
  return { v: 2, entries: [], crew: emptyCrew() }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function readCrew(value: unknown, allowed?: Set<string>): CrewSettings | null {
  if (!record(value) || !record(value.skills) || typeof value.conditionalSkills !== 'boolean') return null
  const pairs = Object.entries(value.skills)
  if (pairs.some(([id, level]) => !/^[a-z][a-z0-9_]*$/.test(id) || (allowed && !allowed.has(id)) ||
    typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 7)) return null
  return { skills: Object.fromEntries(pairs.sort(([a], [b]) => a.localeCompare(b)).map(([id, level]) => [id, Number(level)])), conditionalSkills: value.conditionalSkills }
}
/** Called only after raw snapshot validation; comparison ignores cosmetic paint. */
export function projectMobilitySetup(raw: SetupResolved, crew: CrewSettings): SetupResolved {
  return { ...raw, skills: crew.skills, conditionalSkills: crew.conditionalSkills, camouflage: false }
}
function sameCrew(a: CrewSettings, b: CrewSettings) {
  return a.conditionalSkills === b.conditionalSkills && Object.keys(a.skills).length === Object.keys(b.skills).length &&
    Object.entries(a.skills).every(([id, level]) => b.skills[id] === level)
}
export function crewForEntry(document: ComparisonDocument, id: string): CrewSettings {
  const overrides = document.legacyCrewOverrides
  return overrides && Object.hasOwn(overrides, id) ? overrides[id] : document.crew
}

/** Read a legacy list/seed or a v2 document. Parsing never rewrites storage. */
export function parseComparison(value: unknown, skillIds?: Iterable<string>): ComparisonLoad {
  const allowed = skillIds ? new Set(skillIds) : undefined
  const legacy = Array.isArray(value) ? value : record(value) && value.v === 1 && record(value.vehicle) && value.vehicle.config ? [value.vehicle] : null
  const document = legacy ? null : record(value) ? value : null
  if (!legacy && !document) return { status: 'invalid' }
  if (document && document.v !== 2) return { status: document.v === undefined ? 'invalid' : 'unsupported' }
  const entries: unknown = legacy ?? document?.entries
  if (!Array.isArray(entries) || entries.some(entry => !validEntry(entry)) ||
      new Set(entries.map(entry => entry.id)).size !== entries.length) return { status: 'invalid' }
  const rawCrews = entries.map(entry => readCrew({
    skills: entry.config?.skills ?? {}, conditionalSkills: entry.config?.conditionalSkills ?? false,
  }, allowed))
  if (rawCrews.some(crew => !crew)) return { status: 'invalid' }
  if (legacy) {
    const crew = rawCrews[0] ?? emptyCrew()
    const overrides = Object.fromEntries(entries.flatMap((entry, i) =>
      sameCrew(rawCrews[i]!, crew) ? [] : [[entry.id, rawCrews[i]!]]))
    return { status: 'ready', document: { v: 2, entries, crew,
      ...(Object.keys(overrides).length ? { legacyCrewOverrides: overrides } : {}) } }
  }
  const crew = readCrew(document?.crew, allowed)
  if (!crew) return { status: 'invalid' }
  const overrides: Record<string, CrewSettings> = Object.create(null)
  if (document?.legacyCrewOverrides !== undefined) {
    if (!record(document.legacyCrewOverrides)) return { status: 'invalid' }
    const ids = new Set(entries.map(entry => entry.id))
    for (const [id, value] of Object.entries(document.legacyCrewOverrides)) {
      const settings = readCrew(value, allowed)
      if (!ids.has(id) || !settings) return { status: 'invalid' }
      if (!sameCrew(crew, settings)) overrides[id] = settings
    }
  }
  return { status: 'ready', document: { v: 2, entries, crew,
    ...(Object.keys(overrides).length ? { legacyCrewOverrides: overrides } : {}) } }
}
export function readComparisonSeed(encoded: unknown, skillIds?: Iterable<string>): ComparisonLoad {
  if (typeof encoded !== 'string') return { status: 'missing' }
  try { return parseComparison(JSON.parse(encoded), skillIds) } catch { return { status: 'invalid' } }
}
export function readSeed(encoded: unknown): ComparisonEntry | null {
  const loaded = readComparisonSeed(encoded)
  return loaded.status === 'ready' ? loaded.document.entries[0] ?? null : null
}

const prefix = 'tank-mobility-v1:'
const sessions = new Map<string, string>()
export function saveComparison(key: string, value: ComparisonEntry[] | ComparisonDocument) {
  const parsed = parseComparison(value)
  if (parsed.status !== 'ready') throw new Error('Invalid comparison document')
  const encoded = JSON.stringify(parsed.document)
  try {
    sessionStorage.setItem(prefix + key, encoded)
    sessions.set(key, encoded)
    return 'storage' as const
  } catch {
    sessions.set(key, encoded)
    return 'memory' as const
  }
}
export function readComparisonDocument(key: unknown, skillIds?: Iterable<string>): ComparisonLoad {
  if (!key || typeof key !== 'string') return { status: 'missing' }
  try {
    const encoded = sessions.get(key) ?? sessionStorage.getItem(prefix + key)
    return encoded ? parseComparison(JSON.parse(encoded), skillIds) : { status: 'missing' }
  } catch { return { status: 'invalid' } }
}
export function readComparison(key: unknown): ComparisonEntry[] | null {
  const loaded = readComparisonDocument(key)
  return loaded.status === 'ready' ? loaded.document.entries : null
}
const modeledBoosts = new Set(['freeAfterburning', 'afterburning', 'improvedAfterburning'])
function boostOptions(input: ComputeInput | null, catalog?: ItemCatalog | null) {
  if (!input) return []
  return input.consumableStems.flatMap(stem => {
    const script = input.consumableScripts[stem]
    const p = script?.params
    const known = modeledBoosts.has(stem)
    const hasMobilityEffect = known || Object.keys({ ...p, ...p?.bonusValues }).some(k => /engine|velocity|terrainResistance|speedLimit/i.test(k))
    if (!hasMobilityEffect) return []
    const { duration, cooldown } = consumableTiming(script, input.deviceIds, catalog)
    const supported = known && duration != null && duration > 0 && (Number(p?.enginePowerIncrease) > 0 || Number(p?.bonusValues?.enginePowerIncrease) > 0)
    return [{ stem, duration, cooldown, supported }]
  })
}

/** A carried consumable affects the run only during its explicit activation window. */
export function mobilityVehicle({ id, name, input, catalog, activations = {}, color, summary, loading = false }: VehicleArgs) {
  const hasUnknownUpgrade = Number(input?.modules?.tier) === 11 && !input?.modules?.upgradeProgression
  const options = boostOptions(hasUnknownUpgrade ? null : input, catalog)
  const windows = options.filter(o => Object.hasOwn(activations, o.stem) && Number.isFinite(activations[o.stem]) && activations[o.stem] >= 0)
    .map(o => ({ ...o, start: activations[o.stem], end: o.duration ? activations[o.stem] + o.duration : Infinity }))
  const times = [...new Set([0, ...windows.flatMap(w => [w.start, w.end]).filter(Number.isFinite)])].sort((a, b) => a - b)
  const phases: Phase[] = times.map(start => {
    const active = windows.filter(w => start >= w.start && start < w.end)
    const state: Mobility | null = !hasUnknownUpgrade && input && active.every(w => w.supported)
      ? computeCharacteristics({ ...input, consumableStems: active.map(w => w.stem) })._mobility : null
    return { start, input: state || null }
  })
  const carried = (input?.consumableStems || []).map(stem => ({
    stem, item: catalog?.consumables.find(item => item.stem === stem),
    window: windows.find(window => window.stem === stem),
  }))
  return { id, name, color, summary, loading, phases, windows, carried, options, mobility: phases[0].input }
}
