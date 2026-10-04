<script setup>
/**
 * 3D 回放能力面板（回放工作台内）：目标回放在本机解析（上游 Rust Core WASM →
 * playbackScene 全场渲染），文件不出本机、不经服务端。
 *
 * 职责边界：只拥有**场景生命周期**（场景内核 + HUD + 阵容 + 相机 / 画质 / 标签 / GLB +
 * 播放传输）；文件选择与 session identity 由工作台（`useReplaySession` + `FileDrop`）
 * 唯一持有——本面板从不自己要求文件，也没有第二个 session。
 *
 * 切到别的能力（`active=false`）：场景停帧但不销毁，切回不重新解析、保留 timeline / 相机；
 * 键盘播放快捷键同样只在激活时响应。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useI18n } from 'vue-i18n'
import { createPlaybackStore } from '../scene/playbackStore.js'
import { initPlayback, QUALITY_PRESETS } from '../scene/playbackScene.js'
import { detectWebGL } from '../scene/webglSupport.js'
import { uiProfile } from '../composables/useUiProfile.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import Scene3DStatus from './Scene3DStatus.vue'
import PlaybackTransport from './PlaybackTransport.vue'
import PlaybackDisplaySurface from './PlaybackDisplaySurface.vue'
import PlaybackVehicleLabels3D from './PlaybackVehicleLabels3D.vue'
import VehicleDetailsPanel from './VehicleDetailsPanel.vue'
import PlaybackRoster from './PlaybackRoster.vue'
import { rosterLanesFor } from '../scene/rosterState.js'
import BaseStatusBar from './BaseStatusBar.vue'
import BattlePlaybackHud from './BattlePlaybackHud.vue'
import SegmentedControl from './SegmentedControl.vue'
import AppButton from './AppButton.vue'
import { mapLabel } from '../utils/helpers.js'
import { PLAYBACK_SPEEDS, PLAYBACK_STEP_SECONDS, isInteractiveTarget, usePlaybackTransport } from '../composables/usePlaybackTransport.js'

defineOptions({ name: 'Replay3DPane' })

const props = defineProps({
  /** 工作台派生的目标回放文件；null = 还没选（面板只显示提示，不自己开文件选择器） */
  file: { type: Object, default: null },
  /** 当前能力是否激活：false 时停帧、停键盘，但不销毁会话 */
  active: { type: Boolean, default: false },
  /** 工作台给出的不可用原因（多文件未选场次等）；非空时不解析 */
  blockedReason: { type: String, default: '' },
})

const { t, locale } = useI18n()
const { availability, requireFeature } = useFeatureGate()
const online = computed(() => availability(Feature.PLAYBACK_3D))

/**
 * 呈现偏好（标签行 / 战场 UI 分块）的**唯一 owner** 是 usePlaybackPreferences——
 * 与 2D Playback 共用同一份持久化偏好，3D 不再自建第二套 localStorage 状态。
 */
const { labelPrefs, hpPrefs, uiPrefs } = usePlaybackPreferences()

/**
 * 「隐藏全部 UI」：**不写入持久化偏好**（刷新后回到常规界面，不会把用户永久关在空白场景里），
 * 只覆盖本次会话的显示。隐藏时保留一个常驻的极简恢复按钮——不得做成不可逆状态。
 * `H` 键切换；输入控件聚焦时不响应（复用播放传输的同一判据）。
 */
const uiHidden = ref(false)
/**
 * 「显示 / 二级控件」面开合（局部视图状态，不持久化）。
 *
 * 一个 owner 承担两种形态（不新建第二套设置系统）：内容是同一份——相机模式、阵容 / 标签 /
 * 画质等查看与显示开关；只有**位置**随形态变，且位置归 `PlaybackDisplaySurface`：
 *   · 宽视口 / 横屏 = 锚定在 gear 上的浮面，优先开在 gear 上方，空间不足换边并夹在 workspace 内；
 *   · 竖屏 = 流内的一块面，排在传输控件之后（order 由本组件的 `.portrait-flow` 给）。
 * 两种形态读写同一份共享偏好（uiPrefs / labelPrefs / hpPrefs / store.cam）。
 */
const displayOpen = ref(false)
const displayAnchor = ref(null)
function toggleDisplay(anchor) { displayAnchor.value = anchor; displayOpen.value = !displayOpen.value }
/** 紧凑档：手机形态（见 usePlaybackPhoneForm —— 宽度 <768 **或** 触屏且视口高 ≤500，
 *  后者命中手机全屏横屏）。**不能用纯宽度断点**：手机竖屏 412×915 全屏后是 915×412，
 *  按宽度会突然判成平板、把收起来的 controls 又展开。与 2D 共用同一份 form-factor 契约。 */
const { isPhone } = usePlaybackPhoneForm()
/**
 * 竖屏判据与 2D **同一个**（usePlaybackPortraitViewport）：不能从 `isPhone` 推——手机横屏 /
 * 全屏横屏也是 `isPhone`，但它们走的是 `Team 1 | 正方形 Stage | Team 2`。
 *
 *   竖屏 = 纵向流：HUD / 正方形 Stage / 传输控件 / 详情（inline）/ Team 1 / Team 2，页面可滚
 *   其它 = 三段式：两侧车道 + 中间正方形 Stage，传输控件在 Stage 之下
 */
const { isPortrait } = usePlaybackPortraitViewport()
const portraitFlow = computed(() => isPortrait.value)

