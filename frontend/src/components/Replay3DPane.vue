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
import { useI18n } from 'vue-i18n'
import { createPlaybackStore } from '../scene/playbackStore.js'
import { initPlayback, QUALITY_PRESETS } from '../scene/playbackScene.js'
import { hpPercentText } from '../scene/rosterState.js'
import { detectWebGL } from '../scene/webglSupport.js'
import { uiProfile } from '../composables/useUiProfile.js'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import Scene3DStatus from './Scene3DStatus.vue'
import PlaybackTransport from './PlaybackTransport.vue'
import PlaybackVehicleLabels3D from './PlaybackVehicleLabels3D.vue'
import BaseStatusBar from './BaseStatusBar.vue'
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
/** 「显示」面板开合（局部视图状态，不持久化） */
const displayOpen = ref(false)
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
/** 审计 3D-15：手机上两队名单默认收起（原来两块 240px 面板互相重叠、盖住场景），按需打开 */
const rosterOpen = ref(false)
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
const hpText = (n) => String(Math.round(Math.max(0, Number(n) || 0)))
const hpPctText = (pct) => Math.round(Number(pct) || 0) + '%'

/**
 * 阵营色只在 HUD 里用（three.js 场景本体的阵营色由场景内核按设计 token 处理）：
 * 阵容圆点 / 胜利失败横幅取语义 token，随主题切换，不再写死红绿。
 * `uiProfile` 是唯一 reactive 主题源（design-language §2），读样式只发生在计算属性里，
 * 不在每帧渲染里逐行读。
 *
 * **两套颜色是不同的概念，不得互相替代**：
 * - `team1` / `team2` = **物理队伍**身份色（--color-team-1/2），固定不随录像者所属队伍交换；
 * - `ally` / `enemy` = **记录者视角**（--color-team-ally/enemy），只服务顶栏总血量、比分与胜负横幅。
 */
const teamColors = computed(() => {
  // 主题偏好是唯一主题状态源：它变了就重读一次 token 值
  void uiProfile.value
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') {
    return { team1: 'currentColor', team2: 'currentColor', ally: 'currentColor', enemy: 'currentColor', unknown: 'currentColor' }
  }
  const styles = getComputedStyle(document.documentElement)
  const read = (name) => styles.getPropertyValue(name).trim() || 'currentColor'
  return {
    team1: read('--color-team-1'),
    team2: read('--color-team-2'),
    ally: read('--color-team-ally'),
    enemy: read('--color-team-enemy'),
    unknown: read('--color-text-secondary'),
  }
})

/**
 * 名册按**物理队伍**分组渲染（左 = Team 1，右 = Team 2，未识别阵营在左车道底部——
 * 位置与颜色都不随录像者属于哪一队改变）。场景内核只下发 `team`，颜色在本层取语义 token，
 * 保证「Team 1 是什么颜色」只有一份事实源。
 *
 * HP 数值/百分比由每行的 `hp` / `maxHp` 现算（回放时刻的状态投影，见 scene/rosterState.js）：
 * 没有可信上限时百分比为 `null`，上屏成「—」而不是 0——unknown ≠ 0。
 */
const rosterGroups = computed(() => {
  const colors = teamColors.value
  const withColor = (list, color) => (list || []).map((player) => ({
    ...player,
    color,
    hpText: String(Math.max(0, Math.round(Number(player.hp) || 0))),
    pctText: formatPct(player.hp, player.maxHp),
  }))
  return {
    team1: withColor(store.roster.team1, colors.team1),
    team2: withColor(store.roster.team2, colors.team2),
    unknown: withColor(store.roster.unknown, colors.unknown),
  }
})

/** HP 百分比文案（整数 + `%`）；无可信上限 → `—` */
function formatPct(hp, maxHp) {
  const pct = hpPercentText(hp, maxHp)
  return pct == null ? '—' : `${pct}%`
}
/** 名册血条的填充宽度（百分比字符串；无上限 → 0） */
function hpBarWidth(hp, maxHp) {
  const pct = hpPercentText(hp, maxHp)
  return `${pct == null ? 0 : pct}%`
}

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
  if (!file || !sceneApi) return
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
  if (!sceneApi) return
  sceneApi.destroy?.()
  sceneApi = null
}

