/**
 * AgentTankopedia —— 配置器 / 研发 / 特性派生模型（拆分自 AgentTankopedia.vue，行为原样）。
 * 研发树 ↔ 配置栏/参数面板三方共用同一 URL 状态；特性 delta 跟踪与弹种表联动。
 */
import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import type { SetupSelection } from '../../replay-local/compute/tankSetup'
import type { TankCharacteristics } from '../../replay-local/compute/characteristics'
import type { useTankopediaDetailData } from './useTankopediaDetailData'
import { moduleTreeLayout } from '../../utils/techTreeLayout.js'
import { computeCharacteristics, penetrationCoefficient } from '../../replay-local/compute/characteristics'
import { shellLabel, normType, isPremiumShell } from '../../scene/tankMeta.js'
import { shellIconUrl } from '../../utils/researchCatalog.js'
import { pitchDeviceBonus } from '../../replay-local/compute/tankSetup'

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
}
export function useTankopediaSetupModel({ detailId, writeState, data, cache, route, VIEW, locale }: SetupContext) {
  const { detail, modules, catalog, techTree, upgradeSelection, cfgs, setup } = data

  // ---- 研发弹窗（研发树 ↔ 配置栏/参数面板 三方共用同一 URL 状态） ----
  /** 研发弹窗开关。弹窗与配置栏模块矩阵共用同一个 `setup`（URL 状态），改动双向同步；
   *  换车（含弹窗里点下一级坦克）时关闭，避免把上一辆车的图留在窗口里。 */
  const researchOpen = ref(false)
  /** XI：modules 带客户端 upgradeProgression（研发界面切升级树形态）。 */
  const isXiResearch = computed(() => !!modules.value?.upgradeProgression)

  /**
   * 研发树事件写回 custom + abilities，投影（projectTankUpgrades）随之重算。
   * 树必须消费 `upgradeSelection` 的归一化结果（而不是原始 URL）：手工链接
   * `abilities=22,23,24` 投影只取每组一项，若树直接读 URL 会把三项都标成已研发。
   */
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
  /** 升级元数据不可用（版本/脚本/投影字段缺失）时禁止写入研发状态：树保持只读展示。 */
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
  // 离开坦克百科（打开 3D 等）时不能把模态留在别的页面上
  watch(() => route.query.view, view => { if (view !== VIEW) researchOpen.value = false }, { flush: 'sync' })

  /** 研发图的上一辆车：科技树边 to=当前车（同 AgentTechTree 旧口径；缺树时为空）。 */
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

  /** 研发图里的后继车：节点来自布局，展示事实来自科技树 + tank_cache。 */
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

  /** 研发图点节点 = 安装（与配置栏模块矩阵同一套对号规则，写回同一组 URL 键）。 */
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

  /** 研发图点「下一级坦克」= 切到那辆车（清掉上一辆车的配置下标）。 */
  function openVehicleFromGraph(tankId: number | null) {
    if (!tankId) return
    writeState({ tank: Number(tankId), config: null, engine: null, track: null, upgrade: null, abilities: [] })
  }

  // ---- 特性计算输入 ----
  const computeInput = computed(() => (setup.value.canConfigure && detail.value && modules.value && catalog.value
    // 升级数据不可用时 top 与 custom 都 fail-closed：不允许拿 stock 数值冒充已研发投影。
    && !(upgradeSelection.value.available
      && (upgradeSelection.value.mode === 'top' || upgradeSelection.value.mode === 'custom')
      && !upgradeSelection.value.supported)
    ? buildComputeInput({
      detail: detail.value, modules: modules.value, selection: setup.value, catalog: catalog.value,
    })
    : null))

  const characteristics = computed(() => (computeInput.value ? computeCharacteristics(computeInput.value) : null))
  /** 上一次渲染的特性（BK useDelta 同逻辑）：delta = 当前值 − 上一次值；初次加载无 delta。 */
  const previousCharacteristics = ref<TankCharacteristics | null>(null)
  /** 重置时清掉对比值：记录重置目标，特性第一次落到该目标时把 previous 对齐（delta=0）。 */
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
  /** 上一次计入对比基线的选择键：URL 提交（pending → route.query）会让特性重算一次，
   *  内容相同但对象是新引用；若照单收下，previous 就被抹成新值，delta 立刻消失。 */
  let lastSelectionKey: string | null = null
  let lastTankId: number | null = null
  watch(characteristics, (value, oldValue) => {
    const tankId = detail.value?.tank_id ?? null
    // 加载/换车过渡期间不能沿用上一辆车（或上一配置）的基线，否则新车首次参数表
    // 会显示相对上一辆车的 delta；等有效特性再次出现时从空基线重新开始。
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

  /** 弹种表：穿深/伤害/弹速随校准弹、超负荷、火药、钨芯联动（与引擎同一系数），并标记当前选中弹。 */
  const shellRows = computed(() => data.shells.value.map((shell, index) => {
    const calibrated = deviceIds.value.has(103)
    const penetrationCoefficientValue = penetrationCoefficient(shell.type, calibrated)
    const near = shell.penetration == null ? null : shell.penetration * penetrationCoefficientValue
    const farRaw = shell.penetration_far == null ? null : shell.penetration_far * penetrationCoefficientValue
    const falloff = characteristics.value?._farPenetrationFalloffFactor ?? 1
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
      // 超负荷 107：远距穿透 = 近距 − (近距 − 校准后远距) × 0.4（piercingPenaltyFactor500m = -60）
      tunedPenetrationFar: near == null || farRaw == null ? farRaw : near - (near - farRaw) * falloff,
      tunedDamage: (shell.damage ?? 0) * (characteristics.value?._damageCoeff ?? 1),
      tunedVelocity: shell.velocity == null ? null : shell.velocity * (characteristics.value?._shellVelocityFactor ?? 1),
      // 钨芯穿甲弹的伤害/模块伤害系数（引擎同一系数，弹种表与 DPM 同源）
      tunedModuleDamage: (shell.module_damage ?? 0) * (characteristics.value?._damageCoeff ?? 1),
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

  /** 参数区火炮元信息：口径 + 循环类型（config 的 is_drum/is_burst 语义）。 */
  const gunMeta = computed(() => {
    const config = data.curCfg.value
    if (!config || !characteristics.value) return null
    const type = config.is_drum ? 'autoreloader' : config.is_burst ? 'autoloader' : 'regular'
    return { caliber: config.caliber ?? null, type }
  })

  /** 交互射界图数据：沿用 pitchLimits（当前配置 models.pb 原值）+ yaw_limits。 */
  const yawLimits = computed(() => data.curCfg.value?.yaw_limits || null)
  /**
   * 射界图的有效俯仰修正：初始炮塔 pitch（models.pb 的 initial_turret_rotation，仅 4 辆
   * 意系 AT-SPG 非零）+ 改进型垂直稳定器 122 的 +4° 仰 / +3° 俯。
   * 图上 up/down 是带符号的：初始 pitch 对上是 −pitch、对下是 +pitch（BI 同口径）。
   */
  const pitchBonus = computed(() => {
    const initialPitch = Number(modules.value?.initialTurretRotation?.pitch) || 0
    const hasStabilizer = deviceIds.value.has(122)
    const stabilizer = pitchDeviceBonus(deviceIds.value, catalog.value)
    // 已选 122 但目录缺值：fail-closed（不把缺失数值当 0），保留原有边界。
    if (hasStabilizer && !stabilizer) return null
    if (!stabilizer && !initialPitch) return null
    const up = stabilizer?.up || 0
    const down = stabilizer?.down || 0
    return { up: up - initialPitch, down: down + initialPitch }
  })

  // ---- 选择写回 URL（replace）：全部配置器字段一份 owner，分享/返回可恢复。 ----

  /** 初始/顶级快捷：只切换模块（config/发动机/履带），保留装备与物品选择。 */
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
    // 换配置/换炮后旧弹种下标不再有意义：让 resolveSetup 重新取默认弹（URL 上移除 shell）
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
    // 默认弹不写进 URL（键缺省 = 自动取 AP/首个非金币弹）
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
      // 重置 = 默认配置（XI 缺省 top）；只有显式「初始」preset 才写 stock。
      ...(upgradeSelection.value.available ? { upgrade: null, abilities: [] } : {}),
      config: Math.max(0, cfgs.value.length - 1),
      engine: Math.max(0, (modules.value?.engines?.length || 1) - 1),
      track: Math.max(0, (modules.value?.chassis?.length || 1) - 1),
      // 重置也回到默认弹：否则当前已是顶级配置时 writeSetup 会保留上一发选择的 HE/金币弹。
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
      // 已经在重置目标：不产生特性变化，直接把对比基线对齐到当前值
      previousCharacteristics.value = characteristics.value
      resetTargetKey = null
    }
    writeSetup(target)
  }

  /** 装甲查看器入口的配置下标：配置器可用时以选择态为准，否则回落原 select。 */
  const configForArmor = computed(() => (setup.value.canConfigure ? setup.value.config : data.cfgIdx.value))

  return {
    researchOpen, isXiResearch,
    augmentInstalled, augmentChosen, augmentWritable,
    onAugmentResearch, onAugmentResearchAll, onAugmentResearchNone,
    researchPrevVehicles, researchNextVehicles,
    installFromGraph, openVehicleFromGraph,
    computeInput, characteristics, previousCharacteristics,
    effectiveShell, selectionKey, paramTable, deviceIds,
    shellRows, moduleLang, moduleName,
    currentTurret, currentGun, currentEngine, currentTrack,
    gunMeta, yawLimits, pitchBonus,
    applyModulePreset, writeSetup, selectShell, cycleSkill, maxSkills, clearSkills, resetSetup,
    configForArmor,
  }
}
