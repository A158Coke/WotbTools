import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import type { SetupSelection } from '../../replay-local/compute/tankSetup'
import type { TankCharacteristics } from '../../replay-local/compute/characteristics'
import type { useTankopediaDetailData } from './useTankopediaDetailData'
import { moduleTreeLayout } from '../../utils/techTreeLayout.js'
import { computeCharacteristics, penetrationCoefficient } from '../../replay-local/compute/characteristics'
import { shellLabel, normType, isPremiumShell, fmtNum } from '../../scene/tankMeta.js'
import { shellIconUrl } from '../../utils/researchCatalog.js'
import { pitchDeviceBonus } from '../../replay-local/compute/tankSetup'
import { mechanicTextFor, trayShellFor } from '../../scene/tankMechanics'

import {
  buildComputeInput, decodeDevices, defaultShellIndex, encodeDevices, paramGroups, pickGun, pickTurret,
} from '../../replay-local/compute/tankSetup'

/** @param {{
 *  detailId: import('vue').ComputedRef<number|null>,
 *  writeState: (patch: object, options?: object) => void,
 *  data: object,           // useTankopediaDetailData 的返回
 *  cache: import('vue').Ref<object>,
 *  route: object,
 *  VIEW: string,
 *  locale: import('vue').Ref<string>,
 *  t: (key: string, params?: unknown) => string,
 *  te: (key: string) => boolean,
 * }} ctx */