/** 当前是否应存在场景（模板 v-else 分支的条件，必须与它逐字一致） */
function shouldHaveScene() {
  return !!webgl.supported && !props.blockedReason && !!props.file
}

/** 需要则建场景（返回是否新建）；已存在则复用，不重建、不重解析 */
function ensureScene() {
  if (sceneApi || !shouldHaveScene()) return false
  sceneApi = initPlayback(stage.value, store, labelOverlay.value)
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
    }
    return
  }
  if (created || file !== loadedFile) {
    loadedFile = file
    loadFile(file)
  }
}

/**
 * 阵容车道（review blocker 修复）：己方 / 敌方各占一条**侧边车道**，未知阵营归左车道、
 * 在车道内常驻底部（flex: none，不被队伍名单滚出可视区）——三条名单都不与中央 HUD 列
 * 或底部控制条共用车道。车道上下界**不写死**：ResizeObserver 实测 .hud / .controls 的
 * 高度写入 --pb-hud-h / --pb-controls-h（.pb-root 上有兜底默认），HUD 长高（基地条 +
 * 击杀流）或控制条换行（窄屏）时车道自动让位。
 */
const rootEl = ref(null)
const hudEl = ref(null)
const controlsEl = ref(null)
let laneBoundsObserver = null
function observeLaneBounds() {
  if (typeof ResizeObserver !== 'function') return
  laneBoundsObserver?.disconnect()
  laneBoundsObserver = new ResizeObserver(() => {
    const root = rootEl.value
    if (!root) return
    root.style.setProperty('--pb-hud-h', `${Math.ceil(hudEl.value?.offsetHeight ?? 0)}px`)
    root.style.setProperty('--pb-controls-h', `${Math.ceil(controlsEl.value?.offsetHeight ?? 0)}px`)
  })
  if (hudEl.value) laneBoundsObserver.observe(hudEl.value)
  if (controlsEl.value) laneBoundsObserver.observe(controlsEl.value)
}
watch(controlsEl, (el) => {
  // controls 是 hasData 条件渲染：数据就位才出现，出现即纳入观测
  if (el && laneBoundsObserver) laneBoundsObserver.observe(el)
})

/** ?debug：几何门禁 / 人工排查的状态注入点（与场景内核的 ?debug 钩子同一口径，只暴露
 *  store 引用与车道 DOM，不改变任何行为）。browser 几何门禁据此注入 roster / killfeed，
 *  在真实 Chrome 里断言车道的非交叉几何。 */
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  window.__pbPane = { store, get labelOverlay() { return labelOverlay.value } }
}

/**
 * 「显示」面板的可用高度（实测写进 --pb-display-panel-h）。向上展开时取两者最小：
 *   1. 工具条上沿到面板顶的实际空间（矮窗口里否则面板会长到视口外）；
 *   2. **.pb-pane 视口内可见高度的 1/4**：面板不该盖住画面主体；小窗口里"场景中心"
 *      可能整个落在视口外（横屏 360px 高时 .pb-root 顶部本身就是负的），所以按可见
 *      高度的比例兜，而不是按 .pb-root 高度的一半。
 *
 * 极端矮的窗口（横屏 < 480px 高）上方根本没有空间：那时面板改走**工具条内联**布局
 * （见 @media (height < 480px)），不再需要这里的可用高度。
 *
 * 与车道定界同一口径（实测 → 写 CSS 变量），不在 CSS 里猜。打开时才测量
 * （闭合状态下 .controls 可能整块不存在），窗口尺寸变化时重算。
 */
const displayWrapEl = ref(null)
const DISPLAY_PANEL_MAX_H = 240
function measureDisplayPanel() {
  const wrap = displayWrapEl.value
  const root = rootEl.value
  const pane = wrap?.closest('.pb-pane')
  if (!wrap || !root || !pane) return
  const rootBox = root.getBoundingClientRect()
  const paneBox = pane.getBoundingClientRect()
  const paneVisible = Math.max(0, Math.min(paneBox.bottom, innerHeight) - Math.max(paneBox.top, 0))
  const above = wrap.getBoundingClientRect().top - rootBox.top
  const available = Math.min(above, paneVisible / 4, DISPLAY_PANEL_MAX_H)
  root.style.setProperty('--pb-display-panel-h', `${Math.max(72, Math.floor(available))}px`)
}
watch(displayOpen, (open) => { if (open) measureDisplayPanel() })

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
  [() => props.file, () => props.blockedReason, () => props.active],
  ([, , active], previous = []) => {
    // 先按新的 file/blocked 收敛场景，再处理能力切换
    reconcileScene()
    const activeChanged = previous.length === 3 && previous[2] !== active
    if (activeChanged) sceneApi?.setPaused?.(!active)
  },
  { flush: 'post' },
)

