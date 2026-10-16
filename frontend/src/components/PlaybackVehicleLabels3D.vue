<script setup>
import { ref, shallowRef } from 'vue'
import PlaybackVehicleLabel from './PlaybackVehicleLabel.vue'
import TankClassIcon from './TankClassIcon.vue'
import { LABEL_OCCLUDED_OPACITY } from '../utils/labelLayout.js'

defineProps({
  labelPrefs: { type: Object, required: true },
  gunMarks: { type: Map, default: () => new Map() },
  hpPrefs: { type: Object, required: true },
  markerPrefs: { type: Object, default: () => ({ classIcons: false }) },
  selectedEid: { type: Number, default: null },
  hidden: Boolean,
})
const emit = defineEmits(['select'])
// Only this child receives 10 Hz content snapshots. Screen coordinates bypass
// Vue entirely: Three.js moves a bounded set of DOM anchors at render speed.
const labels = shallowRef([])
const elements = new Map()
const anchors = new Map()
// 伤害数字（"-342"）与名牌同层：canvas sprite 恒在 DOM 之下，跨层避让（renderOrder /
// 世界空间偏移）怎么算都会被名牌压住——同层后落点直接读血条 DOM 几何（px），
// 不存在世界↔屏幕换算，也不存在"永远被 DOM 盖住"。
const rootEl = ref(null)
const damages = shallowRef([])
const damageEls = new Map()
let damageSeq = 0
/** 血条右缘 ↔ 数字左缘的间隙：贴着血条读数，又不压住血条本身。 */
const DMG_GAP_PX = 8
/** 没有血条也没有名牌内容时的回退抬升（锚点 = 名牌块底边，即车辆模型上方）。 */
const DMG_FALLBACK_LIFT_PX = 20
/** 同一辆车短时间内连续受击：向下错开槽位，避免多个数字完全重叠到读不出。 */
const DMG_STACK_PX = 20
const DMG_STACK_SLOTS = 3
// 软遮挡下限的唯一来源在 utils/labelLayout.js；这里只做「常量 → CSS 变量」投影，
// CSS 不再自带数值（否则同一契约又散成两处）。
const occludedStyle = { '--pb-label-occluded-opacity': String(LABEL_OCCLUDED_OPACITY) }
function paint(el, anchor) {
  if (!el || !anchor) return
  el.hidden = !anchor.visible
  el.style.transform = `translate(${anchor.x}px, ${anchor.y}px) translate(-50%, -100%)`
  el.classList.toggle('label-occluded', !!anchor.occluded)
}
function bind(eid, el) {
  if (el) { elements.set(eid, el); paint(el, anchors.get(eid)) }
  else elements.delete(eid)
}
/**
 * 伤害数字落点（覆盖层 px）。血条可见 → 血条右缘 + `DMG_GAP_PX`、垂直居中于血条；
 * 血条关掉但名牌仍在 → 名牌块右缘同一规则；两者都没有（关名牌 / 空名牌）→ 锚点上方
 * `DMG_FALLBACK_LIFT_PX`（锚点 = 名牌块底边，场景侧已按车体抬升，见 labelLiftWorld）。
 * 车辆未投影、或名牌 DOM 尚未布局（hidden / 还没 patch）→ null：本帧不定位，下一帧再量。
 * @param {number} stack 同车并发伤害数字的槽位（0 = 最新，向下错开）
 * @param {number} textWidth 数字自身宽度：右侧放不下时（车辆贴屏幕右缘）镜像到血条左侧
 */