// Selection belongs to the pane. Camera mode and follow target belong to the scene.
// 选中与详情可见性是**两个状态**：关详情不清选中，选中也从不自动跟随（跟随只由相机动作改变）。
const selectedEid = ref(null)
const detailsOpen = ref(false)
/** 浮窗落位偏好：点左车道 → 落右侧，点右车道 → 落左侧，点场景里的车 → 与它相对的一侧。 */
const detailsSide = ref('right')
function selectVehicle(eid, event = null) {
  selectedEid.value = eid
  detailsOpen.value = true
  displayOpen.value = false
  const side = detailsSideFor(event)
  if (side) detailsSide.value = side
}
function detailsSideFor(event) {
  const target = event?.target
  if (target?.closest?.('.side-left')) return 'right'
  if (target?.closest?.('.side-right')) return 'left'
  const root = rootEl.value
  if (!root || !Number.isFinite(event?.clientX)) return null
  // 场景里的车：浮窗落在点击位置的**相对**一侧，不挡住用户刚点的那台车。
  const rect = root.getBoundingClientRect()
  return event.clientX > rect.left + rect.width / 2 ? 'left' : 'right'
}
/** 详情 ×：只关详情。选中（名册高亮）、跟随、相机、时间轴、倍速与名册都不动。 */
function closeDetails() {
  detailsOpen.value = false
}
function chooseCamera(mode) {
  if (mode === 'follow' && selectedEid.value != null) sceneApi?.setFollow(selectedEid.value)
  else sceneApi?.setCam(mode)
}
function setUiHidden(hidden) {
  uiHidden.value = hidden
  if (hidden) displayOpen.value = false
}
function toggleUiHidden() { setUiHidden(!uiHidden.value) }
/**
 * `H` 切换「隐藏全部 UI」。在输入 / 可操作控件上不响应（复用播放传输的同一判据：
 * 输入框里打字不该把界面藏起来）。
 *
 * 注：判据用 `event.target`（与 usePlaybackTransport 的空格 / 方向键一致）。浏览器里
 * 输入框聚焦时 keydown 的 target 就是该元素；happy-dom 的合成 KeyboardEvent 不设 target，
 * 因此这条守卫无法用「聚焦 input + dispatch」在单测里覆盖——测试改为直接调用本函数
 * 并传入真实 target 形状的事件（见 Replay3DPane.test.js）。
 */
function onUiToggleKeydown(event) {
  if (event.key !== 'h' && event.key !== 'H') return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (!props.active || !store.hasData) return
  if (isInteractiveTarget(event.target)) return
  event.preventDefault()
  toggleUiHidden()
}

/** 战场 UI 分块：隐藏全部 UI 时整块关掉（只保留恢复按钮） */
const showTopbar = computed(() => !uiHidden.value && uiPrefs.showTopbar)
const showRoster = computed(() => !uiHidden.value && uiPrefs.showRoster)
const showKillfeed = computed(() => !uiHidden.value && uiPrefs.showKillfeed)
const showBaseStatus = computed(() => !uiHidden.value && uiPrefs.showBaseStatus)

const store = createPlaybackStore()
const stage = ref(null)
const labelOverlay = ref(null)
let sceneApi = null
const transport = usePlaybackTransport({
  isPlaying: () => store.playing,
  play: () => sceneApi?.setPlaying(true),
  pause: () => sceneApi?.setPlaying(false),
  step: (delta) => sceneApi?.seekBy(delta),
  isReady: () => store.hasData,
  // 工作台切到别的能力时不再劫持空格 / 方向键（2D 回放面板同时激活会争抢）
  isActive: () => props.active,
})
// 审计 3D-23：渲染器创建前做 WebGL 预检；不支持时不初始化场景，整块换成说明
const webgl = detectWebGL()

/**
 * 把共享偏好推给场景内核（唯一方向：偏好 → 场景；场景只读，不回写）。
 * 建场景时要补推一次——内核在 initPlayback 之后才有 setLabelPrefs。
 */
function pushLabelPrefs() {
  sceneApi?.setLabelPrefs?.({
    enabled: !uiHidden.value,
    showPlayerName: labelPrefs.showPlayerName,
    showTankName: labelPrefs.showTankName,
    showHp: hpPrefs.showHp,
    showReload: labelPrefs.showReload,
  })
}
watch([labelPrefs, hpPrefs, uiHidden], pushLabelPrefs, { deep: true })

/** 最近一次加载的文件：失败后"重试"直接重新解析，不必再选一次 */
let lastFile = null
const lastFileName = ref('')
const loadingMessage = computed(() => t(store.assetStage ? 'agentReplay.loading_assets' : 'agentReplay.parsing'))

// 画质徽标按 qualityKey 三语计算（store.qualityLabel 为上游兼容中文字段）
const qualityBadge = computed(() =>
  t('agentReplay.quality') + ' · ' + t('agentReplay.q_' + store.qualityKey),
)

/** 地图名三语：优先按资产面 key 查 map_names.json，查不到再用解析器给的名字，都没有就原样显示 */
const mapTitle = computed(() => {
  const key = store.mapKey
  const byKey = key ? mapLabel(key, locale.value) : null
  if (byKey && byKey !== key) return byKey
  return mapLabel(store.mapName, locale.value) || store.mapName
})

// 相机 / 画质档位文案都是用户可见文本，且本应用支持运行中切语言（MorePanel 的 setLocale 不刷新页面），
// 所以走 computed 每次重算——不得在 setup 里定死一次，也不用内核预设里的固定中文 label。
const CAMERAS = computed(() => [
  { value: 'free', label: t('agentReplay.cam_free') },
  { value: 'top', label: t('agentReplay.cam_top') },
  { value: 'follow', label: t('agentReplay.cam_follow') },
])
const QUALITY_ORDER = Object.keys(QUALITY_PRESETS)

// 顶栏双方总血量：数值用**完整整数**（§11 HUD 禁止 1k / 22.3k 缩写，与 2D HUD 同口径）；
// 色条宽度用原始百分比（不取整，血量缓慢下降时条仍平滑），title 上给取整百分比。
const hudHealth = (current, maximum) => ({
  state: 'EXACT',
  knownRemaining: Number.isFinite(Number(current)) ? Math.max(0, Number(current)) : 0,
  totalMax: Number.isFinite(Number(maximum)) ? Math.max(0, Number(maximum)) : 0,
  unknownMax: 0,
})