// 面板打开期间尺寸变化（旋转 / 全屏 / 工作台重排）重算可用高度；闭合时不测量
// （此时 .controls 可能整块不存在），打开那一下由 watch(displayOpen) 负责。
function onViewportResize() { if (displayOpen.value) measureDisplayPanel() }
onMounted(() => window.addEventListener('resize', onViewportResize))
onBeforeUnmount(() => window.removeEventListener('resize', onViewportResize))
</script>

<template>
  <div class="pb-pane">
    <Scene3DStatus v-if="!webgl.supported" mode="unsupported" :webgl-status="webgl.status" />
    <p v-else-if="blockedReason" class="pb-note" data-testid="replay3d-blocked">{{ blockedReason }}</p>
    <p v-else-if="!file" class="pb-note" data-testid="replay3d-empty">{{ $t('agentReplay.no_file') }}</p>
    <div v-else class="pb-root" ref="rootEl" :class="{ 'roster-open': rosterOpen }">
      <div ref="stage" class="scene"></div>
      <PlaybackVehicleLabels3D ref="labelOverlay" :label-prefs="labelPrefs" :hp-prefs="hpPrefs" :hidden="uiHidden || !store.hasData" />

      <!-- 顶部 HUD 列：顶栏 → 基地状态条 → 击杀流。整列在没有任何子块可显示时消失
           （不是留一个空 .hud 占位——那会让"隐藏全部 UI"看起来没生效，也让车道定界白留高度）。 -->
      <div v-if="store.hasData && (showTopbar || showBaseStatus || showKillfeed)" ref="hudEl" class="hud">
        <div v-if="store.hasData && showTopbar" class="topbar panel">
          <div class="tb-row">
            <span class="map">{{ mapTitle }}</span>
            <span class="timer">{{ store.timer }}</span>
          </div>
          <!-- 双方队伍总血量（与上游 3D 视图同布局：数值 + 色条夹住比分，己方在左、敌方在右）。
               整行是**记录者视角**：血条与比分都按 friendly_team 映射（teamHpTotals /
               perspectiveScore）——与名册的**物理队伍**是两套不同约定，不得互相替代。 -->
          <div class="tb-row" data-test="hud-team-hp">
            <em class="hpnum hpnum-f">{{ hpText(store.hpFriend) }} / {{ hpText(store.hpFriendMax) }}</em>
            <span class="hpbar hp-f" :title="`${t('agentReplay.hp_friendly')} ${hpPctText(store.hpFriendPct)}`">
              <i :style="{ width: store.hpFriendPct + '%' }"></i>
            </span>
            <span class="score" data-test="hud-score"><span class="t1">{{ store.scoreFriend }}</span> : <span class="t2">{{ store.scoreEnemy }}</span></span>
            <span class="hpbar hp-e" :title="`${t('agentReplay.hp_enemy')} ${hpPctText(store.hpEnemyPct)}`">
              <i :style="{ width: store.hpEnemyPct + '%' }"></i>
            </span>
            <em class="hpnum hpnum-e">{{ hpText(store.hpEnemy) }} / {{ hpText(store.hpEnemyMax) }}</em>
          </div>
        </div>

        <!-- 基地状态条（与 2D 共用）：每基地一枚徽章（底色 = 归属，外环 = 占领进度），两端为争霸积分 -->
        <div v-if="store.hasData && showBaseStatus && store.baseViews.length" class="base-status">
          <BaseStatusBar :bases="store.baseViews" :friendly-points="store.pointsFriend" :enemy-points="store.pointsEnemy" />
        </div>

        <div v-if="store.hasData && showKillfeed" class="killfeed">
          <div v-for="kf in store.killfeed" :key="kf.id" class="kf">{{ killfeedText(kf) }}</div>
        </div>
      </div>

      <!-- 阵容车道：左右两条侧边车道（不占中央 HUD 车道）；未知阵营归左车道、常驻车道
           底部（不被队伍名单滚出可视区），与居中的 HUD 列 / 底部控制条互不遮挡。
           左侧恒为**物理 Team 1**、右侧恒为 **Team 2**：位置、标题、颜色都不随录像者
           属于哪一队改变（不在这里做 friendly/enemy 映射）。 -->
      <template v-if="store.hasData && showRoster">
        <div class="team-lane side-left">
          <div class="team panel team1">
            <h3>{{ t('agentReplay.team1') }}</h3>
            <div class="roster">
              <div
                v-for="p in rosterGroups.team1" :key="p.eid"
                class="pl" :class="{ dead: p.dead, followed: p.followed }"
                @click="sceneApi.setFollow(p.eid)"
              >
                <span class="dot" :style="{ background: p.color }"></span>
                <span class="nick">{{ p.nick }}</span>
                <span class="hpv" data-test="roster-hp">{{ p.hpText }}</span>
                <span class="hpp" data-test="roster-hp-pct">{{ p.pctText }}</span>
                <span class="tank">{{ p.tank }}</span>
                <span class="hpbar"><i :style="{ width: hpBarWidth(p.hp, p.maxHp), background: p.color }"></i></span>
              </div>
            </div>
          </div>
          <div v-if="rosterGroups.unknown.length" class="team panel team-unknown">
            <h3>{{ t('agentReplay.teamUnknown') }}</h3>
            <div class="roster">
              <div
                v-for="p in rosterGroups.unknown" :key="p.eid"
                class="pl" :class="{ dead: p.dead, followed: p.followed }"
                @click="sceneApi.setFollow(p.eid)"
              >
                <span class="dot" :style="{ background: p.color }"></span>
                <span class="nick">{{ p.nick }}</span>
                <span class="hpv" data-test="roster-hp">{{ p.hpText }}</span>
                <span class="hpp" data-test="roster-hp-pct">{{ p.pctText }}</span>
                <span class="tank">{{ p.tank }}</span>
                <span class="hpbar"><i :style="{ width: hpBarWidth(p.hp, p.maxHp), background: p.color }"></i></span>
              </div>
            </div>
          </div>
        </div>
        <div class="team-lane side-right">
          <div class="team panel team2">
            <h3>{{ t('agentReplay.team2') }}</h3>
            <div class="roster">
              <div
                v-for="p in rosterGroups.team2" :key="p.eid"
                class="pl" :class="{ dead: p.dead, followed: p.followed }"
                @click="sceneApi.setFollow(p.eid)"
              >
                <span class="dot" :style="{ background: p.color }"></span>
                <span class="nick">{{ p.nick }}</span>
                <span class="hpv" data-test="roster-hp">{{ p.hpText }}</span>
                <span class="hpp" data-test="roster-hp-pct">{{ p.pctText }}</span>
                <span class="tank">{{ p.tank }}</span>
                <span class="hpbar"><i :style="{ width: hpBarWidth(p.hp, p.maxHp), background: p.color }"></i></span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-if="!uiHidden && store.banner" class="banner" :style="{ color: bannerColor }">{{ bannerText() }}</div>

      <!-- 隐藏全部 UI：连底部播放控件一起让位（这是「只看战场」的语义）；
           `H` 键或右上角常驻按钮随时恢复。resize 观测对 null 元素是安全的（watch(controlsEl)）。 -->
      <div v-if="store.hasData && !uiHidden" ref="controlsEl" class="controls panel">
        <!-- 与 2D 回放同一套传输控件（时间轴 / 倍速 / mm:ss 一致） -->
        <PlaybackTransport
          :playing="store.playing"
          :speed="store.speed"
          :speeds="PLAYBACK_SPEEDS"
          :current-time="store.time"
          :start-time="store.startTime"
          :duration="store.duration"
          :step-seconds="PLAYBACK_STEP_SECONDS"
          @toggle-play="transport.togglePlay()"
          @step="sceneApi.seekBy($event)"
          @set-speed="sceneApi.setSpeed($event)"
          @seek="sceneApi.seekTime($event)"
          @scrub-start="store.seeking = true; transport.scrubStart()"
          @scrub-end="store.seeking = false; transport.scrubEnd()"
        />
        <!-- 3D 专属（相机 / 显示 / 阵容 / 画质）独立成一行，不与传输控件混成一套。
             标签与战场 UI 的开关收进「显示」面板：设置只有一份 owner（共享偏好），
             不在工具条上再放一份重复开关。 -->
        <div class="toolbar" data-testid="replay3d-toolbar">
          <button
            type="button" class="tool-btn roster-toggle" :aria-pressed="rosterOpen"
            data-testid="roster-toggle" @click="rosterOpen = !rosterOpen"
          >{{ t('agentReplay.roster') }}</button>
          <SegmentedControl
            :model-value="store.cam"
            :options="CAMERAS"
            :aria-label="t('agentReplay.camera')"
            @update:model-value="sceneApi.setCam($event)"
          />
          <div ref="displayWrapEl" class="display-wrap">
            <button
              type="button" class="tool-btn" :aria-expanded="displayOpen"
              aria-haspopup="true" data-testid="display-toggle"
              @click="displayOpen = !displayOpen"
            >{{ t('agentReplay.display') }}</button>
          </div>
          <span class="spacer"></span>
          <span class="q-badge" :title="t('agentReplay.q_title')">{{ qualityBadge }}</span>
        </div>
      </div>

      <!-- 「显示」面板：锚在 .pb-root 的**右下角**（不是工具条），用 `hidden` 开关。
           关键取舍：面板**绝不参与工具条布局**——一旦让它撑高 .controls，底部控件就会长到
           占掉半个战场，阵容车道随之越界（矮窗口实测）。浮动面板 + 内部滚动是稳定的做法：
           高度上限由 measureDisplayPanel 实测写进 --pb-display-panel-h，宽度按断点由 CSS 给。 -->
      <div class="display-panel panel" data-testid="display-panel" :hidden="uiHidden || !displayOpen">
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
        <button
          type="button" class="tool-btn dp-hide" data-testid="hide-all-ui"
          @click="setUiHidden(true)"
        >{{ t('agentReplay.hide_all_ui') }}</button>
      </div>

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

