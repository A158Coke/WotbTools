<script setup>
/**
 * 坦克百科（?view=agent-tankopedia，2026-10-01 起对所有用户公开）：列表 + 详情两态。
 * 数据面：tank_cache.json（列表/概要）+ tank/{id}.json（详情，configs/armor_model/shells）
 * 经 agentData → assetProvider 走配置的 remote asset origin（client-only，无同源回退）。
 *
 * URL 是筛选 / 详情状态的唯一 owner（utils/tankopediaQuery.js 解析与序列化）：
 * q / tier / nation / type / sort 用 replace 写入（不堆历史），?tank= 详情用 push（返回键回到列表），
 * ?config= 记录详情页选中的配置下标并联动装甲查看器入口。
 * 列表增量渲染（审计 3D-18）：首屏一页，滚动到底由 IntersectionObserver 追加，按钮兜底。
 * 坦克百科中的 3D 检视入口保留当前角色显示策略；装甲页面本身只要求登录。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { locationForView } from '../app/navigation'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Box, GitBranch, Network, RotateCcw, TriangleAlert } from 'lucide-vue-next'
import { fetchTankEncyclopedia, fetchTankData, tankImageUrl, loadTankIconCrops } from '../scene/agentData.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { romanLevel } from '../utils/tierFormat.js'
import { TYPE_CLS, normType, shellLabel, isPremiumShell, fmt, fmtNum, tankNationLabel, tankTypeLabel } from '../scene/tankMeta.js'
import {
  normalizeTankCache, parseTankopediaQuery, sameTankopediaQuery, withTankopediaState,
} from '../utils/tankopediaQuery.js'
import { loadResearchCatalog, loadTankModules, loadTechTree, shellIconUrl } from '../utils/researchCatalog.js'
import { moduleTreeLayout } from '../utils/techTreeLayout.js'
import { computeCharacteristics, penetrationCoefficient } from '../replay-local/compute/characteristics'
import {
  buildComputeInput, decodeDevices, devicesFromEquipmentIds, encodeDevices,
  defaultShellIndex, findTankModules, paramGroups, pickGun, pickTurret, resolveSetup,
} from '../replay-local/compute/tankSetup'
import PageHeader from './PageHeader.vue'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import TankCatalogMenu from './TankCatalogMenu.vue'
import TankConfigPanel from './TankConfigPanel.vue'
import TankResearchPanel from './TankResearchPanel.vue'
import TankParamPanel from './TankParamPanel.vue'
import AppDialog from './AppDialog.vue'
import { Motion } from 'motion-v'
import { motionTransition } from '../shared/motion/motionPolicy'

const VIEW = 'agent-tankopedia'
/** 车种枚举 → i18n 键（AT-SPG 含连字符，不直接作键） */

const { t, te, locale } = useI18n()
const route = useRoute()
const router = useRouter()

// ---------- URL 状态（唯一 owner） ----------
/** 已提交但可能尚未落到 route.query 的最近一次写入：在同一 tick / 同一次点击里连写两次
 *  （研发弹窗里点模块、紧接着再点）时，第二次若仍以 route.query 为底就会覆盖第一击。 */
const pendingQuery = ref(null)
const effectiveQuery = computed(() => pendingQuery.value || route.query)
const urlState = computed(() => parseTankopediaQuery(effectiveQuery.value))
const onView = () => route.query?.view === VIEW
// 导航落地后 URL 重新成为唯一事实来源
watch(() => route.query, () => { pendingQuery.value = null }, { flush: 'sync' })

function writeState(patch, { push = false } = {}) {
  if (!onView()) return
  const base = effectiveQuery.value
  const query = withTankopediaState(base, { ...urlState.value, ...patch })
  if (sameTankopediaQuery(base, query)) return
  pendingQuery.value = query
  router[push ? 'push' : 'replace']({ query })
}