type TreeNode = { stem: string; tankId: number; tier?: number }
type GraphNode = { install?: { kind: string; index: number; occurrences: { turret: number; gun: number }[] } }
type SetupContext = {
  detailId: ComputedRef<number | null>; writeState: (patch: Record<string, unknown>) => void
  data: ReturnType<typeof useTankopediaDetailData>; cache: Ref<Record<string, { name?: string; tier?: number }>>
  route: RouteLocationNormalizedLoaded; VIEW: string; locale: Ref<string>
  t: (key: string, params?: unknown) => string
}
export function useTankopediaSetupModel({ detailId, writeState, data, cache, route, VIEW, locale, t }: SetupContext) {
  const { detail, modules, catalog, techTree, mechanicsCatalog, upgradeSelection, cfgs, setup } = data

  const researchOpen = ref(false)
  const isXiResearch = computed(() => !!modules.value?.upgradeProgression)

  const augmentInstalled = computed(() => {
    if (!isXiResearch.value) return []
    const sel = upgradeSelection.value
    if (!sel.available) return []
    if (sel.mode === 'custom') return sel.abilities
    if (sel.mode !== 'top') return []
    return [
      ...sel.nodes.filter(n => n.type !== 'NODETYPE_ALTERNATIVE_MECHANIC').map(n => n.id),
      ...sel.abilities,
    ]
  })
  const augmentChosen = computed(() => {
    const sel = upgradeSelection.value
    if (!sel.available) return {}
    return { ...sel.choices }
  })
  const augmentWritable = computed(() => upgradeSelection.value.supported !== false)
  function onAugmentResearch(ids: number[]) {
    if (!augmentWritable.value) return
    writeState({ upgrade: ids.length ? 'custom' : 'stock', abilities: ids })
  }
  function onAugmentResearchAll() {
    if (!augmentWritable.value) return
    writeState({ upgrade: 'top', abilities: [] })
  }
  function onAugmentResearchNone() {
    if (!augmentWritable.value) return
    writeState({ upgrade: 'stock', abilities: [] })
  }
  watch(detailId, () => { researchOpen.value = false })
  watch(() => route.query.view, view => { if (view !== VIEW) researchOpen.value = false }, { flush: 'sync' })

  const researchPrevVehicles = computed(() => {
    const stem = detail.value?.stem
    const nodes = techTree.value?.nodes
    if (!stem || !nodes?.length) return []
    const byStem = new Map<string, TreeNode>(nodes.map((n: TreeNode) => [n.stem, n]))
    const out = new Map()
    for (const edge of techTree.value.edges || []) {
      if (edge.to !== stem) continue
      const node = byStem.get(edge.from)
      if (!node || out.has(node.stem)) continue
      const summary = cache.value?.[String(node.tankId)]
      out.set(node.stem, {
        node,
        cost: Number(edge.cost?.xp) || null,
        name: summary?.name || node.stem,
      })
    }
    return [...out.values()]
  })

  const researchNextVehicles = computed(() => {
    if (!modules.value || !catalog.value) return []
    let layout = null
    try {
      layout = moduleTreeLayout(modules.value, setup.value, {})
    } catch {
      return []
    }
    if (!layout) return []
    const byStem = new Map<string, TreeNode>((techTree.value?.nodes || []).map((n: TreeNode) => [n.stem, n]))
    return layout.nextVehicles.map((v) => {
      const node = byStem.get(v.stem)
      const summary = node ? cache.value?.[String(node.tankId)] : null
      return {
        stem: v.stem,
        cost: v.cost || null,
        tankId: node?.tankId ?? null,
        name: summary?.name || node?.stem || v.stem,
        tier: Number(summary?.tier ?? node?.tier) || null,
        sourceModule: v.sourceModule,
        sourceKind: v.sourceKind,
      }
    })
  })

  function installFromGraph(node: GraphNode) {
    const m = modules.value
    const d = detail.value
    const sel = setup.value
    if (!m || !d || !sel?.canConfigure || !node?.install) return
    const ins = node.install
    if (ins.kind === 'engine') return writeSetup({ engine: ins.index })
    if (ins.kind === 'chassis') return writeSetup({ track: ins.index })
    if (ins.kind === 'turret') return writeSetup(pickTurret(sel, m, d, ins.index))
    if (ins.kind === 'gun') {
      const occ = ins.occurrences.find(o => o.turret === sel.turret) || ins.occurrences[0]
      const base = occ.turret === sel.turret ? sel : pickTurret(sel, m, d, occ.turret)
      return writeSetup(pickGun(base, m, d, occ.gun))
    }
  }

  function openVehicleFromGraph(tankId: number | null) {
    if (!tankId) return
    writeState({ tank: Number(tankId), config: null, engine: null, track: null, upgrade: null, abilities: [] })
  }

  const computeInput = computed(() => (setup.value.canConfigure && detail.value && modules.value && catalog.value
    && !(upgradeSelection.value.available
      && (upgradeSelection.value.mode === 'top' || upgradeSelection.value.mode === 'custom')
      && !upgradeSelection.value.supported)
    ? buildComputeInput({
      detail: detail.value, modules: modules.value, selection: setup.value, catalog: catalog.value,
    })
    : null))

  const characteristics = computed(() => (computeInput.value ? computeCharacteristics(computeInput.value) : null))
  const previousCharacteristics = ref<TankCharacteristics | null>(null)
  let resetTargetKey: string | null = null
  type SelectionKeyInput = Omit<SetupSelection, 'shell' | 'upgrade'> & { shell: number | null; upgrade?: SetupSelection['upgrade'] | null }
  const effectiveShell = (selection: SelectionKeyInput) => (selection.shell == null
    ? defaultShellIndex(cfgs.value[selection.config])
    : selection.shell)
  const selectionKey = (selection: SelectionKeyInput) => JSON.stringify([
    selection.config, effectiveShell(selection), selection.engine, selection.track,
    selection.devices, selection.consumables, selection.provisions,
    selection.skills, selection.conditionalSkills, selection.camouflage,
    selection.upgrade, selection.abilities,
  ])
  let lastSelectionKey: string | null = null
  let lastTankId: number | null = null
  watch(characteristics, (value, oldValue) => {
    const tankId = detail.value?.tank_id ?? null
    if (!value || tankId !== lastTankId) {
      previousCharacteristics.value = null
      lastSelectionKey = null
      lastTankId = tankId
      resetTargetKey = null
      return
    }
    const key = selectionKey(setup.value)
    if (key === lastSelectionKey) return
    lastSelectionKey = key
    if (resetTargetKey != null) {
      previousCharacteristics.value = key === resetTargetKey ? value : (oldValue || null)
      resetTargetKey = null
      return
    }
    previousCharacteristics.value = oldValue || null
  }, { flush: 'sync' })
  const paramTable = computed(() => (characteristics.value
    ? paramGroups(characteristics.value, previousCharacteristics.value || {}, catalog.value?.paramsFormat)
    : []))
  const deviceIds = computed(() => new Set(computeInput.value?.deviceIds || []))

  const mechanicRows = computed(() => {
    const list = Array.isArray(detail.value?.mechanics) ? detail.value.mechanics : []
    return list.map(mechanic => {
      const text = mechanicTextFor(mechanicsCatalog.value, mechanic, locale.value)
      return { ...mechanic, title: text.title, description: text.description }
    })
  })

  const shellRows = computed(() => data.shells.value.map((shell, index) => {
    const calibrated = deviceIds.value.has(103)
    const penetrationCoefficientValue = penetrationCoefficient(shell.type, calibrated)
    const near = shell.penetration == null ? null : shell.penetration * penetrationCoefficientValue
    const farRaw = shell.penetration_far == null ? null : shell.penetration_far * penetrationCoefficientValue
    const falloff = characteristics.value?._farPenetrationFalloffFactor ?? 1
    const tunedDamage = (shell.damage ?? 0) * (characteristics.value?._damageCoeff ?? 1)
    // 突击弹（TrayShell）逐段期望伤害：倍率乘在配置器算出的平均伤害上；只对 kinds
    // 内的弹种生效（APCR）。段标签按客户端文案语义：首段“≤d”，中段“a–b”，末段“≥a”
    // （末段的 distance 是最大射程，不是文案边界）。
    const tray = trayShellFor(detail.value?.mechanics, shell)
    const traySectors = tray?.sectors ?? null
    const damageByDistance = traySectors
      ? traySectors.map((sector, i) => {
        const previous = traySectors[i - 1]
        const lower = fmtNum(previous?.distance ?? sector.distance, 0)
        const label = i === 0
          ? t('agentTanks.mechanics.distance_at_most', { distance: fmtNum(sector.distance, 0) })
          : i === traySectors.length - 1
            ? t('agentTanks.mechanics.distance_at_least', { distance: lower })
            : t('agentTanks.mechanics.distance_range', {
              from: lower,
              to: fmtNum(sector.distance, 0),
            })
        return {
          ...sector,
          label,
          percent: Math.round(sector.factor * 100),
          damage: Math.round(tunedDamage * sector.factor),
        }
      })
      : null
    return {
      ...shell,
      index,
      selected: index === setup.value.shell,
      label: shellLabel(shell) || normType(shell.type),
      premium: isPremiumShell(shell),
      iconUrl: shellIconUrl(shell.type),
      range: shell.range ?? null,
      maxAmmo: modules.value?.turrets?.[setup.value.turret]?.guns?.[setup.value.gun]?.stats?.maxAmmo ?? null,
      explosionRadius: shell.explosion_radius ?? null,
      tunedPenetration: near,
      tunedPenetrationFar: near == null || farRaw == null ? farRaw : near - (near - farRaw) * falloff,
      tunedDamage,
      tunedVelocity: shell.velocity == null ? null : shell.velocity * (characteristics.value?._shellVelocityFactor ?? 1),
      tunedModuleDamage: (shell.module_damage ?? 0) * (characteristics.value?._damageCoeff ?? 1),
      damageByDistance,
    }
  }))

  const moduleLang = computed(() => (locale.value === 'zh' ? 'zh-Hans' : 'en'))
  function moduleName(item: Record<string, unknown> | null) {
    if (!item) return ''
    const name = [item[`name_${moduleLang.value}`], item.name_en, item['name_zh-Hans'], item.name]
      .find(value => typeof value === 'string' && value.trim() && !value.trim().startsWith('#'))
    return name || (typeof item.stem === 'string' ? item.stem.replaceAll('_', ' ').trim() : '') || '—'
  }
  const currentTurret = computed(() => modules.value?.turrets?.[setup.value.turret] || null)
  const currentGun = computed(() => currentTurret.value?.guns?.[setup.value.gun] || null)
  const currentEngine = computed(() => modules.value?.engines?.[setup.value.engine] || null)
  const currentTrack = computed(() => modules.value?.chassis?.[setup.value.track] || null)

  const gunMeta = computed(() => {
    const config = data.curCfg.value
    if (!config || !characteristics.value) return null
    const type = config.is_drum ? 'autoreloader' : config.is_burst ? 'autoloader' : 'regular'
    return { caliber: config.caliber ?? null, type }
  })

  const yawLimits = computed(() => data.curCfg.value?.yaw_limits || null)
  const pitchBonus = computed(() => {
    const initialPitch = Number(modules.value?.initialTurretRotation?.pitch) || 0
    const hasStabilizer = deviceIds.value.has(122)
    const stabilizer = pitchDeviceBonus(deviceIds.value, catalog.value)
    if (hasStabilizer && !stabilizer) return null
    if (!stabilizer && !initialPitch) return null
    const up = stabilizer?.up || 0
    const down = stabilizer?.down || 0
    return { up: up - initialPitch, down: down + initialPitch }
  })


  function applyModulePreset(kind: 'stock' | 'top') {
    writeSetup({
      ...(upgradeSelection.value.available
        ? { upgrade: kind === 'stock' ? 'stock' : 'top', abilities: [] } : {}),
      config: kind === 'stock' ? 0 : Math.max(0, cfgs.value.length - 1),
      engine: kind === 'stock' ? 0 : Math.max(0, (modules.value?.engines?.length || 1) - 1),
      track: kind === 'stock' ? 0 : Math.max(0, (modules.value?.chassis?.length || 1) - 1),
    })
  }

  function writeSetup(patch: Partial<Omit<SetupSelection, 'shell' | 'upgrade'>> & { shell?: number | null; upgrade?: SetupSelection['upgrade'] | null }) {
    const next = { ...setup.value, ...patch }
    const configChanged = patch.config != null && patch.config !== setup.value.config
    writeState({
      config: next.config,
      engine: next.engine,
      track: next.track,
      shell: configChanged ? null : next.shell,
      dev: encodeDevices(next.devices),
      cons: next.consumables,
      prov: next.provisions,
      skills: next.skills,
      conditionalSkills: next.conditionalSkills,
      camo: next.camouflage,
      upgrade: next.upgrade,
      abilities: next.abilities || [],
    })
  }

  function selectShell(index: number) {
    const config = cfgs.value[setup.value.config]
    writeSetup({ shell: index === defaultShellIndex(config) ? null : index })
  }

  function cycleSkill(id: string, maxLevel = false) {
    const current = Number(setup.value.skills?.[id]) || 0
    const next = maxLevel ? 7 : current >= 7 ? 0 : current + 1
    const skills = { ...(setup.value.skills || {}) }
    if (next > 0) skills[id] = next
    else delete skills[id]
    writeSetup({ skills })
  }

  function maxSkills() {
    writeSetup({ skills: Object.fromEntries(Object.keys(catalog.value?.skills || {}).map(id => [id, 7])) })
  }

  function clearSkills() {
    writeSetup({ skills: {}, conditionalSkills: false })
  }

  function resetSetup() {
    const target = {
      ...(upgradeSelection.value.available ? { upgrade: null, abilities: [] } : {}),
      config: Math.max(0, cfgs.value.length - 1),
      engine: Math.max(0, (modules.value?.engines?.length || 1) - 1),
      track: Math.max(0, (modules.value?.chassis?.length || 1) - 1),
      shell: null,
      devices: decodeDevices(''),
      consumables: [],
      provisions: [],
      skills: {},
      conditionalSkills: false,
      camouflage: false,
    }
    resetTargetKey = selectionKey({ ...setup.value, ...target })
    if (selectionKey(setup.value) === resetTargetKey) {
      previousCharacteristics.value = characteristics.value
      resetTargetKey = null
    }
    writeSetup(target)
  }

  const configForArmor = computed(() => (setup.value.canConfigure ? setup.value.config : data.cfgIdx.value))

  return {
    researchOpen, isXiResearch,
    augmentInstalled, augmentChosen, augmentWritable,
    onAugmentResearch, onAugmentResearchAll, onAugmentResearchNone,
    researchPrevVehicles, researchNextVehicles,
    installFromGraph, openVehicleFromGraph,
    computeInput, characteristics, previousCharacteristics,
    effectiveShell, selectionKey, paramTable, deviceIds,
    mechanicRows, shellRows, moduleLang, moduleName,
    currentTurret, currentGun, currentEngine, currentTrack,
    gunMeta, yawLimits, pitchBonus,
    applyModulePreset, writeSetup, selectShell, cycleSkill, maxSkills, clearSkills, resetSetup,
    configForArmor,
  }
}