.pb-root {
  position: relative;
  isolation: isolate;               /* 局部层叠上下文：HUD 只用 --pb-z-* 的 1–9 层 */
  /* 阵容车道定界变量的兜底值：RO 就位后由 observeLaneBounds 写入实测值。
     必须定义在 .pb-root 上——写在 .team-lane 上会把根元素的实测值遮蔽掉。 */
  --pb-hud-h: 48px;
  --pb-controls-h: 130px;
  height: clamp(320px, 62dvh, 720px);
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}

.scene { position: absolute; inset: 0; z-index: var(--pb-z-canvas); }

/* HUD 面板外观（位置交给各自的容器规则，不再默认绝对定位） */
.panel {
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}

.topbar {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  white-space: nowrap;
  padding: var(--space-1) var(--space-4);
}
.topbar .tb-row { display: flex; align-items: center; gap: var(--space-3); }
.topbar .timer { font: var(--type-h3); font-variant-numeric: tabular-nums; }
.topbar .score { font: var(--type-h3); }
.topbar .score .t1 { color: var(--color-team-ally); }
.topbar .score .t2 { color: var(--color-team-enemy); }
.topbar .map { color: var(--color-text-secondary); }
/* 双方队伍总血量：数值 + 色条夹住比分。己方条自右向左、敌方条自左向右（围绕比分对称），
   条宽用原始百分比（不取整）保证连续下降平滑。 */
