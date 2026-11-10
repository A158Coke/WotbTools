<script setup>
/**
 * Agent 3D 装甲查看器（?view=agent-armor）：tankViewer.js 场景内核宿主。
 * Vue owns navigation / recorded-shot summary / the shared tank picker (TankCatalogMenu);
 * tankViewer owns model controls via stable DOM IDs.
 * 数据面：tank/{id}.json + glb/{id}/*.glb 静态资产（agentData.ts，?assets= 基址），
 * 击穿判定 penetration.js 客户端移植；射击复现数据经 sessionStorage 交接（AgentShots）。
 * URL 参数保持上游契约：?tank= &shooter= &config= &shell= &shot= &heatmap=1 &world=1 等。
 * 普通同车型检视：shell 是当前展示 config 的弹表下标；无效下标回退第一项。
 * 射击复现：shell 属于射手 scfg 弹表，回放 shell_id 自动匹配优先于 URL 选弹。
 */
import { computed, inject, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, SlidersHorizontal, MousePointer2, ChevronDown, X } from 'lucide-vue-next'
import { fetchReplayShots, shotViewerQuery, fetchTankData } from '../scene/agentData.js'
import { shotResultBadge } from '../utils/shotPresentation.js'
import { shellLabel, armorPartLabel, armorResultLabel, tankNationLabel, tankTypeLabel } from '../scene/tankMeta.js'
import { formatPlaybackClock } from '../utils/playbackClock.js'
import { shouldResetShellOnConfigChange } from '../utils/armorShellSelection.js'
import { initTankViewer } from '../scene/tankViewer.js'
import { loadDevices, loadTankModules } from '../utils/researchCatalog.js'
import { findTankModules, pitchDeviceBonus, presetProvidesPitchDevice, recordedTargetMatchesShot } from '../replay-local/compute/tankSetup'
import { detectWebGL } from '../scene/webglSupport.js'
import { usePointer } from '../composables/useBreakpoint.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { useForcedLandscape } from '../composables/useForcedLandscape.js'
import Scene3DStatus from './Scene3DStatus.vue'
import RotatePrompt from './RotatePrompt.vue'
import TankCatalogMenu from './TankCatalogMenu.vue'
import ArmorSideConfig from './ArmorSideConfig.vue'
import ArmorShotHud from './ArmorShotHud.vue'

const { t, te } = useI18n()
const router = useRouter()
const route = useRoute()
const isShotPage = computed(() => route.query.shot != null)
// 射击复现没有升级态证据：缺省显式 stock（raw），不把回放未证明的配置补成 XI 满级；
// 普通装甲检视缺省交给 resolveUpgradeSelection（XI→top）。
const armorUpgrade = value => (isShotPage.value ? (value ?? 'stock') : value)
const shotSnapshot = ref([])
const activeShot = computed(() => shotSnapshot.value.find(shot => String(shot.index) === String(route.query.shot)))
const shotPosition = computed(() => shotSnapshot.value.indexOf(activeShot.value))
const recordedResult = computed(() => activeShot.value ? shotResultBadge(activeShot.value, t) : null)
const navigating = ref(false)
const navigationError = ref('')
let alive = true
let navigationSeq = 0
let requestSeq = 0
// The stored list is the selected shooter's snapshot. The scene fetches its own copy before mirroring.
async function readShotSnapshot(seq) {
    if (!isShotPage.value) { shotSnapshot.value = []; return }
    try {
        const data = await fetchReplayShots()
        if (alive && seq === navigationSeq) shotSnapshot.value = data.shots
    } catch { if (alive && seq === navigationSeq) shotSnapshot.value = [] } // The scene reports the actionable missing-handoff error.
}
function shotTankName(role) {
    return activeShot.value?.[`${role}_tank_name`] || t('agentShots.unknown_tank')
}
function backToShots() {
    if (canGoBack) router.back()
    else router.replace({ query: { view: 'agent-shots' } })
}
// 深链直达（?view=agent-armor 无 shot）没有浏览器历史可退：退出动作改走「回坦克百科」
// replace——手机横屏沉浸态卸载外壳后，这颗按钮是页面唯一的站内出口，任何入口形态都
// 必须在（WotbTools #767 复审 P2：直达 + 沉浸态曾让应用内导航全部消失）。
function backOrTankopedia() {
    if (canGoBack) router.back()
    else router.replace({ query: { view: 'agent-tankopedia' } })
}
async function adjacentShot(offset) {
    const shot = shotSnapshot.value[shotPosition.value + offset]
    if (!shot || navigating.value) return
    const seq = ++requestSeq
    navigating.value = true
    navigationError.value = ''
    try {
        const query = await shotViewerQuery(shot)
        if (alive && seq === requestSeq) {
            if (query) await router.replace({ query })
            else navigationError.value = t('armor.navigation_failed')
        }
    } catch {
        if (alive && seq === requestSeq) navigationError.value = t('armor.navigation_failed')
    } finally {
        if (alive && seq === requestSeq) navigating.value = false
    }
}
const { coarse } = usePointer()
// 审计 3D-09：从射击分析 / 坦克百科在当前标签页打开，返回走浏览器历史
const canGoBack = typeof window !== 'undefined' && !!window.history.state?.back
const hint = computed(() => t(coarse.value ? 'armor.hint_touch' : 'armor.hint'))
const shotGestures = computed(() => ['rotate', 'zoom', 'pan'].map(action => ({
    action: t(`armor.gestures.${action}`),
    input: t(`armor.gestures.${coarse.value ? 'touch' : 'mouse'}_${action}`),
})))
// 「参数」面板（装备 / 射击方 / 目标 / 配置）：桌面与手机都默认收起，不再常驻占掉 3D 视口；
// 桌面端复用手机竖屏的顶栏结构，信息卡与设置面板合并为左上角同一张卡。
const toolsOpen = ref(false)
/** 两侧配置编辑器 / 右上角射击 HUD 就绪后才隐藏原生控件（资产缺失时仍可回退） */
const shooterReady = ref(false)
const targetReady = ref(false)
const hudReady = ref(false)
/** 目标/被展示车预设是否提供 122（装甲页俯仰配件勾选可用性；由 ArmorSideConfig 上报）。 */
const pitchFromModules = ref(false)
const pitchFromModulesKnown = ref(false)
/** 122 的俯仰加成数值（宿主从 research/devices.json 读，注入场景；场景不硬编码）。 */
const pitchDeviceBonusValue = ref(null)
/** 两侧模块选择默认收起（2026-10-28 用户要求）；坦克切换按钮在卡片头部，与模块同一块。 */
const shooterOpen = ref(false)
const targetOpen = ref(false)
const editorsReady = computed(() => shooterReady.value && targetReady.value)

/** 重建场景的 query 键：装配键（config/engine/track/dev/cons/prov/shell）不在其中——
 *  改装配只就地更新（viewer.setConfig）与写 URL，不销毁 3D 场景。 */
const SCENE_QUERY_KEYS = [
  'tank', 'shooter', 'shot', 'world', 'heatmap', 'az', 'h', 'd', 'quality', 'move', 'rel', 'clean', 'debug',
  'upgrade', 'abilities', 'supgrade', 'sabilities',
]
const sceneSignature = () => SCENE_QUERY_KEYS.map(key => `${key}=${route.query[key] ?? ''}`).join('&')
let lastSceneSignature = null
let preserveToolsOnRebuild = false
// 「实际搭载」面板懒激活：首次展开「参数」才拉 research 数据（catalog/modules 是 MB 级
// JSON，不该在 3D 场景加载路径上抢带宽）；一旦激活保持（收起再展开不重复拉）。
const loadoutActive = ref(false)
watch(toolsOpen, (open) => { if (open) loadoutActive.value = true }, { immediate: true })
// 编辑器/HUD 就绪 → 隐藏场景自带的原生下拉与装备勾选（资产缺失时保留为回退）
watch([editorsReady, hudReady], ([editors, hud]) => {
  viewer?.setConfigUiVisible?.(!editors)
  viewer?.setShellUiVisible?.(!hud)
}, { flush: 'sync' })
/** 搭载面板的车：场景选择器换车后以 viewer 上报为准（选车不写 URL），深链回落 URL。 */
const loadoutTankId = computed(() => selectedTargetId.value ?? (Number(route.query.tank) || null))
// ?clean=1 时场景脚本会隐藏全部常驻面板（截图 / 嵌入用）；顶栏卡片与参数开关一并让位
const cleanQuery = computed(() => route.query.clean === '1')
const shooterSetupId = computed(() => (selectedShooterId.value ?? Number(route.query.shooter)) || loadoutTankId.value)
const targetSetupId = computed(() => selectedTargetId.value ?? loadoutTankId.value)
const isXiTank = id => Number(tankList.value.find(tank => Number(tank.id) === Number(id))?.tier) === 11
/**
 * 射击装备真值只属于记录的那辆目标车：换目标后不得把原车的 122 / 强化装甲继承给新车。
 * 可用性因此拆成「当前车模块目录支持」+「记录目标与当前目标一致时的回放真值」。
 */
const recordedPitchDevice = computed(
  () => recordedTargetMatchesShot(activeShot.value, targetSetupId.value)
    && !!activeShot.value?.target_equipment?.improved_pitch_limits,
)
/** 可用性：模块目录确认有槽位，或射击真值证明当前目标实际装过 122。未知时 false（fail-closed）。 */
const pitchDeviceAvailable = computed(() => pitchFromModules.value || recordedPitchDevice.value)
/** 射击方配置：只认显式 &scfg=；缺省时射击方用自身默认顶级配置（configs 末位），
 *  不从受击方的 &config= 推导——双方即使是同一辆车也必须独立。空 scfg 视同缺省。 */
const shooterConfigValue = computed(() => {
  const scfg = route.query.scfg
  return scfg != null && scfg !== '' ? scfg : null
})

/** 同一 tick 连点两下（弹种 + 开关）时，第二次写入必须基于上一次尚未落地的 query，
 *  否则会把第一击的结果覆盖回旧值（与坦克百科 pendingQuery 同因同解）。 */
let pendingShotQuery = null
watch(() => route.query, () => { pendingShotQuery = null }, { flush: 'sync' })

/** 原生回退控件变更后写回 URL；场景已经自行应用，不能再回调 viewer 造成循环。 */
function replaceArmorSetupQuery(mutate) {
  const query = { ...(pendingShotQuery || route.query) }
  mutate(query)
  pendingShotQuery = query
  router.replace({ query })
}

function syncNativeTargetConfig(index) {
  const n = Number(index)
  if (!Number.isInteger(n) || n < 0) return
  replaceArmorSetupQuery((query) => {
    query.config = String(n)
    // 受击方换配置不改变射击方弹表，shell 始终保留
    if (shouldResetShellOnConfigChange({ side: 'target', configChanged: true })) delete query.shell
  })
}

function syncNativeShell(index) {
  const n = Number(index)
  if (!Number.isInteger(n) || n < 0) return
  replaceArmorSetupQuery((query) => { query.shell = String(n) })
}

