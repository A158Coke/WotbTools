<script setup>
/**
 * Agent 3D 装甲查看器（?view=agent-armor）：tankViewer.js 场景内核宿主。
 * Vue owns navigation / recorded-shot summary; tankViewer owns model controls via stable DOM IDs.
 * 数据面：tank/{id}.json + glb/{id}/*.glb 静态资产（agentData.js，?assets= 基址），
 * 击穿判定 penetration.js 客户端移植；射击复现数据经 sessionStorage 交接（AgentShots）。
 * URL 参数保持上游契约：?tank= &shooter= &config= &shell= &shot= &heatmap=1 &world=1 等。
 */
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, SlidersHorizontal, MousePointer2, X } from 'lucide-vue-next'
import { fetchReplayShots, shotViewerQuery } from '../scene/agentData.js'
import { shotResultBadge } from '../utils/shotPresentation.js'
import { shellLabel, armorPartLabel, armorResultLabel } from '../scene/tankMeta.js'
import { formatPlaybackClock } from '../utils/playbackClock.js'
import { initTankViewer } from '../scene/tankViewer.js'
import { detectWebGL } from '../scene/webglSupport.js'
import { replayValueLabel } from '../utils/display.js'
import { usePointer } from '../composables/useBreakpoint.js'
import Scene3DStatus from './Scene3DStatus.vue'

const { t, te } = useI18n()
const router = useRouter()
const route = useRoute()
const isShotPage = computed(() => route.query.shot != null)
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
// 手机顶栏的「参数」面板（装备 / 射击方 / 目标 / 配置）：默认收起，不再常驻占掉 3D 视口。
// 桌面端该按钮由 CSS 隐藏（面板照旧常驻），故默认值不影响桌面布局。
const toolsOpen = ref(false)
// ?clean=1 时场景脚本会隐藏全部常驻面板（截图 / 嵌入用）；顶栏卡片与参数开关一并让位
const cleanQuery = computed(() => route.query.clean === '1')

let viewer = null
// 审计 3D-23：创建渲染器之前做 WebGL 预检；不支持时整页换成说明，不再抛原始报错
const webgl = detectWebGL()
/** 场景加载状态（tankViewer onLoadState 上报）：loading / ready / error */
const load = ref({ state: 'loading', progress: null, message: '' })
/** 重建场景 DOM 的计数：整体重试时换 key，让 tankViewer 拿到全新的按 ID 查找的节点 */
const attempt = ref(0)
const PHASE_KEY = { 'armor model': 'armor_model', 'tank model': 'tank_model', 'tank data': 'tank_data', 'tank list': 'tank_list' }

function onLoadState(next) {
    load.value = { state: next.state, progress: next.progress ?? null, message: next.message || '' }
}

function startViewer() {
    const seq = navigationSeq
    const q = new URLSearchParams(window.location.search)
    const tank = Number(q.get('tank')) || 0
    // 初始坦克：?tank=（缺省给 T-34 = 1，避免空参打开白屏）
    window.__INITIAL_TANK__ = tank || 1
    window.__INITIAL_SHOOTER__ = Number(q.get('shooter')) || window.__INITIAL_TANK__
    // 审计 3D-16：场景脚本写入的文案与枚举值按当前语言提供
    viewer = initTankViewer({
        labels: {
            loading: t('armor.loading'),
            loadFailed: (phase, msg) => t('armor.load_failed', { phase, msg }),
            tier: (tier) => `${t('armor.tier')} ${tier}`,
            type: (value) => replayValueLabel(t, te, value),
            nation: (value) => replayValueLabel(t, te, value),
            showCollision: t('armor.show_collision'),
            hideCollision: t('armor.hide_collision'),
            heatmap: t('armor.heatmap'),
            hideHeatmap: t('armor.hide_heatmap'),
            evidence: t('armor.evidence'),
            technicalEvidence: t('armor.technical_evidence'),
            allTiers: t('armor.all_tiers'),
            allNations: t('armor.all_nations'),
            allTypes: t('armor.all_types'),
            hideEvidence: t('armor.hide_evidence'),
            shotView: t('armor.shot_view'),
            relativeView: t('armor.relative_view'),
            worldView: t('armor.world_view'),
            selectShooter: t('armor.select_shooter'),
            selectTarget: t('armor.select_target'),
            partName: (name) => armorPartLabel(name, t),
            resultName: (result) => armorResultLabel(result, t),
            prediction: t('armor.prediction'),
            recordedResult: t('armor.recorded_result'),
            resultAgrees: t('armor.result_agrees'),
            resultDiffers: t('armor.result_differs'),
            shotDamage: t('armor.shot_damage'),
            shotRicochetSeg: t('armor.shot_ricochet_seg'),
            shotLoss: t('armor.shot_loss'),
            shotNominal: t('armor.shot_nominal'),
            shotBlocked: t('armor.shot_blocked'),
            phase: (phase) => (PHASE_KEY[phase] ? t(`armor.phase_${PHASE_KEY[phase]}`) : phase),
        },
        onLoadState: (next) => { if (alive && seq === navigationSeq) onLoadState(next) },
    })
}

