<script setup>
/**
 * Agent 3D 装甲查看器（?view=agent-armor）：tankViewer.js 场景内核宿主。
 * DOM/CSS 自上游 ArmorView.vue 原样平移（tankViewer 按 ID 查找，勿改 ID）。
 * 数据面：tank/{id}.json + glb/{id}/*.glb 静态资产（agentData.js，?assets= 基址），
 * 击穿判定 penetration.js 客户端移植；射击复现数据经 sessionStorage 交接（AgentShots）。
 * URL 参数保持上游契约：?tank= &shooter= &config= &shell= &shot= &heatmap=1 &world=1 等。
 */
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import { initTankViewer } from '../scene/tankViewer.js'
import { detectWebGL } from '../scene/webglSupport.js'
import { replayValueLabel } from '../utils/display.js'
import { usePointer } from '../composables/useBreakpoint.js'
import Scene3DStatus from './Scene3DStatus.vue'

const { t, te } = useI18n()
const router = useRouter()
const { coarse } = usePointer()
// 审计 3D-09：从射击分析 / 坦克百科在当前标签页打开，返回走浏览器历史
const canGoBack = typeof window !== 'undefined' && !!window.history.state?.back
const hint = computed(() => t(coarse.value ? 'armor.hint_touch' : 'armor.hint'))

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
            worldHint: t('armor.world_hint'),
            phase: (phase) => (PHASE_KEY[phase] ? t(`armor.phase_${PHASE_KEY[phase]}`) : phase),
        },
        onLoadState,
    })
}

async function retry() {
    load.value = { state: 'loading', progress: null, message: '' }
    if (viewer?.retry?.()) return
    // 名册都没拿到（或渲染器创建失败）：销毁后重建整个场景
    viewer?.destroy?.()
    viewer = null
    attempt.value += 1
    await nextTick()
    startViewer()
}

onMounted(() => {
    if (webgl.supported) startViewer()
})

// 离开路由必须销毁：rAF 循环 + WebGL 上下文不释放，反复进出会耗尽浏览器
// WebGL 上下文上限（~16 个）出现 "context lost" 黑屏
onBeforeUnmount(() => {
    if (viewer?.destroy) viewer.destroy()
    viewer = null
})
</script>

<template>
<div class="armor-view" :class="{ 'is-unsupported': !webgl.supported }">
    <button v-if="canGoBack" type="button" class="armor-back" data-testid="armor-back" @click="router.back()"><ArrowLeft :size="16" aria-hidden="true" /> {{ $t('armor.back') }}</button>
    <Scene3DStatus v-if="!webgl.supported" mode="unsupported" :webgl-status="webgl.status" />
    <!-- 3D 装甲检视器 DOM：自上游 ArmorView.vue 原样平移（JS 按 ID 查找） -->
    <div v-else :key="attempt" class="armor-stage" data-testid="armor-stage">
        <!-- 旧的单行文字加载提示由 Scene3DStatus 取代；节点保留给场景脚本写入（不可见） -->
        <div class="armor-legacy-loading" hidden><div id="loading">{{ $t('armor.loading') }}</div></div>
        <div id="canvas-container"></div>
        <div id="corner-tl">
            <div id="info-panel" style="display:none;">
                <h1 id="tank-name">Loading...</h1>
                <div class="stat"><span class="label">{{ $t('armor.tier') }}</span><span class="value" id="tank-tier"></span></div>
                <div class="stat"><span class="label">{{ $t('armor.type') }}</span><span class="value" id="tank-type"></span></div>
                <div class="stat"><span class="label">{{ $t('armor.nation') }}</span><span class="value" id="tank-nation"></span></div>
            </div>
            <div id="tank-selectors">
                <div class="sel-row" id="config-row" style="display:none;"><label id="config-label">{{ $t('armor.config') }}</label><select id="config-select"></select></div>
                <div class="sel-row">
                    <label>{{ $t('armor.equip') }}</label>
                    <label style="width:auto;display:flex;align-items:center;gap:3px;cursor:pointer;font-size:0.78em;"><input type="checkbox" id="eq-calibrated"> {{ $t('armor.calibrated') }}</label>
                    <label style="width:auto;display:flex;align-items:center;gap:3px;cursor:pointer;font-size:0.78em;"><input type="checkbox" id="eq-enhanced"> {{ $t('armor.enhanced') }}</label>
                </div>
                <div class="sel-row"><label id="shooter-label">{{ $t('armor.shooter') }}</label><button class="tank-btn" id="shooter-select">—</button></div>
                <div class="sel-row"><label id="target-label">{{ $t('armor.target') }}</label><button class="tank-btn" id="target-select">—</button></div>
            </div>
        </div>
        <div id="corner-tr">
            <div id="shell-selector" style="display:none;">
                <label style="font-size:0.85em;">{{ $t('armor.shell') }} </label>
                <select id="shell-select"></select>
            </div>
            <div id="view-toggle">
                <button id="collision-btn">{{ $t('armor.show_collision') }}</button>
                <button id="penetration-btn">{{ $t('armor.heatmap') }}</button>
                <!-- 审计 3D-14：没有右键的设备（触屏）用开关切到瞄准模式 -->
                <button id="aim-btn" type="button" aria-pressed="false" :title="$t('armor.aim_hint')">{{ $t('armor.aim') }}</button>
            </div>
        </div>
        <div id="tank-picker">
            <div id="tp-header">
                <span id="tp-title">{{ $t('armor.select_tank') }}</span>
                <input type="text" id="tp-search" :placeholder="$t('armor.search')" :aria-label="$t('armor.search')">
                <select id="tp-tier"></select>
                <select id="tp-nation"></select>
                <select id="tp-type"></select>
                <span id="tp-count"></span>
                <button id="tp-close" :title="$t('armor.close')" :aria-label="$t('armor.close')">×</button>
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
        <div id="corner-br">
            <div id="controls-hint">{{ hint }}</div>
        </div>
        <div id="traj-info" style="display:none;position:fixed;z-index:200;pointer-events:none;"></div>
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