function damageAnchor(eid, stack = 0, textWidth = 0) {
  const anchor = anchors.get(eid)
  if (!anchor || !anchor.projected) return null
  const stackY = (stack % DMG_STACK_SLOTS) * DMG_STACK_PX
  if (!anchor.visible) return { x: anchor.x, y: anchor.y - DMG_FALLBACK_LIFT_PX + stackY }
  const host = elements.get(eid)
  if (!host) return null
  const hostRect = host.getBoundingClientRect()
  if (!hostRect.width && !hostRect.height) return null
  const target = (host.querySelector('.pb-hp-bar') || host.querySelector('.vehicle-label'))?.getBoundingClientRect()
  // 名牌在屏上但没有任何可见内容（姓名/血量全关）→ 等同于没有名牌
  if (!target || (!target.width && !target.height)) {
    return { x: anchor.x, y: anchor.y - DMG_FALLBACK_LIFT_PX + stackY }
  }
  const baseX = hostRect.left + hostRect.width / 2
  const baseY = hostRect.bottom
  // hostRect / target 是视口坐标，锚点坐标是覆盖层坐标——先量出"相对锚点"的偏移，
  // 再加锚点得到覆盖层内的落点（覆盖层与 canvas 同原点，见 Replay3DPane.pb-stage 注释）
  const rightX = anchor.x + target.right + DMG_GAP_PX - baseX
  const stageW = rootEl.value?.clientWidth || 0
  // 右边放不下就不硬贴：镜像到血条左侧（仍不覆盖血条），不让 viewport 直接裁掉数字
  const x = stageW > 0 && rightX + textWidth > stageW
    ? anchor.x + target.left - DMG_GAP_PX - textWidth - baseX
    : rightX
  return { x, y: anchor.y + target.top + target.height / 2 - baseY + stackY }
}
/** 逐帧把存活数字摆到锚点几何上：位置走 DOM 直写（与名牌 anchor 同一条热路径），不触发 VDOM patch。 */
function placeDamages(eid) {
  const list = damages.value
  if (!list.length) return
  for (const d of list) {
    if (d.eid !== eid) continue
    const el = damageEls.get(d.id)
    if (!el) continue
    if (d.at == null) {
      el.hidden = false                     // 先显示再量宽：hidden(= display:none) 时量不到宽度
      d.at = damageAnchor(eid, d.stack, el.offsetWidth)
      if (!d.at) { el.hidden = true; continue }   // 本帧还量不到：下一帧再试，不用错位置
    }
    el.hidden = false
    el.style.transform = `translate3d(${d.at.x}px, ${d.at.y}px, 0)`
  }
}
function bindDamage(d, el) {
  if (el) damageEls.set(d.id, el)
  else damageEls.delete(d.id)
}
/**
 * 生成一个伤害数字：场景内核在伤害事件跨过播放时钟时调用一次。
 * 生命周期 = 壁钟 `durationMs`（与 2D 同语义：暂停也自然走完）；漂移 / 淡出 / 不透明度
 * 全在 CSS 动画里；seek 由 `clearDamages` 清空且不补播。
 */
function spawnDamage(eid, hpLoss, durationMs) {
  const id = ++damageSeq
  const alive = damages.value.filter((d) => d.eid === eid).length
  damages.value = [...damages.value, {
    id, eid, stack: alive, text: '-' + hpLoss, bornMs: performance.now(), durationMs, at: null,
  }]
  // 到期摘除走定时器而不是渲染循环：数字是 DOM，暂停时不需要（也不该依赖）场景继续出帧。
  // 非法寿命（NaN / ≤0）也要摘除——宁可短促，也不能把数字永远留在屏幕上。
  setTimeout(() => removeDamage(id), Math.max(1, Number(durationMs) || 0))
  return id
}
function removeDamage(id) {
  const next = damages.value.filter((d) => d.id !== id)
  if (next.length === damages.value.length) return
  damages.value = next
  damageEls.delete(id)
}
function clearDamages() {
  damages.value = []
  damageEls.clear()
}
function damageAnimStyle(d) {
  // 重新挂载（开关伤害层）时从当前相位续播，而不是从头再飘一次
  const age = Math.max(0, performance.now() - d.bornMs)
  return { animationDuration: `${d.durationMs}ms`, animationDelay: `${-age}ms` }
}
function setAnchor(eid, anchor) {
  // 契约：**同步拷贝**进自有 per-eid 存储，不持有调用方对象引用——场景内核逐帧逐车
  // 复用同一个 scratch 对象喂所有 eid（60Hz ×14 个对象的分配热路径），若这里存引用，
  // 全部 eid 会共享最后一辆车的坐标。
  let cur = anchors.get(eid)
  if (!cur) { cur = { x: 0, y: 0, visible: false, occluded: false, projected: false }; anchors.set(eid, cur) }
  cur.x = anchor.x; cur.y = anchor.y; cur.visible = anchor.visible; cur.occluded = anchor.occluded
  // projected = 车辆在视锥内（与"名牌是否显示"无关）：关名牌时伤害数字仍有落点
  cur.projected = anchor.projected ?? anchor.visible
  paint(elements.get(eid), cur)
  placeDamages(eid)
}
function setLabels(rows) { labels.value = rows }
function clear() { labels.value = []; anchors.clear(); elements.clear(); clearDamages() }
defineExpose({ setLabels, setAnchor, clear, spawnDamage, removeDamage, clearDamages, damageAnchor })
</script>

