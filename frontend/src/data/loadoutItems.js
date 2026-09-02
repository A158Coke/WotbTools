/**
 * Battle Playback 战斗装载（consumable / provision / equipment）本地化名称。
 *
 * ⚠️ 本文件由 `frontend/scripts/generate-loadout-items.mjs` 自动生成，请勿手工编辑。
 * 单一来源：zh/nameEn 取自 `common/wotb-item-catalog-json/**` authoritative catalog；
 * ru 由生成脚本内的 RU overlay 提供（官方游戏术语）。后端 DTO 只返回稳定协议标识
 * （logicalItemId / equipmentId），用户可见文案一律由本模块 + i18n 提供，绝不裸露
 * raw protocol ID（plan §21/§22/§23）。
 *
 * 契约：unknown 条目（null logicalItemId / 无映射 equipmentId）由调用方走
 * `recon.map.playback.loadout_unknown` fallback 并保留 raw id 仅作诊断。
 */

/** consumable：logicalItemId -> { zh, en, ru } */
export const CONSUMABLE_NAMES = {
  "AUTOMATIC_FIRE_EXTINGUISHER": {
    "zh": "自动灭火器",
    "en": "Automatic Fire Extinguisher",
    "ru": "Автоматический огнетушитель"
  },
  "FIRST_AID_KIT": {
    "zh": "急救包",
    "en": "First Aid Kit",
    "ru": "Аптечка"
  },
  "REPAIR_KIT": {
    "zh": "修理箱",
    "en": "Repair Kit",
    "ru": "Ремкомплект"
  },
  "ENGINE_POWER_BOOST": {
    "zh": "发动机功率增压",
    "en": "Engine Power Boost",
    "ru": "Форсирование двигателя"
  },
  "ADRENALINE": {
    "zh": "肾上腺素",
    "en": "Adrenaline",
    "ru": "Адреналин"
  },
  "MULTI_PURPOSE_RESTORATION_PACK": {
    "zh": "多功能恢复包",
    "en": "Multi-Purpose Restoration Pack",
    "ru": "Многоцелевой ремонтный набор"
  },
  "IMPROVED_ENGINE_POWER_BOOST": {
    "zh": "改进型发动机功率增压",
    "en": "Improved Engine Power Boost",
    "ru": "Улучшенное форсирование двигателя"
  },
  "RETICLE_CALIBRATION": {
    "zh": "瞄准校准",
    "en": "Reticle Calibration",
    "ru": "Калибровка прицела"
  },
  "SHELL_RELOAD_BOOST": {
    "zh": "炮弹装填加速",
    "en": "Shell Reload Boost",
    "ru": "Ускорение перезарядки"
  },
  "REACTIVE_ARMOR": {
    "zh": "反应装甲",
    "en": "Reactive Armor",
    "ru": "Динамическая защита"
  },
  "TUNGSTEN_SHELLS": {
    "zh": "钨芯炮弹",
    "en": "Tungsten Shells",
    "ru": "Вольфрамовые снаряды"
  },
  "DYNAMIC_ARMOUR_SYSTEM": {
    "zh": "动态装甲系统",
    "en": "Dynamic Armour System",
    "ru": "Система динамической брони"
  },
  "REDUCED_ENGINE_POWER_BOOST": {
    "zh": "次级强化引擎",
    "en": "Reduced Engine Power Boost",
    "ru": "Сниженное форсирование двигателя"
  }
}