function syncNativeEquipment(kind, value) {
  if (kind !== 'calibrated' && kind !== 'enhanced' && kind !== 'pitch') return
  replaceArmorSetupQuery((query) => {
    if (kind === 'calibrated') query.eqcal = value ? '1' : '0'
    else if (kind === 'enhanced') query.eqenh = value ? '1' : '0'
    else query.eqpitch = value ? '1' : '0'
  })
}

function applyShotSetup(patch) {
  if (!patch) return
  const query = { ...(pendingShotQuery || route.query) }
  const put = (key, value) => {
    if (value == null || value === '') delete query[key]
    else query[key] = String(value)
  }
  if ('shell' in patch) put('shell', patch.shell)
  if ('eqcal' in patch) put('eqcal', patch.eqcal ? '1' : '0')
  if ('eqenh' in patch) put('eqenh', patch.eqenh ? '1' : '0')
  if ('eqpitch' in patch) put('eqpitch', patch.eqpitch ? '1' : '0')
  // 先落 URL（状态 owner），再驱动场景：场景侧异常不应该把用户的选择丢掉
  pendingShotQuery = query
  router.replace({ query })
  if ('shell' in patch) viewer?.setShell?.(Number(patch.shell))
  if ('eqcal' in patch) viewer?.setEquipmentOverride?.('calibrated', patch.eqcal)
  if ('eqenh' in patch) viewer?.setEquipmentOverride?.('enhanced', patch.eqenh)
  if ('eqpitch' in patch) viewer?.setEquipmentOverride?.('pitch', patch.eqpitch)
}

/**
 * 射击方 / 受击方的模块与配件改动（各自完整的详情页配置逻辑）：
 * 写各自的 URL 键并驱动场景——射击方换主炮重载弹表，受击方换配置切装甲板。
 */
function applySide(side, patch) {
  if (!patch) return
  const query = { ...(pendingShotQuery || route.query) }
  const put = (key, value) => {
    const text = Array.isArray(value) ? value.join(',') : value
    if (text == null || text === '') delete query[key]
    else query[key] = String(text)
  }
  const shooter = side === 'shooter'
  const configChanged = patch.configChanged === true
  const upgradeKey = shooter ? 'supgrade' : 'upgrade'
  const abilitiesKey = shooter ? 'sabilities' : 'abilities'
  const previousUpgrade = query[upgradeKey]
  const previousAbilities = query[abilitiesKey]
  // PATCH 里带 upgrade 时写显式模式（stock/top/custom 原样写回——custom 由
  // ArmorSideConfig 携带 abilities 一起发来，折叠成 top 会静默展示整套顶级数值）；
  // 缺省（无 key）= XI 顶级由场景侧决定。
  if ('upgrade' in patch) {
    put(upgradeKey, patch.upgrade === 'stock' || patch.upgrade === 'custom' ? patch.upgrade : 'top')
  }
  if ('abilities' in patch) put(abilitiesKey, patch.abilities)
  const upgradesChanged = previousUpgrade !== query[upgradeKey] || previousAbilities !== query[abilitiesKey]
  if (upgradesChanged) {
    preserveToolsOnRebuild = true
    // 旧选车器只更新场景内选择；升级重建前把实际双方车型落到 URL，避免回到先前深链。
    put('tank', targetSetupId.value)
    put('shooter', shooterSetupId.value)
  }
  if (shooter) {
    // 只有真正换炮才写 scfg：只换发动机/履带不凭空建立独立射手配置，
    // 保持 URL 最小改动。换炮时清除旧 shell 下标（弹表已换）。
    if (configChanged) put('scfg', patch.config)
    put('sengine', patch.engine)
    put('strack', patch.track)
    put('sdev', patch.dev)
  } else {
    put('config', patch.config)
    put('engine', patch.engine)
    put('track', patch.track)
    put('dev', patch.dev)
  }
  if (shouldResetShellOnConfigChange({ side, configChanged })) delete query.shell
  pendingShotQuery = query
  router.replace({ query })
  // 升级的装甲/俯仰/弹表共用原有场景重建；不要同时启动旧场景的换炮请求。
  if (!configChanged || upgradesChanged) return
  if (shooter) viewer?.setShooterConfig?.(Number(patch.config))
  else viewer?.setConfig?.(Number(patch.config))
}

let viewer = null
/** tankViewer 已创建并挂上静态控件事件（碰撞/热力图按钮在此之前置灰，避免点击丢失） */
const viewerReady = ref(false)
const distanceState = ref(null)
// 审计 3D-23：创建渲染器之前做 WebGL 预检；不支持时整页换成说明，不再抛原始报错
const webgl = detectWebGL()
/** 场景加载状态（tankViewer onLoadState 上报）：loading / ready / error */
const load = ref({ state: 'loading', progress: null, message: '' })
// 手机横屏沉浸态：compact 外壳的顶栏 + Tab 栏（104px）在 ~375px 高的横屏视口里是最大单项
// 消耗。判据与 ReplayWorkspace 同一口径（shared/breakpoints 的手机形态查询 + 非竖屏 + 触屏）；
// AppShell 是显隐与 token 归零的唯一 owner，这里只申请 / 释放。WebGL 不可用时整页是普通
// 文档流（依赖 Tab 栏导航），不申请；宽 ≥768 的横屏手机 / 平板上申请是无害 no-op。
const shellChrome = inject(SHELL_CHROME_KEY, null)
const shellOwner = Symbol('agent-armor')
const { isPhone } = usePlaybackPhoneForm()
const { isPortrait } = usePlaybackPortraitViewport()
const wantsImmersive = computed(() => coarse.value && isPhone.value && !isPortrait.value && webgl.supported)
watch(wantsImmersive, (on) => shellChrome?.request(shellOwner, on), { immediate: true })
onBeforeUnmount(() => shellChrome?.request(shellOwner, false))
// 强制横屏（design-language §9）：只在 Android 手机 App（原生锁定）与 iPhone Safari（竖屏提示旋转）生效；
// 桌面、平板与 Android 浏览器沿用小屏布局。场景在提示下保持挂载，转到横屏即继续。
const forcedLandscape = useForcedLandscape(computed(() => webgl.supported))
// 点选结果胶囊（顶部正中）：小屏默认只显示最终判定一行，点开看逐层明细；新判定回到收起态。
const resultExpanded = ref(false)
const onboarding = inject(ONBOARDING_KEY, null)
onMounted(() => onboarding?.registerSurface('armor', {
    ready: () => load.value.state === 'ready',
    failed: () => !webgl.supported || load.value.state === 'error',
}))
onBeforeUnmount(() => onboarding?.registerSurface('armor', null))
/** 重建场景 DOM 的计数：整体重试时换 key，让 tankViewer 拿到全新的按 ID 查找的节点 */
const attempt = ref(0)
const PHASE_KEY = { 'armor model': 'armor_model', 'tank model': 'tank_model', 'tank data': 'tank_data', 'tank list': 'tank_list', 'shell data': 'shell_data' }

function onLoadState(next) {
    load.value = { state: next.state, progress: next.progress ?? null, message: next.message || '' }
}

// 选车弹窗：菜单本体是共享 TankCatalogMenu（与坦克百科同一套搜索/筛选/排序/卡片）。
// 名册与当前选择由 tankViewer 回调提供；选择动作回到 viewer.selectTank 加载弹药/目标。
const pickerOpen = ref(false)
const pickerMode = ref('target')
const tankList = ref([])
const tankListState = ref('loading')
const selectedShooterId = ref(null)
const selectedTargetId = ref(null)
const pickerFilters = ref({ q: '', tier: '', nation: '', type: '', sort: 'name' })
const pickerTitle = computed(() => pickerMode.value === 'shooter' ? t('armor.select_shooter') : t('armor.select_target'))
const pickerSelectedId = computed(() => pickerMode.value === 'shooter' ? selectedShooterId.value : selectedTargetId.value)
// 选车器换车不写 route；子编辑器按 tank-id 重建，就绪标志必须随车重置，
// 否则新车的编辑器不可用/加载失败时原生配置下拉仍被旧标志隐藏。
// 必须放在 selectedShooterId/selectedTargetId 声明之后：watch 注册时立即求值 source。
/**
 * 122 可用性由常驻 HUD / URL 覆盖使用，不能等「参数」面板懒挂载 `ArmorSideConfig`
 * 才给结论；这里按目标车独立预取（nation modules 有缓存，target 切换才重查）。
 */
let pitchAvailabilitySeq = 0
let pitchAvailabilityTimer = null
const PITCH_AVAILABILITY_RETRY_MS = 5000
const PITCH_AVAILABILITY_MAX_ATTEMPTS = 3
async function resolvePitchAvailability(tankId, attempt = 0) {
  const seq = ++pitchAvailabilitySeq
  if (pitchAvailabilityTimer) {
    clearTimeout(pitchAvailabilityTimer)
    pitchAvailabilityTimer = null
  }
  if (!(tankId > 0)) {
    pitchFromModules.value = false
    pitchFromModulesKnown.value = true
    return
  }
  try {
    const [detail, devices] = await Promise.all([fetchTankData(tankId), loadDevices()])
    if (seq !== pitchAvailabilitySeq) return
    // 加成数值只依赖 devices.json：先落盘再等模块目录。模块请求失败只影响槽位确认，
    // 不得阻断已取得的 4°/3°（回放真值仍可让 HUD/场景启用 122）。
    pitchDeviceBonusValue.value = pitchDeviceBonus([122], devices)
    const nationData = await loadTankModules(detail.nation)
    if (seq !== pitchAvailabilitySeq) return
    const modules = findTankModules(nationData, tankId)
    pitchFromModules.value = presetProvidesPitchDevice(modules, { devicePresets: devices?.devicePresets })
    // 只有成功读到目录才允许后续「确认不支持 → 清理 URL 覆盖」。
    pitchFromModulesKnown.value = true
  } catch {
    if (seq !== pitchAvailabilitySeq) return
    // 瞬时网络/资产失败 ≠ 该车不支持：保留 unknown（不清理 eqpitch），临时停用加成并重试。
    pitchFromModules.value = false
    pitchFromModulesKnown.value = false
    if (attempt + 1 < PITCH_AVAILABILITY_MAX_ATTEMPTS) {
      pitchAvailabilityTimer = setTimeout(() => {
        pitchAvailabilityTimer = null
        if (seq === pitchAvailabilitySeq) resolvePitchAvailability(tankId, attempt + 1)
      }, PITCH_AVAILABILITY_RETRY_MS)
    }
  }
}

watch(shooterSetupId, () => { shooterReady.value = false; hudReady.value = false })
watch(targetSetupId, (id) => {
  targetReady.value = false
  // 换车后旧车的 122 可用性不再有效；先 fail-closed，等目标车模块目录返回。
  pitchFromModules.value = false
  pitchFromModulesKnown.value = false
  resolvePitchAvailability(id)
}, { immediate: true })