<template>
  <div ref="rootEl" class="vehicle-label-overlay" :hidden="hidden" :style="occludedStyle" data-testid="vehicle-label-overlay">
    <div v-for="row in labels" :key="row.eid" :ref="el => bind(row.eid, el)"
      class="vehicle-label-anchor" :data-eid="row.eid" hidden>
      <PlaybackVehicleLabel
        :player-name="row.playerName" :tank-name="row.tankName" :gun-marks="gunMarks.get(row.accountId)" :friendly="row.friendly"
        :destroyed="row.destroyed" :last-known="row.lastKnown" :hp="row.hp" :reload="row.reload"
        :hp-ghost="row.hpGhost" :hp-flash="row.hpFlash" :hp-no-transition="true"
        :show-player-name="labelPrefs.showPlayerName" :show-tank-name="labelPrefs.showTankName"
        :show-hp="hpPrefs.showHp" :show-reload="labelPrefs.showReload"
      />
      <button v-if="markerPrefs.classIcons" type="button" class="vehicle-class-button"
        :class="{ 'is-friendly': row.friendly === true, 'is-enemy': row.friendly === false, 'is-destroyed': row.destroyed }"
        :aria-label="row.tankName" :aria-pressed="selectedEid === row.eid"
        @pointerdown.stop @click.stop="emit('select', row.eid, $event)">
        <TankClassIcon :tank-class="row.tankClass" />
      </button>
    </div>
    <!-- 伤害数字排在所有名牌之后：同层内 DOM 顺序即层级，数字永远不会被名牌压住。
         初始 hidden，由 placeDamages 量到落点后再显示（避免在覆盖层原点闪一帧）。 -->
    <div v-if="markerPrefs.showStatus !== false" class="pb-damage-layer" aria-hidden="true">
      <span v-for="d in damages" :key="d.id" :ref="el => bindDamage(d, el)"
        class="pb-damage" data-test="pb-damage" hidden>
        <span class="pb-damage-text" :style="damageAnimStyle(d)">{{ d.text }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.vehicle-label-overlay { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: var(--pb-z-canvas); }
.vehicle-label-overlay[hidden], .vehicle-label-anchor[hidden] { display: none; }
.vehicle-label-anchor { position: absolute; left: 0; top: 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; }
.label-occluded { opacity: var(--pb-label-occluded-opacity, .35); }
/* 伤害数字：血条右侧的战斗反馈数字。屏幕尺寸固定 px（远近缩放与自由/跟随/俯视镜头下
   视觉大小一致），深色描边保证任意地形 / 车体上都读得出，出生阶段 100% 不透明、
   只在后半程淡出；漂移 = 右上 20px / 24px（合计约 31px，契约 20~35px）。 */
.pb-damage-layer { position: absolute; inset: 0; pointer-events: none; }
.pb-damage { position: absolute; left: 0; top: 0; }
.pb-damage[hidden] { display: none; }
.pb-damage-text {
  display: block;
  color: var(--color-playback-damage-text);
  font: var(--type-caption);
  font-size: var(--font-size-h3);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-shadow: var(--text-shadow-playback-damage);
  transform: translate(0, -50%);
  animation: pb-damage-rise linear forwards;
}
@keyframes pb-damage-rise {
  0% { transform: translate(0, -50%); opacity: 1; }
  50% { opacity: 1; }
  100% { transform: translate(var(--space-5), calc(-50% - var(--space-6))); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .pb-damage-text { animation: none; }
}
.vehicle-class-button {
  display: grid;
  place-items: center;
  min-inline-size: var(--hit-min);
  min-block-size: var(--hit-min);
  padding: var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-team-neutral);
  pointer-events: auto;
  cursor: pointer;
}
.vehicle-class-button :deep(path) { stroke: var(--color-canvas); stroke-width: 1; paint-order: stroke; }
.vehicle-class-button.is-friendly { color: var(--color-team-ally); }
.vehicle-class-button.is-enemy { color: var(--color-team-enemy); }
.vehicle-class-button.is-destroyed { color: var(--color-playback-label-destroyed); opacity: .55; }
.vehicle-class-button[aria-pressed="true"], .vehicle-class-button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: var(--space-1); }
</style>