.topbar .hpnum { font-style: normal; color: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; }
.topbar .hpbar { display: inline-flex; width: 92px; height: 9px; overflow: hidden;
                 border-radius: var(--radius-full); background: var(--color-surface-3); }
.topbar .hp-f { justify-content: flex-end; }
.topbar .hpbar > i { display: block; height: 100%; transition: width var(--duration-base) var(--ease-standard); }
.topbar .hp-f > i { background: var(--color-team-ally); }
.topbar .hp-e > i { background: var(--color-team-enemy); }

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

/* 顶部 HUD 竖排：顶栏 → 基地状态条 → 击杀流；整列不拦截场景操作，
   阵容面板从这一列下方开始，不再靠各自猜的固定 top 值。 */
.hud {
  position: absolute; top: var(--space-2); left: var(--space-2); right: var(--space-2);
  z-index: var(--pb-z-hud);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
  pointer-events: none;
}

/* 阵容车道（review blocker 修复）：左右两条**侧边**车道，未知阵营归左车道、在车道内
   flex 常驻底部——三条名单都不与中央 HUD 列 / 底部控制条共用车道。车道上下界**实测**：
   ResizeObserver 把 .hud / .controls 的高度写进 --pb-hud-h / --pb-controls-h（下面给
   兜底默认），HUD 长高或控制条换行时车道自动让位，不再有写死的 top:96px / 底部 reserve。 */