// 搜索 / 筛选 / 排序的唯一实现是 TankCatalogMenu（与装甲查看器选车弹窗共用）：
// 本页只负责 URL 状态与详情；组件内的输入草稿即时筛选，防抖后通过 update:filters 提交。
const listFilters = computed(() => ({
  q: urlState.value.q,
  tier: urlState.value.tier,
  nation: urlState.value.nation,
  type: urlState.value.type,
  sort: urlState.value.sort,
}))
function writeFilters(filters) {
  writeState({
    q: filters.q,
    tier: filters.tier,
    nation: filters.nation,
    type: filters.type,
    sort: filters.sort,
  })
}

// ---------- 显示名（审计 3D-16：不直接显示 china / heavyTank 等原始值） ----------
const nationLabel = nation => tankNationLabel(t, te, nation)
const typeLabel = type => tankTypeLabel(t, te, type)
const tierLabel = tier => romanLevel(tier)

// ---------- 列表态 ----------
const cache = ref({})
const listState = ref('loading')   // loading | ready | error
const listError = ref('')

const tanks = computed(() => normalizeTankCache(cache.value))

async function loadList() {
  listState.value = 'loading'
  listError.value = ''
  try {
    cache.value = await fetchTankEncyclopedia()
    listState.value = 'ready'
  } catch (e) {
    console.error('tankopedia load failed:', e)
    listError.value = String(e?.message || e)
    listState.value = 'error'
  }
}

function openDetail(id) {
  writeState({ tank: id, config: null }, { push: true })
}
function backToList() {
  // In-app back must collapse the detail history entry instead of adding another one.
  // Otherwise list → detail → in-app back → browser Back re-opens the same detail.
  writeState({ tank: null, config: null })
}

// ---------- 详情态（?tank=；数据 = tank/{id}.json + tank_cache 概要） ----------
const detailId = computed(() => urlState.value.tank)
const detail = ref(null)
const detailState = ref('idle')   // idle | loading | ready | error
const detailError = ref('')
let detailRequest = 0

const summary = computed(() => (detailId.value != null ? cache.value?.[String(detailId.value)] || null : null))
const cfgs = computed(() => detail.value?.configs || [])
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

/**
 * 俯角/仰角显示回退链：per-tank 数据 → tank_cache 概要 → 当前配置 pitch_limits。
 * 前两者取决于资产包生成时间，配置级 pitch_limits（models.pb 直取）只要配置有数据就有值，
 * 是数据面缺字段时的兜底——与 GunPitchRange 同一约定：dep = max、ele = −min。
 */
const pitchLimits = computed(() => curCfg.value?.pitch_limits || null)
const gunDepression = computed(() =>
  detail.value?.gun_depression ?? summary.value?.gun_depression ?? pitchLimits.value?.max ?? null)
const gunElevation = computed(() => {
  const ele = detail.value?.gun_elevation ?? summary.value?.gun_elevation
  if (ele != null) return ele
  return pitchLimits.value?.min != null ? -pitchLimits.value.min : null
})

// ---------- 配置器状态（URL 是唯一 owner） ----------
/** 逐车模块数据（资产包 /research/modules/{nation}.json，按 tankId 对号）。 */
const modules = ref(null)
/** 资产包全局目录/物品/技能/参数格式（research/*.json）。 */
const catalog = ref(null)
/** 该车所属科技树（只为研发弹窗的「下一级坦克」补名称/tier；缺失时节点不显示）。 */
const techTree = ref(null)
let modulesRequest = 0

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

/** 研发弹窗开关。弹窗与配置栏模块矩阵共用同一个 `setup`（URL 状态），改动双向同步；
 *  换车（含弹窗里点下一级坦克）时关闭，避免把上一辆车的图留在窗口里。 */
const researchOpen = ref(false)
watch(detailId, () => { researchOpen.value = false })
// 离开坦克百科（打开 3D 等）时不能把模态留在别的页面上
watch(() => route.query.view, view => { if (view !== VIEW) researchOpen.value = false }, { flush: 'sync' })