/**
 * 可用性改变时同步场景；模块目录确认该车没有 122 槽位时清掉共享链接的覆盖。
 * 必须注册在 selectedShooterId/selectedTargetId 声明之后：watch 会立即求值 source，
 * 而 pitchDeviceAvailable 依赖 targetSetupId。
 */
watch([pitchDeviceAvailable, pitchFromModulesKnown], ([available, known]) => {
  viewer?.setPitchDeviceAvailable?.(available)
  if (!available && known && route.query.eqpitch != null) {
    replaceArmorSetupQuery(query => { delete query.eqpitch })
    // 必须回到 null（撤销覆盖），不能写 false：effectivePitchDevice 的优先级是
    // equipmentOverride.pitch != null 即直接采用——显式 false 会永久压住后续
    // 恢复的 recorded target truth（切走再切回原目标时拖炮不再得到 +4°/+3°）。
    viewer?.setEquipmentOverride?.('pitch', null)
  }
})

function openPicker(mode) {
    if (!viewer?.canPick?.()) return
    pickerMode.value = mode
    pickerOpen.value = true
}
function closePicker() {
    if (!pickerOpen.value) return
    pickerOpen.value = false
    const id = pickerMode.value === 'shooter' ? 'shooter-select' : 'target-select'
    nextTick(() => document.getElementById(id)?.focus())
}
function onPickerSelect(tank) {
    if (viewer?.selectTank?.(pickerMode.value, tank.id)) closePicker()
}
function setPickerFilters(filters) {
    pickerFilters.value = filters
}
function onPickerKeydown(event) {
    if (!pickerOpen.value) return
    // 筛选 sheet 等二级模态层（portal 到 body）自己处理 Esc / Tab：按键发生在 #tank-picker 之外的 dialog 内时不介入
    const layer = event.target instanceof Element ? event.target.closest('[role="dialog"]') : null
    if (layer && layer.id !== 'tank-picker') return
    if (event.key === 'Escape') { event.preventDefault(); closePicker(); return }
    if (event.key !== 'Tab') return
    const picker = document.getElementById('tank-picker')
    if (!picker) return
    const focusable = [...picker.querySelectorAll('button, input, select')].filter(el => !el.disabled)
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (!first) return
    if (event.shiftKey && (document.activeElement === first || !picker.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !picker.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
    }
}
onMounted(() => window.addEventListener('keydown', onPickerKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onPickerKeydown))
onBeforeUnmount(() => {
  // 先进位使在飞行请求的 seq 失效：卸载后 reject 不得再挂 5s 重试。
  pitchAvailabilitySeq++
  if (pitchAvailabilityTimer) {
    clearTimeout(pitchAvailabilityTimer)
    pitchAvailabilityTimer = null
  }
})

// 122 的加成数值只有 devices.json 一个权威来源；场景通过 setter 接收，避免前端硬编码 +4/+3。
// 成功读取目录（含首轮失败后的重试）会在 resolvePitchAvailability() 里同步恢复 bonus。
watch(pitchDeviceBonusValue, value => { viewer?.setPitchDeviceBonus?.(value) })

function startViewer(preserveSelection = false) {
    distanceState.value = null
    const seq = navigationSeq
    const q = new URLSearchParams(window.location.search)
    const tank = Number(q.get('tank')) || 0
    if (!preserveSelection) {
        // 同一 view 的路由重建：先丢掉上一条路由的选择。新 viewer 在 populateTankLists
        // 发布 onTankSelection 之前若丢失上下文，retry(true) 才不会恢复旧路线。
        selectedShooterId.value = null
        selectedTargetId.value = null
    }
    // 初始坦克：?tank=（缺省给 Super Conqueror = 19281，避免空参打开白屏；
    // 2026-10-19 用户指定默认测试车辆）。
    // context-lost full rebuild 时沿用当前 shooter/target（picker 选择不写 URL），
    // 否则用户切车后点“重试”会被重置回 URL 里的初始坦克。
    const initialTarget = preserveSelection && selectedTargetId.value != null
        ? selectedTargetId.value
        : (tank || 19281)
    const initialShooter = preserveSelection && selectedShooterId.value != null
        ? selectedShooterId.value
        : (Number(q.get('shooter')) || initialTarget)
    // 审计 3D-16：场景脚本写入的文案与枚举值按当前语言提供
    // 初始车/射手经显式参数注入（2026-10-24 起替代 window.__INITIAL_TANK__ / __INITIAL_SHOOTER__）
    viewer = initTankViewer({
        initialTankId: initialTarget,
        initialShooterId: initialShooter,
        pitchDeviceBonus: pitchDeviceBonusValue.value,
        pitchDeviceAvailable: pitchDeviceAvailable.value,
        labels: {
            loading: t('armor.loading'),
            shellUnavailable: t('armor.shell_unavailable'),
            loadFailed: (phase, msg) => t('armor.load_failed', { phase, msg }),
            contextLost: t('armor.context_lost'),
            type: (value) => tankTypeLabel(t, te, value),
            nation: (value) => tankNationLabel(t, te, value),
            showCollision: t('armor.show_collision'),
            hideCollision: t('armor.hide_collision'),
            heatmap: t('armor.heatmap'),
            hideHeatmap: t('armor.hide_heatmap'),
            technicalEvidence: t('armor.technical_evidence'),
            shotView: t('armor.shot_view'),
            relativeView: t('armor.relative_view'),
            worldView: t('armor.world_view'),
            pitchDevice: t('armor.pitch_device'),
            replayEquipmentAutoTitle: t('armor.equipment_auto'),
            partName: (name) => armorPartLabel(name, t),
            resultName: (result) => armorResultLabel(result, t),
            shotDamage: t('armor.shot_damage'),
            shotPenChance: t('armor.penetration_chance'),
            shotPenDamage: t('armor.penetration_damage'),
            shotSplashDamage: t('armor.splash_damage'),
            shotMinDamage: t('armor.min_damage'),
            shotMaxDamage: t('armor.max_damage'),
            shotAvgDamage: t('armor.avg_damage'),
            shotAvgShort: t('armor.avg_short'),
            heRadius: t('armor.splash_radius'),
            heBestSample: t('armor.best_sample'),
            directHit: t('armor.direct_hit'),
            expectedDamage: t('armor.expected_damage'),
            heSamplingUnavailable: t('armor.sampling_unavailable'),
            noPrimaryBlocked: t('armor.no_primary_blocked'),
            heBestSampleUpper: t('armor.best_sample_upper'),
            heBestSampleLower: t('armor.best_sample_lower'),
            sectionName: (section) => {
                const key = section === 'gunBarrel' ? 'gun_barrel' : section
                return t(`armor.sections.${key}`)
            },
            shotRicochetSeg: t('armor.shot_ricochet_seg'),
            shotLoss: t('armor.shot_loss'),
            shotNominal: t('armor.shot_nominal'),
            shotBlocked: t('armor.shot_blocked'),
            shotDistance: t('armor.distance'),
            effectivePenetration: t('armor.effective_penetration'),
            distanceUnit: t('armor.distance_unit'),
            mayPenetrate: t('armor.may_penetrate'),
            armorStateLabel: t('armor.armor_state'),
            armorStateDefaultSuffix: t('armor.armor_state_default'),
            armorStateAutoTitle: t('armor.armor_state_auto'),
            phase: (phase) => (PHASE_KEY[phase] ? t(`armor.phase_${PHASE_KEY[phase]}`) : phase),
        },
        onLoadState: (next) => { if (alive && seq === navigationSeq) onLoadState(next) },
        onTankList: (list) => {
            if (!alive || seq !== navigationSeq) return
            tankList.value = list
            tankListState.value = 'ready'
        },
        onTankSelection: (selection) => {
            if (!alive || seq !== navigationSeq) return
            selectedShooterId.value = selection.shooter
            selectedTargetId.value = selection.target
        },
        onDistanceChange: state => { if (alive && seq === navigationSeq) distanceState.value = state },
        onConfigSelection: index => syncNativeTargetConfig(index),
        onShellSelection: index => syncNativeShell(index),
        onEquipmentSelection: (kind, value) => syncNativeEquipment(kind, value),
    })
    viewerReady.value = true
    lastSceneSignature = sceneSignature()
    // 编辑器可能先于场景就绪（模块 JSON 比模型快）：创建后补一次显隐
    viewer.setConfigUiVisible?.(!editorsReady.value)
    viewer.setShellUiVisible?.(!hudReady.value)
}

async function retry() {
    if (!alive) return
    load.value = { state: 'loading', progress: null, message: '' }
    const previous = viewer
    if (previous?.retry?.()) return
    const preserveSelection = previous?.isContextLost?.() === true
    const seq = ++navigationSeq
    requestSeq++
    navigating.value = false
    // 名册都没拿到（或渲染器创建失败）：销毁后重建整个场景
    viewerReady.value = false
    previous?.destroy?.()
    viewer = null
    attempt.value += 1
    await nextTick()
    if (alive && seq === navigationSeq && webgl.supported) startViewer(preserveSelection)
}

onMounted(async () => {
    const seq = navigationSeq
    await readShotSnapshot(seq)
    await nextTick()
    if (alive && seq === navigationSeq && webgl.supported) startViewer()
})
// Same-view query navigation does not remount ViewHost. Dispose the old scene before rebuilding its ID contract.
watch(() => route.fullPath, async () => {
    if (route.query.view !== 'agent-armor') return
    // 只改了装配键：场景已由 applyShotSetup 就地更新，不重建（否则每次点模块都会闪一下）
    if (viewer && sceneSignature() === lastSceneSignature) return
    requestSeq++
    // 仅重建场景时子编辑器/HUD 仍挂载；它们的 boolean 监听不会重新发 ready，
    // 不能在这里清空 readiness，否则会同时显示原生回退控件。
    viewerReady.value = false
    viewer?.destroy?.()
    viewer = null
    if (!preserveToolsOnRebuild) toolsOpen.value = false
    preserveToolsOnRebuild = false
    pickerOpen.value = false
    tankList.value = []
    tankListState.value = 'loading'
    load.value = { state: 'loading', progress: null, message: '' }
    attempt.value += 1
    const seq = ++navigationSeq
    shotSnapshot.value = []
    await readShotSnapshot(seq)
    await nextTick()
    if (alive && seq === navigationSeq && webgl.supported) startViewer()
    if (alive && seq === navigationSeq) navigating.value = false
})

// 离开路由必须销毁：rAF 循环 + WebGL 上下文不释放，反复进出会耗尽浏览器
// WebGL 上下文上限（~16 个）出现 "context lost" 黑屏
onBeforeUnmount(() => {
    alive = false
    navigationSeq++
    requestSeq++
    if (viewer?.destroy) viewer.destroy()
    viewer = null
})
</script>

<template>
<div class="armor-view" data-scene-surface data-tour="armor-workspace" :class="{ 'is-unsupported': !webgl.supported, 'has-back': !isShotPage, 'is-shot': isShotPage, 'is-clean': cleanQuery }">
    <button v-if="!isShotPage" type="button" class="armor-back" data-testid="armor-back" :aria-label="$t('armor.back')" @click="backOrTankopedia"><ArrowLeft :size="16" aria-hidden="true" /><span class="armor-back-label">{{ $t('armor.back') }}</span></button>
    <header v-if="isShotPage && !cleanQuery" class="armor-shot-header" data-testid="armor-shot-header">
        <button type="button" class="armor-shot-back" :aria-label="$t('armor.back_to_shots')" @click="backToShots"><ArrowLeft :size="18" aria-hidden="true" /><span>{{ $t('armor.back_to_shots') }}</span></button>
        <div class="armor-shot-context">
            <div class="armor-shot-matchup"><strong>{{ shotTankName('shooter') }}</strong><ArrowRight :size="18" aria-hidden="true" /><strong>{{ activeShot?.target_eid == null ? $t('agentShots.no_target') : shotTankName('target') }}</strong></div>
            <div v-if="activeShot" class="armor-shot-meta"><span>{{ $t('armor.recorded_shot') }} · {{ formatPlaybackClock(activeShot.time_s) }}</span><span>{{ $t('agentShots.recorded_damage') }} <b>{{ activeShot.damage ?? '—' }}</b></span><span v-if="recordedResult" :class="`armor-shot-result is-${recordedResult.tone}`">{{ recordedResult.text }}</span><span v-if="activeShot.shell_kind">{{ shellLabel({ type: activeShot.shell_kind }) }}</span></div>
        </div>
        <nav class="armor-shot-navigation" :aria-label="$t('armor.shot_navigation')">
            <button type="button" :disabled="navigating || shotPosition <= 0" :aria-label="$t('armor.previous_shot')" :title="$t('armor.previous_shot')" @click="adjacentShot(-1)"><ChevronLeft :size="20" aria-hidden="true" /></button>
            <span>{{ $t('armor.hit_position', { current: shotPosition >= 0 ? shotPosition + 1 : '—', total: shotSnapshot.length }) }}</span>
            <button type="button" :disabled="navigating || shotPosition < 0 || shotPosition >= shotSnapshot.length - 1" :aria-label="$t('armor.next_shot')" :title="$t('armor.next_shot')" @click="adjacentShot(1)"><ChevronRight :size="20" aria-hidden="true" /></button>
        </nav>
        <p v-if="navigationError" class="armor-navigation-error" role="alert">{{ navigationError }}</p>
    </header>
    <section v-if="isShotPage && !cleanQuery && webgl.supported" class="armor-interaction-help" aria-labelledby="armor-help-title" data-testid="armor-interaction-help">
        <h2 id="armor-help-title"><MousePointer2 :size="18" aria-hidden="true" />{{ $t('armor.gestures.title') }}</h2>
        <dl><div v-for="gesture in shotGestures" :key="gesture.action"><dt>{{ gesture.input }}</dt><dd>{{ gesture.action }}</dd></div></dl>
    </section>
    <Scene3DStatus v-if="!webgl.supported" mode="unsupported" :webgl-status="webgl.status" />
    <!-- Keep every scene-owned ID mounted while Vue arranges the surrounding interface. -->
    <div v-else :key="attempt" class="armor-stage" :class="{ 'is-tools-open': toolsOpen }" data-testid="armor-stage">
        <!-- 旧的单行文字加载提示由 Scene3DStatus 取代；节点保留给场景脚本写入（不可见） -->
        <div class="armor-legacy-loading" hidden><div id="loading">{{ $t('armor.loading') }}</div></div>
        <div id="canvas-container"></div>
        <div id="corner-tl">
            <div id="info-panel" style="display:none;">
                <h1 id="tank-name">{{ $t('armor.loading') }}</h1>
                <div class="stat"><span class="label">{{ $t('armor.tier') }}</span><span class="value" id="tank-tier"></span></div>
                <div class="stat"><span class="label">{{ $t('armor.type') }}</span><span class="value" id="tank-type"></span></div>
                <div class="stat"><span class="label">{{ $t('armor.nation') }}</span><span class="value" id="tank-nation"></span></div>
            </div>
            <!-- 「参数」开关：展开 / 收起装备、射击方、目标、配置；桌面与手机均默认收起 -->
            <button
                v-if="!cleanQuery"
                type="button"
                class="armor-tools"
                data-testid="armor-tools"
                aria-controls="tank-selectors"
                :aria-expanded="toolsOpen ? 'true' : 'false'"
                :aria-label="$t('armor.tools')"
                :title="$t('armor.tools')"
                @click="toolsOpen = !toolsOpen"
            ><SlidersHorizontal :size="18" aria-hidden="true" /><span class="armor-tools-label">{{ $t('armor.tools') }}</span></button>
            <div id="tank-selectors" :class="{ 'has-shot-hud': hudReady }">
                <div class="armor-setup-head">
                    <h2 class="armor-panel-title">{{ $t('armor.setup') }}</h2>
                    <button
                        type="button"
                        class="armor-tools-close"
                        data-testid="armor-tools-close"
                        :aria-label="$t('armor.tools_close')"
                        :title="$t('armor.tools_close')"
                        @click="toolsOpen = false"
                    ><X :size="18" aria-hidden="true" /></button>
                </div>
                <p v-if="isShotPage" class="armor-setup-note">{{ $t('armor.recording_vs_preview') }}</p>
                <div class="sel-row" id="config-row" style="display:none;"><label id="config-label" for="config-select">{{ $t('armor.config') }}</label><select id="config-select"></select></div>
                <div class="sel-row">
                    <label class="armor-equipment-caption">{{ $t('armor.equip') }}</label>
                    <label class="eq-opt"><input type="checkbox" id="eq-calibrated"> <span class="eq-opt-label">{{ $t('armor.calibrated') }}</span></label>
                    <label class="eq-opt"><input type="checkbox" id="eq-enhanced"> <span class="eq-opt-label">{{ $t('armor.enhanced') }}</span></label>
                    <label v-show="pitchDeviceAvailable" class="eq-opt" id="pitch-device-opt"><input type="checkbox" id="eq-pitch-device"> <span class="eq-opt-label">{{ $t('armor.pitch_device') }}</span></label>
                    <label class="eq-opt" id="armor-state-opt" style="display:none;"><input type="checkbox" id="armor-state-toggle"> <span class="eq-opt-label">{{ $t('armor.dynamic_armor') }}</span></label>
                </div>
                <!-- 射击方 / 受击方：坦克切换 + 模块选择同一张卡，模块默认收起。 -->
                <div class="armor-side-cards" data-testid="armor-side-configs">
                    <section class="armor-side-card">
                        <header class="armor-side-head">
                            <span class="armor-side-role">{{ $t('armor.loadout_shooter') }}</span>
                            <button type="button" class="tank-btn armor-side-tank" id="shooter-select" disabled @click="openPicker('shooter')">—</button>
                            <button
                                type="button"
                                class="armor-side-toggle"
                                v-if="!isXiTank(shooterSetupId)"
                                :aria-expanded="shooterOpen ? 'true' : 'false'"
                                aria-controls="shooter-modules"
                                :aria-label="$t('armor.loadout_shooter')"
                                data-testid="armor-side-toggle-shooter"
                                @click="shooterOpen = !shooterOpen"
                            ><ChevronDown :size="18" aria-hidden="true" :class="{ 'is-open': shooterOpen }" /></button>
                        </header>
                        <div id="shooter-modules" class="armor-side-body">
                            <ArmorSideConfig
                                v-if="loadoutActive"
                                :key="`shooter-${shooterSetupId ?? 'none'}`"
                                :tank-id="shooterSetupId"
                                :expanded="shooterOpen"
                                :config="shooterConfigValue"
                                :engine="route.query.sengine"
                                :track="route.query.strack"
                                :dev="route.query.sdev"
                                :upgrade="armorUpgrade(route.query.supgrade)"
                                :abilities="route.query.sabilities"
                                @apply="patch => applySide('shooter', patch)"
                                @ready="value => shooterReady = value"
                            />
                        </div>
                    </section>
                    <section class="armor-side-card">
                        <header class="armor-side-head">
                            <span class="armor-side-role">{{ $t('armor.loadout_target') }}</span>
                            <button type="button" class="tank-btn armor-side-tank" id="target-select" disabled @click="openPicker('target')">—</button>
                            <button
                                type="button"
                                class="armor-side-toggle"
                                v-if="!isXiTank(targetSetupId)"
                                :aria-expanded="targetOpen ? 'true' : 'false'"
                                aria-controls="target-modules"
                                :aria-label="$t('armor.loadout_target')"
                                data-testid="armor-side-toggle-target"
                                @click="targetOpen = !targetOpen"
                            ><ChevronDown :size="18" aria-hidden="true" :class="{ 'is-open': targetOpen }" /></button>
                        </header>
                        <div id="target-modules" class="armor-side-body">
                            <ArmorSideConfig
                                v-if="loadoutActive"
                                :key="`target-${targetSetupId ?? 'none'}`"
                                :tank-id="targetSetupId"
                                :expanded="targetOpen"
                                :config="route.query.config"
                                :engine="route.query.engine"
                                :track="route.query.track"
                                :dev="route.query.dev"
                                :upgrade="armorUpgrade(route.query.upgrade)"
                                :abilities="route.query.abilities"
                                @apply="patch => applySide('target', patch)"
                                @ready="value => targetReady = value"
                            />
                        </div>
                    </section>
                    <p id="tank-selection-status" role="status">{{ $t('armor.picker_loading') }}</p>
                </div>
            </div>
        </div>
        <div id="tank-picker" role="dialog" aria-modal="true" aria-labelledby="tp-title" :class="{ open: pickerOpen }" @click.self="closePicker">
            <TankCatalogMenu
                v-if="pickerOpen"
                layout="dialog"
                autofocus
                :title="pickerTitle"
                :tanks="tankList"
                :state="tankListState"
                :filters="pickerFilters"
                :selected-id="pickerSelectedId"
                @update:filters="setPickerFilters"
                @select="onPickerSelect"
                @close="closePicker"
            />
        </div>
        <!-- 装甲厚度模式点选结果：停靠在场景顶部正中的胶囊（不跟随命中点），只显示部件名 + 基础装甲值 -->
        <div id="click-info">
            <h3 id="click-part">—</h3>
            <div class="row">
                <span>{{ $t('armor.base_armor') }}</span>
                <span id="click-armor">—</span>
            </div>
        </div>
        <div class="armor-bottom-controls">
        <div id="corner-tr">
            <ArmorShotHud
                :shooter-id="shooterSetupId"
                :distance-state="load.state === 'ready' ? distanceState : null"
                @distance="value => viewer?.setDistance?.(value)"
                :scfg="shooterConfigValue"
                :upgrade="armorUpgrade(route.query.supgrade)"
                :abilities="route.query.sabilities"
                :shell="route.query.shell"
                :eqcal="route.query.eqcal"
                :eqenh="route.query.eqenh"
                :eqpitch="route.query.eqpitch"
                :calibrated-default="!!activeShot?.shooter_equipment?.calibrated_shells"
                :enhanced-default="!!activeShot?.target_equipment?.enhanced_armor"
                :pitch-default="recordedPitchDevice"
                :pitch-available="pitchDeviceAvailable"
                @shell="index => applyShotSetup({ shell: index })"
                @calibrated="value => applyShotSetup({ eqcal: value })"
                @enhanced="value => applyShotSetup({ eqenh: value })"
                @pitch="value => applyShotSetup({ eqpitch: value })"
                @ready="value => hudReady = value"
            />
            <div id="shell-selector" style="display:none;">
                <label for="shell-select">{{ $t('armor.shell') }} </label>
                <select id="shell-select"></select>
            </div>
            <div id="view-toggle">
                <button id="collision-btn" type="button" aria-pressed="false" :disabled="!viewerReady">{{ $t('armor.show_collision') }}</button>
                <button id="penetration-btn" type="button" aria-pressed="false" :disabled="!viewerReady">{{ $t('armor.heatmap') }}</button>
                <!-- 装甲组成显隐只在装甲厚度视图可用（场景按 collisionMode 显示这一行） -->
                <div id="armor-filters" class="armor-filters" hidden>
                    <button id="filter-primary" type="button" class="active" aria-pressed="true">{{ $t('armor.filter_primary') }}</button>
                    <button id="filter-spaced" type="button" class="active" aria-pressed="true">{{ $t('armor.filter_spaced') }}</button>
                    <button id="filter-external" type="button" class="active" aria-pressed="true">{{ $t('armor.filter_external') }}</button>
                </div>
            </div>
        </div>
        <div id="corner-br">
            <div v-if="!isShotPage" id="controls-hint">{{ hint }}</div>
        </div>
        </div>
        <div
            id="traj-info"
            style="display:none;"
            role="button"
            tabindex="0"
            :class="{ 'is-expanded': resultExpanded }"
            :aria-expanded="resultExpanded ? 'true' : 'false'"
            :aria-label="$t('armor.result_details')"
            data-testid="armor-result-pill"
            @click="resultExpanded = !resultExpanded"
            @keydown.enter.prevent="resultExpanded = !resultExpanded"
            @keydown.space.prevent="resultExpanded = !resultExpanded"
        ></div>
        <div id="shot-replay-error" role="alert" aria-live="assertive" style="display:none;"></div>
        <div id="turret-controls">
            <div v-if="!isShotPage && !cleanQuery" class="armor-camera-presets" role="group" :aria-label="$t('armor.camera_presets')">
                <!-- preserveView：保留用户缩放距离；机位上炮轴线、看向炮线枢轴，炮管指向镜头（0x5f3759df / 2026-11-10 反馈） -->
                <button type="button" class="armor-scene-button" data-testid="armor-camera-front" :disabled="load.state !== 'ready'" @click="viewer?.setCameraPreset?.('front', { preserveView: true })">{{ $t('armor.camera_front') }}</button>
                <button type="button" class="armor-scene-button" data-testid="armor-camera-hull-down" :disabled="load.state !== 'ready'" @click="viewer?.setCameraPreset?.('hull_down', { preserveView: true })">{{ $t('armor.camera_hull_down') }}</button>
            </div>
            <div class="ctrl-row"><label>{{ $t('armor.turret') }}</label><span id="turret-val">0°</span></div>
            <div class="ctrl-row"><label>{{ $t('armor.gun') }}</label><span id="gun-val">0°</span></div>
        </div>
        <Scene3DStatus
            v-if="load.state === 'loading'"
            mode="loading"
            :progress="load.progress"
            :message="$t('armor.loading')"
        />
        <Scene3DStatus
            v-else-if="load.state === 'error'"
            mode="error"
            :message="load.message"
            @retry="retry"
        />
    </div>
    <RotatePrompt
        v-if="forcedLandscape.blocked.value"
        class="armor-rotate-prompt"
        :device="forcedLandscape.device.value"
        :action-label="isShotPage ? $t('armor.back_to_shots') : $t('armor.back')"
        @action="isShotPage ? backToShots() : backOrTankopedia()"
    />
</div>
</template>

<!-- Scene IDs are a DOM contract; all chrome colors follow the site's presentation profile. -->
<style>
.armor-view {
    --bg: var(--color-canvas); --panel: color-mix(in srgb, var(--color-surface-1) 96%, transparent);
    --panel2: var(--color-surface-2); --border: var(--color-border-subtle); --border-hi: var(--color-border-strong);
    --accent: var(--color-accent-text); --accent-2: var(--color-accent-text); --accent-3: var(--color-text-primary);
    --green: var(--color-success); --orange: var(--color-warning); --red: var(--color-danger);
    --blue: var(--color-info); --yellow: var(--color-warning); --txt: var(--color-text-primary); --muted: var(--color-text-secondary);
    --shadow: var(--elevation-2); --radius: var(--radius-lg); --radius-sm: var(--radius-md);
    --input-bg: var(--color-surface-2); --input-bg-hover: var(--color-surface-3);
    --tooltip-bg: var(--color-surface-1); --scrub: var(--color-info);
    position: relative; display: flex; flex-direction: column; isolation: isolate;
    inline-size: 100%; block-size: calc(100dvh - var(--header-h) - env(safe-area-inset-bottom)); min-block-size: 420px;
    margin: 0; padding: 0; overflow: hidden; background: var(--color-canvas); color: var(--txt); font: var(--type-body);
}
.armor-view .armor-stage { position: relative; flex: 1; min-block-size: 0; inline-size: 100%; }
.armor-view.is-unsupported { block-size: auto; min-block-size: 0; overflow: visible; background: transparent; }
.armor-view.is-unsupported .armor-back { position: static; margin: var(--space-4) var(--gutter) 0; }
.armor-view #canvas-container { inline-size: 100%; block-size: 100%; }
.armor-view :is(button, select, input) { font: inherit; }
.armor-view :is(button, select) { min-block-size: var(--scene-hit); }
.armor-view :is(button, summary, select, input):focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.armor-view button { cursor: pointer; }
.armor-view button:disabled { cursor: default; opacity: .45; }
.armor-view :is(#corner-tl, #corner-tr, #corner-br) { position: absolute; display: flex; gap: var(--space-3); }
.armor-view #corner-tl { inset-block-start: var(--space-5); inset-inline-start: var(--space-5); align-items: flex-start; }
.armor-view.has-back #corner-tl { inset-block-start: calc(var(--space-5) + var(--scene-hit) + var(--space-2)); }
.armor-view :is(#info-panel, #tank-selectors, #turret-controls, #debug-info, #click-info) {
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--elevation-2);
}
.armor-view #info-panel { padding: var(--space-4); max-inline-size: 20rem; max-block-size: 46dvh; overflow: auto; overflow-wrap: anywhere; }
.armor-view #info-panel h1 { margin: 0 0 var(--space-2); font: var(--type-h3); color: var(--txt); }
.armor-view #info-panel .stat { display: flex; justify-content: space-between; gap: var(--space-3); font: var(--type-caption); }
.armor-view #info-panel .label { color: var(--muted); }
.armor-view #info-panel .value { font-weight: 600; }
.armor-view .armor-setup-note { margin: 0 0 var(--space-3); color: var(--muted); font: var(--type-caption); }
.armor-view .armor-panel-title { margin: 0 0 var(--space-2); color: var(--muted); font: var(--type-caption); }
.armor-view .armor-tools-close { display: none; }
.armor-view .armor-side-cards { display: grid; gap: var(--space-3); min-inline-size: 0; }
.armor-view .armor-side-card { display: grid; gap: var(--space-2); min-inline-size: 0; }
.armor-view .armor-side-card + .armor-side-card { border-block-start: 1px solid var(--color-border-subtle); padding-block-start: var(--space-3); }
.armor-view .armor-side-head { display: flex; align-items: center; gap: var(--space-2); min-inline-size: 0; padding-block: var(--space-1); }
.armor-view .armor-side-role { color: var(--color-accent-text); font: var(--type-caption); font-weight: 700; white-space: nowrap; }
.armor-view .armor-side-tank { flex: 1 1 auto; inline-size: auto; min-inline-size: 0; }
.armor-view .armor-side-toggle { display: grid; place-items: center; flex: none; inline-size: var(--hit-min); block-size: var(--hit-min); padding: 0; border: 0; background: transparent; color: var(--color-text-secondary); cursor: pointer; }
.armor-view .armor-side-toggle svg { transition: transform var(--duration-fast) var(--ease-standard); }
.armor-view .armor-side-toggle svg.is-open { transform: rotate(180deg); }
.armor-view .armor-side-body { padding-block-start: var(--space-1); }
.armor-view .armor-camera-presets { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-block-end: var(--space-2); }
.armor-view .armor-camera-presets button { flex: 1; min-inline-size: var(--hit-min); white-space: nowrap; }
.armor-view #turret-controls .ctrl-row { display: inline-flex; gap: var(--space-2); margin-inline-end: var(--space-3); }
.armor-view #turret-controls .ctrl-row span { font-weight: 700; font-variant-numeric: tabular-nums; }
.armor-view #view-toggle > button { flex: 1; }
/* 射击复现的图形面板就绪后，场景自带的校准弹/强化装甲勾选只作为资产缺失时的回退 */
.armor-view #tank-selectors.has-shot-hud .eq-opt:not(#armor-state-opt) { display: none; }
.armor-view #tank-selectors.has-shot-hud .armor-equipment-caption { display: none; }
.armor-view #tank-selectors { padding: var(--space-3); inline-size: 23rem; max-block-size: 54dvh; overflow-y: auto; z-index: var(--pb-z-hud); }
.armor-view #tank-selectors .sel-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-1) 0; }
.armor-view #tank-selectors label { color: var(--muted); font: var(--type-caption); }
.armor-view #tank-selectors .sel-row > label:first-child { flex: 0 0 100%; }
.armor-view #tank-selectors .eq-opt { display: inline-flex; flex: 1; align-items: center; gap: var(--space-1); min-block-size: var(--scene-hit); cursor: pointer; }
.armor-view input[type="checkbox"] { flex: none; min-inline-size: 0; inline-size: var(--control-check); block-size: var(--control-check); margin: 0; accent-color: var(--color-accent); }
.armor-view #tank-selectors :is(.tank-btn, select) { inline-size: 100%; min-inline-size: 0; padding: var(--space-2) var(--space-3); background: var(--input-bg); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--txt); }
.armor-view #tank-selectors .tank-btn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: start; }
.armor-view #tank-selectors .tank-btn:hover { border-color: var(--accent); background: var(--input-bg-hover); }
.armor-view #tank-selectors .tank-btn:disabled { color: var(--color-text-tertiary); cursor: wait; }
.armor-view #tank-selection-status { margin: var(--space-2) 0 0; color: var(--color-text-secondary); font: var(--type-caption); }
.armor-view #shooter-label { color: var(--color-accent-text); }
.armor-view #target-label { color: var(--color-info); }
/* 右上角是一块整体面板：射击 HUD、模式切换、装甲组成、点选结果共用同一张卡片。
   固定宽度：进入厚度视图（过滤行/点选结果出现）时面板不会突然变宽。 */
.armor-view #corner-tr {
    inset-block-start: var(--space-5);
    inset-inline-end: var(--space-5);
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    inline-size: var(--armor-shot-card-width);
    max-inline-size: 42%;
    padding: var(--space-2);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--elevation-2);
}
.armor-view #shell-selector { padding: var(--space-2) var(--space-3); max-inline-size: 100%; }
.armor-view #shell-selector label { color: var(--muted); font: var(--type-caption); }
.armor-view #shell-selector select { max-inline-size: 100%; min-inline-size: 0; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--input-bg); color: var(--txt); }
.armor-view #view-toggle { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
/* 模式按钮文案固定（状态用 active/aria-pressed 表示）：避免开关时标签变长变短把面板宽度挤动 */
.armor-view #view-toggle > button { white-space: nowrap; }
/* 装甲组成显隐是同一面板内的第二行（只在厚度视图出现），不再是浮在产品外的独立卡片 */
.armor-view .armor-filters {
    flex: 1 1 100%;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-block-start: var(--space-2);
    border-block-start: 1px solid var(--color-border-subtle);
}
.armor-view .armor-filters[hidden] { display: none; }
.armor-view :is(#view-toggle button, .armor-scene-button) { padding: var(--space-2) var(--space-3); background: var(--input-bg); color: var(--txt); border: 1px solid var(--border); border-radius: var(--radius-md); font: var(--type-caption); }
.armor-view #view-toggle button:hover { border-color: var(--accent); }
.armor-view :is(#view-toggle button.active, .armor-scene-button[aria-pressed="true"]) { background: var(--color-accent); color: var(--color-on-accent); border-color: transparent; }
.armor-view #corner-br { inset-block-end: var(--space-5); inset-inline-end: var(--space-5); align-items: flex-end; flex-direction: column; max-inline-size: 38%; }
.armor-view #controls-hint { font: var(--type-caption); color: var(--color-playback-label-text); text-shadow: var(--text-shadow-playback-label); }
.armor-view #turret-controls { position: absolute; inset-block-end: var(--space-5); inset-inline-start: var(--space-5); display: none; padding: var(--space-3) var(--space-4); min-inline-size: 16rem; max-inline-size: min(32rem, 44%); max-block-size: 40dvh; overflow-y: auto; overflow-wrap: anywhere; }
/* Desktop/tablet and landscape touch phones mirror the mobile portrait top bar: tank info
   and the setup panel are one top-left card, and the setup panel starts collapsed behind
   the 参数 toggle. */
@media (width >= 768px), (pointer: coarse) and (orientation: landscape) {
    .armor-view #corner-tl {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: var(--space-1) var(--space-2);
        inline-size: min(20rem, calc(100% - var(--space-10)));
        max-block-size: calc(100% - var(--space-10));
        padding: var(--space-3);
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        box-shadow: var(--elevation-2);
        overflow-y: auto;
        z-index: var(--pb-z-hud);
    }
    .armor-view.is-clean #corner-tl { display: none; }
    .armor-view.has-back #corner-tl { max-block-size: calc(100% - var(--space-10) - var(--scene-hit) - var(--space-2)); }
    .armor-view #info-panel {
        grid-column: 1;
        grid-row: 1;
        min-inline-size: 0;
        max-inline-size: none;
        max-block-size: none;
        overflow: visible;
        padding: 0;
        background: none;
        border: 0;
        border-radius: 0;
        box-shadow: none;
    }
    .armor-view #info-panel .stat { display: inline-flex; align-items: center; gap: var(--space-1); margin-inline-end: var(--space-2); }
    .armor-view #corner-tl > .armor-tools {
        grid-column: 2;
        grid-row: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--input-bg);
        color: var(--txt);
    }
    .armor-view .armor-tools[aria-expanded="true"] { border-color: var(--accent); color: var(--accent); }
    .armor-view #tank-selectors {
        grid-column: 1 / -1;
        grid-row: 2;
        display: none;
        inline-size: auto;
        max-block-size: 54dvh;
        margin-block-start: var(--space-1);
        padding: var(--space-3) 0 0;
        border: 0;
        border-block-start: 1px solid var(--border);
        border-radius: 0;
        background: none;
        box-shadow: none;
    }
    .armor-view #tank-selectors .armor-panel-title { margin-block-end: var(--space-3); }
    .armor-view .armor-stage.is-tools-open #tank-selectors { display: block; }
}
/* 横屏手机/平板：使用平板/桌面式布局（左上信息卡 + 四角浮层），并解除竖屏的 420px
   最小高度；信息行压成单行，避免短视口下设置面板被挤出卡片。竖屏手机仍走下面 mobile 规则。
   必须排在上面大卡片的 `overflow: visible` 之后：同特异度下后者会覆盖裁剪，
   长车名就会画到「参数」按钮下面。 */