async function retry() {
    if (!alive) return
    load.value = { state: 'loading', progress: null, message: '' }
    if (viewer?.retry?.()) return
    const seq = ++navigationSeq
    requestSeq++
    navigating.value = false
    // 名册都没拿到（或渲染器创建失败）：销毁后重建整个场景
    viewer?.destroy?.()
    viewer = null
    attempt.value += 1
    await nextTick()
    if (alive && seq === navigationSeq && webgl.supported) startViewer()
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
    requestSeq++
    viewer?.destroy?.()
    viewer = null
    toolsOpen.value = false
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
<div class="armor-view" :class="{ 'is-unsupported': !webgl.supported, 'has-back': canGoBack && !isShotPage, 'is-shot': isShotPage, 'is-clean': cleanQuery }">
    <button v-if="canGoBack && !isShotPage" type="button" class="armor-back" data-testid="armor-back" :aria-label="$t('armor.back')" @click="router.back()"><ArrowLeft :size="16" aria-hidden="true" /><span class="armor-back-label">{{ $t('armor.back') }}</span></button>
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
            <!-- 手机顶栏的「参数」开关：展开 / 收起装备、射击方、目标、配置（桌面端 CSS 隐藏，面板常驻） -->
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
            <div id="tank-selectors"><h2 class="armor-panel-title">{{ $t('armor.setup') }}</h2><p v-if="isShotPage" class="armor-setup-note">{{ $t('armor.recording_vs_preview') }}</p>
                <div class="sel-row" id="config-row" style="display:none;"><label id="config-label" for="config-select">{{ $t('armor.config') }}</label><select id="config-select"></select></div>
                <div class="sel-row">
                    <label>{{ $t('armor.equip') }}</label>
                    <label class="eq-opt"><input type="checkbox" id="eq-calibrated"> <span class="eq-opt-label">{{ $t('armor.calibrated') }}</span></label>
                    <label class="eq-opt"><input type="checkbox" id="eq-enhanced"> <span class="eq-opt-label">{{ $t('armor.enhanced') }}</span></label>
                </div>
                <div class="sel-row"><label id="shooter-label">{{ $t('armor.shooter') }}</label><button class="tank-btn" id="shooter-select">—</button></div>
                <div class="sel-row"><label id="target-label">{{ $t('armor.target') }}</label><button class="tank-btn" id="target-select">—</button></div>
            </div>
        </div>
        <div id="tank-picker" role="dialog" aria-modal="true" aria-labelledby="tp-title">
            <div id="tp-header">
                <span id="tp-title">{{ $t('armor.select_tank') }}</span>
                <input type="text" id="tp-search" :placeholder="$t('armor.search')" :aria-label="$t('armor.search')">
                <select id="tp-tier" :aria-label="$t('armor.tier')"></select>
                <select id="tp-nation" :aria-label="$t('armor.nation')"></select>
                <select id="tp-type" :aria-label="$t('armor.type')"></select>
                <span id="tp-count"></span>
                <button id="tp-close" :title="$t('armor.close')" :aria-label="$t('armor.close')"><X :size="20" aria-hidden="true" /></button>
            </div>
            <div id="tp-grid"></div>
        </div>
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
            <div id="shell-selector" style="display:none;">
                <label for="shell-select">{{ $t('armor.shell') }} </label>
                <select id="shell-select"></select>
            </div>
            <div id="view-toggle">
                <button id="collision-btn" type="button" aria-pressed="false">{{ $t('armor.show_collision') }}</button>
                <button id="penetration-btn" type="button" aria-pressed="false">{{ $t('armor.heatmap') }}</button>
            </div>
        </div>
        <div id="corner-br">
            <div v-if="!isShotPage" id="controls-hint">{{ hint }}</div>
        </div>
        </div>
        <div id="traj-info" style="display:none;"></div>
        <div id="turret-controls">
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
    inline-size: 100%; block-size: calc(100dvh - var(--header-h) - var(--tabbar-h)); min-block-size: 420px;
    margin: 0; padding: 0; overflow: hidden; background: var(--bg); color: var(--txt); font: var(--type-body);
}
.armor-view .armor-stage { position: relative; flex: 1; min-block-size: 0; inline-size: 100%; }
.armor-view.is-unsupported { block-size: auto; min-block-size: 0; overflow: visible; background: transparent; }
.armor-view.is-unsupported .armor-back { position: static; margin: var(--space-4) var(--gutter) 0; }
.armor-view #canvas-container { inline-size: 100%; block-size: 100%; }
.armor-view :is(button, select, input) { font: inherit; }
.armor-view :is(button, select) { min-block-size: 44px; }
.armor-view :is(button, summary, select, input):focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.armor-view button { cursor: pointer; }
.armor-view button:disabled { cursor: default; opacity: .45; }
.armor-view :is(#corner-tl, #corner-tr, #corner-br) { position: absolute; display: flex; gap: var(--space-3); }
.armor-view #corner-tl { inset-block-start: var(--space-5); inset-inline-start: var(--space-5); align-items: flex-start; }
.armor-view.has-back #corner-tl { inset-block-start: calc(var(--space-5) + 44px + var(--space-2)); }
.armor-view :is(#info-panel, #tank-selectors, #shell-selector, #view-toggle, #turret-controls, #debug-info, #click-info) {
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--elevation-2);
}
.armor-view #info-panel { padding: var(--space-4); max-inline-size: 20rem; max-block-size: 46dvh; overflow: auto; overflow-wrap: anywhere; }
.armor-view #info-panel h1 { margin: 0 0 var(--space-2); font: var(--type-h3); color: var(--txt); }
.armor-view #info-panel .stat { display: flex; justify-content: space-between; gap: var(--space-3); font: var(--type-caption); }
.armor-view #info-panel .label { color: var(--muted); }
.armor-view #info-panel .value { font-weight: 600; }
.armor-view .armor-setup-note { margin: 0 0 var(--space-3); color: var(--muted); font: var(--type-caption); }
.armor-view .armor-panel-title { margin: 0 0 var(--space-2); color: var(--muted); font: var(--type-caption); }
.armor-view #tank-selectors { padding: var(--space-3); inline-size: 17rem; max-block-size: 54dvh; overflow-y: auto; z-index: var(--pb-z-hud); }
.armor-view #tank-selectors .sel-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-1) 0; }
.armor-view #tank-selectors label { color: var(--muted); font: var(--type-caption); }
.armor-view #tank-selectors .sel-row > label:first-child { flex: 0 0 100%; }
.armor-view #tank-selectors .eq-opt { display: inline-flex; flex: 1; align-items: center; gap: var(--space-1); min-block-size: 44px; cursor: pointer; }
.armor-view input[type="checkbox"] { flex: none; min-inline-size: 0; inline-size: var(--control-check); block-size: var(--control-check); margin: 0; accent-color: var(--color-accent); }
.armor-view #tank-selectors :is(.tank-btn, select) { inline-size: 100%; min-inline-size: 0; padding: var(--space-2) var(--space-3); background: var(--input-bg); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--txt); }
.armor-view #tank-selectors .tank-btn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: start; }
.armor-view #tank-selectors .tank-btn:hover { border-color: var(--accent); background: var(--input-bg-hover); }
.armor-view #shooter-label { color: var(--color-accent-text); }
.armor-view #target-label { color: var(--color-info); }
.armor-view #corner-tr { inset-block-start: var(--space-5); inset-inline-end: var(--space-5); flex-direction: column; align-items: flex-end; max-inline-size: 42%; }
.armor-view #shell-selector { padding: var(--space-2) var(--space-3); max-inline-size: 100%; }
.armor-view #shell-selector label { color: var(--muted); font: var(--type-caption); }
.armor-view #shell-selector select { max-inline-size: 100%; min-inline-size: 0; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--input-bg); color: var(--txt); }
.armor-view #view-toggle { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-2); }
.armor-view :is(#view-toggle button, .armor-scene-button) { padding: var(--space-2) var(--space-3); background: var(--input-bg); color: var(--txt); border: 1px solid var(--border); border-radius: var(--radius-md); font: var(--type-caption); }
.armor-view #view-toggle button:hover { border-color: var(--accent); }
.armor-view :is(#view-toggle button.active, .armor-scene-button[aria-pressed="true"]) { background: var(--color-accent); color: var(--color-on-accent); border-color: transparent; }
.armor-view #corner-br { inset-block-end: var(--space-5); inset-inline-end: var(--space-5); align-items: flex-end; flex-direction: column; max-inline-size: 38%; }
.armor-view #controls-hint { font: var(--type-caption); color: var(--color-playback-label-text); text-shadow: var(--text-shadow-playback-label); }
.armor-view #turret-controls { position: absolute; inset-block-end: var(--space-5); inset-inline-start: var(--space-5); display: none; padding: var(--space-3) var(--space-4); min-inline-size: 16rem; max-inline-size: min(32rem, 44%); max-block-size: 40dvh; overflow-y: auto; overflow-wrap: anywhere; }
.armor-view .ctrl-row { display: flex; align-items: flex-start; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-1) 0; font: var(--type-caption); }
.armor-view .ctrl-row > * { min-inline-size: 0; }
.armor-view .ctrl-row label { color: var(--muted); }
.armor-view .ctrl-row span { color: var(--accent); }
.armor-view .armor-evidence summary { display: list-item; min-block-size: 44px; padding: var(--space-3) 0; cursor: pointer; color: var(--color-text-primary); font: var(--type-body); }
.armor-view #debug-info { display: none; padding: var(--space-3); max-inline-size: 24rem; max-block-size: 32dvh; overflow: auto; font: var(--type-caption); }
.armor-view #debug-info h4 { margin: 0 0 var(--space-2); font: var(--type-caption); }
.armor-view .dbg-row { display: flex; align-items: flex-start; gap: var(--space-1); margin: var(--space-1) 0; overflow-wrap: anywhere; }
.armor-view .dbg-dot { flex: none; inline-size: var(--space-2); block-size: var(--space-2); border-radius: var(--radius-full); margin-block-start: var(--space-1); }
.armor-view .dbg-name { flex: none; color: var(--muted); }
.armor-view .dbg-val { min-inline-size: 0; }
.armor-view #click-info { position: absolute; display: none; padding: var(--space-3) var(--space-4); min-inline-size: 13rem; pointer-events: none; z-index: var(--pb-z-modal); }
.armor-view #click-info h3 { margin: 0 0 var(--space-2); font: var(--type-h3); }
.armor-view #click-info .row { display: flex; justify-content: space-between; gap: var(--space-3); font: var(--type-caption); }
.armor-view #click-info .pen { color: var(--green); }
.armor-view #click-info .bounce { color: var(--red); }
.armor-view #click-info .ricochet { color: var(--orange); }
.armor-view #traj-info { position: fixed; z-index: var(--z-header); pointer-events: none; }
.armor-view .armor-back { position: absolute; z-index: calc(var(--z-sticky) + 1); inset-block-start: var(--space-5); inset-inline-start: var(--space-5); display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--panel); color: var(--txt); }
.armor-view .armor-tools { display: none; }
.armor-view .armor-bottom-controls { display: contents; }
/* Recorded-shot actions are a persistent, high-contrast toolbar. */
.armor-view.is-shot #corner-br { display: flex; flex-direction: row; flex-wrap: wrap; align-items: stretch; gap: var(--space-2); max-inline-size: calc(100% - var(--space-10)); padding: var(--space-2); background: var(--color-surface-1); border: 1px solid var(--color-border-strong); border-radius: var(--radius-lg); box-shadow: var(--elevation-2); z-index: var(--pb-z-hud); }
.armor-view .armor-shot-view-switch { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-1); background: var(--color-surface-2); border-radius: var(--radius-md); }
.armor-view .armor-shot-view-switch .armor-scene-button { flex: 1; min-block-size: var(--space-12); padding: var(--space-2) var(--space-4); font: var(--type-body); font-weight: 600; }
.armor-view #debug-toggle { min-block-size: var(--space-12); padding: var(--space-2) var(--space-4); border-color: var(--color-accent); color: var(--color-accent-text); font: var(--type-body); font-weight: 600; }
.armor-view #debug-toggle[aria-pressed="true"] { color: var(--color-on-accent); }

