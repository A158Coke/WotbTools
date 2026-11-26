#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const catalogDir = resolve(repoRoot, 'common/wotb-item-catalog-json')
const outFile = resolve(__dirname, '../src/data/loadoutItems.js')

const readItems = (file) => JSON.parse(readFileSync(resolve(catalogDir, file), 'utf8')).items

const ZH_PROVISION = {
  SMALL_FOOD: '小补给',
  LARGE_FOOD: '大补给',
}

const ZH_EQUIPMENT = {
  107: '弹药超荷',
}

const RU_CONSUMABLE = {
  AUTOMATIC_FIRE_EXTINGUISHER: 'Автоматический огнетушитель',
  FIRST_AID_KIT: 'Аптечка',
  REPAIR_KIT: 'Ремкомплект',
  ENGINE_POWER_BOOST: 'Форсирование двигателя',
  ADRENALINE: 'Адреналин',
  MULTI_PURPOSE_RESTORATION_PACK: 'Многоцелевой ремонтный набор',
  IMPROVED_ENGINE_POWER_BOOST: 'Улучшенное форсирование двигателя',
  RETICLE_CALIBRATION: 'Калибровка прицела',
  SHELL_RELOAD_BOOST: 'Ускорение перезарядки',
  REACTIVE_ARMOR: 'Динамическая защита',
  TUNGSTEN_SHELLS: 'Вольфрамовые снаряды',
  DYNAMIC_ARMOUR_SYSTEM: 'Система динамической брони',
  REDUCED_ENGINE_POWER_BOOST: 'Сниженное форсирование двигателя',
}

const RU_PROVISION = {
  SMALL_FOOD: 'Малый паёк',
  LARGE_FOOD: 'Большой паёк',
  STANDARD_FUEL: 'Стандартное топливо',
  IMPROVED_FUEL: 'Улучшенное топливо',
  PROTECTIVE_KIT: 'Защитный комплект',
  SANDBAG_ARMOR: 'Мешки с песком',
  ENHANCED_SANDBAG_ARMOR: 'Усиленные мешки с песком',
  GEAR_OIL: 'Масло для КПП',
  IMPROVED_GEAR_OIL: 'Улучшенное масло для КПП',
  IMPROVED_GUNPOWDER: 'Улучшенный порох',
  SPALL_LINER: 'Противоосколочный подбой',
}

const RU_EQUIPMENT = {
  100: 'Орудийный досылатель',
  101: 'Расходники повышенного качества',
  102: 'Улучшенная вентиляция',
  103: 'Калиброванные снаряды',
  104: 'Улучшенный привод наводки',
  105: 'Вертикальный стабилизатор',
  106: 'Точное орудие',
  107: 'Суперзарядник',
  108: 'Улучшенные модули',
  120: 'Доработанные модули +',
  109: 'Система защиты',
  110: 'Усиленная броня',
  111: 'Улучшенная сборка',
  112: 'Усиленные гусеницы',
  113: 'Ящик с инструментами',
  114: 'Улучшенная оптика',
  115: 'Маскировочная сеть',
  116: 'Улучшенное управление',
  117: 'Ускоритель двигателя',
  118: 'Система подачи расходников',
  122: 'Улучшенный вертикальный стабилизатор',
  123: 'Улучшенная подвеска',
}

const mapToObject = (items, keyFn, ruOverlay, zhOverlay = {}) => {
  const out = {}
  for (const item of items) {
    const key = String(keyFn(item))
    out[key] = {
      zh: zhOverlay[key] ?? item.nameZh,
      en: item.nameEn,
      ru: ruOverlay[key] ?? null,
    }
  }
  return out
}

const consumables = mapToObject(readItems('consumables.json'), (i) => i.code, RU_CONSUMABLE)
const provisions = mapToObject(readItems('provisions.json'), (i) => i.code, RU_PROVISION, ZH_PROVISION)
const equipment = mapToObject(readItems('equipment.json'), (i) => i.id, RU_EQUIPMENT, ZH_EQUIPMENT)

const indent = (obj, pad) => JSON.stringify(obj, null, 2).replace(/\n/g, `\n${' '.repeat(pad)}`)

const body = `/**
 * Battle Playback 战斗装载（consumable / provision / equipment）本地化名称。
 *
 * ⚠️ 本文件由 \`frontend/scripts/generate-loadout-items.mjs\` 自动生成，请勿手工编辑。
 * 单一来源：en 取自 \`common/wotb-item-catalog-json/**\` authoritative catalog；zh 默认取 catalog，
 * 仅允许生成脚本内显式 UI 术语 overlay；ru 由生成脚本内 RU overlay 提供。后端 DTO 只返回稳定协议标识
 * （logicalItemId / equipmentId），用户可见文案一律由本模块 + i18n 提供，绝不裸露
 * raw protocol ID（装载契约见 docs/features/battle-playback.md）。
 *
 * 契约：unknown 条目（null logicalItemId / 无映射 equipmentId）由调用方走
 * \`recon.map.playback.loadout_unknown\` fallback 并保留 raw id 仅作诊断。
 */

/** consumable：logicalItemId -> { zh, en, ru } */
export const CONSUMABLE_NAMES = ${indent(consumables, 0)}

/** provision：logicalItemId -> { zh, en, ru } */
export const PROVISION_NAMES = ${indent(provisions, 0)}

/** equipment：numeric equipmentId -> { zh, en, ru } */
export const EQUIPMENT_NAMES = ${indent(equipment, 0)}

/**
 * 解析 loadout 条目显示名。
 * @param {'consumable'|'provision'|'equipment'} scope
 * @param {string|number|null} id logicalItemId / equipmentId（null 或未知 -> null，交由调用方 fallback）
 * @param {string} locale zh|en|ru
 * @returns {string|null} 本地化名称；无法映射返回 null。
 */
export function loadoutItemLabel(scope, id, locale) {
  if (id == null || id === '') return null
  const map = scope === 'consumable' ? CONSUMABLE_NAMES
    : scope === 'provision' ? PROVISION_NAMES
      : EQUIPMENT_NAMES
  const entry = map[String(id)]
  if (!entry) return null
  const lang = locale === 'zh' || locale === 'en' || locale === 'ru' ? locale : 'en'
  return entry[lang] || entry.en
}
`

writeFileSync(outFile, body, 'utf8')
console.log(`generated ${outFile}`)
