<script setup>
/**
 * Agent 三维回放页（场景内核版 / client-only）：本地 .wotbreplay → 浏览器 WASM
 * parsePlayback 解析（契约 v2 时序能力，文件不出本机）→ playbackScene 全场渲染。
 * 交互面板自上游 PlaybackView 完整平移（顶栏/名册/击杀流/控制条/画质档/相机/GLB/标签），
 * 标签文案三语（zh/en/ru）；拓扑（评审 P0-3）：无服务端通道——渲染资产经
 * ?assets= 资产平面（assetProvider）。
 * 播放传输控件与 2D 回放共用 PlaybackTransport + usePlaybackTransport：播放 / ±5s / 速度档位 /
 * 时钟（从 00:00 起算）/ 进度条，键盘空格 / ←→，拖动时暂停、松手若原先在播放则继续。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createPlaybackStore } from '../scene/playbackStore.js'
import { initPlayback, QUALITY_PRESETS } from '../scene/playbackScene.js'
import { loadPlaybackData } from '../scene/replaySource.js'
import { assetProvider } from '../scene/assetProvider.js'
import { detectWebGL } from '../scene/webglSupport.js'
import Scene3DStatus from './Scene3DStatus.vue'
import PlaybackTransport from './PlaybackTransport.vue'
import BaseStatusBar from './BaseStatusBar.vue'
import { mapLabel } from '../utils/helpers.js'
import { PLAYBACK_SPEEDS, PLAYBACK_STEP_SECONDS, usePlaybackTransport } from '../composables/usePlaybackTransport.js'

const { t, locale } = useI18n()

const store = createPlaybackStore()
const stage = ref(null)
/** 审计 3D-15：手机上两队名单默认收起（原来两块 240px 面板互相重叠、盖住场景），按需打开 */
const rosterOpen = ref(false)
let sceneApi = null
const transport = usePlaybackTransport({
  isPlaying: () => store.playing,
  play: () => sceneApi?.setPlaying(true),
  pause: () => sceneApi?.setPlaying(false),
  step: (delta) => sceneApi?.seekBy(delta),
  isReady: () => store.hasData,
})
// 审计 3D-23：渲染器创建前做 WebGL 预检；不支持时不初始化场景，整页换成说明
const webgl = detectWebGL()
/** 最近一次选择的文件：失败后"重试"直接重新解析，不必再选一次 */
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

// 顶栏双方总血量：数值用**完整整数**（§11 HUD 禁止 1k / 22.3k 缩写，与 2D HUD 同口径）；
// 色条宽度用原始百分比（不取整，血量缓慢下降时条仍平滑），title 上给取整百分比。
const hpText = (n) => String(Math.round(Math.max(0, Number(n) || 0)))
const hpPctText = (pct) => Math.round(Number(pct) || 0) + '%'

const CAMS = [
  { k: 'free', label: () => t('agentReplay.cam_free') },
  { k: 'top', label: () => t('agentReplay.cam_top') },
  { k: 'follow', label: () => t('agentReplay.cam_follow') },
]
const QUALITY_ORDER = Object.keys(QUALITY_PRESETS)
// 资产平面状态提示：回放解析不依赖资产；地图/地形/车模 GLB 需要 ?assets=
const assetsReady = assetProvider.configured()

async function loadFile(file) {
  if (!file || !sceneApi) return
  lastFile = file
  lastFileName.value = file.name || 'replay'
  store.loading = true
  try {
    await sceneApi.loadData({ kind: 'local', file })
  } catch (e) {
    store.err = String(e?.message || e).slice(0, 160)
  } finally {
    store.loading = false
  }
}

function onFilePicked(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  return loadFile(file)
}

function retryLoad() {
  if (lastFile) return loadFile(lastFile)
  store.err = ''
}


function bannerText() {
  const b = store.banner
  if (!b) return ''
  return b.outcome ? t('agentReplay.banner_' + b.outcome) : b.text
}
function killfeedText(kf) {
  // 结构化渲染（三语）：击杀 = killer × victim；环境/非击杀只标阵亡（cause 细节上游为中文后缀）
  return kf.kill
    ? `${kf.killer} ${t('agentReplay.destroyed')} ${kf.victim}`
    : `${kf.victim} ✝`
}