.team-lane {
  position: absolute;
  display: flex; flex-direction: column; gap: var(--space-2);
  top: calc(var(--space-2) + var(--pb-hud-h) + var(--space-3));
  bottom: calc(var(--pb-controls-h) + var(--space-2) + var(--space-3));
  z-index: var(--pb-z-hud);
  width: 240px;
  pointer-events: none;              /* 车道只负责定界，空白处不拦截场景操作 */
}
.side-left { position: absolute; left: var(--space-2); }
.side-right { position: absolute; right: var(--space-2); }
.team {
  pointer-events: auto;
  min-height: 0;                     /* 车道放不下时在面板内部滚动，不越界 */
  overflow-y: auto;
  padding: var(--space-1);
}
.team1, .team2 { flex: 0 1 auto; }
.team-unknown { flex: none; max-height: 50%; }   /* 常驻可见：不被队伍名单挤出车道 */
.team-unknown h3 { color: var(--color-text-secondary); }
.team h3 { margin: var(--space-1) var(--space-1) var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); }

/* 名册行：两行网格。
   行 1 = 队伍标 + 昵称 + **HP 数值** + **百分比**（数值列 `tabular-nums`、不截断；
          只有昵称允许 ellipsis）。
   行 2 = 车型名（可 ellipsis）+ 一条**次要**的细血条——血条只是辅助视觉，
          HP 数值与百分比才是主信息（旧版只有血条，血量只能靠长度猜）。

   ⚠️ 用显式 grid-column/row 定位，**不要用 grid-template-areas**：
   本行有两行结构，"HP 值行 1 占第 3 列 / 百分比行 1 占第 4 列"，若把它们写成同一个
   区域名，该区域就不是矩形 → 整条 `grid-template-areas` 被判无效并丢弃 → 所有单元格
   落进隐式单列、全部叠在 x=0（实测整行文字互相压在一起）。 */