.armor-view #tank-picker { position: absolute; inset: var(--space-5); margin: auto; max-inline-size: var(--layout-wide-max); background: var(--panel); border: 1px solid var(--border-hi); border-radius: var(--radius-lg); z-index: var(--z-dialog); display: none; flex-direction: column; box-shadow: var(--elevation-3); }
.armor-view #tank-picker.open { display: flex; }
.armor-view #tp-header { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-3); border-block-end: 1px solid var(--border); }
.armor-view #tp-title { font: var(--type-h3); }
.armor-view #tp-search { flex: 1; min-inline-size: var(--form-field-min); }
.armor-view #tp-header :is(input, select) { min-block-size: 44px; padding: var(--space-2); background: var(--input-bg); color: var(--txt); border: 1px solid var(--border); border-radius: var(--radius-md); }
.armor-view #tp-count { color: var(--muted); font: var(--type-caption); }
.armor-view #tp-close { display: inline-flex; align-items: center; justify-content: center; min-inline-size: 44px; background: transparent; border: none; color: var(--txt); }
.armor-view #tp-grid { flex: 1; min-block-size: 0; overflow-y: auto; padding: var(--space-3); display: grid; grid-template-columns: repeat(auto-fill, minmax(min(10rem, 100%), 1fr)); gap: var(--space-3); align-content: start; }
.armor-view .tank-card { padding: 0; min-inline-size: 0; overflow: hidden; background: var(--color-surface-2); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--txt); text-align: start; }
.armor-view .tank-card:hover, .armor-view .tank-card.sel { border-color: var(--accent); }
.armor-view .tank-card .tc-img { inline-size: 100%; block-size: 8rem; object-fit: contain; display: block; padding: var(--space-1); }
.armor-view .tank-card .tc-body { padding: var(--space-2); }
.armor-view .tank-card .tc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--type-body); }
.armor-view .tank-card .tc-meta { display: flex; justify-content: space-between; gap: var(--space-1); margin-block-start: var(--space-1); font: var(--type-caption); color: var(--muted); }
.armor-view .tank-card .tc-tier { color: var(--color-accent-text); }
.armor-view .armor-shot-header { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-3) var(--space-5); border-block-end: 1px solid var(--border); background: var(--color-surface-1); z-index: calc(var(--z-sticky) + 1); }
.armor-view .armor-shot-header button { display: inline-flex; flex: none; align-items: center; justify-content: center; gap: var(--space-2); min-inline-size: 44px; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--input-bg); color: var(--txt); }
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
@media (width >= 768px) {
    .armor-view.is-shot #corner-tl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); max-inline-size: min(var(--column-panel-width), 52%); }
    .armor-view.is-shot .armor-tools { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--panel); color: var(--txt); }
    .armor-view.is-shot .armor-tools[aria-expanded="true"] { border-color: var(--accent); color: var(--accent); }
    .armor-view.is-shot #tank-selectors { display: none; position: absolute; inset-block-start: calc(100% + var(--space-2)); inset-inline-start: 0; inline-size: 100%; max-block-size: 52dvh; }
    .armor-view.is-shot .armor-stage.is-tools-open #tank-selectors { display: block; }
}
@media (768px <= width < 1200px) {
    .armor-view #corner-tl { flex-direction: column; gap: var(--space-2); }
    .armor-view #info-panel { inline-size: 17rem; padding: var(--space-3); }
    .armor-view #tank-selectors { max-block-size: 38dvh; }
}
@media (width < 768px) {
    .armor-view .armor-interaction-help { flex-direction: column; align-items: stretch; gap: var(--space-2); padding: var(--space-2) var(--space-3); }
    .armor-view .armor-interaction-help h2 { font: var(--type-caption); font-weight: 600; }
    .armor-view .armor-interaction-help dl { gap: var(--space-2); }

    .armor-view #corner-tl { inset-block-start: var(--space-2); inset-inline: var(--space-2); display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--space-1) var(--space-2); padding: var(--space-1) var(--space-2); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--elevation-2); z-index: var(--pb-z-modal); }
    .armor-view.has-back #corner-tl { inset-block-start: var(--space-2); inset-inline-start: calc(var(--space-2) * 2 + 44px); }
    .armor-view #info-panel { grid-column: 1; grid-row: 1; min-inline-size: 0; max-inline-size: none; max-block-size: none; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0; background: none; border: none; box-shadow: none; }
    .armor-view #info-panel h1 { display: inline-block; max-inline-size: 52%; vertical-align: bottom; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--type-body); margin: 0 var(--space-2) 0 0; }
    .armor-view #info-panel .stat { display: inline-flex; gap: var(--space-1); vertical-align: bottom; }
    .armor-view #info-panel .stat + .stat::before { content: '·'; color: var(--muted); }
    .armor-view #info-panel .label { display: none; }
    .armor-view #tank-selectors { grid-column: 1 / -1; grid-row: 2; display: none; inline-size: auto; margin-block-start: var(--space-1); padding: var(--space-2) 0; border: none; border-block-start: 1px solid var(--border); border-radius: 0; background: none; box-shadow: none; max-block-size: calc((100dvh - var(--header-h) - var(--tabbar-h)) * .46); }
    .armor-view #tank-selectors .armor-panel-title { display: none; }
    .armor-view #tank-selectors .sel-row { flex-wrap: nowrap; }
    .armor-view #tank-selectors .sel-row > label:first-child { flex: 0 0 var(--space-12); }
    .armor-view .armor-stage.is-tools-open #tank-selectors { display: block; }
    .armor-view .armor-tools { grid-column: 2; grid-row: 1; display: inline-flex; align-items: center; justify-content: center; inline-size: 44px; block-size: 44px; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--input-bg); color: var(--txt); }
    .armor-view .armor-tools-label { display: none; }
    .armor-view .armor-tools[aria-expanded="true"] { border-color: var(--accent); color: var(--accent); }
    .armor-view #corner-tr { inset-block-start: auto; inset-block-end: var(--space-2); inset-inline: var(--space-2); max-inline-size: none; flex-direction: row; flex-wrap: wrap; align-items: stretch; gap: var(--space-2); }
    .armor-view #shell-selector { flex: none; padding: var(--space-1) var(--space-2); }
    .armor-view #view-toggle { flex: 1 1 11rem; min-inline-size: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1); padding: var(--space-1) var(--space-2); }
    .armor-view #view-toggle button { padding: var(--space-1); white-space: normal; }
    .armor-view #turret-controls { inset-block-start: calc(var(--space-2) * 2 + 48px); inset-block-end: auto; inset-inline-start: var(--space-2); min-inline-size: 0; max-inline-size: calc(100% - var(--space-4)); padding: var(--space-1) var(--space-3); max-block-size: 28dvh; }
    .armor-view #turret-controls .ctrl-row { display: inline-flex; margin: 0 var(--space-3) 0 0; }
    .armor-view #corner-br { display: none; }
    .armor-view.is-shot .armor-bottom-controls { position: absolute; inset-block-end: var(--space-2); inset-inline: var(--space-2); display: flex; flex-direction: column; gap: var(--space-2); pointer-events: none; z-index: var(--pb-z-hud); }
    .armor-view.is-shot .armor-bottom-controls :is(#corner-tr, #corner-br) { position: static; max-inline-size: none; pointer-events: auto; }
    .armor-view.is-shot .armor-shot-view-switch { flex: 1 1 100%; }
    .armor-view.is-shot #debug-toggle { flex: 1; }
    .armor-view.is-shot #corner-tr { display: none; }
    .armor-view.is-shot .armor-stage.is-tools-open #corner-tr { display: flex; z-index: var(--pb-z-hud); }
    .armor-view.is-shot #debug-info { max-block-size: 20dvh; }
    .armor-view.is-clean #corner-tl { display: none; }
    .armor-view .armor-back { inset-block-start: var(--space-2); inset-inline-start: var(--space-2); inline-size: 44px; padding: 0; justify-content: center; }
    .armor-view .armor-back-label { display: none; }
    .armor-view #tank-picker { inset: 0; max-inline-size: none; border-radius: 0; }
    .armor-view #tp-header { gap: var(--space-2); padding: var(--space-2); }
    .armor-view #tp-title { order: 1; flex: 1 1 auto; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .armor-view #tp-count { order: 2; flex: none; }
    .armor-view #tp-close { order: 3; flex: none; inline-size: 44px; }
    .armor-view #tp-search { order: 4; flex: 1 1 100%; min-inline-size: 0; }
    .armor-view #tp-header select { order: 5; flex: 1 1 28%; min-inline-size: 0; }
    .armor-view #tp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: var(--space-2); gap: var(--space-2); }
    .armor-view .tank-card .tc-img { block-size: 6rem; }
    .armor-view .armor-shot-header { flex-wrap: wrap; gap: var(--space-2); padding: var(--space-2); }
    .armor-view .armor-shot-back span { display: none; }
    .armor-view .armor-shot-context { flex-basis: calc(100% - 60px); }
    .armor-view .armor-shot-matchup { font: var(--type-body); }
    .armor-view .armor-shot-meta { gap: var(--space-2); }
    .armor-view .armor-shot-navigation { inline-size: 100%; justify-content: space-between; }
}
</style>
