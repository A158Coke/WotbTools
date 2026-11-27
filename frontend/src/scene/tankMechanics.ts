import { SHELL_TOKEN_KIND } from './penetration.js'

export interface DamageSector {
  distance: number
  factor: number
}

export interface TankMechanic {
  name: string
  localizationValues?: Record<string, string> | null
  kinds?: string[] | null
  sectors?: DamageSector[] | null
  [key: string]: unknown
}

export interface MechanicTextRow {
  titleKey?: string
  descriptionKey?: string
  title?: Record<string, string> | null
  description?: Record<string, string> | null
}

export interface TankMechanicsTable {
  mechanics?: Record<string, MechanicTextRow> | null
}

type ShellLike = { type?: unknown; type_id?: unknown } | null | undefined

const KIND_BY_SHELL_KIND: Record<string, string> = {
  ap: 'ARMOR_PIERCING',
  apcr: 'ARMOR_PIERCING_CR',
  heat: 'HOLLOW_CHARGE',
  he: 'HIGH_EXPLOSIVE',
}

const KIND_BY_TYPE_ID: Record<number, string> = {
  0: 'ARMOR_PIERCING',
  1: 'ARMOR_PIERCING_CR',
  2: 'HOLLOW_CHARGE',
  3: 'HIGH_EXPLOSIVE',
}

export function shellMechanicKind(shell: ShellLike): string | null {
  const id = shell?.type_id
  if (typeof id === 'number') {
    const kind = KIND_BY_TYPE_ID[id]
    if (kind) return kind
  }
  const token = String(shell?.type ?? '').toLowerCase()
  const shellKind = (SHELL_TOKEN_KIND as Record<string, string>)[token]
  return shellKind ? (KIND_BY_SHELL_KIND[shellKind] ?? null) : null
}

export function trayShellFor(
  mechanics: readonly TankMechanic[] | null | undefined,
  shell: ShellLike,
): TankMechanic | null {
  const kind = shellMechanicKind(shell)
  if (!kind) return null
  const rows = Array.isArray(mechanics) ? mechanics : []
  const row = rows.find(item => item?.name === 'TrayShell')
  if (!row || !Array.isArray(row.kinds) || !row.kinds.includes(kind)) return null
  if (!Array.isArray(row.sectors) || row.sectors.length === 0) return null
  return row
}

export function damageFactorAt(
  sectors: readonly DamageSector[] | null | undefined,
  distance: number | null | undefined,
): number | null {
  if (!Array.isArray(sectors) || sectors.length === 0) return null
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) return null
  for (const sector of sectors) {
    if (!Number.isFinite(sector?.distance) || !Number.isFinite(sector?.factor)) return null
    if (distance <= sector.distance) return sector.factor
  }
  const last = sectors[sectors.length - 1]
  return Number.isFinite(last?.factor) ? last.factor : null
}

export function trayShellDamage(
  baseDamage: number | null | undefined,
  sectors: readonly DamageSector[] | null | undefined,
  distance: number | null | undefined,
): number | null {
  if (typeof baseDamage !== 'number' || !Number.isFinite(baseDamage)) return null
  const factor = damageFactorAt(sectors, distance)
  if (factor == null) return baseDamage
  return Math.round(baseDamage * factor)
}

export function mechanicParamValues(
  mechanic: TankMechanic | null | undefined,
): Record<string, string> {
  const raw = mechanic?.localizationValues
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('ParamName') && value != null) out[key] = String(value)
  }
  return out
}

export function renderMechanicText(
  template: string | null | undefined,
  values: Record<string, string> | null | undefined,
): string | null {
  if (typeof template !== 'string' || !template) return null
  const table = values || {}
  let missing = false
  const text = template.replace(/%\(([^)]+)\)/g, (_match, key: string) => {
    const value = table[key]
    if (value == null) {
      missing = true
      return ''
    }
    return value
  })
  return missing ? null : text.replace(/<br\s*\/?>/gi, '\n')
}

export function mechanicLang(locale: string | null | undefined): 'en' | 'zh-Hans' | 'ru' {
  if (locale === 'zh' || locale === 'zh-Hans') return 'zh-Hans'
  if (locale === 'ru') return 'ru'
  return 'en'
}

export function mechanicTextFor(
  table: TankMechanicsTable | null | undefined,
  mechanic: TankMechanic,
  locale: string | null | undefined,
): { title: string | null; description: string | null } {
  const row = table?.mechanics?.[mechanic.name]
  const lang = mechanicLang(locale)
  const title = row?.title?.[lang] ?? null
  const description = renderMechanicText(row?.description?.[lang], mechanicParamValues(mechanic))
  return { title, description }
}