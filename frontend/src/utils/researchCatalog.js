import { assetProvider } from '../scene/assetProvider.js'

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
    consumablesGameVersion: consumables.meta?.gameVersion || null,
    provisionsGameVersion: provisions.meta?.gameVersion || null,
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

export function itemIconUrl(kind, icon) {
  if (!icon) return null
  return ICON_URLS[kind]?.[`${icon}.webp`] || null
}

export function moduleIconUrl(kind) {
  return ICON_URLS.modules[`${kind}.webp`] || null
}

export function skillIconUrl(id) {
  return id ? ICON_URLS.skills[`${id}.webp`] || null : null
}

export function shellIconUrl(type) {
  return type ? ICON_URLS.shells[`${type}.webp`] || null : null
}

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

export function deviceById(devices, id) {
  if (!Array.isArray(devices)) return null
  return devices.find(device => Number(device?.id) === Number(id)) || null
}

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

export function scriptMap(items, stems) {
  const want = new Set(stems || [])
  const out = {}
  for (const item of items) {
    if (want.has(item.stem) && item.script) out[item.stem] = item.script
  }
  return out
}

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

function ruleMatches(rule, tankRef) {
  if (!rule || typeof rule !== 'object') return false
  if (rule.tiers && !tiersMatch(rule, tankRef)) return false
  if (rule.ids && !(rule.ids.includes(`${tankRef.nation}:${tankRef.stem}`) || rule.ids.includes(String(tankRef.tankId)))) return false
  if (rule.nations && !rule.nations.includes(tankRef.nation)) return false
  if (rule.extendedTags && !rule.extendedTags.some(tag => tankRef.tags.includes(tag))) return false
  return Object.keys(rule).length > 0
}

export function itemAvailableForTank(item, tankRef) {
  const filter = item.filter
  if (!filter) return true
  if (Array.isArray(filter.exclude) && filter.exclude.some(rule => ruleMatches(rule, tankRef))) return false
  if (Array.isArray(filter.include) && filter.include.length > 0) {
    return filter.include.some(rule => ruleMatches(rule, tankRef))
  }
  return true
}

export function availableItems(items, tankRef, { mode = 'common' } = {}) {
  return items.filter(item => !item.isAbility && (mode ? item.mode === mode : true) && itemAvailableForTank(item, tankRef))
}
