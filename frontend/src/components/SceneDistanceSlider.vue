<script setup>
// 移动端竖向相机距离滑条（Map Preview 3D / Replay 3D 共用的呈现控件 owner）。
//
// 契约（current-plan §12.5）：
//   · 顶部 = 近（v=1），底部 = 远（v=0）；竖直拖动立即改变真实相机位置。
//   · 松手停在当前位置，不自动回中；值由 sceneApi.cameraDistanceState() 从相机
//     真实状态反推——本组件不维护任何与 camera 不同步的距离 SSOT。
//   · 只在 free / top（固定）模式可用；Follow / Recorder 由场景返回 unavailable，
//     宿主据此隐藏——滑条绝不接管它们的相机所有权。
//   · FOV 不变、不创建第二台相机；距离上下限与地形钳制全部归场景内核。
// 轮询同步：相机也会被键盘飞行 / 模式切换 / 全屏改变——挂载且可见时以低频
// （200ms）从场景读回真实 v；拖动中不回写，避免覆盖手指。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  /** initPlayback 返回的场景 API（cameraDistanceState / setCameraDistance）。
   *  传 getter：宿主的 sceneApi 是非响应式 let（场景创建/销毁不经 Vue ref），
   *  组件轮询时每次现取，天然跟随场景重建。 */
  getSceneApi: { type: Function, required: true },
  /** 宿主可见性判定（手机形态 ∧ 3D 模式 ∧ 场景就绪） */
  visible: Boolean,
})

const { t } = useI18n()
const sceneApi = () => props.getSceneApi?.()

const v = ref(0.5)            // 相机反推的真实值（1=近）
const dragging = ref(false)
const trackEl = ref(null)
let pollTimer = 0

function readFromScene() {
  if (!props.visible) return   // 不可见时轮询空转：跳过场景查询（挂载常驻、渲染由 v-if 决定）
  const state = sceneApi()?.cameraDistanceState?.()
  if (!state?.available) return
  if (!dragging.value) v.value = state.v
}

onMounted(() => {
  readFromScene()
  pollTimer = window.setInterval(readFromScene, 200)
})
onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = 0
})
watch(() => props.visible, () => {
  if (props.visible) readFromScene()
})

function pointToV(clientY) {
  const rect = trackEl.value?.getBoundingClientRect()
  if (!rect || rect.height <= 0) return null
  return Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height))
}
function applyV(next) {
  v.value = next
  sceneApi()?.setCameraDistance?.(next)
}
function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return
  dragging.value = true
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 测试环境可能不支持 */ }
  const next = pointToV(e.clientY)
  if (next != null) applyV(next)
  e.preventDefault()
}
function onPointerMove(e) {
  if (!dragging.value) return
  const next = pointToV(e.clientY)
  if (next != null) applyV(next)
}
function onPointerUp(e) {
  if (!dragging.value) return
  dragging.value = false
  try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 忽略 */ }
}
function onKeydown(e) {
  const step = e.shiftKey ? 0.1 : 0.02
  if (e.key === 'ArrowUp') { applyV(Math.min(1, v.value + step)); e.preventDefault() }
  else if (e.key === 'ArrowDown') { applyV(Math.max(0, v.value - step)); e.preventDefault() }
  else if (e.key === 'PageUp') { applyV(Math.min(1, v.value + 0.2)); e.preventDefault() }
  else if (e.key === 'PageDown') { applyV(Math.max(0, v.value - 0.2)); e.preventDefault() }
  else if (e.key === 'Home') { applyV(1); e.preventDefault() }
  else if (e.key === 'End') { applyV(0); e.preventDefault() }
}

const thumbBottomPct = computed(() => `${(1 - v.value) * 100}%`)
const percentNow = computed(() => Math.round(v.value * 100))
</script>

<template>
  <div
    v-if="visible"
    class="scene-dist"
    data-testid="scene-distance-slider"
    role="slider"
    tabindex="0"
    aria-orientation="vertical"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="percentNow"
    :aria-valuetext="t('agentReplay.distance_value', { percent: percentNow })"
    :aria-label="t('agentReplay.distance')"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKeydown"
  >
    <span class="scene-dist-label" aria-hidden="true">{{ t('agentReplay.distance_near') }}</span>
    <div ref="trackEl" class="scene-dist-track">
      <div class="scene-dist-thumb" :style="{ bottom: thumbBottomPct }"></div>
    </div>
    <span class="scene-dist-label" aria-hidden="true">{{ t('agentReplay.distance_far') }}</span>
  </div>
</template>

<style scoped>
/* 覆盖在 3D 视口右侧、全屏按钮正下方：不单独挤占一列，hit area 与按钮不重叠
 （top 从全屏按钮下缘起算，由宿主以 CSS 变量 --scene-fs-bottom 下发）。 */
.scene-dist {
  position: absolute;
  top: var(--scene-fs-bottom, calc(var(--space-2) + var(--control-h-sm) + var(--space-2)));
  right: var(--space-2);
  z-index: var(--z-sticky);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface-1);
  touch-action: none;
}

.scene-dist-label {
  font: var(--type-caption);
  color: var(--color-text-secondary);
  writing-mode: vertical-rl;
  text-orientation: upright;
}

.scene-dist-track {
  position: relative;
  width: var(--space-2);
  /* 高度上限 200px：矮横屏下不与全屏按钮/顶部 HUD 抢空间（不用 vh，lint 禁 vh） */
  height: min(max(96px, 22dvh), 200px);
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
}

.scene-dist-thumb {
  position: absolute;
  left: 50%;
  transform: translate(-50%, 50%);
  width: calc(var(--space-4) + var(--space-1));
  height: calc(var(--space-4) + var(--space-1));
  border-radius: var(--radius-full);
  background: var(--color-accent);
  pointer-events: none;
}

.scene-dist:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}
</style>