onMounted(() => {
  if (webgl.supported) sceneApi = initPlayback(stage.value, store)
})
onBeforeUnmount(() => {
  sceneApi?.destroy?.()
})
</script>

<template>
  <Scene3DStatus v-if="!webgl.supported" mode="unsupported" :webgl-status="webgl.status" />
  <div v-else class="pb-root" :class="{ 'roster-open': rosterOpen }">
    <div class="scene" ref="stage"></div>

    <!-- 顶部 HUD 栈：顶栏 + 基地状态条同列堆叠（不再各自写死 top 偏移——顶栏加了血量行，
         各自定位会在高度变化时互相压住） -->
    <div class="hud-top">
      <div v-if="store.hasData" class="topbar panel">
        <div class="tb-row">
          <span class="map">{{ mapTitle }}</span>
          <span class="timer">{{ store.timer }}</span>
        </div>
        <!-- 双方队伍总血量（与上游 3D 视图同布局：数值 + 色条夹住比分，己方在左、敌方在右；
             数值来自 teamHpTotals，按全队 max_hp 汇总，未知阵营不计入任一方） -->
        <div class="tb-row" data-test="hud-team-hp">
          <em class="hpnum hpnum-f">{{ hpText(store.hpFriend) }} / {{ hpText(store.hpFriendMax) }}</em>
          <span class="hpbar hp-f" :title="`${t('agentReplay.hp_friendly')} ${hpPctText(store.hpFriendPct)}`">
            <i :style="{ width: store.hpFriendPct + '%' }"></i>
          </span>
          <span class="score"><span class="t1">{{ store.score1 }}</span> : <span class="t2">{{ store.score2 }}</span></span>
          <span class="hpbar hp-e" :title="`${t('agentReplay.hp_enemy')} ${hpPctText(store.hpEnemyPct)}`">
            <i :style="{ width: store.hpEnemyPct + '%' }"></i>
          </span>
          <em class="hpnum hpnum-e">{{ hpText(store.hpEnemy) }} / {{ hpText(store.hpEnemyMax) }}</em>
        </div>
      </div>

      <!-- 基地状态条（与 2D 共用）：每基地一枚徽章（底色 = 归属，外环 = 占领进度），两端为争霸积分 -->
      <div v-if="store.hasData && store.baseViews.length" class="base-status">
        <BaseStatusBar :bases="store.baseViews" :friendly-points="store.pointsFriend" :enemy-points="store.pointsEnemy" />
      </div>
    </div>

    <div v-if="store.hasData" class="team panel team1">
      <h3>{{ t('agentReplay.team1') }}</h3>
      <div class="roster">
        <div
          v-for="p in store.roster.team1" :key="p.eid"
          class="pl" :class="{ dead: p.dead, followed: p.followed }"
          @click="sceneApi.setFollow(p.eid)"
        >
          <span class="dot" :style="{ background: p.dot }"></span>
          <span class="nick">{{ p.nick }}</span>
          <span class="tank">{{ p.tank }}</span>
          <span class="hpbar"><i :style="{ width: p.frac + '%', background: p.dot }"></i></span>
        </div>
      </div>
    </div>
    <div v-if="store.hasData" class="team panel team2">
      <h3>{{ t('agentReplay.team2') }}</h3>
      <div class="roster">
        <div
          v-for="p in store.roster.team2" :key="p.eid"
          class="pl" :class="{ dead: p.dead, followed: p.followed }"
          @click="sceneApi.setFollow(p.eid)"
        >
          <span class="dot" :style="{ background: p.dot }"></span>
          <span class="nick">{{ p.nick }}</span>
          <span class="tank">{{ p.tank }}</span>
          <span class="hpbar"><i :style="{ width: p.frac + '%', background: p.dot }"></i></span>
        </div>
      </div>
    </div>

    <!-- 未知阵营（team=0，联表失败/观察者）：中性 fail-visible，不并入任何一队 -->
    <div v-if="store.hasData && store.roster.unknown && store.roster.unknown.length" class="team panel team-unknown">
      <h3>{{ t('agentReplay.teamUnknown') }}</h3>
      <div class="roster">
        <div
          v-for="p in store.roster.unknown" :key="p.eid"
          class="pl" :class="{ dead: p.dead, followed: p.followed }"
          @click="sceneApi.setFollow(p.eid)"
        >
          <span class="dot" :style="{ background: p.dot }"></span>
          <span class="nick">{{ p.nick }}</span>
          <span class="tank">{{ p.tank }}</span>
          <span class="hpbar"><i :style="{ width: p.frac + '%', background: p.dot }"></i></span>
        </div>
      </div>
    </div>

    <div v-if="store.hasData" class="killfeed">
      <div v-for="kf in store.killfeed" :key="kf.id" class="kf">{{ killfeedText(kf) }}</div>
    </div>
    <div v-if="store.banner" class="banner" :style="{ color: store.banner.color }">{{ bannerText() }}</div>

    <div v-if="store.hasData" class="controls panel">
      <div class="transport" data-testid="replay3d-transport">
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
      </div>
      <div class="row">
        <button type="button" class="roster-toggle" :class="{ on: rosterOpen }" :aria-pressed="rosterOpen" data-testid="roster-toggle" @click="rosterOpen = !rosterOpen">{{ t('agentReplay.roster') }}</button>
        <span class="dim">{{ t('agentReplay.camera') }}</span>
        <button
          v-for="c in CAMS" :key="c.k"
          :class="{ on: store.cam === c.k }" @click="sceneApi.setCam(c.k)"
        >{{ c.label() }}</button>
        <span class="spacer"></span>
        <label class="toggle" :title="store.glbAllowed ? '' : t('agentReplay.glb_gate_hint')">
          <input type="checkbox" :checked="store.glbOn" :disabled="!store.glbAllowed" @change="sceneApi.setGlb($event.target.checked)"> {{ t('agentReplay.glb') }}
        </label>
        <label class="toggle">
          <input type="checkbox" :checked="store.labelsOn" @change="sceneApi.setLabels($event.target.checked)"> {{ t('agentReplay.labels') }}
        </label>
        <span class="q-badge" :title="t('agentReplay.q_title')">{{ qualityBadge }}</span>
      </div>
    </div>

    <div v-if="!store.hasData" class="loader">
      <h2>{{ t('agentReplay.title') }}</h2>
      <div class="row">
        <label class="pick">
          <input type="file" accept=".wotbreplay" @change="onFilePicked" />
          {{ t('agentReplay.local_file') }}
        </label>
      </div>
      <div class="row" v-if="!store.hasData">
        <span class="dim">{{ t('agentReplay.quality') }}</span>
        <button
          v-for="k in QUALITY_ORDER" :key="k"
          :class="{ on: store.qualityKey === k }" @click="sceneApi.setQuality(k)"
        >{{ QUALITY_PRESETS[k].label }}</button>
        <span class="dim small">{{ t('agentReplay.q_desc') }}</span>
      </div>
      <p class="hint">{{ t('agentReplay.pick_hint') }}</p>
      <p v-if="!assetsReady" class="hint assets-warn">{{ t('agentReplay.assets_hint') }}</p>
      <p class="hint">{{ t('agentReplay.pb_hint') }}</p>
    </div>

    <!-- 审计 3D-23：解析为不确定进度，地图资产阶段按段 / 字节推进；失败给出原因与重试 -->
    <Scene3DStatus
      v-if="store.loading"
      mode="loading"
      :progress="store.assetStage ? store.assetProgress : null"
      :message="loadingMessage"
    />
    <Scene3DStatus
      v-else-if="store.err"
      mode="error"
      :message="t('agentReplay.error_load', { msg: store.err })"
      :retryable="!!lastFileName"
      dismissible
      @retry="retryLoad"
      @dismiss="store.err = ''"
    />
  </div>