/** provision：logicalItemId -> { zh, en, ru } */
export const PROVISION_NAMES = {
  "SMALL_FOOD": {
    "zh": "小补给",
    "en": "Small Food",
    "ru": "Малый паёк"
  },
  "LARGE_FOOD": {
    "zh": "大补给",
    "en": "Large Food",
    "ru": "Большой паёк"
  },
  "STANDARD_FUEL": {
    "zh": "标准燃料",
    "en": "Standard Fuel",
    "ru": "Стандартное топливо"
  },
  "IMPROVED_FUEL": {
    "zh": "改进型燃料",
    "en": "Improved Fuel",
    "ru": "Улучшенное топливо"
  },
  "PROTECTIVE_KIT": {
    "zh": "防护套装",
    "en": "Protective Kit",
    "ru": "Защитный комплект"
  },
  "SANDBAG_ARMOR": {
    "zh": "沙袋装甲",
    "en": "Sandbag Armor",
    "ru": "Мешки с песком"
  },
  "ENHANCED_SANDBAG_ARMOR": {
    "zh": "强化沙袋装甲",
    "en": "Enhanced Sandbag Armor",
    "ru": "Усиленные мешки с песком"
  },
  "GEAR_OIL": {
    "zh": "齿轮油",
    "en": "Gear Oil",
    "ru": "Масло для КПП"
  },
  "IMPROVED_GEAR_OIL": {
    "zh": "改进型齿轮油",
    "en": "Improved Gear Oil",
    "ru": "Улучшенное масло для КПП"
  },
  "IMPROVED_GUNPOWDER": {
    "zh": "改进型火药",
    "en": "Improved Gunpowder",
    "ru": "Улучшенный порох"
  },
  "SPALL_LINER": {
    "zh": "防破片内衬",
    "en": "Spall Liner",
    "ru": "Противоосколочный подбой"
  }
}

/** equipment：numeric equipmentId -> { zh, en, ru } */
export const EQUIPMENT_NAMES = {
  "100": {
    "zh": "火炮输弹机",
    "en": "Gun Rammer",
    "ru": "Орудийный досылатель"
  },
  "101": {
    "zh": "高级消耗品",
    "en": "High-End Consumables",
    "ru": "Расходники повышенного качества"
  },
  "102": {
    "zh": "改进型通风系统",
    "en": "Improved Ventilation",
    "ru": "Улучшенная вентиляция"
  },
  "103": {
    "zh": "校准炮弹",
    "en": "Calibrated Shells",
    "ru": "Калиброванные снаряды"
  },
  "104": {
    "zh": "改进型炮控系统",
    "en": "Enhanced Gun Laying Drive",
    "ru": "Улучшенный привод наводки"
  },
  "105": {
    "zh": "垂直稳定器",
    "en": "Vertical Stabilizer",
    "ru": "Вертикальный стабилизатор"
  },
  "106": {
    "zh": "精密火炮",
    "en": "Refined Gun",
    "ru": "Точное орудие"
  },
  "107": {
    "zh": "弹药超荷",
    "en": "Supercharger",
    "ru": "Суперзарядник"
  },
  "108": {
    "zh": "改进型模块",
    "en": "Improved Modules",
    "ru": "Улучшенные модули"
  },
  "109": {
    "zh": "防护系统",
    "en": "Defense System",
    "ru": "Система защиты"
  },
  "110": {
    "zh": "强化装甲",
    "en": "Enhanced Armor",
    "ru": "Усиленная броня"
  },
  "111": {
    "zh": "改进型组装",
    "en": "Improved Assembly",
    "ru": "Улучшенная сборка"
  },
  "112": {
    "zh": "强化履带",
    "en": "Enhanced Tracks",
    "ru": "Усиленные гусеницы"
  },
  "113": {
    "zh": "工具箱",
    "en": "Toolbox",
    "ru": "Ящик с инструментами"
  },
  "114": {
    "zh": "改进型光学系统",
    "en": "Improved Optics",
    "ru": "Улучшенная оптика"
  },
  "115": {
    "zh": "伪装网",
    "en": "Camouflage Net",
    "ru": "Маскировочная сеть"
  },
  "116": {
    "zh": "改进型操控",
    "en": "Improved Control",
    "ru": "Улучшенное управление"
  },
  "117": {
    "zh": "发动机加速器",
    "en": "Engine Accelerator",
    "ru": "Ускоритель двигателя"
  },
  "118": {
    "zh": "消耗品输送系统",
    "en": "Consumable Delivery System",
    "ru": "Система подачи расходников"
  },
  "120": {
    "zh": "改进型模块+",
    "en": "Improved Modules +",
    "ru": "Доработанные модули +"
  },
  "122": {
    "zh": "改进型垂直稳定器",
    "en": "Improved Vertical Stabilizer",
    "ru": "Улучшенный вертикальный стабилизатор"
  },
  "123": {
    "zh": "改进型悬挂",
    "en": "Improved Suspension",
    "ru": "Улучшенная подвеска"
  }
}

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
