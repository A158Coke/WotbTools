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
import { detectWebGL } from '../scene/webglSupport.js'
import { uiProfile } from '../composables/useUiProfile.js'
import Scene3DStatus from './Scene3DStatus.vue'
import PlaybackTransport from './PlaybackTransport.vue'
import BaseStatusBar from './BaseStatusBar.vue'
import SegmentedControl from './SegmentedControl.vue'
import { mapLabel } from '../utils/helpers.js'
import { PLAYBACK_SPEEDS, PLAYBACK_STEP_SECONDS, usePlaybackTransport } from '../composables/usePlaybackTransport.js'

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
  // 工作台切到别的能力时不再劫持空格 / 方向键（2D 回放面板同时激活会争抢）
  isActive: () => props.active,
})
// 审计 3D-23：渲染器创建前做 WebGL 预检；不支持时不初始化场景，整块换成说明
const webgl = detectWebGL()
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

const CAMERAS = [
  { value: 'free', label: t('agentReplay.cam_free') },
  { value: 'top', label: t('agentReplay.cam_top') },
  { value: 'follow', label: t('agentReplay.cam_follow') },
]
const QUALITY_ORDER = Object.keys(QUALITY_PRESETS)

/**
 * 阵营色只在 HUD 里用（three.js 场景本体的阵营色由场景内核按设计 token 处理）：
 * 阵容圆点 / 胜利失败横幅取语义 token，随主题切换，不再写死红绿。
 * `uiProfile` 是唯一 reactive 主题源（design-language §2），读样式只发生在计算属性里，
 * 不在每帧渲染里逐行读。
 */
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

/**
 * 阵容按阵营分组渲染：场景内核写进 store 的 `dot` 是场景侧调色板值，
 * HUD 圆点按**分组归属**改用主题 token（阵容已经是 team1 / team2 / unknown 三组，
 * 每条目本身不带 team 字段）。
 */
const rosterGroups = computed(() => {
  const colors = teamColors.value
  const withColor = (list, color) => (list || []).map((player) => ({ ...player, dotColor: color }))
  return {
    ally: withColor(store.roster.team1, colors.ally),
    enemy: withColor(store.roster.team2, colors.enemy),
    unknown: withColor(store.roster.unknown, colors.unknown),
  }
})

const bannerColor = computed(() => {
  const outcome = store.banner?.outcome
  if (outcome === 'win') return teamColors.value.ally
  if (outcome === 'lose') return teamColors.value.enemy
  return teamColors.value.unknown
})

/** 阵容三段（未知阵营 team=0 中性 fail-visible，绝不并入任何一队） */
const rosterSections = computed(() => [
  { key: 'team1', label: t('agentReplay.team1'), players: rosterGroups.value.ally },
  { key: 'team2', label: t('agentReplay.team2'), players: rosterGroups.value.enemy },
  ...(rosterGroups.value.unknown.length
    ? [{ key: 'unknown', label: t('agentReplay.teamUnknown'), players: rosterGroups.value.unknown }]
    : []),
])

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

/** 重试：同一份文件重新解析（失败不清空 selection，用户不必再选一次） */
function retryLoad() {
  if (lastFile) return loadFile(lastFile)
  store.err = ''
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
  sceneApi = initPlayback(stage.value, store)
  sceneApi?.setPaused?.(!props.active)
  return true
}

/** 解析目标回放：同一次会话内同一文件不重复解析 */
let loadedFile = null
function reconcileScene() {
  if (!shouldHaveScene()) {
    destroyScene()
    loadedFile = null
    return
  }
  const created = ensureScene()
  const file = props.file
  if (created || (file && file !== loadedFile)) {
    loadedFile = file
    loadFile(file)
  }
}

onMounted(reconcileScene)
onBeforeUnmount(destroyScene)

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
</script>