</template>

<style scoped>
/* 面板配色体系自上游 PlaybackView 平移；名字沿用上游，但**两档主题各自给值**：
   深色值逐字保留（showcase 零变化），classic 档在同名 token 上覆盖为浅色。
   3D 场景本体（three.js 画的战场）不随主题变化，只有 HUD 面板跟随。 */
.pb-root {
  position: relative; flex: 1; min-width: 0; min-height: calc(100dvh - var(--header-h) - var(--tabbar-h)); overflow: hidden;
  --panel: rgba(16, 20, 26, .82); --line: #2c3542; --fg: #d8dee7; --dim: #8a94a3;
  --ally: #3fa66a; --enemy: #c05046; --accent: #e8b23c;
  /* 此前绕过 token 直接写死的颜色——收进 token 才能被浅色档统一覆盖 */
  --root-bg: #0d1117; --btn-bg: #1d242e; --on-accent: #14181e;
  --hover-soft: rgba(255, 255, 255, .06); --hpbar-bg: #222a34;
  --loader-bg: rgba(10, 13, 17, .94); --warn: #ffcf5c; --error: #e07b7b;
  background: var(--root-bg); color: var(--fg);
  font: 13px/1.45 "Segoe UI", "Microsoft YaHei", sans-serif;
}
html[data-ui-profile="classic"] .pb-root {
  --panel: rgba(255, 255, 255, .94); --line: #d9dde3; --fg: #2a2f28; --dim: #5c665a;
  --ally: #15803d; --enemy: #b3261e; --accent: #a95c1c;
  --root-bg: #f4f5f2; --btn-bg: #fff; --on-accent: #fff;
  --hover-soft: rgba(0, 0, 0, .05); --hpbar-bg: #e3e6e1;
  /* loader 是整页 UI overlay（store.hasData 之前铺满视口），不是 3D 场景 →
     必须跟随主题；深度与 canonical 浅色档状态色一致以保证可读 */
  --loader-bg: rgba(244, 245, 242, .97); --warn: #9a6000; --error: #a3232e;
}
.scene { position: absolute; inset: 0; }
.panel { position: absolute; background: var(--panel); border: 1px solid var(--line);
         border-radius: 8px; backdrop-filter: blur(4px); }
