/**
 * AgentTankopedia —— 详情数据装载与配置投影（拆分自 AgentTankopedia.vue，行为原样）。
 * 详情态（?tank=）：数据 = tank/{id}.json + tank_cache 概要；逐车模块数据来自
 * 资产包 /research/modules/{nation}.json（仅 config 带 turret_local/gun_local 时加载）。
 */
import { computed, ref, watch } from 'vue'
import { fetchTankData } from '../../scene/agentData.js'
import { loadResearchCatalog, loadTankModules, loadTechTree } from '../../utils/researchCatalog.js'
import { findTankModules } from '../../replay-local/compute/tankSetup'
import { projectTankUpgrades } from '../../replay-local/compute/tankUpgrades'
import { devicesFromEquipmentIds, encodeDevices, resolveSetup } from '../../replay-local/compute/tankSetup'

/** @param {{
 *  urlState: import('vue').ComputedRef<object>,
 *  detailId: import('vue').ComputedRef<number|null>,
 *  writeState: (patch: object, options?: object) => void,
 * }} ctx */
export function useTankopediaDetailData({ urlState, detailId, writeState }) {
  const detail = ref(null)
  const detailState = ref('idle')   // idle | loading | ready | error
  const detailError = ref('')
  let detailRequest = 0
  /** 逐车模块数据（资产包 /research/modules/{nation}.json，按 tankId 对号）。 */
  const modules = ref(null)
  /** 资产包全局目录/物品/技能/参数格式（research/*.json）。 */
  const catalog = ref(null)
  /** 该车所属科技树（只为研发弹窗的「下一级坦克」补名称/tier；缺失时节点不显示）。 */
  const techTree = ref(null)
  let modulesRequest = 0

  // summary 依赖宿主的 tank cache（列表态所有物）；由宿主经 bindCache 注入保持单一来源。
  let cacheGetter = () => ({})
  function bindCache(getter) { cacheGetter = getter }

  const summary = computed(() => (detailId.value != null ? cacheGetter()?.[String(detailId.value)] || null : null))

  const upgradeProjection = computed(() => projectTankUpgrades(
    detail.value, modules.value, urlState.value.upgrade, urlState.value.abilities,
  ))
  /** 升级态不参与模块 ID 对号；投影不改共享原始资产。普通车保持原引用。 */
  const upgradeSelection = computed(() => Number(detail.value?.tier) === 11
    ? upgradeProjection.value.selection
    : { available: false })

  const cfgs = computed(() => upgradeProjection.value.detail?.configs || [])
  /** 默认顶级变体（末位），与查看器 defaultCfg 语义一致；URL ?config= 优先 */
  const cfgIdx = computed({
    get: () => {
      const count = cfgs.value.length
      if (!count) return 0
      const wanted = urlState.value.config
      return wanted != null && wanted < count ? wanted : count - 1
    },
    set: value => writeState({ config: Number(value) }),
  })
  const curCfg = computed(() => cfgs.value[cfgIdx.value] || null)
  const shells = computed(() => curCfg.value?.shells || detail.value?.shells || [])
  const pitchLimits = computed(() => curCfg.value?.pitch_limits || null)
  const gunDepression = computed(() =>
    detail.value?.gun_depression ?? summary.value?.gun_depression ?? pitchLimits.value?.max ?? null)
  const gunElevation = computed(() => {
    const ele = detail.value?.gun_elevation ?? summary.value?.gun_elevation
    if (ele != null) return ele
    return pitchLimits.value?.min != null ? -pitchLimits.value.min : null
  })

  async function loadDetail(id) {
    const request = ++detailRequest
    if (id == null) {
      detail.value = null
      detailState.value = 'idle'
      return
    }
    detailState.value = 'loading'
    detailError.value = ''
    detail.value = null
    modules.value = null
    modulesRequest += 1
    try {
      const data = await fetchTankData(id)
      if (request !== detailRequest) return
      detail.value = data
      detailState.value = 'ready'
      loadModules(id, data.nation, data.configs)
    } catch (e) {
      if (request !== detailRequest) return
      detailError.value = String(e?.message || e)
      detailState.value = 'error'
    }
  }
  watch(detailId, id => loadDetail(id))

  /**
   * 只在 config 带 turret_local/gun_local（客户端对号字段）时加载模块：缺失即静态回退，
   * 不猜模块组合（fail-closed），也不为旧资产包白拉 2 MB JSON。
   */
  async function loadModules(id, nation, configs) {
    const request = ++modulesRequest
    modules.value = null
    if (id == null || !nation || !Array.isArray(configs) || !configs.some(c => c?.turret_local != null)) return
    try {
      const [nextCatalog, data] = await Promise.all([
        loadResearchCatalog(),
        loadTankModules(nation),
      ])
      if (request !== modulesRequest) return
      catalog.value = nextCatalog
      modules.value = findTankModules(data, id)
      // 科技树仅为研发弹窗的「下一级坦克」补名称/tier：不阻塞配置器数据，失败也不拖垮详情
      techTree.value = null
      try {
        loadTechTree(nation).then((tree) => {
          if (request === modulesRequest) techTree.value = tree
        }).catch(() => {})
      } catch {
        techTree.value = null
      }
      reconcileEquipmentHandoff()
    } catch (e) {
      if (request !== modulesRequest) return
      console.warn('research data unavailable:', e)
      modules.value = null
    }
  }

  /**
   * 回放「在配置器中打开」交接（?eq= 装备 id 原值，Type5 配件串）：模块/目录就绪后
   * 反解成 dev 槽位选择写回 URL 并移除 eq（歧义 fail-closed = 对应槽位留空）。
   */
  function reconcileEquipmentHandoff() {
    const ids = urlState.value.eq
    if (!ids?.length || !modules.value || !catalog.value) return
    const devices = devicesFromEquipmentIds(ids, modules.value, catalog.value)
    writeState({ dev: encodeDevices(devices), eq: null })
  }

  /** URL + 客户端数据 → 选择态（炮塔/炮由 ?config= 唯一决定）。 */
  const setup = computed(() => resolveSetup({
    detail: detail.value,
    modules: modules.value,
    url: urlState.value,
    catalog: catalog.value,
  }))

  return {
    detail, detailState, detailError,
    modules, catalog, techTree,
    summary, bindCache,
    upgradeSelection, upgradeProjection,
    cfgs, cfgIdx, curCfg, shells, pitchLimits, gunDepression, gunElevation,
    loadDetail, loadModules,
    setup,
  }
}