/** 研发图的上一辆车：科技树边 to=当前车（同 AgentTechTree 旧口径；缺树时为空）。 */
const researchPrevVehicles = computed(() => {
  const stem = detail.value?.stem
  const nodes = techTree.value?.nodes
  if (!stem || !nodes?.length) return []
  const byStem = new Map(nodes.map(n => [n.stem, n]))
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
  const byStem = new Map((techTree.value?.nodes || []).map(n => [n.stem, n]))
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
function installFromGraph(node) {
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
function openVehicleFromGraph(tankId) {
  if (!tankId) return
  writeState({ tank: Number(tankId), config: null, engine: null, track: null })
}

const computeInput = computed(() => (setup.value.canConfigure && detail.value && modules.value && catalog.value
  ? buildComputeInput({
    detail: detail.value, modules: modules.value, selection: setup.value, catalog: catalog.value,
  })
  : null))
const characteristics = computed(() => (computeInput.value ? computeCharacteristics(computeInput.value) : null))
/** 上一次渲染的特性（BK useDelta 同逻辑）：delta = 当前值 − 上一次值；初次加载无 delta。 */
const previousCharacteristics = ref(null)
/** 重置时清掉对比值：记录重置目标，特性第一次落到该目标时把 previous 对齐（delta=0）。 */
let resetTargetKey = null
const effectiveShell = selection => (selection.shell == null
  ? defaultShellIndex(cfgs.value[selection.config])
  : selection.shell)
const selectionKey = selection => JSON.stringify([
  selection.config, effectiveShell(selection), selection.engine, selection.track,
  selection.devices, selection.consumables, selection.provisions,
  selection.skills, selection.camouflage,
])
/** 上一次计入对比基线的选择键：URL 提交（pending → route.query）会让特性重算一次，
 *  内容相同但对象是新引用；若照单收下，previous 就被抹成新值，delta 立刻消失。 */
let lastSelectionKey = null
let lastTankId = null
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
const shellRows = computed(() => shells.value.map((shell, index) => {
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
function moduleName(item) {
  if (!item) return ''
  return item[`name_${moduleLang.value}`] || item['name_zh-Hans'] || item.name_en || item.stem || ''
}
const currentTurret = computed(() => modules.value?.turrets?.[setup.value.turret] || null)
const currentGun = computed(() => currentTurret.value?.guns?.[setup.value.gun] || null)
const currentEngine = computed(() => modules.value?.engines?.[setup.value.engine] || null)
const currentTrack = computed(() => modules.value?.chassis?.[setup.value.track] || null)

/** 参数区火炮元信息：口径 + 循环类型（config 的 is_drum/is_burst 语义）。 */
const gunMeta = computed(() => {
  const config = curCfg.value
  if (!config || !characteristics.value) return null
  const type = config.is_drum ? 'autoreloader' : config.is_burst ? 'autoloader' : 'regular'
  return { caliber: config.caliber ?? null, type }
})

/** 交互射界图数据：沿用上面 pitchLimits（当前配置 models.pb 原值）+ yaw_limits。 */
const yawLimits = computed(() => curCfg.value?.yaw_limits || null)
/**
 * 射界图的有效俯仰修正：初始炮塔 pitch（models.pb 的 initial_turret_rotation，仅 4 辆
 * 意系 AT-SPG 非零）+ 改进型垂直稳定器 122 的 +4° 仰 / +3° 俯。
 * 图上 up/down 是带符号的：初始 pitch 对上是 −pitch、对下是 +pitch（BI 同口径）。
 */
const pitchBonus = computed(() => {
  const initialPitch = Number(modules.value?.initialTurretRotation?.pitch) || 0
  const hasStabilizer = deviceIds.value.has(122)
  if (!hasStabilizer && !initialPitch) return null
  let up = 0
  let down = 0
  if (hasStabilizer) {
    const item = catalog.value?.devices?.find(device => device.id === 122)
    const params = item?.script?.params?.bonusValues
    up = Number(params?.upperPitchLimitIncrease)
    down = Number(params?.lowerPitchLimitIncrease)
    if (!Number.isFinite(up) || !Number.isFinite(down)) return null
  }
  return { up: up - initialPitch, down: down + initialPitch }
})

/** 初始/顶级快捷：只切换模块（config/发动机/履带），保留装备与物品选择。 */
function applyModulePreset(kind) {
  writeSetup({
    config: kind === 'stock' ? 0 : Math.max(0, cfgs.value.length - 1),
    engine: kind === 'stock' ? 0 : Math.max(0, (modules.value?.engines?.length || 1) - 1),
    track: kind === 'stock' ? 0 : Math.max(0, (modules.value?.chassis?.length || 1) - 1),
  })
}

/** 选择写回 URL（replace）：全部配置器字段一份 owner，分享/返回可恢复。 */
function writeSetup(patch) {
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
    camo: next.camouflage,
  })
}

function selectShell(index) {
  // 默认弹不写进 URL（键缺省 = 自动取 AP/首个非金币弹）
  const config = cfgs.value[setup.value.config]
  writeSetup({ shell: index === defaultShellIndex(config) ? null : index })
}

function cycleSkill(id, maxLevel = false) {
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
  writeSetup({ skills: {} })
}

function resetSetup() {
  const target = {
    config: Math.max(0, cfgs.value.length - 1),
    engine: Math.max(0, (modules.value?.engines?.length || 1) - 1),
    track: Math.max(0, (modules.value?.chassis?.length || 1) - 1),
    // 重置也回到默认弹：否则当前已是顶级配置时 writeSetup 会保留上一发选择的 HE/金币弹。
    shell: null,
    devices: decodeDevices(''),
    consumables: [],
    provisions: [],
    skills: {},
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
const configForArmor = computed(() => (setup.value.canConfigure ? setup.value.config : cfgIdx.value))

// 列表在详情往返期间保持挂载：TankCatalogMenu 内部保存增量条数与搜索草稿
//（组件卸载会清掉防抖 timer，详情期间提交的 q 也会丢）。直达详情时不提前挂载列表，
// 避免隐藏卡片发图片请求；返回列表时再挂载。
const listMounted = ref(detailId.value == null)
watch(detailId, id => { if (id == null) listMounted.value = true })

function openTechTree() {
  // 科技树入口：locationForView 保留 assets/lang 等与视图无关的键。
  const dest = locationForView('agent-techtree', route)
  router.push({ path: dest.path, query: { ...dest.query, view: 'agent-techtree' } })
}

function open3d() {  // 审计 3D-09：在当前标签页打开装甲查看器（携带实际搭载配置下标），返回走浏览器历史
  // 走 locationForView：它按"离开坦克百科"删掉列表筛选（nation/q/…），同时保留
  // 与视图无关的键（`assets` 资产源 override、`lang`、`admin` 等）——此前手写的
  // `query: { view, tank, config }` 会把 `assets` 一并丢掉，导致进入装甲查看器后
  // 资产源回落（模型/贴图加载不到）。
  // 配置器可用时把装备/物品选择一并带上（dev/cons/prov），并把装甲查看器只认的两个
  // 射击相关装备折成 eqcal/eqenh（103 校准弹 / 110 强化装甲）——装甲页不再展示完整装备。
  const dest = locationForView('agent-armor', route)
  const handoff = setup.value.canConfigure
    ? {
        dev: encodeDevices(setup.value.devices),
        cons: setup.value.consumables.join(','),
        prov: setup.value.provisions.join(','),
        ...(deviceIds.value.has(103) ? { eqcal: '1' } : {}),
        ...(deviceIds.value.has(110) ? { eqenh: '1' } : {}),
      }
    : {}
  router.push({
    path: dest.path,
    query: {
      ...dest.query,
      view: 'agent-armor',
      tank: String(detailId.value),
      config: String(configForArmor.value),
      ...handoff,
    },
  })
}

function hideBrokenImage(event) {
  // 封面缺失：保留固定比例的占位框，不显示破图标
  event.target.hidden = true
}

// 封面图展示裁剪：客户端图标是原始画布（坦克锚定左上、右侧/底部留白近半），
// 按数据面的逐车内容框缩放定位（utils/tankIconCrop.js），视觉对齐旧紧裁口径；
// 数据缺失（旧包/资产源未配置）时 transform 为空串 → 回退原始 contain 展示。
const ICON_BOX_ASPECT = 8 / 5 // 与 .tp-media 的 aspect-ratio 一致
const iconCrops = ref(null)
loadTankIconCrops().then((crops) => { iconCrops.value = crops })
function iconCropStyle(id) {
  const transform = tankIconCropTransform(iconCrops.value?.[String(id)], ICON_BOX_ASPECT)
  return transform ? { transform } : null
}

onMounted(() => {
  loadList()
  if (detailId.value != null) loadDetail(detailId.value)   // 详情直达（刷新 / 分享链接）
})
</script>

<template>
  <section class="tankopedia" data-testid="tankopedia">
    <!-- ================= 详情态 ================= -->
    <template v-if="detailId != null">
      <div class="tp-detail-nav">
        <AppButton variant="ghost" size="sm" data-testid="tank-back" @click="backToList">
          <ArrowLeft :size="16" aria-hidden="true" />
          {{ t('agentTanks.back') }}
        </AppButton>
      </div>

      <p v-if="detailState === 'loading'" class="tp-status" role="status">{{ t('agentTanks.loading') }}</p>
      <EmptyState
        v-else-if="detailState === 'error'"
        role="alert"
        data-testid="tank-detail-error"
        :icon="TriangleAlert"
        :title="t('agentTanks.detail_error_title')"
        :description="detailError || t('agentTanks.error_desc')"
      >
        <AppButton variant="primary" @click="loadDetail(detailId)">
          <RotateCcw :size="16" aria-hidden="true" />
          {{ t('agentTanks.retry') }}
        </AppButton>
      </EmptyState>

      <template v-else-if="detail">
        <Motion
          tag="header"
          class="tp-detail-head"
          :initial="{ opacity: 0, y: 4 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="motionTransition('fast')"
        >
          <span class="tp-media tp-media-lg">
            <img :src="tankImageUrl(detailId)" alt="" width="320" height="200" decoding="async" :style="iconCropStyle(detailId)" @error="hideBrokenImage">
          </span>
          <div class="tp-detail-title">
            <h1>{{ detail.name }}</h1>
            <div class="tp-badges">
              <span class="tp-pill is-tier">{{ tierLabel(detail.tier) }}</span>
              <span class="tp-pill">{{ nationLabel(detail.nation) }}</span>
              <span class="tp-pill" :class="TYPE_CLS[detail.type] || 't-unknown'">{{ typeLabel(detail.type) }}</span>
              <span v-if="summary?.is_premium" class="tp-pill is-premium">{{ t('agentTanks.premium') }}</span>
            </div>
          </div>
          <div v-if="modules && setup.canConfigure" class="tp-detail-actions">
            <AppButton
              variant="secondary"
              size="md"
              data-testid="tank-open-research"
              @click="researchOpen = true"
            >
              <GitBranch :size="18" aria-hidden="true" />
              {{ t('research.open_research') }}
            </AppButton>
          </div>
        </Motion>

        <!-- 工作台：左 = 模型入口 + 配置面板，右 = 参数区（BlitzKit 式两栏）。
             参数卡片顺序：防护 → 机动 → 火力（火力卡内弹种选择置顶）。 -->
        <div class="tp-workbench">
          <div class="tp-workbench-left">
          <section class="tp-card-section tp-model-card" data-testid="tank-open3d-card" data-tour="tankopedia-detail">
            <h2 class="tp-section-title">{{ t('agentTanks.open3d_title') }}</h2>
            <dl v-if="setup.canConfigure" class="tp-summary">
              <div v-if="currentTurret"><dt>{{ t('agentTanks.configurator.turret') }}</dt><dd>{{ moduleName(currentTurret) }}</dd></div>
              <div v-if="currentGun"><dt>{{ t('agentTanks.configurator.gun') }}</dt><dd>{{ moduleName(currentGun) }}</dd></div>
              <div v-if="currentEngine"><dt>{{ t('agentTanks.configurator.engine') }}</dt><dd>{{ moduleName(currentEngine) }}</dd></div>
              <div v-if="currentTrack"><dt>{{ t('agentTanks.configurator.track') }}</dt><dd>{{ moduleName(currentTrack) }}</dd></div>
            </dl>
            <label v-if="!setup.canConfigure && cfgs.length > 1" class="tp-field tp-field-inline">
              <span class="tp-field-label">{{ t('agentTanks.select_config') }}</span>
              <select v-model.number="cfgIdx" data-testid="tank-config">
                <option v-for="(c, i) in cfgs" :key="i" :value="i">{{ c.label }}<template v-if="c.turret_name && c.turret_name !== c.label"> ({{ c.turret_name }})</template></option>
              </select>
            </label>
            <div>
              <AppButton variant="primary" data-testid="tank-open3d" data-tour="tankopedia-armor" @click="open3d">
                <Box :size="16" aria-hidden="true" />
                {{ t('agentTanks.open3d') }}
              </AppButton>
            </div>
            <p class="tp-muted">{{ t('agentTanks.open3d_hint') }}</p>
          </section>

          <TankConfigPanel
            v-if="setup.canConfigure && catalog"
            :detail="detail"
            :modules="modules"
            :selection="setup"
            :catalog="catalog"
            @update="writeSetup"
            @reset="resetSetup"
            @preset="applyModulePreset"
            @cycle-skill="cycleSkill"
            @max-skills="maxSkills"
            @clear-skills="clearSkills"
          />
          </div>

        <!-- 研发弹窗：客户端 ModulesTree 的形态；改动与背后的配置栏同源（URL） -->
        <AppDialog
          :open="researchOpen"
          :title="t('research.modules_title')"
          size="xl"
          data-testid="tank-research-dialog"
          @close="researchOpen = false"
        >
          <TankResearchPanel
            v-if="modules && setup.canConfigure"
            :detail="detail"
            :modules="modules"
            :selection="setup"
            :prev-vehicles="researchPrevVehicles"
            :next-vehicles="researchNextVehicles"
            @install="installFromGraph"
            @open-vehicle="openVehicleFromGraph"
          />
          <p v-else class="tp-muted">{{ t('research.modules_unavailable') }}</p>
        </AppDialog>

        <TankParamPanel
          class="tp-workbench-right"
          v-if="characteristics"
          :groups="paramTable"
          :current="characteristics"
          :base="previousCharacteristics || {}"
          :gun-meta="gunMeta"
          :pitch-limits="pitchLimits"
          :yaw-limits="yawLimits"
          :pitch-bonus="pitchBonus"
          :shells="shellRows"
          @select-shell="selectShell"
        />

        <section v-else class="tp-card-section tp-workbench-right">
          <h2 class="tp-section-title">{{ t('agentTanks.mobility') }}</h2>
          <dl class="tp-stats">
            <div><dt>{{ t('agentTanks.hp') }}</dt><dd>{{ fmtNum(detail.hp, 0) }}</dd></div>
            <div><dt>{{ t('agentTanks.speed_fwd') }}</dt><dd>{{ fmtNum(detail.speed_forward ?? summary?.speed_forward ?? detail.speed) }} km/h</dd></div>
            <div><dt>{{ t('agentTanks.speed_rev') }}</dt><dd>{{ fmtNum(detail.speed_reverse ?? summary?.speed_reverse) }} km/h</dd></div>
            <div><dt>{{ t('agentTanks.view_range') }}</dt><dd>{{ fmtNum(curCfg?.view_range ?? summary?.view_range, 0) }} m</dd></div>
            <div><dt>{{ t('agentTanks.hull_traverse') }}</dt><dd>{{ fmt(summary?.hull_traverse, 1) }} °/s</dd></div>
            <div><dt>{{ t('agentTanks.turret_traverse') }}</dt><dd>{{ fmt(curCfg?.turret_traverse_speed ?? summary?.turret_traverse_speed, 0) }} °/s</dd></div>
            <div><dt>{{ t('agentTanks.gun_dep_ele') }}</dt><dd>{{ fmtNum(gunDepression) }}° / {{ fmtNum(gunElevation) }}°</dd></div>
            <div v-if="curCfg?.reload_time != null"><dt>{{ t('agentTanks.reload') }}</dt><dd>{{ fmt(curCfg.reload_time, 1) }} s</dd></div>
            <div v-if="curCfg?.dpm != null"><dt>{{ t('agentTanks.dpm') }}</dt><dd>{{ fmt(curCfg.dpm, 0) }}</dd></div>
            <div v-if="curCfg?.aim_time != null"><dt>{{ t('agentTanks.aim_time') }}</dt><dd>{{ fmt(curCfg.aim_time, 1) }} s</dd></div>
          </dl>
        </section>
        </div>

        <!-- 无模块数据的静态详情：保留只读弹种表（可配置时弹种表已并入火力卡） -->
        <section v-if="!characteristics" class="tp-card-section">
          <h2 class="tp-section-title">{{ t('agentTanks.shells') }}</h2>
          <div class="tp-table-wrap">
            <table class="tp-table">
              <thead>
                <tr>
                  <th scope="col">{{ t('agentTanks.shell') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.pen') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.dmg') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.pen_far') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.velocity') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.module_dmg') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.normalization') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.ricochet') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in shellRows" :key="s.index">
                  <td><span class="tp-pill is-shell" :class="{ 'is-premium': s.premium }">{{ s.label }}</span></td>
                  <td class="is-num">{{ fmtNum(s.tunedPenetration) }}</td>
                  <td class="is-num">{{ fmtNum(s.tunedDamage, 0) }}</td>
                  <td class="is-num">{{ fmtNum(s.tunedPenetrationFar) }}</td>
                  <td class="is-num">{{ fmtNum(s.tunedVelocity) }}</td>
                  <td class="is-num">{{ fmtNum(s.tunedModuleDamage, 0) }}</td>
                  <td class="is-num">{{ fmtNum(s.normalization, 0) }}°</td>
                  <td class="is-num">{{ fmtNum(s.ricochet, 0) }}°</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>

    <!-- ================= 列表态 ================= -->
    <!-- v-if：直达详情不提前挂载；v-show：列表→详情→返回保留增量条数与搜索草稿 -->
    <PageHeader v-if="listMounted" v-show="detailId == null" :title="t('agentTanks.title')" :description="t('agentTanks.hint')">
      <template #actions>
        <AppButton
          v-if="detailId == null"
          variant="primary"
          data-testid="tankopedia-techtree"
          @click="openTechTree"
        >
          <Network :size="18" aria-hidden="true" />
          {{ t('research.open_techtree') }}
        </AppButton>
      </template>
    </PageHeader>
    <TankCatalogMenu
      v-if="listMounted"
      v-show="detailId == null"
      :tanks="tanks"
      :state="listState"
      :error="listError"
      :filters="listFilters"
      @update:filters="writeFilters"
      @select="tank => openDetail(tank.id)"
      @retry="loadList"
    />
  </section>
</template>

<style scoped>
.tankopedia {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--gutter) var(--space-12);
  color: var(--color-text-primary);
}

.tankopedia :deep(.page-header) { margin-bottom: 0; }

.tp-muted { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.tp-status { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }

/* 详情页配置选择（列表的搜索/筛选/排序在 TankCatalogMenu 内，单一实现） */
.tp-field { display: grid; gap: var(--space-1); min-inline-size: 140px; }
.tp-field-inline { max-inline-size: 360px; }
.tp-field-label { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-field select {
  inline-size: 100%;
  min-block-size: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}
.tp-field select:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* 固定比例的图片框：懒加载图片到达前后都不引起布局位移 */
.tp-media {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 8 / 5;
  inline-size: 100%;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
}

/* 图片必须**绝对定位铺满**，不能让它在网格里按 `block-size:100%` 自适应。
 *
 * 容器是 `display:grid` + `place-items:center`：网格区域按内容 sizing，`block-size:100%`
 * 解不出确定高度，于是 img 退回**固有比例**——封面图是逐车紧裁的（高固定、宽 84~190），
 * 窄于 8:5 的车会算得比容器更高（实测列表卡片 164.8×103 的框里 img 是 164.8×133.5，
 * 详情 hero 240×150 里是 240×156.9），多出来的部分被容器的 `overflow:hidden`
 * **从下方裁掉**（履带/车体下缘被切）。
 * 绝对定位后 img 盒恒等于容器盒，`contain` 完整装下整张图，不再裁切。 */
.tp-media img {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
}

.tp-badges { display: flex; flex-wrap: wrap; gap: var(--space-1); }

.tp-pill {
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  white-space: nowrap;
}

.tp-pill.is-tier,
.tp-pill.is-premium { background: color-mix(in oklab, var(--color-warning) 16%, var(--color-surface-1)); color: var(--color-warning); }
.tp-pill.t-light { background: color-mix(in oklab, var(--color-success) 16%, var(--color-surface-1)); color: var(--color-success); }
.tp-pill.t-medium { background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1)); color: var(--color-accent-text); }
.tp-pill.t-heavy { background: color-mix(in oklab, var(--color-danger) 16%, var(--color-surface-1)); color: var(--color-danger); }
.tp-pill.t-td { background: color-mix(in oklab, var(--color-info) 16%, var(--color-surface-1)); color: var(--color-info); }
.tp-pill.is-shell { background: color-mix(in oklab, var(--color-info) 14%, var(--color-surface-1)); color: var(--color-info); }
.tp-pill.is-shell.is-premium { background: color-mix(in oklab, var(--color-warning) 16%, var(--color-surface-1)); color: var(--color-warning); }

/* ---------- 详情态 ---------- */
.tp-detail-nav { display: flex; }

.tp-detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.tp-media-lg { flex: 0 0 240px; inline-size: 240px; }
.tp-detail-title { display: grid; gap: var(--space-2); min-inline-size: 0; }
.tp-detail-actions { display: flex; align-items: center; gap: var(--space-2); margin-inline-start: auto; }
.tp-detail-title h1 { margin: 0; font: var(--type-h1); overflow-wrap: anywhere; }

.tp-card-section {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.tp-section-title { margin: 0; font: var(--type-h3); }

/* 工作台：桌面左右两栏（模型/装甲入口 + 配置面板），窄屏纵向堆叠 */
.tp-workbench { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: var(--space-4); align-items: start; }
.tp-workbench-left { display: grid; gap: var(--space-4); align-content: start; min-inline-size: 0; }
.tp-workbench-right { min-inline-size: 0; }
.tp-model-card { align-content: start; }

.tp-summary {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-2);
  margin: 0;
}
.tp-summary > div { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); }
.tp-summary dt { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-summary dd { margin: 0; font: var(--type-body); font-weight: 600; overflow-wrap: anywhere; }

.tp-table-wrap { overflow-x: auto; }
.tp-table { inline-size: 100%; border-collapse: collapse; font: var(--type-body); font-variant-numeric: tabular-nums; }
.tp-table th { padding: var(--space-1) var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; text-align: start; white-space: nowrap; }
.tp-table td { padding: var(--space-2); border-block-start: 1px solid var(--color-border-subtle); }
.tp-table .is-num { text-align: end; }

.tp-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-2);
  margin: 0;
}

.tp-stats > div { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); }
.tp-stats dt { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-stats dd { margin: 0; font: var(--type-h3); font-variant-numeric: tabular-nums; }

/* 平板：详情头部封面缩小；工作台改单列（配置面板在下） */
@media (768px <= width < 1200px) {
  .tp-media-lg { flex-basis: 200px; inline-size: 200px; }
  .tp-workbench { grid-template-columns: minmax(0, 1fr); }
}

/* 手机：详情头部改为上下排列 */
@media (width < 768px) {
  .tankopedia { gap: var(--space-3); padding-block-start: var(--space-4); }
  .tp-detail-head { flex-direction: column; align-items: stretch; gap: var(--space-3); }
  .tp-media-lg { flex-basis: auto; inline-size: 100%; }
  .tp-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tp-workbench { grid-template-columns: minmax(0, 1fr); }
}
</style>