@media (pointer: coarse) and (orientation: landscape) {
    .armor-view { min-block-size: 0; }
    .armor-view #info-panel { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
    .armor-view #info-panel h1 { display: inline-block; max-inline-size: 52%; vertical-align: bottom; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--type-body); margin: 0 var(--space-2) 0 0; }
    .armor-view #info-panel .stat { display: inline-flex; gap: var(--space-1); vertical-align: bottom; }
    .armor-view #info-panel .stat + .stat::before { content: '·'; color: var(--muted); }
    .armor-view #info-panel .label { display: none; }
}
.armor-view .ctrl-row { display: flex; align-items: flex-start; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-1) 0; font: var(--type-caption); }
.armor-view .ctrl-row > * { min-inline-size: 0; }
.armor-view .ctrl-row label { color: var(--muted); }
.armor-view .ctrl-row span { color: var(--accent); }
.armor-view .armor-evidence summary { display: list-item; min-block-size: var(--scene-hit); padding: var(--space-3) 0; cursor: pointer; color: var(--color-text-primary); font: var(--type-body); }
.armor-view #debug-info { display: none; padding: var(--space-3); max-inline-size: 24rem; max-block-size: 32dvh; overflow: auto; font: var(--type-caption); }
.armor-view #debug-info h4 { margin: 0 0 var(--space-2); font: var(--type-caption); }
.armor-view .dbg-row { display: flex; align-items: flex-start; gap: var(--space-1); margin: var(--space-1) 0; overflow-wrap: anywhere; }
.armor-view .dbg-dot { flex: none; inline-size: var(--space-2); block-size: var(--space-2); border-radius: var(--radius-full); corner-shape: round; margin-block-start: var(--space-1); }
.armor-view .dbg-name { flex: none; color: var(--muted); }
.armor-view .dbg-val { min-inline-size: 0; }
/* 点选结果（厚度 #click-info、击穿 #traj-info）：固定停靠在场景顶部正中的胶囊，不跟随命中点、
   不压车体（design-language §9「强制横屏」场景 HUD）。场景脚本只切换显示与写入内容。 */
