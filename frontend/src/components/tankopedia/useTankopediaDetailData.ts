import { computed, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { parseTankopediaQuery } from '../../utils/tankopediaQuery.js'
import { fetchTankData } from '../../scene/agentData.js'
import { loadResearchCatalog, loadTankModules, loadTechTree } from '../../utils/researchCatalog.js'
import { findTankModules } from '../../replay-local/compute/tankSetup'
import { projectTankUpgrades } from '../../replay-local/compute/tankUpgrades'
import { devicesFromEquipmentIds, encodeDevices, resolveSetup } from '../../replay-local/compute/tankSetup'
import { loadTankMechanics } from '../../scene/agentData.js'
import type { TankMechanic, TankMechanicsTable } from '../../scene/tankMechanics'

/** @param {{
 *  urlState: import('vue').ComputedRef<object>,
 *  detailId: import('vue').ComputedRef<number|null>,
 *  writeState: (patch: object, options?: object) => void,
 * }} ctx */
type TankShell = { type: string; penetration?: number | null; penetration_far?: number | null; damage?: number | null; velocity?: number | null; module_damage?: number | null; range?: number | null; explosion_radius?: number | null }
type TankDetail = { tank_id?: number; stem?: string; tier?: number; nation?: string; configs?: TankConfig[]; shells?: TankShell[]; mechanics?: TankMechanic[] | null; gun_depression?: number; gun_elevation?: number }
type TankConfig = { turret_local?: number | null; shells?: TankShell[]; pitch_limits?: { min?: number; max?: number }; yaw_limits?: unknown; is_drum?: boolean; is_burst?: boolean; caliber?: number }
type TankSummary = { gun_depression?: number; gun_elevation?: number }
type DetailContext = { urlState: ComputedRef<ReturnType<typeof parseTankopediaQuery>>; detailId: ComputedRef<number | null>; writeState: (patch: Record<string, unknown>) => void }
export function useTankopediaDetailData({ urlState, detailId, writeState }: DetailContext) {
  const detail = ref<TankDetail | null>(null)
  const detailState = ref('idle')
  const detailError = ref('')
  let detailRequest = 0
  const modules = ref<ReturnType<typeof findTankModules> | null>(null)
  const catalog = ref<Awaited<ReturnType<typeof loadResearchCatalog>> | null>(null)
  const techTree = ref<Awaited<ReturnType<typeof loadTechTree>> | null>(null)
  const mechanicsCatalog = ref<TankMechanicsTable | null>(null)
  let modulesRequest = 0

  let cacheGetter: () => Record<string, TankSummary> = () => ({})
  function bindCache(getter: () => Record<string, TankSummary>) { cacheGetter = getter }

  const summary = computed(() => (detailId.value != null ? cacheGetter()?.[String(detailId.value)] || null : null))

  const upgradeProjection = computed(() => projectTankUpgrades(
    detail.value, modules.value, urlState.value.upgrade, urlState.value.abilities,
  ))
  const upgradeSelection = computed(() => Number(detail.value?.tier) === 11
    ? upgradeProjection.value.selection
    : { ...upgradeProjection.value.selection, available: false })

  const cfgs = computed(() => upgradeProjection.value.detail?.configs || [])
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

  async function loadDetail(id: number | null) {
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
      const [data, mechanics] = await Promise.all([
        fetchTankData(id),
        loadTankMechanics().catch(() => null),
      ])
      if (request !== detailRequest) return
      detail.value = data
      mechanicsCatalog.value = (mechanics || null) as TankMechanicsTable | null
      detailState.value = 'ready'
      loadModules(id, data.nation, data.configs)
    } catch (e) {
      if (request !== detailRequest) return
      detailError.value = String(e instanceof Error ? e.message : e)
      detailState.value = 'error'
    }
  }
  watch(detailId, id => loadDetail(id))

  async function loadModules(id: number | null, nation: string | undefined, configs: TankConfig[] | undefined) {
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
      techTree.value = null
      try {
        loadTechTree(nation).then((tree: Awaited<ReturnType<typeof loadTechTree>>) => {
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

  function reconcileEquipmentHandoff() {
    const ids = urlState.value.eq
    if (!ids?.length || !modules.value || !catalog.value) return
    const devices = devicesFromEquipmentIds(ids, modules.value, catalog.value)
    writeState({ dev: encodeDevices(devices), eq: null })
  }

  const setup = computed(() => resolveSetup({
    detail: detail.value,
    modules: modules.value,
    url: urlState.value,
    catalog: catalog.value,
  }))

  return {
    detail, detailState, detailError,
    modules, catalog, techTree, mechanicsCatalog,
    summary, bindCache,
    upgradeSelection, upgradeProjection,
    cfgs, cfgIdx, curCfg, shells, pitchLimits, gunDepression, gunElevation,
    loadDetail, loadModules,
    setup,
  }
}
