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
import Scene3DStatus from './Scene3DStatus.vue'
import PlaybackTransport from './PlaybackTransport.vue'
import BaseStatusBar from './BaseStatusBar.vue'
import SegmentedControl from './SegmentedControl.vue'
import AppButton from './AppButton.vue'
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
const { availability, requireFeature } = useFeatureGate()
const online = computed(() => availability(Feature.PLAYBACK_3D))

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

/**
 * 把目标文件交给场景内核。
 *
 * **加载状态不属于组件层**：`playbackScene.loadData()` 自己持有代数 guard 与
 * `loading` / `err` / `assetStage` / `assetProgress` 的唯一写入权（见其 finally 的
 * `gen === sessionGen || gen + 1 === sessionGen` 判定）。组件层若也写 `store.loading`，
 * 就会出现「旧场景的迟到完成把新场景的 loading 清掉」——两边代数不同步，且组件层没有
 * 任何 guard。所以这里只发命令与记录最近文件（重试用）。
 */
async function loadFile(file) {
  if (!file || !sceneApi || !requireFeature(Feature.PLAYBACK_3D)) return
  lastFile = file
  lastFileName.value = file.name || 'replay'
  await sceneApi.loadData({ kind: 'local', file })
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
  if (sceneApi || !props.active || !shouldHaveScene()) return false
  sceneApi = initPlayback(stage.value, store)
  sceneApi?.setPaused?.(!props.active)
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
  // 尚未按开始（含换到另一场）：先把上一场撤下，否则旧场景继续呈现、还会压住待开播面板
  if (file !== startedFile.value) {
    if (loadedFile) {
      sceneApi?.reset?.()
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
  window.__pbPane = { store }
}

onMounted(() => {
  reconcileScene()
  observeLaneBounds()
})
onBeforeUnmount(() => {
  destroyScene()
  laneBoundsObserver?.disconnect()
  laneBoundsObserver = null
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
    if (activeChanged) sceneApi?.setPaused?.(!active)
  },
  { flush: 'post' },
)
</script>

<template>
  <div class="pb-pane">
    <p v-if="!online.available" class="pb-note" data-testid="replay3d-connectivity">{{ $t(online.messageKey) }}</p>
    <Scene3DStatus v-else-if="!webgl.supported" mode="unsupported" :webgl-status="webgl.status" />
    <p v-else-if="blockedReason" class="pb-note" data-testid="replay3d-blocked">{{ blockedReason }}</p>
    <p v-else-if="!file" class="pb-note" data-testid="replay3d-empty">{{ $t('agentReplay.no_file') }}</p>
    <div v-else class="pb-root" ref="rootEl" :class="{ 'roster-open': rosterOpen }">
      <div ref="stage" class="scene"></div>

      <div ref="hudEl" class="hud">
        <div v-if="store.hasData" class="topbar panel">
          <div class="tb-row">
            <span class="map">{{ mapTitle }}</span>
            <span class="timer">{{ store.timer }}</span>
          </div>
          <!-- 双方队伍总血量（与上游 3D 视图同布局：数值 + 色条夹住比分，己方在左、敌方在右；
               整行单一阵营视角：血条与比分都按 friendly_team 映射，见 teamHpTotals/perspectiveScore） -->
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
        <div v-if="store.hasData && store.baseViews.length" class="base-status">
          <BaseStatusBar :bases="store.baseViews" :friendly-points="store.pointsFriend" :enemy-points="store.pointsEnemy" />
        </div>

        <div v-if="store.hasData" class="killfeed">
          <div v-for="kf in store.killfeed" :key="kf.id" class="kf">{{ killfeedText(kf) }}</div>
        </div>
      </div>

      <!-- 阵容车道：左右两条侧边车道（不占中央 HUD 车道）；未知阵营归左车道、常驻车道
           底部（不被队伍名单滚出可视区），与居中的 HUD 列 / 底部控制条互不遮挡 -->
      <template v-if="store.hasData">
        <div class="team-lane side-left">
          <div class="team panel team1">
            <h3>{{ t('agentReplay.team1') }}</h3>
            <div class="roster">
              <div
                v-for="p in rosterGroups.ally" :key="p.eid"
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
          <div v-if="rosterGroups.unknown.length" class="team panel team-unknown">
            <h3>{{ t('agentReplay.teamUnknown') }}</h3>
            <div class="roster">
              <div
                v-for="p in rosterGroups.unknown" :key="p.eid"
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
        </div>
        <div class="team-lane side-right">
          <div class="team panel team2">
            <h3>{{ t('agentReplay.team2') }}</h3>
            <div class="roster">
              <div
                v-for="p in rosterGroups.enemy" :key="p.eid"
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
        </div>
      </template>

      <div v-if="store.banner" class="banner" :style="{ color: bannerColor }">{{ bannerText() }}</div>

      <div v-if="store.hasData" ref="controlsEl" class="controls panel">
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

      <!-- 待开播：画质先定型再解析 + 拉资产（内核在 startPlayback 惰性建渲染器、首帧按当前档位） -->
      <div v-if="file !== startedFile" class="pre-start" data-test="replay3d-pending">
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

/* 审计 3D-15：紧凑档名单收进「阵容」开关。打开时两条车道**各占半宽**——旧版两块 240px
   绝对定位互相重叠、盖住场景（不得回退）；半宽放不下弹种 / 血条，只留圆点 + 昵称。
   车道上下界仍由 --pb-hud-h / --pb-controls-h 实测定界，与桌面同一套几何安全。 */
@media (width < 768px) {
  .roster-toggle { display: inline-flex; align-items: center; }
  .team-lane { display: none; }
  .pb-root.roster-open .team-lane { display: flex; }
  .pb-root.roster-open .side-left { position: absolute; left: var(--space-2); right: 51%; width: auto; }
  .pb-root.roster-open .side-right { position: absolute; right: var(--space-2); left: 51%; width: auto; }
  .pl .tank, .pl .hpbar { display: none; }
  .topbar { gap: var(--space-2); padding: 0 var(--space-3); }
  .controls { width: calc(100% - var(--space-2)); padding: var(--space-1) var(--space-2); }
}

/* 触屏：控件点击区域抬到 --hit-min（44px），布局不动 */
@media (pointer: coarse) {
  .tool-btn { min-height: var(--hit-min); }
}
</style>
