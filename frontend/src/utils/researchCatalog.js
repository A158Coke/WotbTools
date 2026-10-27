/**
 * 研发/配置数据面加载器（数据源 = 仓库 common/research/，由上游 WoT-Blitz-Agent 仓
 * tools/export_research_loadout.py 从本机客户端解包导出，meta.json.gameVersion 锚定）。
 *
 * 职责：加载装备/物品目录与逐车模块数据、vehicleFilter 求值（include 各规则 AND、
 * 规则间 OR，exclude 命中即排除；extendedTags 全语义）、装备槽位 → 设备 id 解析。
 * 纯数据 + 纯函数；组件只消费，不做第二次解析。
 */
import DEVICES_JSON from '../../../common/research/devices.json'
import CONSUMABLES_JSON from '../../../common/research/consumables.json'
import PROVISIONS_JSON from '../../../common/research/provisions.json'
import PARAMS_FORMAT_JSON from '../../../common/research/params/format.json'
import PARAMS_STRUCTURE_JSON from '../../../common/research/params/structure.json'
import CAMOUFLAGE_JSON from '../../../common/research/camouflage.json'
import SKILLS_JSON from '../../../common/research/skills.json'

export const RESEARCH_META = Object.freeze({
  gameVersion: DEVICES_JSON.meta.gameVersion,
  devices: DEVICES_JSON.devices,
  devicePresets: DEVICES_JSON.presets,
  consumables: CONSUMABLES_JSON.items,
  provisions: PROVISIONS_JSON.items,
  paramsFormat: PARAMS_FORMAT_JSON.params,
  paramsStructure: PARAMS_STRUCTURE_JSON,
  camouflage: { defaultCategory: CAMOUFLAGE_JSON.defaultCategory, categories: CAMOUFLAGE_JSON.categories },
  skills: SKILLS_JSON.items,
  crewSkillClasses: SKILLS_JSON.classes,
})

/** 乘员技能 id（skills.json 的 20 项；训练资格按车型，效果全局生效）。 */
export const SKILL_IDS = Object.freeze(Object.keys(SKILLS_JSON.items))


/**
 * 客户端图标（构建期打成一个 URL 表）：物品来自客户端 UI 样式表 bg-sprite 映射并裁成
 * 独立 webp（icons/items/<kind>/<icon>.webp），模块是 ModulesTechTree 的 5 张类型图。
 * 缺图（manifest.missing）时返回 null，由组件回退文本——图标缺失不影响任何数值语义。
 */
const ITEM_ICON_URLS = import.meta.glob('../../../common/research/icons/items/**/*.webp', {
  eager: true, query: '?url', import: 'default',
})
const MODULE_ICON_URLS = import.meta.glob('../../../common/research/icons/modules/*.webp', {
  eager: true, query: '?url', import: 'default',
})
const SKILL_ICON_URLS = import.meta.glob('../../../common/research/icons/skills/*.webp', {
  eager: true, query: '?url', import: 'default',
})
const SHELL_ICON_URLS = import.meta.glob('../../../common/research/icons/shells/*.webp', {
  eager: true, query: '?url', import: 'default',
})

/** glob 键 → 相对 icons/ 的稳定后缀（Vite 在 Windows 也返回正斜杠）。 */
function iconUrls(modules, prefix) {
  const out = {}
  for (const key of Object.keys(modules)) {
    const index = key.indexOf(prefix)
    if (index >= 0) out[key.slice(index + prefix.length)] = modules[key]
  }
  return out
}

const ICON_URLS = {
  devices: iconUrls(ITEM_ICON_URLS, 'icons/items/devices/'),
  consumables: iconUrls(ITEM_ICON_URLS, 'icons/items/consumables/'),
  provisions: iconUrls(ITEM_ICON_URLS, 'icons/items/provisions/'),
  modules: iconUrls(MODULE_ICON_URLS, 'icons/modules/'),
  skills: iconUrls(SKILL_ICON_URLS, 'icons/skills/'),
  shells: iconUrls(SHELL_ICON_URLS, 'icons/shells/'),
}

/** 物品图标 URL（kind = devices | consumables | provisions）；无图返回 null。 */
export function itemIconUrl(kind, icon) {
  if (!icon) return null
  return ICON_URLS[kind]?.[`${icon}.webp`] || null
}

/** 模块类型图标 URL（kind = chassis | engine | gun | hull | turret）。 */
export function moduleIconUrl(kind) {
  return ICON_URLS.modules[`${kind}.webp`] || null
}

/** 乘员技能图标 URL（skill id）；无图返回 null。 */
export function skillIconUrl(id) {
  return id ? ICON_URLS.skills[`${id}.webp`] || null : null
}