/* 顶部 HUD 栈：顶栏 + 基地状态条同列堆叠。高度随内容（顶栏两行 / 有没有基地条），
   名册的 top 按栈的最坏高度留出余量，不再依赖写死的 top 偏移。 */
.hud-top { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 5;
           display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
.topbar { position: static; padding: 6px 18px;
          display: flex; flex-direction: column; align-items: center; gap: 3px; white-space: nowrap; }
.topbar .tb-row { display: flex; align-items: center; gap: 12px; }
.topbar .timer { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.topbar .score { font-size: 16px; font-weight: 600; }
.topbar .score .t1 { color: var(--ally); }
/* 争霸点数与单基地进度已移到基地状态条（BaseStatusBar，与 2D 共用） */
.topbar .score .t2 { color: var(--enemy); }
.topbar .map { color: var(--dim); }
/* 双方队伍总血量：数值 + 色条夹住比分。己方条自右向左、敌方条自左向右（围绕比分对称），
   血量只掉不涨，条宽用原始百分比（不取整）保证连续下降平滑。 */
.topbar .hpnum { font-style: normal; font-size: 12px; color: var(--dim); font-variant-numeric: tabular-nums; }
.topbar .hpbar { display: inline-flex; width: 92px; height: 9px; overflow: hidden;
                 border-radius: 999px; background: var(--hpbar-bg); }
.topbar .hp-f { justify-content: flex-end; }
.topbar .hpbar > i { display: block; height: 100%; transition: width .5s ease-out; }
.topbar .hp-f > i { background: var(--ally); }
.topbar .hp-e > i { background: var(--enemy); }
@media (prefers-reduced-motion: reduce) {
  .topbar .hpbar > i { transition: none; }
}
/* 名册让位：顶栏两行后更低，避免与 HUD 栈压住（基地条居中、不与两侧 240px 名册横向重叠） */
.team { top: 84px; width: 240px; padding: 6px; max-height: calc(100% - 190px); overflow-y: auto; z-index: 5; }
.team1 { left: 10px; }
.team2 { right: 10px; }
/* 未知阵营中性组：居中灰调 fail-visible */
.team-unknown { left: 50%; transform: translateX(-50%); width: 220px; }
.team-unknown h3 { color: var(--text-muted); }
.team h3 { font-size: 12px; color: var(--dim); margin: 2px 4px 6px; font-weight: 500; }
.pl { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 5px; cursor: pointer; }
.pl:hover { background: var(--hover-soft); }
.pl.dead { opacity: .42; }
.pl.dead .nick { text-decoration: line-through; }
.pl.followed { outline: 1px solid var(--accent); }
.pl .dot { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.pl .nick { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl .tank { color: var(--dim); font-size: 11px; max-width: 86px; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }
.pl .hpbar { width: 52px; height: 5px; background: var(--hpbar-bg); border-radius: 3px; flex: none; }
.pl .hpbar i { display: block; height: 100%; border-radius: 3px; }
.killfeed { position: absolute; top: 128px; left: 50%; transform: translateX(-50%);
            display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; z-index: 4; }
.kf { background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
      padding: 3px 12px; font-size: 12px; animation: kfin .18s ease-out; white-space: nowrap; }
@keyframes kfin { from { opacity: 0; transform: translateY(-6px); } }
.controls { bottom: 10px; left: 50%; transform: translateX(-50%); width: min(880px, 94%);
            padding: 8px 14px; display: flex; flex-direction: column; gap: 6px; z-index: 5; }
.controls .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
/* 共用播放传输控件（PlaybackTransport，与 2D 同一套）；时间 mm:ss 与 2D 统一（审计 3D-22） */
.controls .transport { display: flex; flex-direction: column; gap: 4px; }
/* 基地状态条：HUD 栈里顶栏正下方居中（同列流式，不再写死 top——顶栏两行后不会互压） */
.base-status { position: static; pointer-events: none; }
.pb-root input[type="checkbox"] { flex: none; min-width: 0; width: auto; margin: 0; }
.pb-root button, .pb-root select { background: var(--btn-bg); color: var(--fg); border: 1px solid var(--line);
                   border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.pb-root button:hover { border-color: var(--accent); }
.pb-root button.on { background: var(--accent); color: var(--on-accent); border-color: var(--accent); font-weight: 600; }
.toggle { display: flex; gap: 4px; align-items: center; color: var(--dim); cursor: pointer; }
.dim { color: var(--dim); }
.small { font-size: 11px; }
.spacer { flex: 1; }
.q-badge { color: var(--dim); }
.banner { position: absolute; top: 38%; left: 50%; transform: translate(-50%, -50%);
          font-size: 42px; font-weight: 700; padding: 14px 44px; z-index: 6;
          background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
.loader { position: absolute; inset: 0; background: var(--loader-bg); z-index: 10;
          display: flex; flex-direction: column; gap: 14px; align-items: center;
          justify-content: center; }
.loader h2 { font-weight: 500; }
.loader .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.loader .hint { color: var(--dim); max-width: 620px; text-align: center; margin: 0; }
.loader .assets-warn { color: var(--warn); }
.loader .err { color: var(--error); max-width: 640px; white-space: pre-wrap; }
.pick { cursor: pointer; border: 1px solid var(--line); padding: 6px 14px; border-radius: 6px; }
.pick input[type='file'] { display: none; }
.loader button { min-width: 44px; }
.roster-toggle { display: none; }
@media (pointer: coarse) {
  .pb-root button { min-height: 44px; }
}
/* 审计 3D-15：手机上名单收进「阵容」开关，打开时两队并排各占一半宽度，场景仍可见 */
@media (width < 768px) {
  .roster-toggle { display: inline-flex; }
  /* 名册从 HUD 栈下方开始（顶栏两行 + 可能的基地条都留在上面） */
  .team { display: none; top: 96px; width: calc(50% - 12px); max-height: 42%; }
  .team1 { left: 8px; }
  .team2 { right: 8px; }
  .pb-root.roster-open .team { display: block; }
  .pl .tank, .pl .hpbar { display: none; }
  .hud-top { top: 6px; gap: 4px; }
  .topbar { padding: 4px 12px; gap: 2px; }
  .topbar .tb-row { gap: 8px; }
  .topbar .timer { font-size: 15px; }
  .topbar .score { font-size: 14px; }
  /* 手机窄屏：血量数值与色条随视口收缩（clamp，不新增断点），保证
     「数值+条+比分+条+数值」在 320–767px 都是一行且不溢出 */
  .topbar .hpnum { font-size: clamp(10px, 2.8vw, 11px); }
  .topbar .hpbar { width: clamp(40px, 13vw, 56px); height: 7px; }
  .killfeed { top: 164px; }
  .controls { bottom: 6px; width: calc(100% - 12px); padding: 6px 8px; }
}
</style>