/** Banner colors follow the current profile and Recorder perspective. */
const teamColors = computed(() => {
  // 主题偏好是唯一主题状态源：它变了就重读一次 token 值
  void uiProfile.value
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') {
    return { ally: 'currentColor', enemy: 'currentColor', unknown: 'currentColor' }
  }
  const styles = getComputedStyle(document.documentElement)
  const read = (name) => styles.getPropertyValue(name).trim() || 'currentColor'
  return {
    ally: read('--color-team-ally'),
    enemy: read('--color-team-enemy'),
    unknown: read('--color-text-secondary'),
  }
})

/** Physical identities stay in the store; shared roster presentation derives Recorder colors. */
const rosterLanes = computed(() => rosterLanesFor(store.roster, store.friendlyTeam))

/** 选中行（详情面用它取实时投影；随名册每帧更新，所以是 computed 不是快照） */
const selectedRow = computed(() => {
  if (selectedEid.value == null) return null
  const g = store.roster
  return g.team1.find((p) => p.eid === selectedEid.value)
    || g.team2.find((p) => p.eid === selectedEid.value)
    || g.unknown.find((p) => p.eid === selectedEid.value)
    || null
})

const selectedDetailState = computed(() => selectedRow.value ? {
  vehicle: { tankName: selectedRow.value.tank, playerName: selectedRow.value.nick,
    team: selectedRow.value.team, friendly: [1, 2].includes(store.friendlyTeam) && [1, 2].includes(selectedRow.value.team) ? selectedRow.value.team === store.friendlyTeam : null },
  destroyed: selectedRow.value.dead,
} : null)
const selectedHealth = computed(() => selectedRow.value ? {
  currentHp: Number.isFinite(selectedRow.value.hp) ? selectedRow.value.hp : null,
  maxHp: Number.isFinite(selectedRow.value.maxHp) && selectedRow.value.maxHp > 0 ? selectedRow.value.maxHp : null,
} : null)
const detailClock = (sec) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.floor(Math.max(0, sec) % 60)).padStart(2, '0')}`

const bannerColor = computed(() => {
  const outcome = store.banner?.outcome
  if (outcome === 'win') return teamColors.value.ally
  if (outcome === 'lose') return teamColors.value.enemy
  return teamColors.value.unknown
})

/**
 * 把目标文件交给场景内核。
 *
 * **加载状态不属于组件层**：`playbackScene.loadData()` 自己持有代数 guard 与
 * `loading` / `err` / `assetStage` / `assetProgress` 的唯一写入权（见其 finally 的
 * `gen === sessionGen || gen + 1 === sessionGen` 判定）。组件层若也写 `store.loading`，
 * 就会出现「旧场景的迟到完成把新场景的 loading 清掉」——两边代数不同步，且组件层没有
 * 任何 guard。所以这里只发命令与记录最近文件（重试用）。
 */
/**
 * 解析任务的 session 所有权（P0：replay parser lifecycle is session-owned）：
 * 清空 / 换文件 / 销毁时**真正 abort 在途解析**，不只是丢弃结果——否则旧解析继续占着
 * Worker 队列，极端情况下（Worker 不回包）新文件永远排队、面板卡在「解析中」。
 * signal 经内核的 source 透传给 replaySource 的解析边界；被 abort 的旧加载其错误
 * 由内核的代数 guard 吞掉（新加载已接管归属），不会写成用户可见错误。
 */
let parseController = null
function abortParse() {
  parseController?.abort()
  parseController = null
}

async function loadFile(file) {
  // 连通性门禁在最前（离线时不启动新的 3D 解析）；随后是 main 的解析生命周期归属：
  // 每次新解析都要先撤下上一次（abort）并换新的 AbortController。
  if (!file || !sceneApi || !requireFeature(Feature.PLAYBACK_3D)) return
  abortParse()
  parseController = new AbortController()
  lastFile = file
  lastFileName.value = file.name || 'replay'
  await sceneApi.loadData({ kind: 'local', file, signal: parseController.signal })
}

/** 重试：同一份文件重新解析（失败不清空 selection，用户不必再选一次）；错误态由场景层重写 */
function retryLoad() {
  if (lastFile) return loadFile(lastFile)
}

function bannerText() {
  const banner = store.banner
  if (!banner) return ''
  return banner.outcome ? t('agentReplay.banner_' + banner.outcome) : banner.text
}
function killfeedText(kf) {
  // 结构化渲染（三语）：击杀 = killer × victim；环境/非击杀只标阵亡（cause 细节上游为中文后缀）
  return kf.kill
    ? `${kf.killer} ${t('agentReplay.destroyed')} ${kf.victim}`
    : `${kf.victim} ${t('agentReplay.destroyed_by_environment')}`
}

/**
 * 场景生命周期不变量（唯一权威，别把三件事混在一起）：
 *
 *   sceneApi 存在  ⟺  有一个**活的** stage DOM ∧ file 存在 ∧ 未被阻断 ∧ WebGL 可用
 *
 * 三种变化的产品语义完全不同，必须分开处理：
 * - `active=false`（能力切走）→ **只停帧**：保留会话，切回不重新解析、保留 timeline / 相机；
 * - `file=null` / `blockedReason` 非空 → **销毁场景**：模板此时已经移除了 `.pb-root`，
 *   旧 stage 是游离节点，再往上渲染就是往看不见的 DOM 上画（而且渲染循环还在跑）；
 * - 组件卸载 → 销毁一次。
 *
 * 销毁后必须等 Vue 用 `flush: 'post'` 重建出新的 stage 再 `initPlayback`，
 * 否则会把旧节点（或 null）交给场景内核。
 */
function destroyScene() {
  abortParse()   // 场景销毁 = 解析任务一并撤下（在途解析不得再占 Worker 队列）
  selectedEid.value = null
  detailsOpen.value = false
  if (!sceneApi) return
  sceneApi.destroy?.()
  sceneApi = null
}

/** 当前是否应存在场景（模板 v-else 分支的条件，必须与它逐字一致） */
function shouldHaveScene() {
  return online.value.available && !!webgl.supported && !props.blockedReason && !!props.file
}

/** 需要则建场景（返回是否新建）；已存在则复用，不重建、不重解析 */
function ensureScene() {
  // 两侧约束都要保留：
  //   · `!props.active` —— 未激活的能力不得建场景（不需要激活就初始化会在切走时白跑渲染）；
  //   · `labelOverlay.value` —— 3D 名牌改屏幕空间 DOM 锚点后，场景需要覆盖层句柄。
  if (sceneApi || !props.active || !shouldHaveScene()) return false
  sceneApi = initPlayback(stage.value, store, labelOverlay.value, { onVehicleSelect: selectVehicle })
  sceneApi?.setPaused?.(!props.active)
  pushLabelPrefs();   // 新场景默认吃共享偏好（含"隐藏全部 UI"的当前状态）
  return true
}

/** 解析目标回放：同一次会话内同一文件不重复解析 */
let loadedFile = null

/**
 * 待开播：文件到位后先让用户选画质，按「开始」才解析 + 拉资产。
 * 画质必须在渲染器创建前定型（内核 `startPlayback()` 惰性建渲染器、首帧按当前档位），
 * 所以这一步不能省成"加载中也能切档"。`startedFile` = 用户已按过开始的那一场。
 */
const startedFile = ref(null)
const qualityOptions = computed(() =>
  QUALITY_ORDER.map((k) => ({ value: k, label: t('agentReplay.q_' + k) })),
)

function startReplay() {
  if (!props.file) return
  startedFile.value = props.file
  reconcileScene()
}

function reconcileScene() {
  if (!shouldHaveScene()) {
    destroyScene()
    loadedFile = null
    startedFile.value = null
    return
  }
  const created = ensureScene()
  const file = props.file
  // 尚未按开始（含换到另一场）：先把上一场撤下，否则旧场景继续呈现、还会压住待开播面板；
  // 同时撤下旧场的在途解析（reset 归零会话，解析任务也一并让出 Worker 队列）
  if (file !== startedFile.value) {
    if (loadedFile) {
      sceneApi?.reset?.()
      abortParse()
      loadedFile = null
      selectedEid.value = null
      detailsOpen.value = false
      displayOpen.value = false
    }
    return
  }
  if (created || file !== loadedFile) {
    loadedFile = file
    loadFile(file)
  }
}

// Measure viewport capacity independently of the content-sized Stage row.
const rootEl = ref(null)
const hudEl = ref(null)
const controlsEl = ref(null)
let laneBoundsObserver = null
function measurePresentationBounds() {
  const root = rootEl.value
  if (!root) return
  const pageStyle = getComputedStyle(document.documentElement)
  const header = parseFloat(pageStyle.getPropertyValue('--header-h')) || 0
  const tabs = document.fullscreenElement === root ? 0 : (parseFloat(pageStyle.getPropertyValue('--tabbar-h')) || 0)
  const viewportH = window.visualViewport?.height || window.innerHeight
  const top = document.fullscreenElement === root ? 0 : header
  const workspaceH = Math.max(1, viewportH - top - tabs)
  root.style.setProperty('--pb-workspace-h', `${workspaceH}px`)
  const style = getComputedStyle(root)
  const gap = parseFloat(style.getPropertyValue('--space-1')) || 0
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  const hudH = hudEl.value?.getBoundingClientRect().height || 0
  const controlsH = controlsEl.value?.getBoundingClientRect().height || 0
  const budget = Math.max(1, workspaceH - padding - border - hudH - controlsH - gap * 2)
  const stageW = root.querySelector('.pb-stage')?.getBoundingClientRect().width || 0
  root.style.setProperty('--pb-square-avail-h', `${Math.floor(budget)}px`)
  root.style.setProperty('--pb-stage-h', `${Math.floor(Math.min(stageW, budget)) + gap * 2}px`)
}
function observeLaneBounds() {
  if (typeof ResizeObserver !== 'function') return
  laneBoundsObserver?.disconnect()
  laneBoundsObserver = new ResizeObserver(measurePresentationBounds)
  for (const el of [rootEl.value, hudEl.value, controlsEl.value]) if (el) laneBoundsObserver.observe(el)
}
watch([controlsEl, hudEl], (elements) => {
  for (const el of elements) if (el && laneBoundsObserver) laneBoundsObserver.observe(el)
  measurePresentationBounds()
}, { flush: 'post' })

/**
 * 全屏（与 2D 同一套产品语义，见 composables/usePlaybackFullscreen）：
 * 目标是 3D 回放根 `.pb-root`——不是整个 WotbTools 外壳。纯呈现 / 生命周期切换：
 * 场景、解析、时间、倍速、相机、跟随目标、标签与名册偏好**都不重置**
 * （本组件不做任何 `reset()` / `loadData()`，全屏只改变容器尺寸，渲染器由既有
 * ResizeObserver 路径适配）。手机形态在全屏成功后锁横屏，退出/卸载解锁。
 */
const { isFullscreen, fullscreenSupported, toggleFullscreen, unlockOrientation } = usePlaybackFullscreen({
  target: () => rootEl.value,
  isPhone,
  // capability 切走（active=false）时不该再锁着方向
  isActive: () => props.active,
})

/** ?debug：几何门禁 / 人工排查的状态注入点（与场景内核的 ?debug 钩子同一口径，只暴露
 *  store 引用与车道 DOM，不改变任何行为）。browser 几何门禁据此注入 roster / killfeed，
 *  在真实 Chrome 里断言车道的非交叉几何。 */
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  window.__pbPane = {
    store,
    get selectedEid() { return selectedEid.value },
    get detailsOpen() { return detailsOpen.value },
    get labelOverlay() { return labelOverlay.value },
    /** 场景实例身份：全屏 / 旋转前后必须是同一个（门禁据此断言「没有重建场景」）。 */
    get sceneApi() { return sceneApi },
  }
}


onMounted(() => {
  reconcileScene()
  observeLaneBounds()
  window.addEventListener('keydown', onUiToggleKeydown)
})
onBeforeUnmount(() => {
  destroyScene()
  laneBoundsObserver?.disconnect()
  laneBoundsObserver = null
  window.removeEventListener('keydown', onUiToggleKeydown)
  if (window.__pbPane?.store === store) delete window.__pbPane
})

/**
 * file / blockedReason / active 都由工作台派生：
 * 只有 `active` 是「暂停 / 恢复」，其余两个都会改变「场景该不该存在」。
 */
watch(
  [() => props.file, () => props.blockedReason, () => props.active, () => online.value.available],
  ([, , active], previous = []) => {
    // 先按新的 file/blocked 收敛场景，再处理能力切换
    reconcileScene()
    const activeChanged = previous.length >= 3 && previous[2] !== active
    if (activeChanged) {
      sceneApi?.setPaused?.(!active)
      if (!active) unlockOrientation()
    }
  },
  { flush: 'post' },
)

// 面板打开期间尺寸变化（旋转 / 全屏 / 工作台重排）重算可用高度；闭合时不测量
// （此时 .controls 可能整块不存在），打开那一下由 watch(displayOpen) 负责。
function onViewportResize() { measurePresentationBounds() }
onMounted(() => window.addEventListener('resize', onViewportResize))
onBeforeUnmount(() => window.removeEventListener('resize', onViewportResize))
</script>

<template>
  <div class="pb-pane">
    <!-- pending（首次检测未完成）：不下结论、不初始化 3D 场景，保持中性空白。 -->
    <template v-if="!online.available">
      <p v-if="!online.pending" class="pb-note" data-testid="replay3d-connectivity">{{ $t(online.messageKey) }}</p>
    </template>
    <Scene3DStatus v-else-if="!webgl.supported" mode="unsupported" :webgl-status="webgl.status" />
    <p v-else-if="blockedReason" class="pb-note" data-testid="replay3d-blocked">{{ blockedReason }}</p>
    <p v-else-if="!file" class="pb-note" data-testid="replay3d-empty">{{ $t('agentReplay.no_file') }}</p>
    <!-- 两种呈现（与 2D 同一个契约）：
           `roster-side`  = 三段式 `[Team1] [正方形 Stage] [Team2]`，传输控件在 Stage 之下；
                            宽档、平板、手机横屏、手机全屏横屏都是这一条；
           `portrait-flow` = 手机竖屏纵向流：HUD / Stage / 传输控件 / 详情 / Team 1 / Team 2。
         名册关闭时两者都没有车道，Stage 仍是居中的正方形。 -->
    <div v-else class="pb-root playback-workspace" ref="rootEl" :class="{ 'phone-form': isPhone, 'portrait-flow': portraitFlow, 'roster-side': showRoster && !portraitFlow }" data-testid="replay3d-root">
      <!-- 名牌覆盖层与 canvas 共用**同一个正方形盒子**：场景内核按 canvas（.scene）尺寸算锚点，
           覆盖层必须与它同原点，否则三段式下名牌会整体偏一条车道宽。 -->
      <div class="pb-stage" data-testid="replay3d-stage">
        <div class="stage-square">
          <div ref="stage" class="scene"></div>
          <PlaybackVehicleLabels3D ref="labelOverlay" :label-prefs="labelPrefs" :hp-prefs="hpPrefs" :hidden="uiHidden || !store.hasData" />
        </div>
      </div>

      <!-- Only persistent state contributes to measured HUD height. Kill events stay in a bounded overlay. -->
      <div v-if="store.hasData && (showTopbar || showBaseStatus || showKillfeed)" ref="hudEl" class="hud">
        <BattlePlaybackHud
          v-if="showTopbar || (showBaseStatus && store.baseViews.length)"
          :class="{ topbar: showTopbar }"
          :show-summary="showTopbar"
          score-label-key="recon.map.playback.kills"
          :map-title="mapTitle"
          :battle-time="store.timer"
          :friendly-hp="hudHealth(store.hpFriend, store.hpFriendMax)"
          :enemy-hp="hudHealth(store.hpEnemy, store.hpEnemyMax)"
          :friendly-points="store.scoreFriend"
          :enemy-points="store.scoreEnemy"
          :hp-no-transition="!store.playing"
        >
          <template v-if="showBaseStatus && store.baseViews.length" #bases>
            <BaseStatusBar compact class="base-status" :bases="store.baseViews" :friendly-points="store.pointsFriend" :enemy-points="store.pointsEnemy" />
          </template>
        </BattlePlaybackHud>
        <div v-if="showKillfeed && store.killfeed.length" class="killfeed" data-test="replay3d-killfeed" aria-hidden="true">
          <div v-for="kf in store.killfeed.slice(-3)" :key="kf.id" class="kf">{{ killfeedText(kf) }}</div>
        </div>
      </div>

      <!-- 详情是**整个 3D 战场 workspace（.pb-root）顶层**的可拖动浮窗（与 2D 同一个组件、
           同一份位置所有权）：它是 .pb-root 的直接子级，不属于 Stage、也不属于任何一条名册
           车道，可以拖到 Team 1 / Stage / Team 2 任意一栏之上。下缘不得越过传输控件
           （drag-bounds）。竖屏换成纵向流里的 inline 内容块（同一个组件）。
           与名册**互不影响**：名册开着时详情照样在，换选 Team 2 的车只是更新同一个窗。 -->
      <VehicleDetailsPanel
        v-if="!uiHidden && detailsOpen && selectedRow"
        class="vehicle-details" data-testid="replay3d-details"
        :presentation="portraitFlow ? 'inline' : 'floating'"
        :selected-state="selectedDetailState" :health="selectedHealth" :phone-form="portraitFlow"
        :current-time="store.time" :format-clock="detailClock"
        :drag-host="rootEl" :drag-bounds="controlsEl"
        :initial-side="detailsSide" :selection-key="selectedEid"
        @close="closeDetails"
      />

      <!-- 阵容车道：Recorder 的己方在左、敌方在右，未知阵营独立列在左车道底部。
           三段式下两条车道吃满根高度、不与中间一栏的 HUD / 传输控件交叉；竖屏下它们是
           纵向流里传输控件（与详情）之后的两段。没有「临时名册面」：名册的唯一开关是
           uiPrefs.showRoster。行的渲染与 2D 共用同一个 `PlaybackRoster`。 -->
      <div v-if="store.hasData && showRoster" class="roster-surface" data-testid="roster-surface">
        <div class="team-lane side-left" data-testid="replay3d-lane-left">
          <PlaybackRoster variant="3d" :compact="!portraitFlow" :teams="rosterLanes.left" :friendly-team="store.friendlyTeam" :selected-id="selectedEid" @select="selectVehicle" />
        </div>
        <div class="team-lane side-right" data-testid="replay3d-lane-right">
          <PlaybackRoster variant="3d" :compact="!portraitFlow" :teams="rosterLanes.right" :friendly-team="store.friendlyTeam" :selected-id="selectedEid" @select="selectVehicle" />
        </div>
      </div>

      <div v-if="!uiHidden && store.banner" class="banner" :style="{ color: bannerColor }">{{ bannerText() }}</div>

      <!-- 隐藏全部 UI：连底部播放控件一起让位（这是「只看战场」的语义）；
           `H` 键或右上角常驻按钮随时恢复。resize 观测对 null 元素是安全的（watch(controlsEl)）。 -->
      <div v-if="store.hasData && !uiHidden" ref="controlsEl" class="controls panel">
        <!-- 与 2D 回放同一套传输控件（时间轴 / 倍速 / mm:ss 一致） -->
        <PlaybackTransport
          :fullscreen-supported="fullscreenSupported"
          :is-fullscreen="isFullscreen"
          :display-open="displayOpen"
          display-enabled
          @toggle-fullscreen="toggleFullscreen()"
          @toggle-display="toggleDisplay"
          :playing="store.playing"
          :speed="store.speed"
          :speeds="PLAYBACK_SPEEDS"
          :current-time="store.time"
          :start-time="store.startTime"
          :duration="store.duration"
          :step-seconds="PLAYBACK_STEP_SECONDS"
          :compact="isPhone"
          @toggle-play="transport.togglePlay()"
          @step="sceneApi.seekBy($event)"
          @set-speed="sceneApi.setSpeed($event)"
          @seek="sceneApi.seekTime($event)"
          @scrub-start="store.seeking = true; transport.scrubStart()"
          @scrub-end="store.seeking = false; transport.scrubEnd()"
        >
        </PlaybackTransport>
      </div>

      <PlaybackDisplaySurface :open="displayOpen && !uiHidden" :portrait="portraitFlow" :anchor="displayAnchor" :host="rootEl" @close="displayOpen = false">
        <!-- 查看 / 显示开关都在这里（同一份 store.cam / uiPrefs / labelPrefs / hpPrefs / store.glbOn，
             没有第二套状态）：高频动作之外的设置不该永久占着战场高度。
             名册没有单独的「打开名册」入口：它的唯一开关是下面的 disp-roster 呈现偏好。 -->
          <p class="dp-title">{{ t('agentReplay.camera') }}</p>
          <SegmentedControl
            class="dp-camera"
            :model-value="store.cam"
            :options="CAMERAS"
            :aria-label="t('agentReplay.camera')"
            @update:model-value="chooseCamera($event)"
          />
        <p class="dp-title">{{ t('agentReplay.display_battlefield') }}</p>
        <label class="toggle"><input type="checkbox" data-testid="disp-topbar" :checked="uiPrefs.showTopbar" @change="uiPrefs.showTopbar = $event.target.checked"> {{ t('agentReplay.display_topbar') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-roster" :checked="uiPrefs.showRoster" @change="uiPrefs.showRoster = $event.target.checked"> {{ t('agentReplay.display_roster') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-killfeed" :checked="uiPrefs.showKillfeed" @change="uiPrefs.showKillfeed = $event.target.checked"> {{ t('agentReplay.display_killfeed') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-base" :checked="uiPrefs.showBaseStatus" @change="uiPrefs.showBaseStatus = $event.target.checked"> {{ t('agentReplay.display_base') }}</label>
        <p class="dp-title">{{ t('agentReplay.display_labels') }}</p>
        <label class="toggle"><input type="checkbox" data-testid="disp-player" :checked="labelPrefs.showPlayerName" @change="labelPrefs.showPlayerName = $event.target.checked"> {{ t('recon.map.playback.show_player_name') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-tank" :checked="labelPrefs.showTankName" @change="labelPrefs.showTankName = $event.target.checked"> {{ t('recon.map.playback.show_tank_name') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-hp" :checked="hpPrefs.showHp" @change="hpPrefs.showHp = $event.target.checked"> {{ t('recon.map.playback.show_hp') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-reload" :checked="labelPrefs.showReload" @change="labelPrefs.showReload = $event.target.checked"> {{ t('agentReplay.display_reload') }}</label>
        <p class="dp-title">{{ t('agentReplay.display_scene') }}</p>
        <label class="toggle" :title="store.glbAllowed ? '' : t('agentReplay.glb_gate_hint')">
          <input type="checkbox" data-testid="disp-glb" :checked="store.glbOn" :disabled="!store.glbAllowed" @change="sceneApi.setGlb($event.target.checked)"> {{ t('agentReplay.glb') }}
        </label>
        <!-- 画质在紧凑档是只读徽标（档位在播放前定型，运行中不可改），宽档同样只在工具条展示 -->
        <p class="q-badge dp-quality" :title="t('agentReplay.q_title')">{{ qualityBadge }}</p>
        <button
          type="button" class="tool-btn dp-hide" data-testid="hide-all-ui"
          @click="setUiHidden(true)"
        >{{ t('agentReplay.hide_all_ui') }}</button>
        <!-- 紧凑档面板是覆盖战场的浮层，必须有明确关闭入口（宽档点触发按钮即可，这里要能一眼看到） -->
        <button
          type="button" class="tool-btn dp-close"
          data-testid="display-close" @click="displayOpen = false"
        >{{ t('app.close') }}</button>
      </PlaybackDisplaySurface>

      <!-- 隐藏全部 UI 后唯一的恢复入口：常驻、极简、不遮场景中心；`H` 键等效。
           不得做成不可逆状态（该状态也不写入持久化偏好）。 -->
      <button
        v-if="uiHidden" type="button" class="ui-restore tool-btn panel"
        data-testid="show-all-ui" :title="t('agentReplay.show_all_ui_hint')"
        @click="setUiHidden(false)"
      >{{ t('agentReplay.show_all_ui') }}</button>

      <!-- 待开播：画质先定型再解析 + 拉资产（内核在 startPlayback 惰性建渲染器、首帧按当前档位） -->
      <div v-if="!uiHidden && file !== startedFile" class="pre-start" data-test="replay3d-pending">
        <div class="pre-start-card">
          <h3>{{ t('agentReplay.title') }}</h3>
          <p class="pre-start-file">{{ t('agentReplay.ready_file', { name: file.name || 'replay' }) }}</p>
          <SegmentedControl
            :model-value="store.qualityKey"
            :options="qualityOptions"
            :aria-label="t('agentReplay.quality')"
            data-testid="replay3d-quality"
            @update:model-value="sceneApi.setQuality($event)"
          />
          <AppButton variant="primary" data-test="replay3d-start" @click="startReplay">{{ t('agentReplay.start') }}</AppButton>
        </div>
      </div>

      <!-- 审计 3D-23：解析为不确定进度，地图资产阶段按段 / 字节推进；失败给出原因与重试 -->
      <Scene3DStatus
        v-if="!uiHidden && store.loading"
        mode="loading"
        :progress="store.assetStage ? store.assetProgress : null"
        :message="loadingMessage"
      />
      <Scene3DStatus
        v-else-if="!uiHidden && store.err"
        mode="error"
        :message="t('agentReplay.error_load', { msg: store.err })"
        :retryable="!!lastFileName"
        dismissible
        @retry="retryLoad"
        @dismiss="store.err = ''"
      />
    </div>
  </div>
</template>

<style scoped>
/* HUD 全部走语义 token（两档主题同一份规则，不再各写一套私有 palette）：
   3D 场景本体（three.js 画的战场）不随主题变化，只有场景之上的应用 UI 跟随。 */
.pb-pane { display: block; }

.pb-note { margin: var(--space-4) 0; color: var(--color-text-secondary); font: var(--type-body); }

/**
 * 三列工作区骨架（2D 与 3D 同一布局契约）：`[Team1] [正方形 Stage] [Team2]`。
 *
 * 战场是**正方形**：横屏视口里它只能受高度约束，两侧于是天然空出横向空间；那些空间就是
 * 名册的槽位——不把正方形拉成宽矩形去填满视口。名册关闭时不带 `roster-side` 类，
 * 侧槽整列不存在，Stage 依然居中、依然是正方形。
 *
 * 传输控件与 HUD 只占**中间一栏**（Stage 之上 / 之下），两条车道因此吃满整个根高度——
 * 手机横屏（740×360、844×390）与全屏横屏下，正常 7v7 的紧凑行不需要车道滚动条。
 */
.pb-root.roster-side .roster-surface {
  /* 宽档下这条表壳**不参与布局**：两条车道必须直接落在根网格的第 1 / 第 3 列里。
     让表壳留在流里，它就成了网格的唯一内容项、被放进第 1 列，两条车道只能在 240px 里
     上下叠着排（实测名册下半截溢到传输控件上）。`display: contents` 才是它的层级语义。 */
  display: contents;
}
.pb-root.roster-side .team-lane {
  position: static;
  inset: auto;
  width: auto;
  min-height: 0;
  /* 车道填满网格行（= 根高度）。正常 7v7 的紧凑行放得下；只有病态数据（远超 7v7）才会
     在车道内出现滚动——那是例外数据的安全兜底，不是常规呈现。 */
  align-self: stretch;
  overflow-y: auto;
}

.pb-root {
  position: relative;
  scroll-margin-block-start: calc(var(--header-h) + var(--space-3));
  isolation: isolate;               /* 局部层叠上下文：HUD 只用 --pb-z-* 的 1–9 层 */
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}

.scene { position: absolute; inset: 0; z-index: var(--pb-z-canvas); }

/**
 * 正方形 Stage 的工作区骨架（2D 与 3D 共用同一布局契约）。
 *
 * 两个渲染器的战场都是**正方形**：横屏视口里它只能受高度约束，两侧于是天然空出横向空间,
 * 那些空间就是 Team 1 / Team 2 名册的槽位——不把正方形拉成宽矩形去填满视口。
 *
 *   · `.pb-root` 是三列网格：`[Team1] [Stage] [Team2]`；
 *   · 侧槽宽度受 `--pb-lane-w` 控制，名册关闭时整列不存在（Stage 仍居中、仍是正方形）；
 *   · `.pb-stage` 里的 `.stage-square` 是正方形盒子：在可用空间里取最大正方形并居中；
 *     canvas（.scene）与名牌覆盖层共用这个盒子，因此两者同原点、同尺寸。
 *
 * 竖屏（手机）走另一套：见 `.portrait-flow` 的纵向流（HUD → Stage → Transport → 详情 → 名册）。
 */

.pb-stage {
  display: grid;
  place-items: center;
  min-width: 0; min-height: 0;
}
/* 正方形：取「可用宽 / 可用高」的较小边，永远不拉伸成矩形 */
.stage-square {
  position: relative;
  aspect-ratio: 1 / 1;
  inline-size: min(100%, 100cqh);
  block-size: auto;
}
.stage-square > .scene { position: absolute; inset: 0; }
.pb-stage { container-type: size; }

/* HUD 面板外观（位置交给各自的容器规则，不再默认绝对定位） */
.panel {
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}


/* 待开播：半透明遮罩 + 居中卡片（画质档位 + 开始）；点开始才解析 + 拉资产。
   层级用 --pb-z-scrim（盖住 HUD 面板，加载 / 错误状态仍在其上）。 */
.pre-start {
  position: absolute; inset: 0;
  z-index: var(--pb-z-scrim);
  display: grid; place-items: center;
  padding: var(--space-4);
  background: var(--color-scrim);
}
.pre-start-card {
  display: grid; justify-items: center; gap: var(--space-3);
  max-inline-size: min(100%, 420px);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
  box-shadow: var(--elevation-3);
  text-align: center;
}
.pre-start-card h3 { margin: 0; font: var(--type-h3); }
.pre-start-file { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }

/* Persistent HUD appearance; row placement belongs to the shared workspace. */
.hud {
  z-index: var(--pb-z-hud);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
  pointer-events: none;
}

/* 名册车道只负责**位置与宽度**：行的布局与视觉由共用的 PlaybackRoster 独占（见该组件）。
   三段式与竖屏纵向流分别在 `.roster-side` / `.portrait-flow` 下给出位置。 */
.team-lane { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }

/* Details placement belongs to the pane; the surface itself is the shared component, which now
   owns its own workspace-level position (drag + clamp). No absolute/transform rules here:
   the 3D stage is a square, so a corner-pinned card would cover the battlefield. */

.killfeed {
  position: absolute; inset-block-start: calc(100% + var(--space-1)); inset-inline: 0;
  max-block-size: calc(3 * (var(--line-height-caption) + var(--space-1))); overflow: hidden;
  display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
  max-width: 100%;
}
.kf {
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
  max-inline-size: 100%; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;
  animation: kfin var(--duration-base) var(--ease-standard);
}
@keyframes kfin { from { opacity: 0; transform: translateY(-6px); } }

/* 基地状态条：顶栏下方居中，不拦截场景操作（徽章本身可悬停看说明） */
.base-status { pointer-events: none; }

/* Transport appearance; shared workspace owns its position and available width. */
.controls {
  z-index: var(--pb-z-hud);
  display: flex; flex-direction: column; gap: var(--space-2);
}
.toggle { display: flex; gap: var(--space-1); align-items: center; min-height: var(--hit-min); color: var(--color-text-secondary); cursor: pointer; }
.tool-btn {
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  cursor: pointer;
}
.tool-btn[aria-pressed="true"] { border-color: var(--color-accent); background: var(--color-accent); color: var(--color-on-accent); }
.tool-btn:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.q-badge { color: var(--color-text-secondary); font: var(--type-caption); }
.pb-root input[type="checkbox"] { flex: none; width: auto; min-width: 0; margin: 0; }

/* Display content appearance; placement belongs to PlaybackDisplaySurface. */
.dp-title { margin: var(--space-1) 0 0; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
.dp-hide { margin-block-start: var(--space-2); inline-size: 100%; }

/* 隐藏全部 UI 后的唯一恢复入口：右下角常驻，不遮场景中心也不拦场景操作 */
.ui-restore {
  position: absolute; right: var(--space-2); top: var(--space-2);
  z-index: var(--pb-z-hud);
  box-shadow: var(--elevation-3);
}

.banner {
  position: absolute; top: 38%; left: 50%; transform: translate(-50%, -50%);
  z-index: var(--pb-z-hud);
  padding: var(--space-3) var(--space-10);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
  font: var(--type-display);
  font-weight: 700;
}

@media (hover: hover) {
  .tool-btn:hover { color: var(--color-text-primary); }
}


.phone-form .dp-close, .phone-form .dp-camera { inline-size: 100%; }

/**
 * 手机竖屏：纵向流（与 2D 同一个契约）。
 *   HUD → 正方形 Stage（用满列宽）→ 传输控件 →（显示面板）→ 详情 inline → Team 1 → Team 2
 * 竖屏利用的是**纵向**空间：根高度由内容决定，页面自己滚；没有两条各自滚动的队伍盒子，
 * 也没有盖在场景上的名册浮层。
 */
.pb-root.portrait-flow {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  height: auto;
  overflow: visible;
  padding: var(--space-2);
}
.portrait-flow > .hud { position: relative; inset: auto; order: 1; }
.portrait-flow > .pb-stage { order: 2; container-type: normal; }
.portrait-flow .stage-square { inline-size: 100%; }
.portrait-flow > .controls {
  position: static;
  order: 3;
  width: 100%;
  transform: none;
}

.portrait-flow > .vehicle-details { order: 5; }
.portrait-flow > .roster-surface { order: 6; display: grid; gap: var(--space-2); }
/* Display 面在竖屏纵向流里紧跟传输控件（共享组件只负责「是一块流内面」，顺序归宿主）。 */
.portrait-flow > .pb-display-surface { order: 4; }
.portrait-flow .team-lane { position: static; width: auto; }
.portrait-flow > .banner { position: absolute; top: var(--space-12); }

/* 触屏：控件点击区域抬到 --hit-min（44px），布局不动 */
@media (pointer: coarse) {
  .tool-btn { min-height: var(--hit-min); }
}
</style>
