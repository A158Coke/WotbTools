/**
 * 研发/配置数据面加载器（数据源 = 资产包 `research/`，由上游 WoT-Blitz-Agent 仓
 * `tools/export_research_loadout.py` 从本机客户端解包导出，`meta.json.gameVersion` 锚定）。
 *
 * 所有配置器数据（装备/物品/技能/参数/涂装/逐车模块）都由资产包提供，`common/research/`
 * 只保留全局共享的图标集。职责：加载目录、vehicleFilter 求值（include 各规则 AND、
 * 规则间 OR，exclude 命中即排除；extendedTags 全语义）、装备槽位 → 设备 id 解析。
 * 纯数据 + 纯函数；组件只消费，不做第二次解析。
 */
import { assetProvider } from '../scene/assetProvider.js'

/**
 * 全局配置器目录（资产包 `/research/*.json`；不含逐车模块）。
 * 缓存 Promise，同一页面生命周期只拉一次；失败清除后可重试。
 */
let catalogPromise = null

export function loadResearchCatalog() {
  if (catalogPromise) return catalogPromise
  catalogPromise = Promise.all([
    assetProvider.json('/research/devices.json'),
    assetProvider.json('/research/consumables.json'),
    assetProvider.json('/research/provisions.json'),
    assetProvider.json('/research/params/format.json'),
    assetProvider.json('/research/params/structure.json'),
    assetProvider.json('/research/camouflage.json'),
    assetProvider.json('/research/skills.json'),
  ]).then(([devices, consumables, provisions, format, structure, camouflage, skills]) => Object.freeze({
    gameVersion: devices.meta?.gameVersion || null,
    devices: devices.devices,
    devicePresets: devices.presets,
    consumables: consumables.items,
    provisions: provisions.items,
    paramsFormat: format.params,
    paramsStructure: structure,
    camouflage: { defaultCategory: camouflage.defaultCategory, categories: camouflage.categories },
    skills: skills.items,
    crewSkillClasses: skills.classes,
  })).catch((error) => {
    catalogPromise = null
    throw error
  })
  return catalogPromise
}

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

/**
 * 逐车模块数据（tank-specific，随**资产包** `/research/modules/{nation}.json` 发布）。
 *
 * 不进入前端构建：新坦克/模块数值只更新资产包即可生效，不需要 WotbTools 发版。
 * 缓存 Promise 让同一国别的并发请求只发一次；失败时清除，下一次可重试。
 */
const modulesCache = new Map()

export function loadTankModules(nation) {
  if (modulesCache.has(nation)) return modulesCache.get(nation)
  const promise = assetProvider.json(`/research/modules/${nation}.json`).catch((error) => {
    modulesCache.delete(nation)
    throw error
  })
  modulesCache.set(nation, promise)
  return promise
}

/**
 * 科技树布局数据（随资产包 `/research/tech_tree/{nation}.json` 发布；上游
 * `export_research_loadout.py --with-research-graph` 导出）。nodes 带 x/y 网格坐标
 * （x=列 y=行，列≠tier）、tankId/tier/price/tags；pending = 科技树已登记但未实装的
 * XI 展示位（只有坐标，无名称/价格——不造数据）；edges = 整车研发边
 * （`<unlocks><vehicle>`，from/to 为车辆 stem）。
 */
const techTreeCache = new Map()

export function loadTechTree(nation) {
  if (techTreeCache.has(nation)) return techTreeCache.get(nation)
  const promise = assetProvider.json(`/research/tech_tree/${nation}.json`).catch((error) => {
    techTreeCache.delete(nation)
    throw error
  })
  techTreeCache.set(nation, promise)
  return promise
}

/** 装备 id → 目录条目（回放 `shooter_equipment.raw` 徽标的唯一反查源；未知 id 返回 null）。 */
export function deviceById(devices, id) {
  if (!Array.isArray(devices)) return null
  return devices.find(device => Number(device?.id) === Number(id)) || null
}

/**
 * 只装装备目录（devices.json）的轻加载器：装甲查看器/回放徽标只需要 id→图标/名称，
 * 不为徽标拉整份配置器目录（params/技能/涂装）。缓存 Promise，与 loadResearchCatalog
 * 各自独立；失败清除后可重试。
 */
let devicesPromise = null

export function loadDevices() {
  if (devicesPromise) return devicesPromise
  devicesPromise = assetProvider.json('/research/devices.json').then(data => Object.freeze({
    gameVersion: data.meta?.gameVersion || null,
    devices: data.devices,
    devicePresets: data.presets,
  })).catch((error) => {
    devicesPromise = null
    throw error
  })
  return devicesPromise
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
export function resolveDeviceIds(presetSlots, choices, devices) {
  if (!Array.isArray(presetSlots)) return []
  const byStem = new Map((devices || []).map(device => [device.stem, device]))
  const ids = []
  for (let i = 0; i < presetSlots.length; i += 1) {
    const choice = choices?.[i]
    if (choice !== 0 && choice !== 1) continue
    const stem = choice === 0 ? presetSlots[i].left : presetSlots[i].right
    const device = stem ? byStem.get(stem) : null
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
