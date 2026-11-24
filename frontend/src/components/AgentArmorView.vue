<script setup>
/**
 * Agent 3D 装甲查看器（?view=agent-armor）：tankViewer.js 场景内核宿主。
 * Vue owns navigation / recorded-shot summary / the shared tank picker;
 * tankViewer owns model controls via stable DOM IDs. URL 参数保持上游契约
 * （?tank= &shooter= &config= &shell= &shot= &heatmap=1 &world=1 等）。
 * 样式与射击导航 / 装配 URL 同步 / 122 可用性 / 场景文案表拆分至 agent-armor-view.css
 * 与 agent-armor/（LOC 预算；行为原样）。
 */
import { computed, inject, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, MousePointer2 } from 'lucide-vue-next'
import { formatShotBattleClock } from '../utils/playbackClock.js'
import { initTankViewer } from '../scene/tankViewer.js'
import { recordedTargetMatchesShot } from '../replay-local/compute/tankSetup'
import { detectWebGL } from '../scene/webglSupport.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { useForcedLandscape } from '../composables/useForcedLandscape.js'
import { usePointer } from '../composables/useBreakpoint.js'
import Scene3DStatus from './Scene3DStatus.vue'
import RotatePrompt from './RotatePrompt.vue'
import TankCatalogMenu from './TankCatalogMenu.vue'
import ArmorShotHud from './ArmorShotHud.vue'
import ArmorToolsPanel from './agent-armor/ArmorToolsPanel.vue'
import { useArmorShotPage } from './agent-armor/useArmorShotPage.ts'
import { useArmorSetupQuery } from './agent-armor/useArmorSetupQuery.ts'
import { useArmorPitchAvailability } from './agent-armor/useArmorPitchAvailability.ts'
import { armorViewerLabels } from './agent-armor/armorViewerLabels.ts'
import { shellLabel } from '../scene/tankMeta.js'
import './agent-armor-view.css'
import './agent-armor-view-responsive.css'
import './agent-armor-view-hud-responsive.css'
const { t, te } = useI18n()
const route = useRoute()
const {
    isShotPage, armorUpgrade, shotSnapshot, battleStartRaw, activeShot, shotPosition,
    recordedResult, navigating, navigationError, readShotSnapshot, shotTankName,
    backToShots, backOrTankopedia, adjacentShot, hint, shotGestures,
    bumpNavSeq, currentNavSeq, requestSeqNext, dispose: disposeShots,
} = useArmorShotPage()
// coarse 由 usePointer 提供（射击页手势提示 / 沉浸态判据共用）
const { coarse } = usePointer()

const pickerOpen = ref(false)
const pickerMode = ref('target')
const tankList = ref([])
const tankListState = ref('loading')
const selectedShooterId = ref(null)
const selectedTargetId = ref(null)
const pickerFilters = ref({ q: '', tier: '', nation: '', type: '', category: '', sort: 'name' })
// 「参数」面板（装备 / 射击方 / 目标 / 配置）：桌面与手机都默认收起，不再常驻占掉 3D 视口；
// 桌面端复用手机竖屏的顶栏结构，信息卡与设置面板合并为左上角同一张卡。
const toolsOpen = ref(false)
/** 两侧配置编辑器 / 右上角射击 HUD 就绪后才隐藏原生控件（资产缺失时仍可回退） */
const shooterReady = ref(false)
const targetReady = ref(false)
const hudReady = ref(false)
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
const { pitchFromModules, pitchFromModulesKnown, pitchDeviceBonusValue } = useArmorPitchAvailability(targetSetupId)
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
const {
  replaceArmorSetupQuery, syncNativeTargetConfig, syncNativeShell, syncNativeEquipment, applyShotSetup, applySide,
} = useArmorSetupQuery({
  viewer: () => viewer,
  targetSetupId: () => targetSetupId.value,
  shooterSetupId: () => shooterSetupId.value,
  onUpgradesChanged: () => { preserveToolsOnRebuild = true },
})

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
// 击穿判定结果卡（跟随世界命中点的屏幕投影，2026-11-16 用户裁示）。判定模式唯一结果窗口
// （2026-11-15 用户裁示：五行点选卡只在厚度模式保留）；装甲查看器手机端默认展开逐层明细
// （2026-11-16 用户反馈：不能只给极简一行），小屏点卡片可收起为一行胶囊；射击复现页结果卡
// 空间受限，保持默认收起。
const resultExpanded = ref(!isShotPage.value)
watch(isShotPage, shot => { resultExpanded.value = !shot })
// 展开/收起改变卡片高度：DOM 更新后让场景按新尺寸重新定位（避让固定 HUD 面板）。
watch(resultExpanded, () => nextTick(() => viewer?.repositionResultCard?.()))
const onboarding = inject(ONBOARDING_KEY, null)
onMounted(() => onboarding?.registerSurface('armor', {
    ready: () => load.value.state === 'ready',
    failed: () => !webgl.supported || load.value.state === 'error',
}))
onBeforeUnmount(() => onboarding?.registerSurface('armor', null))
/** 重建场景 DOM 的计数：整体重试时换 key，让 tankViewer 拿到全新的按 ID 查找的节点 */
const attempt = ref(0)