<template>
  <div class="pb-pane">
    <Scene3DStatus v-if="!webgl.supported" mode="unsupported" :webgl-status="webgl.status" />
    <p v-else-if="blockedReason" class="pb-note" data-testid="replay3d-blocked">{{ blockedReason }}</p>
    <p v-else-if="!file" class="pb-note" data-testid="replay3d-empty">{{ $t('agentReplay.no_file') }}</p>
    <div v-else class="pb-root" :class="{ 'roster-open': rosterOpen }">
      <div ref="stage" class="scene"></div>

      <div class="hud">
        <div v-if="store.hasData" class="topbar panel">
          <span class="map">{{ mapTitle }}</span>
          <span class="timer">{{ store.timer }}</span>
          <span class="score"><span class="t1">{{ store.score1 }}</span> : <span class="t2">{{ store.score2 }}</span></span>
        </div>

        <!-- 基地状态条（与 2D 共用）：每基地一枚徽章（底色 = 归属，外环 = 占领进度），两端为争霸积分 -->
        <div v-if="store.hasData && store.baseViews.length" class="base-status">
          <BaseStatusBar :bases="store.baseViews" :friendly-points="store.pointsFriend" :enemy-points="store.pointsEnemy" />
        </div>

        <div v-if="store.hasData" class="killfeed">
          <div v-for="kf in store.killfeed" :key="kf.id" class="kf">{{ killfeedText(kf) }}</div>
        </div>
      </div>

      <div v-if="store.hasData" class="roster panel" :class="{ 'is-open': rosterOpen }">
        <div v-for="group in rosterSections" :key="group.key" class="side" :class="{ 'side-unknown': group.key === 'unknown' }">
          <h3>{{ group.label }}</h3>
          <div
            v-for="p in group.players" :key="p.eid"
            class="pl" :class="{ dead: p.dead, followed: p.followed }"
            @click="sceneApi.setFollow(p.eid)"
          >
            <span class="dot" :style="{ background: p.dotColor }"></span>
            <span class="nick">{{ p.nick }}</span>
            <span class="tank">{{ p.tank }}</span>
            <span class="hpbar"><i :style="{ width: p.frac + '%', background: p.dotColor }"></i></span>
          </div>
        </div>
      </div>

      <div v-if="store.banner" class="banner" :style="{ color: bannerColor }">{{ bannerText() }}</div>

      <div v-if="store.hasData" class="controls panel">
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
        <!-- 3D 专属（相机 / 画质 / 标签 / 阵容 / GLB）独立成一行，不与传输控件混成一套 -->
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
  display: flex; gap: var(--space-4); align-items: center; white-space: nowrap;
  padding: var(--space-1) var(--space-4);
}
.topbar .timer { font: var(--type-h3); font-variant-numeric: tabular-nums; }
.topbar .score { font: var(--type-h3); }
.topbar .score .t1 { color: var(--color-team-ally); }
.topbar .score .t2 { color: var(--color-team-enemy); }
.topbar .map { color: var(--color-text-secondary); }

/* 顶部 HUD 竖排：顶栏 → 基地状态条 → 击杀流；整列不拦截场景操作，
   阵容面板从这一列下方开始，不再靠各自猜的固定 top 值。 */
.hud {
  position: absolute; top: var(--space-2); left: var(--space-2); right: var(--space-2);
  z-index: var(--pb-z-hud);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
  pointer-events: none;
}

.roster {
  position: absolute;
  top: 96px; left: var(--space-2); right: var(--space-2);
  z-index: var(--pb-z-hud);
  display: flex; gap: var(--space-2);
  padding: var(--space-1);
  max-height: calc(100% - 240px);
  overflow: hidden;
}
.roster .side { flex: 1 1 0; min-width: 0; overflow-y: auto; }
.roster .side-unknown { flex: 0 1 200px; border-inline-start: 1px solid var(--color-border-subtle); padding-inline-start: var(--space-2); }
.roster h3 { margin: var(--space-1) var(--space-1) var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); }

.pl {
  display: flex; align-items: center; gap: var(--space-1);
  min-height: var(--hit-min); padding: 0 var(--space-1);
  border-radius: var(--radius-sm); cursor: pointer;
}
.pl.dead { opacity: .42; }
.pl.dead .nick { text-decoration: line-through; }
.pl.followed { outline: 1px solid var(--color-accent); }
.pl .dot { flex: none; width: 8px; height: 8px; }
.pl .nick { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl .tank { max-width: 86px; overflow: hidden; color: var(--color-text-secondary); font: var(--type-caption); text-overflow: ellipsis; white-space: nowrap; }
.pl .hpbar { flex: none; width: 52px; height: 5px; border-radius: var(--radius-full); background: var(--color-surface-3); }
.pl .hpbar i { display: block; height: 100%; border-radius: var(--radius-full); }
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

/* 审计 3D-15：紧凑档名单收进「阵容」开关，打开时两队并排、场景仍可见 */
@media (width < 768px) {
  .roster-toggle { display: inline-flex; align-items: center; }
  .roster { display: none; top: 88px; max-height: calc(100% - 220px); }
  .pb-root.roster-open .roster { display: flex; }
  .pl .tank, .pl .hpbar { display: none; }
  .topbar { gap: var(--space-2); padding: 0 var(--space-3); }
  .controls { width: calc(100% - var(--space-2)); padding: var(--space-1) var(--space-2); }
}

/* 触屏：控件点击区域抬到 --hit-min（44px），布局不动 */
@media (pointer: coarse) {
  .tool-btn { min-height: var(--hit-min); }
}
</style>