/** 弹种图标 URL（客户端 type，如 ap / ap_cr_premium / he）。 */
export function shellIconUrl(type) {
  return type ? ICON_URLS.shells[`${type}.webp`] || null : null
}

const DEVICES_BY_STEM = new Map(DEVICES_JSON.devices.map(d => [d.stem, d]))
const DEVICES_BY_ID = new Map(DEVICES_JSON.devices.map(d => [d.id, d]))

export function deviceById(id) {
  return DEVICES_BY_ID.get(id) || null
}

export function deviceByStem(stem) {
  return DEVICES_BY_STEM.get(stem) || null
}

/** 逐车模块数据（按 nation 懒加载独立 chunk）。 */
const modulesCache = new Map()

export async function loadTankModules(nation) {
  if (modulesCache.has(nation)) return modulesCache.get(nation)
  const mod = await import(`../../../common/research/modules/${nation}.json`)
  const data = mod.default
  modulesCache.set(nation, data)
  return data
}

/**
 * 已选物品 stem → 客户端 `<script>` 摘要（计算引擎 provisionScripts/consumableScripts
 * 入参；食物类乘员加成等唯一权威在 script，UI 必须经此构造，勿手写数值）。
 */
export function scriptMap(items, stems) {
  const want = new Set(stems || [])
  const out = {}
  for (const item of items) {
    if (want.has(item.stem) && item.script) out[item.stem] = item.script
  }
  return out
}

/** 装备槽位选择（0=左候选 / 1=右候选 / null=空）→ 已选设备 id 列表（空槽跳过）。 */
export function resolveDeviceIds(presetSlots, choices) {
  if (!Array.isArray(presetSlots)) return []
  const ids = []
  for (let i = 0; i < presetSlots.length; i += 1) {
    const choice = choices?.[i]
    if (choice !== 0 && choice !== 1) continue
    const stem = choice === 0 ? presetSlots[i].left : presetSlots[i].right
    const device = stem ? DEVICES_BY_STEM.get(stem) : null
    if (device) ids.push(device.id)
  }
  return ids
}

function tiersMatch(rule, tankRef) {
  return tankRef.tier >= rule.tiers.min && tankRef.tier <= rule.tiers.max
}

/**
 * 单条规则 = 客户端一个 `<include>`/`<exclude>` 块：块内**全部条件同时满足**（AND）。
 * 例：ration 的 `<vehicle>6-10</vehicle><nations>ussr</nations>` = 苏联车且 6-10 级；
 * 早期实现按“有 tiers 就只看 tiers”短路，会把各国食物错误地发给所有车。
 */
function ruleMatches(rule, tankRef) {
  if (!rule || typeof rule !== 'object') return false
  if (rule.tiers && !tiersMatch(rule, tankRef)) return false
  if (rule.ids && !(rule.ids.includes(`${tankRef.nation}:${tankRef.stem}`) || rule.ids.includes(String(tankRef.tankId)))) return false
  if (rule.nations && !rule.nations.includes(tankRef.nation)) return false
  if (rule.extendedTags && !rule.extendedTags.some(tag => tankRef.tags.includes(tag))) return false
  return Object.keys(rule).length > 0
}

/**
 * vehicleFilter 求值：一个 include 块内条件 AND、多个块之间 OR；exclude 任一命中即排除。
 * 上游对照： BlitzKit checkConsumableProvisionInclusivity 只支持 tiers/ids/nations/CLIP，
 * 这里 extendedTags 全语义自实现（差异 golden 由测试锁定）。
 */
export function itemAvailableForTank(item, tankRef) {
  const filter = item.filter
  if (!filter) return true
  if (Array.isArray(filter.exclude) && filter.exclude.some(rule => ruleMatches(rule, tankRef))) return false
  if (Array.isArray(filter.include) && filter.include.length > 0) {
    return filter.include.some(rule => ruleMatches(rule, tankRef))
  }
  return true
}

/**
 * 当前车辆可用的装配物品（mode 过滤 + vehicleFilter）。
 * `isAbility` = 战斗内技能（客户端 `<isAbility/>`，如 desertPower 还带地图 geometryFilter），
 * 不是机库可选补给/消耗品，配置器物品池必须排除。
 */
export function availableItems(items, tankRef, { mode = 'common' } = {}) {
  return items.filter(item => !item.isAbility && (mode ? item.mode === mode : true) && itemAvailableForTank(item, tankRef))
}

/** 参数名/单位的本地化条目（strings/{lang}/research.json 由调用方按需动态 import）。 */
export async function loadResearchStrings(locale) {
  const lang = locale === 'ru' ? 'en' : locale === 'en' ? 'en' : 'zh-Hans'
  const mod = await import(`../../../common/research/strings/${lang}/research.json`)
  return mod.default.entries
}