function onLoadState(next) {
    load.value = { state: next.state, progress: next.progress ?? null, message: next.message || '' }
}

// 选车弹窗：菜单本体是共享 TankCatalogMenu（与坦克百科同一套搜索/筛选/排序/卡片）；
// 名册与当前选择由 tankViewer 回调提供（refs 声明提前：loadoutTankId 依赖 selectedTargetId）。
const pickerTitle = computed(() => pickerMode.value === 'shooter' ? t('armor.select_shooter') : t('armor.select_target'))
const pickerSelectedId = computed(() => pickerMode.value === 'shooter' ? selectedShooterId.value : selectedTargetId.value)
// 选车器换车不写 route；子编辑器按 tank-id 重建，就绪标志必须随车重置，
// 否则新车的编辑器不可用/加载失败时原生配置下拉仍被旧标志隐藏。
watch(shooterSetupId, () => { shooterReady.value = false; hudReady.value = false })
watch(targetSetupId, () => { targetReady.value = false })

/**
 * 可用性改变时同步场景；模块目录确认该车没有 122 槽位时清掉共享链接的覆盖。
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

// 122 的加成数值只有 devices.json 一个权威来源；场景通过 setter 接收，避免前端硬编码 +4/+3。
// 成功读取目录（含首轮失败后的重试）会在可用性解析里同步恢复 bonus。
watch(pitchDeviceBonusValue, value => { viewer?.setPitchDeviceBonus?.(value) })

function startViewer(preserveSelection = false) {
    distanceState.value = null
    const seq = currentNavSeq()
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
        labels: armorViewerLabels({ t, te }),
        onLoadState: (next) => { if (isSeqCurrent(seq)) onLoadState(next) },
        onTankList: (list) => {
            if (!isSeqCurrent(seq)) return
            tankList.value = list
            tankListState.value = 'ready'
        },
        onTankSelection: (selection) => {
            if (!isSeqCurrent(seq)) return
            selectedShooterId.value = selection.shooter
            selectedTargetId.value = selection.target
        },
        onDistanceChange: state => { if (isSeqCurrent(seq)) distanceState.value = state },
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
/** 场景回调的序列守卫（alive && seq === navigationSeq，单一来源在 useArmorShotPage） */
function isSeqCurrent(seq) {
    return seq === currentNavSeq()
}

async function retry() {
    load.value = { state: 'loading', progress: null, message: '' }
    const previous = viewer
    if (previous?.retry?.()) return
    const preserveSelection = previous?.isContextLost?.() === true
    const seq = bumpNavSeq()
    requestSeqNext()
    navigating.value = false
    // 名册都没拿到（或渲染器创建失败）：销毁后重建整个场景
    viewerReady.value = false
    previous?.destroy?.()
    viewer = null
    attempt.value += 1
    await nextTick()
    if (isSeqCurrent(seq) && webgl.supported) startViewer(preserveSelection)
}

onMounted(async () => {
    const seq = currentNavSeq()
    await readShotSnapshot(seq)
    await nextTick()
    if (isSeqCurrent(seq) && webgl.supported) startViewer()
})
// Same-view query navigation does not remount ViewHost. Dispose the old scene before rebuilding its ID contract.
watch(() => route.fullPath, async () => {
    if (route.query.view !== 'agent-armor') return
    // 只改了装配键：场景已由 applyShotSetup 就地更新，不重建（否则每次点模块都会闪一下）
    if (viewer && sceneSignature() === lastSceneSignature) return
    requestSeqNext()
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
    const seq = bumpNavSeq()
    shotSnapshot.value = []
    await readShotSnapshot(seq)
    await nextTick()
    if (isSeqCurrent(seq) && webgl.supported) startViewer()
    if (isSeqCurrent(seq)) navigating.value = false
})