.pl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: var(--space-1);
  min-height: var(--hit-min); padding: 0 var(--space-1);
  border-radius: var(--radius-sm); cursor: pointer;
}
.pl .dot { grid-column: 1; grid-row: 1 / span 2; width: 8px; height: 8px; align-self: center; }
.pl .nick { grid-column: 2; grid-row: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl .hpv { grid-column: 3; grid-row: 1; }
.pl .hpp { grid-column: 4; grid-row: 1; text-align: end; }
.pl .hpv,
.pl .hpp {
  font: var(--type-caption);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;              /* HP 与百分比不得被截断 */
}
.pl .tank {
  grid-column: 2; grid-row: 2; min-width: 0;
  overflow: hidden; color: var(--color-text-secondary);
  font: var(--type-caption); text-overflow: ellipsis; white-space: nowrap;
}
.pl .hpbar {
  grid-column: 3 / span 2; grid-row: 2; justify-self: end; align-self: center;
  width: 52px; height: 3px; border-radius: var(--radius-full); background: var(--color-surface-3);
}
.pl .hpbar i { display: block; height: 100%; border-radius: var(--radius-full); }
.pl.dead { opacity: .42; }
.pl.dead .nick { text-decoration: line-through; }
.pl.followed { outline: 1px solid var(--color-accent); }
.pl:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.killfeed {
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
  white-space: nowrap;
  animation: kfin var(--duration-base) var(--ease-standard);
}
@keyframes kfin { from { opacity: 0; transform: translateY(-6px); } }

/* 基地状态条：顶栏下方居中，不拦截场景操作（徽章本身可悬停看说明） */
.base-status { pointer-events: none; }

/* 底部控制条：自己的定位自己声明（`.panel` 只是视觉面，不再隐含 absolute） */
.controls {
  position: absolute;
  bottom: var(--space-2); left: 50%; transform: translateX(-50%);
  z-index: var(--pb-z-hud);
  display: flex; flex-direction: column; gap: var(--space-2);
  width: min(880px, calc(100% - var(--space-4)));
  padding: var(--space-2) var(--space-4);
}
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.spacer { flex: 1; }
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

/* 「显示」面板：锚在 .pb-root 的右下角（悬浮、不参与工具条布局）。
   宽度 240px；高度上限 = 可见面板高度的 40%（实测写进 --pb-display-panel-h），
   下限 72px，内容超出则面板内部滚动——所有开关始终可滚动到并真实可点。 */
.pb-root { --pb-display-panel-w: 240px; --pb-display-panel-h: 240px; }
.display-wrap { display: inline-flex; }
.display-panel {
  position: absolute;
  inset-block-end: var(--space-2);
  inset-inline-end: var(--space-2);
  z-index: var(--pb-z-hud);
  display: flex; flex-direction: column; align-items: stretch; gap: var(--space-1);
  inline-size: var(--pb-display-panel-w);
  max-block-size: var(--pb-display-panel-h);
  overflow-y: auto;
  padding: var(--space-2);
  box-shadow: var(--elevation-3);
}
/* hidden 属性在组件 scoped 样式下不可靠（`.panel` 的 display 会盖掉 UA 的 [hidden]），
   显式写死：闭合时必须真正不占位、不拦点击。 */
.display-panel[hidden] { display: none; }

.display-panel .dp-title {
  margin: var(--space-1) 0 0;
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
}
/* 隐藏按钮必须整宽可点（面板是 flex column + align-items: stretch；曾因没拉伸退化成 18px 宽）。
   注意：这里**不能**再放 `max-inline-size: calc(100% - …)`——百分比解析的是 inline-flex 的
   .display-wrap（26px），会把 240px 的面板夹成一条 34px 的缝。紧凑档的宽度覆盖只在下面的
   媒体查询里给。 */
.display-panel .dp-hide { margin-top: var(--space-2); inline-size: 100%; }

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
  .pl:hover { background: var(--color-surface-3); }
  .tool-btn:hover { color: var(--color-text-primary); }
}

.roster-toggle { display: none; }

/* 审计 3D-15：紧凑档名单收进「阵容」开关。打开时两条车道**各占半宽**——旧版两块 240px
   绝对定位互相重叠、盖住场景（不得回退）；半宽放不下血条，只留圆点 + 昵称 + HP 数值/百分比
   （血量数字与百分比是主信息，**不得**在紧凑档一起消失；血条是次要视觉，可省）。
   车道上下界仍由 --pb-hud-h / --pb-controls-h 实测定界，与桌面同一套几何安全。 */
@media (width < 768px) {
  .roster-toggle { display: inline-flex; align-items: center; }
  .team-lane { display: none; }
  .pb-root.roster-open .team-lane { display: flex; }
  .pb-root.roster-open .side-left { position: absolute; left: var(--space-2); right: 51%; width: auto; }
  .pb-root.roster-open .side-right { position: absolute; right: var(--space-2); left: 51%; width: auto; }
  .pl .hpbar { display: none; }
  /* 车型名是次要行：紧凑档已在 --type-caption 上，不再另设字号（仓库无 --font-size-xs token） */
  /* 紧凑档：显示面板整宽（240px 在 360px 宽的窗口里太窄，读不全标签文案） */
  .pb-root { --pb-display-panel-w: calc(100% - var(--space-4)); }
  .display-panel { inset-inline-start: var(--space-2); inset-inline-end: var(--space-2); }
  .topbar { gap: var(--space-2); padding: 0 var(--space-3); }
  .controls { width: calc(100% - var(--space-2)); padding: var(--space-1) var(--space-2); }
}

/* 触屏：控件点击区域抬到 --hit-min（44px），布局不动 */
@media (pointer: coarse) {
  .tool-btn { min-height: var(--hit-min); }
}
</style>
