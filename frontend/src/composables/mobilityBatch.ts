import { moduleIdentity, selectionQuery, type ComparisonEntry } from './tankMobility'
import { type SetupResolved } from '../replay-local/compute/tankSetup'

export type BatchGroup = 'devices' | 'provisions' | 'consumables'
type BatchItem = {
  stem: string
  tags?: string[]
  script?: { params?: { bonusValues?: Record<string, unknown> } }
  name_en?: string
  'name_zh-Hans'?: string
}
interface BatchSlot { group: string; level: number; left?: string | null; right?: string | null }
export interface BatchSetup {
  entry?: ComparisonEntry
  name?: string
  rawSelection?: SetupResolved
  selection: SetupResolved
  modules: Parameters<typeof moduleIdentity>[0]
  slots: BatchSlot[]
  devices: BatchItem[]
  provisions: BatchItem[]
  consumables: BatchItem[]
  provisionSlots: number
  consumableSlots: number
}
interface Difference { before: string[]; after: string[]; reason?: string; slot?: BatchSlot }
export interface BatchResult { differences: Difference[]; next?: ComparisonEntry }

function foodClass(item: BatchItem | undefined) {
  const bonus = item?.script?.params?.bonusValues
  if (!bonus || Object.keys(bonus).length !== 1) return null
  const strength = Number(bonus.crewLevelIncrease)
  if (item?.tags?.includes('stimulatorHQ') && strength === 10) return 'large'
  if (item?.tags?.includes('stimulator') && strength === 3) return 'small'
  return null
}

function same(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function configured(target: ComparisonEntry, context: BatchSetup, selection: SetupResolved): ComparisonEntry {
  const raw = context.rawSelection || context.selection
  return { ...target, config: selectionQuery({ ...selection, skills: raw.skills,
    conditionalSkills: raw.conditionalSkills, camouflage: raw.camouflage }), stems: moduleIdentity(context.modules, selection) }
}

function mapItems(group: 'consumables' | 'provisions', source: BatchSetup, target: ComparisonEntry, context: BatchSetup): BatchResult {
  const before = context.selection[group], wanted = source.selection[group]
  const after: string[] = []
  const differences: Difference[] = []
  let skipped = false
  for (const stem of wanted) {
    const pool = context[group]
    const exact = pool.find(item => item.stem === stem)
    const kind = group === 'provisions' ? foodClass(source[group].find(item => item.stem === stem)) : null
    const candidates = exact ? [exact] : kind ? pool.filter(item => foodClass(item) === kind) : []
    const match = candidates.length === 1 ? candidates[0].stem : undefined
    if (!match || after.includes(match)) {
      differences.push({ before: [stem], after: [], reason: candidates.length ? 'ambiguous' : 'unsupportedItem' })
      skipped = true
    } else {
      after.push(match)
      if (match !== stem) differences.push({ before: [stem], after: [match], reason: 'equivalent' })
    }
  }
  const capacity = group === 'provisions' ? context.provisionSlots : context.consumableSlots
  if (!Number.isInteger(capacity) || wanted.length > capacity) {
    differences.push({ before: wanted, after: before, reason: 'capacity' })
    skipped = true
  }
  differences.unshift({ before, after: skipped ? before : after, reason: skipped ? 'retained' : undefined })
  if (skipped || same(before, after)) return { differences }
  const next = configured(target, context, { ...context.selection, [group]: after })
  if (group === 'consumables') next.activations = Object.fromEntries(Object.entries(target.activations).filter(([stem]) => after.includes(stem)))
  return { differences, next }
}

function equipped(slot: BatchSlot, side: 0 | 1 | null | undefined) {
  return side == null ? undefined : slot[side === 0 ? 'left' : 'right']
}

function mapDevices(source: BatchSetup, target: ComparisonEntry, context: BatchSetup): BatchResult {
  const validSlots = (setup: BatchSetup) => setup.slots.length === setup.selection.devices.length &&
    setup.slots.every(s => s && s.group && Number.isInteger(s.level)) &&
    new Set(setup.slots.map(s => s.group + '/' + s.level)).size === setup.slots.length
  if (!validSlots(source) || !validSlots(context)) {
    return { differences: [{ before: [], after: [], reason: 'unavailable' }] }
  }
  const next = [...context.selection.devices]
  const differences: Difference[] = []
  for (const [i, slot] of source.slots.entries()) {
    const stem = equipped(slot, source.selection.devices[i])
    const index = context.slots.findIndex(s => s.group === slot.group && s.level === slot.level)
    const dest = context.slots[index]
    const current = dest && equipped(dest, next[index])
    const before = current ? [current] : []
    if (!dest || (stem && (dest.left !== stem && dest.right !== stem || !context.devices.some(d => d.stem === stem)))) {
      differences.push({ slot, before: stem ? [stem] : [], after: before, reason: 'unsupportedSlot' })
      continue
    }
    // An empty source slot may clear a shared choice, never a target-only suspension.
    if (!stem && current && slot.left !== current && slot.right !== current) {
      differences.push({ slot, before, after: before, reason: 'unsupportedSlot' })
      continue
    }
    if (stem === current) continue
    next[index] = !stem ? null : dest.left === stem ? 0 : 1
    differences.push({ slot, before, after: stem ? [stem] : [] })
  }
  return { differences, next: same(next, context.selection.devices) ? undefined :
    configured(target, context, { ...context.selection, devices: next }) }
}

export function previewBatch(group: BatchGroup, dataset: string | null, source: BatchSetup | undefined,
  target: ComparisonEntry, context: BatchSetup | undefined): BatchResult {
  if (!dataset || dataset !== target.dataset) return { differences: [{ before: [], after: [], reason: 'version' }] }
  if (!source || !context || (context.entry && context.entry !== target)) return { differences: [{ before: [], after: [], reason: 'unavailable' }] }
  return group === 'devices' ? mapDevices(source, target, context) : mapItems(group, source, target, context)
}