// 离开路由必须销毁：rAF 循环 + WebGL 上下文不释放，反复进出会耗尽浏览器
// WebGL 上下文上限（~16 个）出现 "context lost" 黑屏
onBeforeUnmount(() => {
    disposeShots()
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
            <div v-if="activeShot" class="armor-shot-meta"><span>{{ $t('armor.recorded_shot') }} · {{ formatShotBattleClock(activeShot.time_s, battleStartRaw) }}</span><span>{{ $t('agentShots.recorded_damage') }} <b>{{ activeShot.damage ?? '—' }}</b></span><span v-if="recordedResult" :class="`armor-shot-result is-${recordedResult.tone}`">{{ recordedResult.text }}</span><span v-if="activeShot.shell_kind">{{ shellLabel({ type: activeShot.shell_kind }) }}</span></div>
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
        <ArmorToolsPanel
            :clean-query="cleanQuery"
            :is-shot-page="isShotPage"
            v-model:tools-open="toolsOpen"
            :hud-ready="hudReady"
            :pitch-device-available="pitchDeviceAvailable"
            :is-xi-tank="isXiTank"
            :shooter-setup-id="shooterSetupId"
            :target-setup-id="targetSetupId"
            :shooter-config-value="shooterConfigValue"
            :loadout-active="loadoutActive"
            v-model:shooter-open="shooterOpen"
            v-model:target-open="targetOpen"
            :armor-upgrade="armorUpgrade"
            @open-picker="openPicker"
            @apply-side="applySide"
            @shooter-ready="value => shooterReady = value"
            @target-ready="value => targetReady = value"
        />
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
        <!-- 厚度模式点选结果（基础装甲/入射角/等效装甲五行）：跟随点击位置，小屏自适应缩放。
             判定模式不再使用这张卡（2026-11-15 用户裁示：只保留逐层判定结果卡 #traj-info），
             数值由 scene/viewer/judgment.ts 的 showArmorPartInfo 写入（该模式不做判定，
             穿深/结果保持 '—'，不猜）。 -->
        <div id="click-info">
            <h3 id="click-part">—</h3>
            <div class="row"><span>{{ $t('armor.base_armor') }}</span><span id="click-armor">—</span></div>
            <div class="row"><span>{{ $t('armor.angle') }}</span><span id="click-angle">—</span></div>
            <div class="row"><span>{{ $t('armor.effective') }}</span><span id="click-effective">—</span></div>
            <div class="row"><span>{{ $t('armor.penetration') }}</span><span id="click-pen">—</span></div>
            <div class="row"><span>{{ $t('armor.result') }}</span><span id="click-result">—</span></div>
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
                <button id="collision-btn" type="button" aria-pressed="false" :title="$t('armor.thickness_scale')" :disabled="!viewerReady">{{ $t('armor.show_collision') }}</button>
                <button id="penetration-btn" type="button" aria-pressed="false" :disabled="!viewerReady">{{ $t('armor.heatmap') }}</button>
                <!-- 装甲组成显隐只在装甲厚度视图可用（场景按 collisionMode 显示这一行） -->
                <div id="armor-filters" class="armor-filters" hidden>
                    <button id="filter-primary" type="button" class="active" aria-pressed="true">{{ $t('armor.filter_primary') }}</button>
                    <button id="filter-spaced" type="button" class="active" aria-pressed="true">{{ $t('armor.filter_spaced') }}</button>
                    <button id="filter-external" type="button" class="active" aria-pressed="true">{{ $t('armor.filter_external') }}</button>
                </div>
            </div>
            <div id="armor-result-legend" class="armor-legend" role="list" :aria-label="$t('armor.result_legend')"><span class="armor-legend-item is-pen" role="listitem"><i aria-hidden="true"></i>{{ $t('armor.legend_penetration') }}</span><span class="armor-legend-item is-may" role="listitem"><i aria-hidden="true"></i>{{ $t('armor.legend_may_penetrate') }}</span>
                <span class="armor-legend-item is-rico" role="listitem"><i aria-hidden="true"></i>{{ $t('armor.legend_ricochet') }}</span><span class="armor-legend-item is-blocked" role="listitem"><i aria-hidden="true"></i>{{ $t('armor.legend_blocked') }}</span></div>
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