.armor-view :is(#click-info, #traj-info) {
    position: absolute;
    inset-block-start: var(--space-5);
    inset-inline-start: 50%;
    transform: translateX(-50%);
    z-index: var(--pb-z-hud);
}
.armor-view #click-info {
    display: none;
    align-items: center;
    gap: var(--space-3);
    min-block-size: var(--hit-min-comfortable);
    padding: 0 var(--space-3);
    color: var(--muted);
    font: var(--type-caption);
    white-space: nowrap;
    pointer-events: none;
}
.armor-view #click-info h3 { margin: 0; color: var(--txt); font: var(--type-caption); font-weight: 600; }
.armor-view #click-info .row { display: flex; gap: var(--space-2); }
.armor-view #click-info #click-armor { color: var(--txt); font-variant-numeric: tabular-nums; font-weight: 700; }
.armor-view #traj-info { max-block-size: calc(100% - var(--space-10)); overflow-y: auto; cursor: pointer; }
.armor-view #traj-info:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
/* 竖屏手机：顶部是信息条与姿态行，胶囊排在它们下面 */
@media (width < 768px) and (orientation: portrait), (width < 768px) and (pointer: fine) {
    .armor-view :is(#click-info, #traj-info) { inset-block-start: calc(var(--space-2) * 3 + var(--space-12) + var(--hit-min-comfortable)); max-inline-size: calc(100% - var(--space-4)); }
}
/* 小屏（竖屏手机 / 手机横屏）：收起态只留最终判定一行作为胶囊，点开看逐层明细 */
@media (width < 768px), (pointer: coarse) and (orientation: landscape) and (height <= 500px) {
    .armor-view #traj-info:not(.is-expanded) > div > :not([data-card-title="final"]) { display: none; }
    .armor-view #traj-info:not(.is-expanded) > div > [data-card-title="final"] { margin: 0; }
}
.armor-view #shot-replay-error { position: fixed; z-index: var(--pb-z-modal); inset-block-start: calc(var(--space-5) + var(--scene-control-h-lg)); inset-inline: var(--space-4); margin-inline: auto; max-inline-size: 30rem; padding: var(--space-2) var(--space-3); background: var(--tooltip-bg); border-left: 4px solid var(--red); border-radius: var(--radius-md); color: var(--red); font: var(--type-caption); box-shadow: var(--elevation-2); pointer-events: none; }
.armor-view .armor-back { position: absolute; z-index: calc(var(--z-sticky) + 1); inset-block-start: var(--space-5); inset-inline-start: var(--space-5); display: inline-flex; align-items: center; gap: var(--space-2); min-block-size: var(--scene-hit); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--panel); color: var(--txt); }
.armor-view .armor-tools { display: none; }
.armor-view .armor-bottom-controls { display: contents; }
/* Recorded-shot actions are a persistent, high-contrast toolbar. */
.armor-view.is-shot #corner-br { display: flex; flex-direction: row; flex-wrap: wrap; align-items: stretch; gap: var(--space-2); max-inline-size: calc(100% - var(--space-10)); padding: var(--space-2); background: var(--color-surface-1); border: 1px solid var(--color-border-strong); border-radius: var(--radius-lg); box-shadow: var(--elevation-2); z-index: var(--pb-z-hud); }
.armor-view.is-shot #corner-br:empty { display: none; }
.armor-view .armor-shot-view-switch { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-1); background: var(--color-surface-2); border-radius: var(--radius-md); }
.armor-view .armor-shot-view-switch .armor-scene-button { flex: 1; min-block-size: var(--scene-control-h-lg); padding: var(--space-2) var(--space-4); font: var(--type-body); font-weight: 600; }

