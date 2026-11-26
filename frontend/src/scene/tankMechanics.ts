/**
 * 车辆机制（客户端 `eGameplayMechanics`）的纯函数层。
 *
 * 数据来源：
 * - 逐车机制清单 = 资产包 `tank/{id}.json` 顶层 `mechanics`（上游
 *   `tools/export_tank_mechanics.py` 从客户端 `3d/Tanks/Parameters/*.yaml` 导出）；
 * - 机制标题/说明 = 资产包 `data/tankMechanics.json` 的 `mechanics.<name>.title/
 *   description.<lang>`（客户端 `TankMechanics/*` 官方文案，含 `%(ParamNameN)` 占位符）；
 * - TrayShell 的分段 = 机制条目的 `kinds` + `sectors`（客户端 `<trayShell>` 结构，
 *   与 `localizationValues` 在导出时逐字对齐）。
 *
 * 语义边界（与客户端一致）：
 * - `sectors[i].distance` 是**该段的上界**；命中距离 `d <= distance` 时取该段
 *   factor（文案写“50 m or less”）。最后一段的 distance 是最大射程，伤害倍率从
 *   上一段边界起延伸到最大射程（文案写“200 m or more”）。
 * - 只对 `kinds` 列出的弹种生效（TrayShell = ARMOR_PIERCING_CR，标准/金币 APCR
 *   同 kind）；HE/AP/HEAT 不乘倍率。
 * - 数据缺失/结构异常返回 null（fail-closed），不猜默认倍率。
 */
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

/** 弹种 → 客户端 `<kind>` 语义枚举；未知 token 返回 null（不猜）。 */
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

/**
 * 该弹适用的 TrayShell 机制；无机制/弹种不匹配/分段缺失 → null。
 * `mechanics` 按客户端清单原顺序传入（同车最多一条 TrayShell）。
 */
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

/** 距离倍率：`d <= sectors[i].distance` 取该段；超出最后上界仍取最后一段。 */
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

/** 距离伤害：基础伤害 × 倍率，取整（客户端平均伤害是整数）；无分段 → 基础伤害。 */
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

/**
 * 官方文案的 `%(ParamNameN)` 值：机制条目 `localizationValues` 原样映射为
 * `{ ParamName1: "50", ... }`；缺失 → 空表。
 */
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

/**
 * 渲染官方文案模板：替换 `%(ParamNameN)`，并把客户端富文本的 `<br/>` 还原为换行。
 * 任一位缺失 → null（fail-closed，不向用户显示裸占位符）。
 *
 * 客户端原文只用到 `<br/>`（ReserveAmmo 三语都是 `…<br/><br/>…`）；这里只做这一种
 * 富文本还原，不猜测/剥离其他标记——出现未知标记时按原文显示，便于发现数据变化。
 */
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

/** 当前语言的文案键：WotbTools 语言码 → 资产包语言（zh → zh-Hans）。 */
export function mechanicLang(locale: string | null | undefined): 'en' | 'zh-Hans' | 'ru' {
  if (locale === 'zh' || locale === 'zh-Hans') return 'zh-Hans'
  if (locale === 'ru') return 'ru'
  return 'en'
}

/** 从全局文案表取某机制在当前语言的标题/说明（缺失 → null）。 */
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