<!-- 样式自上游 ArmorView.vue 平移：整体挂在 .armor-view 命名空间下（.tank-card 与其他页冲突），
     fixed 定位改 absolute（根容器铺满 main 视口区） -->
<style>
.armor-view {
            --bg:#120f0e; --panel:rgba(27,24,23,0.92); --panel2:rgba(35,31,29,0.92);
            --border:rgba(255,255,255,0.12); --border-hi:rgba(255,138,61,0.45);
            --accent:#ff8a3d; --accent-2:#ffb35c; --accent-3:#ffd29b;
            --green:#5fbf7a; --orange:#ff9800; --red:#ff6b6b; --blue:#5fa8e8; --yellow:#ffcf5c;
            --txt:#f3ede6; --muted:#9c8f7f; --shadow:0 10px 34px rgba(0,0,0,0.5);
            --radius:14px; --radius-sm:9px;
            /* 此前绕过 token 直接写死的颜色（表单底/hover/缩略图底板/卡片渐变…）——
               收进 token 才能被浅色档统一覆盖 */
            --input-bg:#2c2724; --input-bg-hover:#35302c;
            --plate-a:#211b17; --plate-b:#171310;
            --card-a:#251f1c; --card-b:#1b1715;
            --on-accent:#1a1208; --hover-strong:#fff;
            --picker-shadow:0 16px 70px rgba(0,0,0,0.7);
            --tooltip-bg:rgba(12,14,22,0.97);
            --scrub:#cc66ff;
            --sel-ring:rgba(255,138,61,0.4);
        }
    /* 浅色档（classic）：3D 视口本体保留游戏视觉（#canvas-container 的暗色渐变不动），
       其上的面板/HUD 落浅色——与 classic-profile.css 对 Reconstruction/战术地图
       「外围面板落浅色、地图本体保留游戏视觉」的既有约定一致。
       深色档取值与上方逐字相同，故 showcase（默认档）零视觉变化。 */
    html[data-ui-profile="classic"] .armor-view {
            --bg:#f4f5f2; --panel:rgba(255,255,255,0.94); --panel2:rgba(255,255,255,0.96);
            --border:#d9dde3; --border-hi:rgba(201,118,46,0.45);
            --accent:#c9762e; --accent-2:#a95c1c; --accent-3:#8a4a12;
            --green:#1f7a33; --orange:#9a6000; --red:#a3232e; --blue:#1f5566; --yellow:#8a6d1f;
            --txt:#2a2f28; --muted:#5c665a; --shadow:0 8px 24px rgba(0,0,0,0.08);
            --input-bg:#fff; --input-bg-hover:#f2f3f0;
            --plate-a:#fbfbfa; --plate-b:#eef0ec;
            --card-a:#fff; --card-b:#f4f5f2;
            --on-accent:#fff; --hover-strong:#11140f;
            --picker-shadow:0 16px 70px rgba(0,0,0,0.18);
            --tooltip-bg:rgba(255,255,255,0.97);
            --scrub:#6d28d9;
            --sel-ring:rgba(201,118,46,0.4);
        }
    .armor-view { margin: 0; padding: 0; background: var(--bg); color: var(--txt); font-family: system-ui, sans-serif; overflow: hidden; position: relative; width: 100%; height: calc(100dvh - var(--header-h) - var(--tabbar-h)); min-height: 420px; }
    /* 场景舞台：整体重试时按 key 重建；铺满根容器，四角面板仍以它为定位参照 */
    .armor-view .armor-stage { position: absolute; inset: 0; }
    .armor-view.is-unsupported { height: auto; min-height: 0; overflow: visible; background: transparent; }
    .armor-view.is-unsupported .armor-back { position: static; transform: none; margin: var(--space-4) var(--gutter) 0; }
    .armor-view #canvas-container { width: 100%; height: 100%; background: radial-gradient(1100px 600px at 30% -10%, #3a2412 0%, transparent 60%), radial-gradient(1000px 600px at 90% 0%, #2f1a0c 0%, transparent 55%); }
    .armor-view #corner-tl {
            position: absolute; top: 20px; left: 20px;
            display: flex; gap: 20px; align-items: flex-start;
        }
    .armor-view #info-panel {
            background: var(--panel); padding: 20px; border-radius: var(--radius);
            max-width: 350px; backdrop-filter: blur(12px);
            border: 1px solid var(--border); box-shadow: var(--shadow);
            max-height: min(58vh, 460px); overflow-y: auto; overflow-wrap: anywhere;
        }
    .armor-view #info-panel h1 { font-size: 1.5em; margin: 0 0 10px 0; color: var(--accent-3); }
    .armor-view #info-panel .stat { display: flex; justify-content: space-between; margin: 4px 0; }
    .armor-view #info-panel .label { color: var(--muted); }
    .armor-view #info-panel .value { font-weight: bold; }
                                                    .armor-view #loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 1.2em; color: var(--accent-3); }
    .armor-view #corner-br {
            position: absolute; bottom: 20px; right: 20px;
            display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
        }
    .armor-view #controls-hint { font-size: 0.8em; color: var(--muted); }
    .armor-view #debug-info {
            background: var(--panel); padding: 10px 14px; border-radius: var(--radius-sm);
            backdrop-filter: blur(12px); border: 1px solid var(--border); box-shadow: var(--shadow);
            display: none; min-width: 230px; max-width: 380px; max-height: 46vh; overflow-y: auto;
            font-family: Consolas, monospace; font-size: 11px;
        }
    .armor-view #debug-info h4 { margin: 0 0 6px 0; font-size: 11px; font-weight: bold; color: var(--accent-2); font-family: system-ui, sans-serif; }
    /* 调试值此前 nowrap + max-width 380px 且只设 overflow-y → 长值被裁且无法滚动查看。
       改为标签不换行、值可换行（长坐标/哈希也不会溢出）。 */
    .armor-view #debug-info .dbg-row { display: flex; align-items: flex-start; gap: 6px; margin: 3px 0; white-space: normal; overflow-wrap: anywhere; }
    .armor-view #debug-info .dbg-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; }
    .armor-view #debug-info .dbg-name { color: var(--muted); flex: none; white-space: nowrap; }
    .armor-view #debug-info .dbg-val { color: var(--txt); min-width: 0; }
    .armor-view #turret-controls {
            position: absolute; bottom: 20px; left: 20px;
            background: var(--panel); padding: 12px 16px; border-radius: var(--radius);
            backdrop-filter: blur(12px); border: 1px solid var(--border); box-shadow: var(--shadow);
            display: none; min-width: 280px; max-width: min(520px, 44vw);
            /* 此前既无换行也无 max-height：长行（弹种/质量标记/图例）溢出面板，
               面板高于视口时被根容器 overflow:hidden 裁掉且无法滚动查看 */
            max-height: min(58vh, 460px); overflow-y: auto; overflow-wrap: anywhere;
        }
    .armor-view .ctrl-row { display: flex; align-items: flex-start; gap: 8px; margin: 4px 0; font-size: 0.85em; flex-wrap: wrap; }
    .armor-view .ctrl-row > * { min-width: 0; }
    .armor-view .ctrl-row label { width: 50px; flex: none; color: var(--muted); }
    .armor-view .ctrl-row span { color: var(--accent); font-weight: bold; }
    .armor-view #click-info {
            position: absolute;
            background: var(--panel); padding: 12px 16px; border-radius: var(--radius-sm);
            backdrop-filter: blur(12px); border: 1px solid var(--border-hi); box-shadow: var(--shadow);
            display: none; min-width: 200px; pointer-events: none; z-index: 100;
        }
    .armor-view #click-info h3 { margin: 0 0 8px 0; font-size: 1em; color: var(--accent-3); }
    .armor-view #click-info .row { display: flex; justify-content: space-between; margin: 3px 0; font-size: 0.9em; }
    .armor-view #click-info .pen { color: var(--green); font-weight: bold; }
    .armor-view #click-info .bounce { color: var(--red); font-weight: bold; }
    .armor-view #click-info .ricochet { color: var(--orange); font-weight: bold; }
    .armor-view #corner-tr {
            position: absolute; top: 20px; right: 20px;
            display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
        }
    .armor-view #shell-selector {
            background: var(--panel); padding: 10px 15px; border-radius: var(--radius-sm);
            backdrop-filter: blur(12px); border: 1px solid var(--border); box-shadow: var(--shadow);
        }
    .armor-view #shell-selector select { background: var(--input-bg); color: var(--txt); border: 1px solid var(--border-hi); border-radius: var(--radius-sm); padding: 4px 9px; }
    .armor-view #tank-selectors {
            background: var(--panel); padding: 12px 16px; border-radius: var(--radius);
            backdrop-filter: blur(12px); border: 1px solid var(--border); box-shadow: var(--shadow);
            z-index: 20; width: 270px;
        }
    .armor-view #tank-selectors .sel-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 0.85em; }
    .armor-view #tank-selectors label { width: 58px; color: var(--muted); font-size: 0.8em; }
    /* 全局 input{flex:1;min-width:120px} 会把复选框撑到 120px 导致 Equip 行溢出面板——恢复自然尺寸 */
    .armor-view input[type="checkbox"] { flex: none; min-width: 0; width: auto; margin: 0; }
    .armor-view #tank-selectors .tank-btn {
            background: var(--input-bg); color: var(--txt); border: 1px solid var(--border); border-radius: var(--radius-sm);
            padding: 5px 10px; max-width: 176px; cursor: pointer; font-size: 0.85em;
            text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: all .12s ease;
        }
    .armor-view #tank-selectors .tank-btn:hover { border-color: var(--accent); background: var(--input-bg-hover); }
    .armor-view #shooter-label { color: var(--accent-2); }
    .armor-view #target-label { color: var(--green); }
    .armor-view #tank-picker {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
            width: min(1060px, 94vw); height: min(700px, 88vh);
            background: var(--panel); border: 1px solid var(--border-hi);
            border-radius: var(--radius); z-index: 1000; display: none; flex-direction: column;
            box-shadow: var(--picker-shadow); backdrop-filter: blur(14px);
        }
    .armor-view #tank-picker.open { display: flex; }
    .armor-view #tp-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .armor-view #tp-title { font-size: 1em; font-weight: bold; color: var(--accent-3); }
    .armor-view #tp-search { flex: 1; min-width: 140px; background: var(--input-bg); color: var(--txt); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 5px 10px; font-size: 0.85em; }
    .armor-view #tp-header select { background: var(--input-bg); color: var(--txt); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 8px; font-size: 0.82em; }
    .armor-view #tp-count { color: var(--accent); font-size: 0.8em; }
    .armor-view #tp-close { background: none; border: none; color: var(--muted); font-size: 1.4em; cursor: pointer; line-height: 1; }
    .armor-view #tp-close:hover { color: var(--hover-strong); }
    .armor-view #tp-grid { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 12px; align-content: flex-start; }
    .armor-view .tank-card {
            flex: 0 0 196px; max-width: 196px;
            background: linear-gradient(180deg,var(--card-a),var(--card-b)); border: 1px solid var(--border); border-radius: var(--radius-sm);
            overflow: hidden; cursor: pointer; transition: transform 0.08s, border-color 0.08s, box-shadow 0.08s;
        }
    .armor-view .tank-card:hover { transform: translateY(-2px); border-color: var(--accent); box-shadow: var(--shadow); }
    .armor-view .tank-card.sel { border-color: var(--accent); box-shadow: 0 0 0 2px var(--sel-ring); }
    .armor-view .tank-card .tc-img { width: 100%; height: 132px; object-fit: contain; background: linear-gradient(180deg,var(--plate-a),var(--plate-b)); display: block; padding: 4px; }
    .armor-view .tank-card .tc-body { padding: 6px 8px; }
    .armor-view .tank-card .tc-name { font-size: 0.84em; color: var(--txt); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .armor-view .tank-card .tc-meta { display: flex; justify-content: space-between; align-items: center; gap: 4px; margin-top: 4px; font-size: 0.74em; }
    .armor-view .tank-card .tc-tier { color: var(--yellow); font-weight: bold; }
    .armor-view .tank-card .tc-type { color: var(--muted); }
    .armor-view .tank-card .tc-nation { color: var(--green); }
    .armor-view #view-toggle {
            background: var(--panel); padding: 8px 14px; border-radius: var(--radius-sm);
            backdrop-filter: blur(12px); border: 1px solid var(--border); box-shadow: var(--shadow);
            display: flex; gap: 8px; flex-wrap: wrap;
        }
    .armor-view #view-toggle button { background: var(--input-bg-hover); color: var(--txt); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 12px; cursor: pointer; font-size: 0.85em; transition: all .12s ease; }
    .armor-view #view-toggle button:hover { border-color: var(--accent); }
    .armor-view #view-toggle button.active { background: linear-gradient(135deg,var(--accent),var(--accent-2)); color: var(--on-accent); border-color: transparent; }
    /* 审计 3D-09：返回入口（从射击分析 / 坦克百科打开时） */
    .armor-view .armor-back {
            position: absolute; z-index: 30; top: 12px; left: 50%; transform: translateX(-50%);
            min-height: 36px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px;
            background: var(--panel); color: var(--txt); cursor: pointer; backdrop-filter: blur(12px);
        }
    .armor-view #view-toggle button#aim-btn.active { background: linear-gradient(135deg,var(--accent),var(--accent-2)); color: var(--on-accent); border-color: transparent; }
    /* 审计 3D-14：触屏控件放大到 44px 点击区域 */
    @media (pointer: coarse) {
        .armor-view #view-toggle button,
        .armor-view #tank-selectors .tank-btn,
        .armor-view #tp-close { min-height: 44px; }
    }
    /* 审计 3D-14：手机——四角面板改为上下两条可滚动的窄带，场景留在中间；选车弹窗全屏 */
    @media (width < 768px) {
        .armor-view #corner-tl { top: 56px; left: 8px; right: 8px; flex-direction: column; gap: 6px; max-height: 34%; overflow-y: auto; }
        .armor-view #info-panel { max-width: none; padding: 10px 12px; }
        .armor-view #info-panel h1 { font-size: 1.1em; margin-bottom: 4px; }
        .armor-view #tank-selectors { width: auto; padding: 8px 12px; }
        .armor-view #corner-tr { top: auto; bottom: 8px; right: 8px; left: 8px; align-items: stretch; }
        .armor-view #view-toggle { justify-content: center; }
        .armor-view #corner-br { display: none; }
        .armor-view #turret-controls { display: none !important; }
        .armor-view .armor-back { top: 8px; left: 8px; transform: none; }
        .armor-view #tank-picker { width: 100%; height: 100%; top: 0; left: 0; transform: none; border-radius: 0; }
        .armor-view .tank-card { flex: 1 1 140px; max-width: none; }
    }
</style>