.armor-view #tank-picker { position: absolute; inset: var(--space-5); margin: auto; max-inline-size: var(--layout-wide-max); background: var(--panel); border: 1px solid var(--border-hi); border-radius: var(--radius-lg); z-index: var(--z-dialog); display: none; flex-direction: column; box-shadow: var(--elevation-3); }
.armor-view #tank-picker.open { display: flex; }
/* 菜单本体 = 共享 TankCatalogMenu（与坦克百科同一套搜索/筛选/卡片/增量列表） */
.armor-view #tank-picker > .tank-catalog-menu { flex: 1; min-block-size: 0; }
/* 共享菜单的控件在装甲页内沿用场景命中尺寸（含搜索框；百科页保持全站控件高度） */
.armor-view #tank-picker :is(button, select, input) { min-block-size: var(--scene-hit); }
.armor-view .armor-shot-header { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-3) var(--space-5); border-block-end: 1px solid var(--border); background: var(--color-surface-1); z-index: calc(var(--z-sticky) + 1); }
.armor-view .armor-shot-header button { display: inline-flex; flex: none; align-items: center; justify-content: center; gap: var(--space-2); min-inline-size: var(--scene-hit); padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--input-bg); color: var(--txt); }
.armor-view .armor-navigation-error { margin: 0; color: var(--color-danger); font: var(--type-caption); }
.armor-view .armor-shot-context { flex: 1; min-inline-size: 0; }
.armor-view .armor-shot-matchup { display: flex; align-items: center; gap: var(--space-2); font: var(--type-h3); }
.armor-view .armor-shot-matchup strong { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.armor-view .armor-shot-matchup svg { flex: none; color: var(--muted); }
.armor-view .armor-shot-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-4); color: var(--muted); font: var(--type-caption); }
.armor-view .armor-shot-meta b { color: var(--txt); font-variant-numeric: tabular-nums; }
.armor-view .armor-shot-result.is-success { color: var(--color-success); }
.armor-view .armor-shot-result.is-danger { color: var(--color-danger); }
.armor-view .armor-shot-result.is-warning { color: var(--color-warning); }
.armor-view .armor-shot-result.is-info { color: var(--color-info); }
.armor-view .armor-shot-navigation { display: flex; align-items: center; gap: var(--space-2); font: var(--type-caption); font-variant-numeric: tabular-nums; }
.armor-view .armor-interaction-help { display: flex; flex: none; align-items: center; gap: var(--space-6); padding: var(--space-3) var(--space-5); background: var(--color-surface-2); border-block-start: 1px solid var(--color-border-strong); border-inline-start: var(--space-1) solid var(--color-accent); }
.armor-view .armor-interaction-help h2 { display: inline-flex; align-items: center; gap: var(--space-2); flex: none; margin: 0; color: var(--color-accent-text); font: var(--type-h3); }
.armor-view .armor-interaction-help dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-6); margin: 0; min-inline-size: 0; }
.armor-view .armor-interaction-help dt { color: var(--color-text-primary); font: var(--type-body); font-weight: 600; }
.armor-view .armor-interaction-help dd { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
/* 手机横屏（与 shared/breakpoints PLAYBACK_PHONE_QUERY 的手机横屏分支同口径）：射击复现页的
   操作提示节是静态指引，在 ~375px 高的视口里挤占 3D 场景带，整节让位；桌面 / 平板 / 竖屏保留。 */
@media (pointer: coarse) and (orientation: landscape) and (height <= 500px) {
    .armor-view .armor-interaction-help { display: none; }
}
@media (768px <= width < 1200px), (pointer: coarse) and (orientation: landscape) {
    .armor-view #tank-selectors { max-block-size: 38dvh; }
}
/* 竖屏手机 + 窄桌面窗口保持既有 mobile 布局；横屏粗指针手机由上面的 tablet 规则接管。 */
@media (width < 768px) and (orientation: portrait), (width < 768px) and (pointer: fine) {
    .armor-view .armor-interaction-help { flex-direction: column; align-items: stretch; gap: var(--space-2); padding: var(--space-2) var(--space-3); }
    .armor-view .armor-interaction-help h2 { font: var(--type-caption); font-weight: 600; }
    .armor-view .armor-interaction-help dl { gap: var(--space-2); }

    .armor-view #corner-tl { inset-block-start: var(--space-2); inset-inline: var(--space-2); display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--space-1) var(--space-2); padding: var(--space-1) var(--space-2); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--elevation-2); z-index: var(--pb-z-modal); }
    .armor-view.has-back #corner-tl { inset-block-start: var(--space-2); inset-inline-start: calc(var(--space-2) * 2 + var(--scene-hit)); }
    .armor-view #info-panel { grid-column: 1; grid-row: 1; min-inline-size: 0; max-inline-size: none; max-block-size: none; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0; background: none; border: none; box-shadow: none; }
    .armor-view #info-panel h1 { display: inline-block; max-inline-size: 52%; vertical-align: bottom; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--type-body); margin: 0 var(--space-2) 0 0; }
    .armor-view #info-panel .stat { display: inline-flex; gap: var(--space-1); vertical-align: bottom; }
    .armor-view #info-panel .stat + .stat::before { content: '·'; color: var(--muted); }
    .armor-view #info-panel .label { display: none; }
    .armor-view #tank-selectors { grid-column: 1 / -1; grid-row: 2; display: none; inline-size: auto; margin-block-start: var(--space-1); padding: var(--space-2) 0; border: none; border-block-start: 1px solid var(--border); border-radius: 0; background: none; box-shadow: none; max-block-size: calc((100dvh - var(--header-h)) * .46); }
    .armor-view #tank-selectors .armor-panel-title { display: none; }
    .armor-view #tank-selectors .sel-row { flex-wrap: nowrap; }
    .armor-view #tank-selectors .sel-row > label:first-child { flex: 0 0 var(--space-12); }
    .armor-view .armor-stage.is-tools-open #tank-selectors { display: block; }
    .armor-view .armor-tools { grid-column: 2; grid-row: 1; display: inline-flex; align-items: center; justify-content: center; inline-size: var(--scene-hit); block-size: var(--scene-hit); padding: 0; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--input-bg); color: var(--txt); }
    .armor-view .armor-tools-label { display: none; }
    .armor-view .armor-tools[aria-expanded="true"] { border-color: var(--accent); color: var(--accent); }
    .armor-view #corner-tr { inset-block-start: auto; inset-block-end: var(--space-2); inset-inline: var(--space-2); inline-size: auto; max-inline-size: none; flex-direction: row; flex-wrap: wrap; align-items: stretch; gap: var(--space-2); }
    .armor-view #shell-selector { flex: none; padding: var(--space-1) var(--space-2); }
    .armor-view #view-toggle { flex: 1 1 11rem; min-inline-size: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1); padding: 0; }
    .armor-view #view-toggle button { padding: var(--space-1); white-space: normal; }
    .armor-view #armor-filters { grid-column: 1 / -1; padding-block-start: var(--space-1); gap: var(--space-1); }
    .armor-view #turret-controls { inset-block-start: calc(var(--space-2) * 2 + var(--scene-control-h-lg)); inset-block-end: auto; inset-inline-start: var(--space-2); min-inline-size: 0; max-inline-size: calc(100% - var(--space-4)); padding: 0 var(--space-1); max-block-size: 28dvh; white-space: nowrap; }
    .armor-view #turret-controls .ctrl-row { display: inline-flex; flex-wrap: nowrap; vertical-align: middle; gap: var(--space-1); margin: 0 var(--space-1); }
    .armor-view #turret-controls .armor-camera-presets { display: inline-flex; flex-wrap: nowrap; vertical-align: middle; gap: var(--space-1); margin: 0 var(--space-1) 0 0; }
    /* 按文字实际宽度排布：平分宽度时「压坡卖头」等较长文案会溢出按钮、压到旁边的炮塔读数 */
    .armor-view #turret-controls .armor-camera-presets button { flex: none; padding: var(--space-1) var(--space-2); }
    .armor-view #corner-br { display: none; }
    .armor-view.is-shot .armor-bottom-controls { position: absolute; inset-block-end: var(--space-2); inset-inline: var(--space-2); display: flex; flex-direction: column; gap: var(--space-2); pointer-events: none; z-index: var(--pb-z-hud); }
    .armor-view.is-shot .armor-bottom-controls :is(#corner-tr, #corner-br) { position: static; max-inline-size: none; pointer-events: auto; }
    .armor-view.is-shot .armor-shot-view-switch { flex: 1 1 100%; }
    .armor-view.is-shot #corner-tr { display: none; }
    .armor-view.is-shot .armor-stage.is-tools-open #corner-tr { display: flex; z-index: var(--pb-z-hud); }
    .armor-view.is-shot #debug-info { max-block-size: 20dvh; }
    .armor-view.is-clean #corner-tl { display: none; }
    .armor-view .armor-back { inset-block-start: var(--space-2); inset-inline-start: var(--space-2); inline-size: var(--scene-hit); block-size: var(--scene-hit); padding: 0; justify-content: center; }
    .armor-view .armor-back-label { display: none; }
    .armor-view #tank-picker { inset: 0; max-inline-size: none; border-radius: 0; }
    .armor-view .armor-shot-header { flex-wrap: wrap; gap: var(--space-2); padding: var(--space-2); }
    .armor-view .armor-shot-back span { display: none; }
    .armor-view .armor-shot-context { flex-basis: calc(100% - 60px); }
    .armor-view .armor-shot-matchup { font: var(--type-body); }
    .armor-view .armor-shot-meta { gap: var(--space-2); }
    .armor-view .armor-shot-navigation { inline-size: 100%; justify-content: space-between; }
}
@media (width < 768px) and (pointer: coarse) and (orientation: landscape) {
    .armor-view #corner-tr { inline-size: var(--armor-shot-card-compact-width); }
}
/* 手机横屏场景 HUD（design-language §9「强制横屏」）：常驻控件只在四角——左上返回 + 车名 / 参数，
   右下拇指区是射击快捷项（弹种、距离、厚度 / 击穿），左下是姿态与角度；完整设置在右侧参数面板
   （约 300px + 安全区），打开时场景仍在左侧可见。顶部正中留给点选结果胶囊。 */
@media (pointer: coarse) and (orientation: landscape) and (height <= 500px) {
    /* 沉浸态外壳在左上放菜单按钮（--immersive-nav-reserve）：返回键与信息卡整体右移让出 */
    .armor-view :is(#corner-tl, .armor-back) { inset-inline-start: calc(max(var(--space-5), env(safe-area-inset-left)) + var(--immersive-nav-reserve)); }
    .armor-view .armor-back { inline-size: var(--hit-min-comfortable); padding: 0; justify-content: center; }
    .armor-view .armor-back-label { display: none; }
    .armor-view.has-back #corner-tl { inset-block-start: var(--space-5); inset-inline-start: calc(max(var(--space-5), env(safe-area-inset-left)) + var(--immersive-nav-reserve) + var(--hit-min-comfortable) + var(--space-2)); inline-size: min(17rem, 34%); }
    .armor-view #corner-tr { inset-block-start: auto; inset-block-end: max(var(--space-2), env(safe-area-inset-bottom)); inset-inline-end: max(var(--space-5), env(safe-area-inset-right)); max-block-size: calc(100% - var(--space-12) - var(--space-10)); overflow-y: auto; }
    .armor-view #corner-br { display: none; }
    /* 单发分析页：射击参数面板（#corner-tr）与视角切换（#corner-br）共享右下布局空间——
       与竖屏 is-shot 契约同构（armor-bottom-controls 升为布局 owner，两角置 static 排进
       同一列，视角切换按 DOM 序落在参数面板下方）；is-shot #corner-br 的 display:flex
       特异性高于上面的 #corner-br 隐藏规则，必须显式接管而不是再调 z-index。 */
    .armor-view.is-shot .armor-bottom-controls {
        position: absolute;
        inset-block-end: max(var(--space-2), env(safe-area-inset-bottom));
        inset-inline-end: max(var(--space-5), env(safe-area-inset-right));
        max-inline-size: calc(100% - max(var(--space-5), env(safe-area-inset-left)) - max(var(--space-5), env(safe-area-inset-right)) - var(--immersive-nav-reserve));
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--space-2);
        pointer-events: none;
        z-index: var(--pb-z-hud);
    }
    .armor-view.is-shot .armor-bottom-controls :is(#corner-tr, #corner-br) {
        position: static;
        inset: auto;
        max-inline-size: none;
        pointer-events: auto;
    }
    /* 短横屏紧凑 HUD：返回键 + 车名 + 参数并成一条 38px 胶囊；点选结果接管胶囊右侧；
       右下射击面板 15rem × ≤45dvh；左下姿态面板压到两行。 */
    .armor-view .armor-back {
        block-size: 38px;
        min-block-size: 38px;
        inline-size: 40px;
        padding: 0;
        border-start-end-radius: 0;
        border-end-end-radius: 0;
        border-inline-end: 0;
        box-shadow: none;
    }
    .armor-view #corner-tl {
        display: flex;
        align-items: center;
        gap: 6px;
        inline-size: 14rem;
        block-size: 38px;
        min-block-size: 38px;
        max-block-size: none;
        padding: 0 6px 0 10px;
        overflow: visible;
    }
    .armor-view.has-back #corner-tl {
        inset-inline-start: calc(max(var(--space-5), env(safe-area-inset-left)) + var(--immersive-nav-reserve) + 40px);
        inline-size: 14rem;
        border-start-start-radius: 0;
        border-end-start-radius: 0;
        border-inline-start: 0;
    }
    .armor-view #info-panel {
        /* tankViewer 用内联 display:block 打开信息卡；这里保持块级，内部再用行内排版，
           避免用 !important 与运行时内联样式打架。 */
        display: block;
        min-inline-size: 0;
        max-inline-size: none;
        max-block-size: none;
        padding: 0;
        overflow: hidden;
        white-space: nowrap;
    }
    .armor-view #info-panel h1 {
        display: inline-block;
        max-inline-size: 46%;
        margin: 0 4px 0 0;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: bottom;
        font: var(--type-caption);
        font-weight: 600;
    }
    .armor-view #info-panel .stat {
        display: inline-flex;
        gap: 3px;
        margin: 0;
        vertical-align: bottom;
        font: var(--type-caption);
        font-size: var(--font-size-caption-xs);
        line-height: var(--line-height-caption-xs);
    }
    .armor-view #info-panel .stat + .stat::before {
        content: '·';
        margin-inline: 3px;
        color: var(--muted);
    }
    .armor-view #info-panel .label { display: none; }
    .armor-view #info-panel .stat:last-child { display: none; }
    .armor-view #corner-tl > .armor-tools {
        flex: none;
        inline-size: 36px;
        block-size: 36px;
        min-block-size: 36px;
        padding: 0;
        border: 0;
        border-radius: var(--radius-full);
        corner-shape: round;
        background: transparent;
    }
    .armor-view #corner-tl .armor-tools-label { display: none; }
    /* 结果胶囊贴左上胶囊右侧，不再固定 50%：740px 视口下也不会压到右下射击面板。 */
    .armor-view :is(#click-info, #traj-info) {
        inset-block-start: calc(var(--space-5) + 5px);
        inset-inline-start: calc(max(var(--space-5), env(safe-area-inset-left)) + var(--immersive-nav-reserve) + 14rem + 8px);
        transform: none;
    }
    .armor-view.has-back :is(#click-info, #traj-info) {
        inset-inline-start: calc(max(var(--space-5), env(safe-area-inset-left)) + var(--immersive-nav-reserve) + 40px + 14rem + 8px);
    }
    .armor-view #click-info {
        min-block-size: 28px;
        max-inline-size: max(6rem, calc(100% - 32.5rem - var(--immersive-nav-reserve) - max(var(--space-5), env(safe-area-inset-left)) - max(var(--space-5), env(safe-area-inset-right))));
        padding: 0 8px;
        gap: 6px;
        overflow: hidden;
        font: var(--type-caption);
    }
    /* 厚度值 #click-armor 永不参与收缩；部件名与「基础装甲」标签可省略。 */
    .armor-view #click-info h3 { flex: 1 1 0; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; }
    /* 结果卡最窄时也先保证厚度数值：部件名以 0 为 flex 基准完全让位，
       行拿到剩余宽度后只压缩标签；#click-armor 不收缩。 */
    .armor-view #click-info .row { flex: 0 1 auto; min-inline-size: 0; }
    .armor-view #click-info .row > span:first-child { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; }
    .armor-view #click-info #click-armor { flex: none; }
    .armor-view #traj-info { max-block-size: 72px; }
    /* 展开态明细卡必须留在左上 / 左中带：780×360 实测展开卡（top 79 + 72px）会伸进
       右下共享列的参数面板。高度收到 48px（overflow-y 继承基础滚动），宽度与收起态
       同公式，任何 Judge 视口都不与右下列相交。 */
    .armor-view #traj-info.is-expanded {
        max-block-size: 48px;
        max-inline-size: max(6rem, calc(100% - 32.5rem - var(--immersive-nav-reserve) - max(var(--space-5), env(safe-area-inset-left)) - max(var(--space-5), env(safe-area-inset-right))));
    }
    .armor-view #traj-info:not(.is-expanded) { max-inline-size: max(6rem, calc(100% - 32.5rem - var(--immersive-nav-reserve) - max(var(--space-5), env(safe-area-inset-left)) - max(var(--space-5), env(safe-area-inset-right)))); }
    .armor-view #corner-tr {
        inline-size: 15rem;
        max-block-size: 45dvh;
        padding: 4px;
        gap: 4px;
    }
    .armor-view #view-toggle {
        display: grid;
        flex: 0 0 auto;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0;
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
    }
    .armor-view #view-toggle > button,
    .armor-view #view-toggle > button:last-of-type {
        min-block-size: 36px;
        block-size: 36px;
        padding: 0 4px;
        border: 0;
        border-radius: 0;
        white-space: nowrap;
    }
    .armor-view #view-toggle > button + button { border-inline-start: 1px solid var(--border); }
    .armor-view #view-toggle .armor-filters {
        grid-column: 1 / -1;
        gap: 2px;
        padding: 4px 0 0;
    }
    .armor-view #turret-controls {
        inset-block-end: max(var(--space-2), env(safe-area-inset-bottom));
        inset-inline-start: max(var(--space-5), env(safe-area-inset-left));
        min-inline-size: 0;
        max-inline-size: min(15rem, calc(100% - var(--space-10)));
        max-block-size: 72px;
        padding: 4px 8px;
        border-radius: var(--radius-md);
        overflow-y: auto;
        white-space: nowrap;
    }
    .armor-view #turret-controls .armor-camera-presets {
        display: flex;
        flex-wrap: nowrap;
        gap: 4px;
        margin: 0 0 2px;
    }
    .armor-view #turret-controls .armor-camera-presets button {
        flex: 1;
        min-inline-size: 0;
        min-block-size: 30px;
        padding: 2px 6px;
        font: var(--type-caption);
        font-size: var(--font-size-caption-xs);
        line-height: var(--line-height-caption-xs);
        white-space: nowrap;
    }
    .armor-view #turret-controls .ctrl-row {
        display: inline-flex;
        flex-wrap: nowrap;
        align-items: center;
        gap: 4px;
        margin: 0 10px 0 0;
        font: var(--type-caption);
        font-size: var(--font-size-caption-xs);
        line-height: var(--line-height-caption-xs);
    }
    .armor-view #turret-controls .ctrl-row:last-child { margin-inline-end: 0; }
    .armor-view .armor-setup-head {
        position: sticky;
        inset-block-start: 0;
        z-index: var(--z-sticky);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        margin-block-end: var(--space-2);
        padding-block: 2px;
        background: var(--color-surface-1);
    }
    .armor-view #tank-selectors .armor-panel-title { margin: 0; }
    .armor-view .armor-tools-close {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        inline-size: var(--hit-min);
        block-size: var(--hit-min);
        min-block-size: var(--hit-min);
        padding: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius-full);
        corner-shape: round;
        background: var(--input-bg);
        color: var(--txt);
    }
    .armor-view .armor-stage.is-tools-open #tank-selectors {
        position: fixed;
        inset-block: 0;
        inset-inline-end: 0;
        inline-size: calc(19rem + env(safe-area-inset-right));
        max-block-size: none;
        margin: 0;
        padding: var(--space-3) calc(var(--space-3) + env(safe-area-inset-right)) var(--space-3) var(--space-3);
        border: 0;
        border-inline-start: 1px solid var(--border);
        background: var(--color-surface-1);
        box-shadow: var(--elevation-3);
        z-index: var(--pb-z-modal);
    }
    /* 抽屉是 #corner-tl 的后代：#corner-tl 所属层叠上下文只有 pb-z-hud(5)，与右下
       armor-bottom-controls（同为 5 且 DOM 靠后）同级时抽屉会被 HUD 盖住并拦截触摸；
       其自身 pb-z-modal(9) 无法越级。展开抽屉时提升所属上下文到 z-dialog——必须高于
       射击复现顶栏（--z-sticky+1 = 101），否则顶栏右侧的上一/下一发箭头会盖住抽屉
       顶部 sticky 的关闭按钮（与 #tank-picker 同一 dialog 层，DOM 靠后的 picker 仍在其上）。 */
    .armor-view.is-shot .armor-stage.is-tools-open #corner-tl { z-index: var(--z-dialog); }
}
/* 600×320 级窄横屏：左上胶囊已占掉近半宽度，结果胶囊改到胶囊下方第二行；
   右下面板从 168px 起、左下面板从 ~240px 起，与 28px 高的结果行保持分离。 */
@media (pointer: coarse) and (orientation: landscape) and (height <= 500px) and (width < 768px) {
    .armor-view :is(#click-info, #traj-info),
    .armor-view.has-back :is(#click-info, #traj-info) {
        inset-block-start: calc(var(--space-5) + 44px);
        inset-inline-start: calc(max(var(--space-5), env(safe-area-inset-left)) + var(--immersive-nav-reserve));
        max-inline-size: calc(100% - max(var(--space-5), env(safe-area-inset-left)) - max(var(--space-5), env(safe-area-inset-right)) - var(--immersive-nav-reserve));
    }
}
/* 竖屏提示（强制横屏设备）：盖住场景但不卸载它，转到横屏即继续 */
.armor-view .armor-rotate-prompt { position: absolute; inset: 0; z-index: var(--pb-z-modal); background: var(--color-canvas); }
</style>
