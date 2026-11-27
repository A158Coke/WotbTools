/**
 * 版本变更页的数据层：catalog/summary 加载、release 校验、逐车详情与弹窗状态。
 * 与展示无关的部分集中在这里，组件只保留渲染辅助（AgentVersionDiff.vue ≤500 行）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { navigateToDataset } from './useDataVersion.js'
import {
  datasetAssetUrl, fetchDatasetTank, fetchDatasetTankCrops, fetchMapDiff, fetchPairSummary,
  fetchTankDiff, loadVersionDiffCatalog, versionDiffCatalogState,
} from './useVersionDiff.js'
import type { DiffPair } from './useVersionDiff.js'
import type { DiffChange } from '../components/version-diff/versionDiffFormat.js'
import type { ArmorDiffDetail } from '../scene/viewer/armorComparisonModel.js'

export interface DiffTankRow {
  id: number
  name: string
  tier: number
  nation?: string
  type?: string
  status: string
  categories?: string[]
  premium?: boolean
  collector?: boolean
  chips?: DiffChange[]
  detail?: string
  [key: string]: unknown
}

export interface DiffMapRow {
  mapId: number | string
  key: string
  display?: string
  status?: string
  categories?: string[]
  counts?: Record<string, number | null | undefined>
  detail?: string
  [key: string]: unknown
}

export interface DiffItemFile {
  name: string
  added?: number
  removed?: number
  changed?: number
  schema?: { added?: Record<string, unknown>; removed?: Record<string, unknown> }
  [key: string]: unknown
}

export interface DiffCounts {
  items?: { files?: Record<string, Omit<DiffItemFile, 'name'>>; techTree?: Record<string, boolean | number> }
  schema?: { added?: Record<string, number>; removed?: Record<string, number> }
  presentation?: Record<string, unknown>
  artifacts?: Record<string, unknown>
  tanks?: { technicalOnly?: number; [key: string]: unknown }
  [key: string]: unknown
}

export interface DiffSummary {
  tanks?: DiffTankRow[]
  maps?: DiffMapRow[]
  mapsAdded?: DiffMapRow[]
  mapsRemoved?: DiffMapRow[]
  mapsPresentationOnly?: DiffMapRow[]
  modelOnly?: DiffTankRow[]
  unresolved?: unknown[]
  meta?: { pipelineChanged?: boolean; [key: string]: unknown }
  counts?: DiffCounts
  [key: string]: unknown
}

export interface TankProfileConfig {
  shells?: Array<{ damage?: number; penetration?: number; [key: string]: unknown }>
  reload?: number
  dpm?: number
  view_range?: number
  [key: string]: unknown
}

export interface TankProfile {
  hp?: number
  speed_forward?: number
  speed_reverse?: number
  configs?: TankProfileConfig[]
  armor?: { hull?: { front?: number; sides?: number; rear?: number; [key: string]: unknown }; [key: string]: unknown }
  [key: string]: unknown
}

export interface DiffTankDetail extends ArmorDiffDetail {
  changes?: DiffChange[]
  configs?: ArmorDiffDetail['configs'] & {
    added?: Array<{ gun?: string; turret?: string; gunLocal?: number; turretLocal?: number; [key: string]: unknown }>
    removed?: Array<{ gun?: string; turret?: string; gunLocal?: number; turretLocal?: number; [key: string]: unknown }>
  }
  research?: {
    changes?: DiffChange[]
    modulesAdded?: unknown[]
    modulesRemoved?: unknown[]
    unpaired?: unknown[]
    changed?: boolean
  }
  identity?: { name?: string; nation?: string; tier?: number; type?: string; [key: string]: unknown }
  unresolved?: unknown[]
  [key: string]: unknown
}

export function useVersionDiffPage() {
  const route = useRoute()
  const router = useRouter()
  const catalog = versionDiffCatalogState

  const selectedPairId = ref('')
  const summary = ref<DiffSummary | null>(null)
  const summaryState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const summaryError = ref('')
  const releaseMismatch = ref<Array<{ side: 'from' | 'to'; expected?: string; actual?: string | null }>>([])
  const armorVerification = ref<'pending' | 'verified' | 'mismatch'>('pending')
  const statDetails = ref<Record<string, DiffTankDetail>>({})
  const coverCrops = ref<Record<string, Record<string, unknown>>>({})
  const tankProfiles = ref<Record<string, TankProfile | null>>({})
  const tankRequests = new Map()
  const mapQuery = ref('')

  const tankDialog = ref<{ open: boolean; row: DiffTankRow | null; detail: DiffTankDetail | null; loading: boolean; error: string }>(
    { open: false, row: null, detail: null, loading: false, error: '' })
  const armorDialog = ref<{ open: boolean; tankName: string; tankId: number | null; armor: unknown; detail: DiffTankDetail | null; pair: DiffPair | null }>(
    { open: false, tankName: '', tankId: null, armor: null, detail: null, pair: null })
  const armorSelection = ref<{ tankId: number | null; configKey: string; keys: string[] }>({ tankId: null, configKey: '', keys: [] })
  const mapDialog = ref<{ open: boolean; row: DiffMapRow | null; detail: Record<string, unknown> | null; status: string; loading: boolean; error: string }>(
    { open: false, row: null, detail: null, status: 'changed', loading: false, error: '' })
  let tankRequest = 0
  let mapRequest = 0

  const pair = computed<DiffPair | null>(() => catalog.value.pairs.find(item => item.id === selectedPairId.value) || null)

  const tankRows = computed<DiffTankRow[]>(() => summary.value?.tanks || [])
  const changedTanks = computed(() => tankRows.value.filter(row => row.status === 'changed'))
  const armorTanks = computed(() => changedTanks.value.filter(row => row.categories?.includes('armor')))
  const lineup = computed(() => [
    { status: 'added', id: 'added', title: 'versionDiff.summary.tanksAdded' },
    { status: 'removed', id: 'removed', title: 'versionDiff.summary.tanksRemoved' },
  ].map(section => ({ ...section, rows: tankRows.value.filter(row => row.status === section.status) }))
    .filter(section => section.rows.length))

  const statCategories = ['firepower', 'mobility', 'survivability', 'identity']
  const statTanks = computed(() => changedTanks.value
    .filter(row => row.categories?.some(category => statCategories.includes(category)))
    .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name)))
  const otherTanks = computed(() => changedTanks.value.filter(row =>
    row.categories?.some(category => category === 'geometry' || category === 'research')
    || (!statTanks.value.includes(row) && !armorTanks.value.includes(row))))
  const synopsis = computed(() => [
    ...lineup.value.map(section => ({ key: section.title, count: section.rows.length })),
    { key: 'versionDiff.log.stats', count: statTanks.value.length },
    { key: 'versionDiff.summary.armorChanged', count: armorTanks.value.length },
    { key: 'versionDiff.summary.mapsChanged', count: allMaps.value.length },
  ].filter(item => item.count))

  const allMaps = computed<DiffMapRow[]>(() => {
    if (!summary.value) return []
    return [
      ...(summary.value.mapsAdded || []).map(row => ({ ...row, status: 'added', categories: ['added'] })),
      ...(summary.value.mapsRemoved || []).map(row => ({ ...row, status: 'removed', categories: ['removed'] })),
      ...(summary.value.maps || []).map(row => ({ ...row, status: 'changed' })),
      // 只有展示层重生成（2D/封面）的图也进列表：不显示的话 hasData 有计数但列表里找不到。
      ...(summary.value.mapsPresentationOnly || []).map(row => ({ ...row, status: 'changed', categories: ['presentation'] })),
    ]
  })
  const mapRows = computed(() => {
    const query = mapQuery.value.trim().toLocaleLowerCase()
    return allMaps.value
      .filter(row => !query || String(row.display || row.key || '').toLocaleLowerCase().includes(query))
  })

  const itemFiles = computed<DiffItemFile[]>(() => Object.entries(summary.value?.counts?.items?.files || {})
    .map(([name, value]) => ({ name, ...value })))
  const techTree = computed(() => summary.value?.counts?.items?.techTree || {})
  const schemaCounts = computed(() => summary.value?.counts?.schema || { added: {}, removed: {} })
  const presentation = computed(() => summary.value?.counts?.presentation || {})
  const artifacts = computed(() => summary.value?.counts?.artifacts || {})
  const unresolved = computed(() => summary.value?.unresolved || [])

  const gameplayItems = computed(() => itemFiles.value.filter(file => file.added || file.removed || file.changed))
  const techTreeChanged = computed(() => Object.values(techTree.value).some(Boolean))
  const itemSchemas = computed(() => itemFiles.value.filter(file => ['added', 'removed']
    .some(side => Object.keys(file.schema?.[side as 'added' | 'removed'] || {}).length)))
  const hasData = computed(() => Boolean(summary.value && (
    otherTanks.value.length || gameplayItems.value.length || techTreeChanged.value
    || summary.value.modelOnly?.length || summary.value.mapsPresentationOnly?.length
    || summary.value.counts?.tanks?.technicalOnly || summary.value.meta?.pipelineChanged
    || unresolved.value.length || schemaEntries('added').length || schemaEntries('removed').length
    || itemSchemas.value.length || Object.values(presentation.value).some(Boolean)
    || Object.values(artifacts.value).some(value => Array.isArray(value) ? value.length : value)
  )))

  function preserveQuery(): Record<string, string> {
    const query: Record<string, string> = {}
    for (const key of ['assets', 'localuser', 'admin']) {
      const value = route.query[key]
      if (typeof value === 'string' && value) query[key] = value
    }
    return query
  }

  function selectPair(next: DiffPair | null) {
    if (!next) return
    selectedPairId.value = next.id
    router.replace({
      query: {
        ...route.query,
        view: 'agent-version-diff',
        from: next.from.dataset,
        to: next.to.dataset,
      },
    })
  }

  function selectInitialPair() {
    const pairs = catalog.value.pairs
    if (!pairs.length) return
    if (selectedPairId.value && pairs.some(item => item.id === selectedPairId.value)) return
    const requested = pairs.find(item => item.from.dataset === route.query.from && item.to.dataset === route.query.to)
    selectPair(requested || pairs[pairs.length - 1])
  }

  async function loadSummary(next: DiffPair | null) {
    if (!next) return
    const request = ++loadSummary.seq
    summaryState.value = 'loading'
    summaryError.value = ''
    summary.value = null
    releaseMismatch.value = []
    armorVerification.value = 'pending'
    statDetails.value = {}
    tankProfiles.value = {}
    coverCrops.value = {}
    mapQuery.value = ''
    armorSelection.value = { tankId: null, configKey: '', keys: [] }
    try {
      const data = await fetchPairSummary(next)
      if (request !== loadSummary.seq) return
      summary.value = data
      summaryState.value = 'ready'
      await checkReleases(next, request)
      if (request !== loadSummary.seq) return
      const sides: Array<'from' | 'to'> = ['from', 'to']
      for (const side of sides) {
        if (!releaseMismatch.value.some(identity => identity.side === side)) {
          void loadCrops(next[side].dataset, request)
        }
      }
      for (const row of statTanks.value) {
        if (!row.detail) continue
        void tankDetail(next, row).then(detail => {
          if (request === loadSummary.seq) statDetails.value[row.id] = detail
        }).catch(() => {})
      }
      // 装甲章节的文字版要展示完整 diff（含配置级板件），与对比器共用同一份缓存请求。
      for (const row of armorTanks.value) {
        if (!row.detail) continue
        void tankDetail(next, row).then(detail => {
          if (request === loadSummary.seq) statDetails.value[row.id] = detail
        }).catch(() => {})
      }
      for (const section of lineup.value) {
        for (const row of section.rows) {
          const side = row.status === 'removed' ? 'from' : 'to'
          if (!releaseMismatch.value.some(identity => identity.side === side)) void loadProfile(next, row, request)
        }
      }
    } catch (error) {
      if (request !== loadSummary.seq) return
      summaryError.value = error instanceof Error ? error.message : String(error)
      summaryState.value = 'error'
    }
  }
  loadSummary.seq = 0

  async function checkReleases(next: DiffPair, request: number) {
    const mismatches: Array<{ side: 'from' | 'to'; expected?: string; actual?: string | null }> = []
    const sides: Array<'from' | 'to'> = ['from', 'to']
    for (const side of sides) {
      const identity = next[side]
      try {
        const response = await fetch(datasetAssetUrl(identity.dataset, '/version.json'), { cache: 'no-cache' })
        if (!response.ok) {
          mismatches.push({ side, expected: identity.release, actual: null })
          continue
        }
        const doc = await response.json()
        if (doc.release !== identity.release) mismatches.push({ side, expected: identity.release, actual: doc.release })
      } catch {
        mismatches.push({ side, expected: identity.release, actual: null })
      }
    }
    if (request !== loadSummary.seq) return
    releaseMismatch.value = mismatches
    armorVerification.value = mismatches.length ? 'mismatch' : 'verified'
  }

  watch(pair, next => { void loadSummary(next) }, { immediate: true })
  watch(selectedPairId, () => {
    ++tankRequest
    ++mapRequest
    tankDialog.value.open = false
    armorDialog.value.open = false
    mapDialog.value.open = false
  })
  watch(() => catalog.value.status, (status) => {
    if (status === 'ready' && !selectedPairId.value) selectInitialPair()
  })

  onMounted(async () => {
    const result = await loadVersionDiffCatalog()
    if (result.status === 'ready') selectInitialPair()
  })

  async function loadCrops(dataset: string, request: number) {
    try {
      const crops = await fetchDatasetTankCrops(dataset)
      if (request === loadSummary.seq) coverCrops.value[dataset] = crops
    } catch {
      // Older datasets can omit crop metadata. Keep the full cover visible.
    }
  }

  async function loadProfile(activePair: DiffPair, row: DiffTankRow, request: number) {
    const dataset = tankDataset(row, activePair)
    try {
      const data = await fetchDatasetTank(dataset, row.id)
      if (request === loadSummary.seq) tankProfiles.value[row.id] = data as TankProfile
    } catch {
      if (request === loadSummary.seq) tankProfiles.value[row.id] = null
    }
  }

  function tankDataset(row: DiffTankRow, activePair: DiffPair | null = pair.value): string {
    if (!activePair) return ''
    return row.status === 'removed' ? activePair.from.dataset : activePair.to.dataset
  }

  function tankDetail(activePair: DiffPair, row: DiffTankRow): Promise<DiffTankDetail> {
    const key = `${activePair.path}/${row.id}`
    if (!tankRequests.has(key)) {
      const request = fetchTankDiff(activePair, row.id).then(detail => detail as DiffTankDetail).catch((error) => {
        tankRequests.delete(key)
        throw error
      })
      tankRequests.set(key, request)
    }
    return tankRequests.get(key)
  }

  function openTank(row: DiffTankRow) {
    const request = ++tankRequest
    tankDialog.value = { open: true, row, detail: null, loading: false, error: '' }
    if (!row.detail || !pair.value) return
    tankDialog.value.loading = true
    tankDetail(pair.value, row)
      .then((detail) => {
        if (request !== tankRequest) return
        tankDialog.value = { ...tankDialog.value, detail, loading: false }
      })
      .catch((error) => {
        if (request !== tankRequest) return
        tankDialog.value = { ...tankDialog.value, loading: false, error: error instanceof Error ? error.message : String(error) }
      })
  }

  function armorDetailFor(row: DiffTankRow): Promise<ArmorDiffDetail> {
    if (!pair.value) return Promise.reject(new Error('no active pair'))
    return tankDetail(pair.value, row)
  }

  function openArmor(row: DiffTankRow | null = tankDialog.value.row, armor: unknown = tankDialog.value.detail?.armor) {
    if (!row || !armor) return
    armorDialog.value = {
      open: true,
      tankName: row.name,
      tankId: row.id,
      armor,
      detail: tankDialog.value.detail,
      pair: pair.value,
    }
  }

  function openMap(row: DiffMapRow) {
    const request = ++mapRequest
    mapDialog.value = { open: true, row, detail: null, status: row.status || 'changed', loading: false, error: '' }
    if (!row.detail) return
    mapDialog.value.loading = true
    if (!pair.value) return
    fetchMapDiff(pair.value, row.mapId)
      .then((detail) => {
        if (request !== mapRequest) return
        mapDialog.value = { ...mapDialog.value, detail: detail as Record<string, unknown>, loading: false }
      })
      .catch((error) => {
        if (request !== mapRequest) return
        mapDialog.value = { ...mapDialog.value, loading: false, error: error instanceof Error ? error.message : String(error) }
      })
  }

  function toggleArmorSelection(row: DiffTankRow, selection: { configKey?: string; keys: string[] }) {
    const keys = selection.keys
    const configKey = selection.configKey || ''
    const current = armorSelection.value
    if (!keys.length) {
      armorSelection.value = { tankId: null, configKey: '', keys: [] }
      return
    }
    const same = current.tankId === row.id && current.configKey === configKey
      && keys.length === current.keys.length
      && keys.every(key => current.keys.includes(key))
    armorSelection.value = same
      ? { tankId: null, configKey: '', keys: [] }
      : { tankId: row.id, configKey, keys: [...keys] }
  }

  function armorSelectionKeys(row: DiffTankRow) {
    return armorSelection.value.tankId === row.id ? armorSelection.value.keys : []
  }

  function armorSelectionConfigKey(row: DiffTankRow) {
    return armorSelection.value.tankId === row.id ? armorSelection.value.configKey : ''
  }

  /** 版本相关跳转必须整页切换 dataset（assetBase 在页面生命周期内按加载时 dataset 缓存）。 */
  function goToPage(dataset: string, query: Record<string, string>) {
    const href = router.resolve({ path: '/', query: { ...preserveQuery(), ...query } }).href
    navigateToDataset(dataset, href)
  }

  function openVersion(dataset: string, row: DiffTankRow | null = tankDialog.value.row) {
    if (!row?.id) return
    goToPage(dataset, { view: 'agent-tankopedia', tank: String(row.id) })
  }

  function openArmorViewer(dataset: string) {
    const tankId = armorDialog.value.tankId
    if (tankId == null) return
    goToPage(dataset, { view: 'agent-armor', tank: String(tankId) })
  }

  function openMapVersion(dataset: string) {
    const row = mapDialog.value.row
    const detail = mapDialog.value.detail as {
      from?: { key?: string; variantIds?: number[] }
      to?: { key?: string; variantIds?: number[] }
    } | null
    // 两侧 key/variant 可能不同：按 dataset 取对应侧的身份，避免旧版按新版的 key 打开。
    const side = pair.value && dataset === pair.value.from.dataset ? detail?.from : detail?.to
    const key = side?.key || row?.key
    const variant = side?.variantIds?.[0] ?? row?.mapId
    if (!key) return
    goToPage(dataset, { view: 'map-preview', map: key, variant: String(variant ?? '') })
  }

  function retryCatalog() {
    void loadVersionDiffCatalog({ force: true }).then(result => {
      if (result.status === 'ready') selectInitialPair()
    })
  }

  function schemaEntries(kind: 'added' | 'removed'): Array<[string, number]> {
    const bucket = kind === 'added' ? schemaCounts.value.added : schemaCounts.value.removed
    return Object.entries(bucket || {})
      .sort((a, b) => b[1] - a[1])
  }

  return {
    catalog, selectedPairId, summary, summaryState, summaryError, releaseMismatch, armorVerification,
    statDetails, coverCrops, tankProfiles, mapQuery,
    tankDialog, armorDialog, armorSelection, mapDialog,
    pair, tankRows, changedTanks, armorTanks, lineup, statTanks, otherTanks, synopsis,
    allMaps, mapRows, itemFiles, techTree, schemaCounts, presentation, artifacts, unresolved,
    gameplayItems, techTreeChanged, itemSchemas, hasData,
    selectPair, tankDataset, loadSummary, tankDetail, armorDetailFor, openTank, openArmor, openMap,
    toggleArmorSelection, armorSelectionKeys, armorSelectionConfigKey, openVersion, openArmorViewer, openMapVersion,
    retryCatalog, schemaEntries,
  }
}