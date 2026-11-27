<script setup>
import { ref, shallowRef, watch } from 'vue'
import PlaybackVehicleLabel from './PlaybackVehicleLabel.vue'
import TankClassIcon from './TankClassIcon.vue'
import { LABEL_OCCLUDED_OPACITY } from '../utils/labelLayout.js'

const props = defineProps({
  labelPrefs: { type: Object, required: true },
  gunMarks: { type: Map, default: () => new Map() },
  hpPrefs: { type: Object, required: true },
  markerPrefs: { type: Object, default: () => ({ classIcons: false }) },
  selectedEid: { type: Number, default: null },
  hidden: Boolean,
  interactive: { type: Boolean, default: true },
  lastKnownLabel: { type: String, default: '' },
  markerKindLabels: { type: Object, default: null },
})
const emit = defineEmits(['select'])
const labels = shallowRef([])
const elements = new Map()
const anchors = new Map()
const markerLabels = shallowRef([])
const markerEls = new Map()
const markerAnchors = new Map()
const rootEl = ref(null)
const damages = shallowRef([])
let damageSeq = 0
let labelsSeq = 0
const DMG_GAP_PX = 8
const DMG_FALLBACK_LIFT_PX = 20
const DMG_STACK_PX = 20
const DMG_STACK_SLOTS = 3
const DMG_DRIFT_PX = 20
const SIDE_RIGHT = 'right'
const SIDE_LEFT = 'left'
const occludedStyle = { '--pb-label-occluded-opacity': String(LABEL_OCCLUDED_OPACITY) }
function syncGhostPhase(host) {
  const ghost = host.querySelector('.pb-hp-ghost')
  const bornMs = Number(ghost?.dataset.bornMs)
  if (Number.isFinite(bornMs)) ghost.style.animationDelay = `${-Math.max(0, performance.now() - bornMs)}ms`
}
function paint(el, anchor, forceReappearing = false) {
  if (!el || !anchor) return
  const reappearing = (el.hidden || forceReappearing) && anchor.visible
  setHidden(el, !anchor.visible)
  if (!anchor.visible) return
  el.style.transform = `translate(${anchor.x}px, ${anchor.y}px) translate(-50%, -100%)`
  el.classList.toggle('label-occluded', !!anchor.occluded)
  if (reappearing) syncGhostPhase(el)
}
function bind(eid, el) {
  if (el) { elements.set(eid, el); paint(el, anchors.get(eid)) }
  else elements.delete(eid)
}
function markerActor(row) {
  return [row.player, row.tank].filter(Boolean).join(' · ')
}
function markerKindLabel(row) {
  const map = props.markerKindLabels
  if (!map) return ''
  if (row.kind === 'target' && row.intent) {
    const base = map[row.intent] || ''
    const who = markerActor(row)
    const entry = map[`target_${row.intent}`]
    if (entry && who && row.target) {
      if (typeof entry === 'function') return entry(row.target, who)
      return String(entry).replace('{who}', who).replace('{target}', row.target)
    }
    if (who) return base ? `${who} · ${base}` : who
    return row.target ? `${base} · ${row.target}` : base
  }
  return (row.kind && map[row.kind]) || ''
}
function bindMarker(key, el) {
  if (el) { markerEls.set(key, el); paintMarker(markerEls.get(key), markerAnchors.get(key)) }
  else markerEls.delete(key)
}
function stackOffsetPx(stack) { return (stack % DMG_STACK_SLOTS) * DMG_STACK_PX }
function damageLayoutKey(anchorVisible) {
  return [
    anchorVisible ? 1 : 0,
    props.hidden ? 1 : 0,
    props.hpPrefs?.showHp ? 1 : 0,
    props.labelPrefs?.showPlayerName ? 1 : 0,
    props.labelPrefs?.showTankName === false ? 0 : 1,
    props.labelPrefs?.showReload ? 1 : 0,
    props.markerPrefs?.classIcons ? 1 : 0,
    labelsSeq,
  ].join('|')
}
/**
 * 量一块伤害数字**相对名牌锚点**的局部布局：血条可见 → 右缘 + `DMG_GAP_PX`、垂直居中于血条；
 * 血条关掉但名牌仍在 → 名牌块右缘同一规则；两者都没有（关名牌 / 真实 0×0 空名牌）→ 锚点上方
 * `DMG_FALLBACK_LIFT_PX`（锚点 = 名牌块底边，场景侧已按车体抬升，见 labelLiftWorld）。
 * 缓存的是几何（dx/dy/textW），不是屏幕坐标：屏幕坐标每帧按当前 anchor 重算。
 * @returns {{dxRight:number,dxLeft:number,dy:number,textW:number}|null} null = 现在还量不到（下一帧再试）
 */
function measureDamageLayout(eid, el, stack, anchorVisible) {
  if (props.hidden) return null
  const textW = el?.offsetWidth || 0
  const fallback = { dxRight: 0, dxLeft: -textW, dy: -DMG_FALLBACK_LIFT_PX + stackOffsetPx(stack), textW }
  if (!anchorVisible) return fallback
  const host = elements.get(eid)
  if (!host) return null
  const hostRect = host.getBoundingClientRect()
  const target = (host.querySelector('.pb-hp-bar') || host.querySelector('.vehicle-label'))?.getBoundingClientRect()
  if ((!hostRect.width && !hostRect.height) || !target || (!target.width && !target.height)) return fallback
  const baseX = hostRect.left + hostRect.width / 2
  const baseY = hostRect.bottom
  return {
    dxRight: target.right + DMG_GAP_PX - baseX,
    dxLeft: target.left - DMG_GAP_PX - textW - baseX,
    dy: target.top + target.height / 2 - baseY + stackOffsetPx(stack),
    textW,
  }
}
function resolveDamageSide(layout, anchorX, stageW, current) {
  const fitsRight = stageW <= 0 || anchorX + layout.dxRight + layout.textW + DMG_DRIFT_PX <= stageW
  const fitsLeft = anchorX + layout.dxLeft - DMG_DRIFT_PX >= 0
  if (current === SIDE_LEFT) return fitsLeft || !fitsRight ? SIDE_LEFT : SIDE_RIGHT
  return fitsRight || !fitsLeft ? SIDE_RIGHT : SIDE_LEFT
}
function setHidden(el, hidden) { if (el.hidden !== hidden) el.hidden = hidden }
function flushAnchors(eids, stageW) {
  const list = damages.value
  if (!list.length) {
    for (const eid of eids) paint(elements.get(eid), anchors.get(eid))
    return
  }
  const preShownHosts = new Set()
  for (const eid of eids) {
    const anchor = anchors.get(eid)
    if (!anchor?.projected) continue
    const host = elements.get(eid)
    if (host && anchor.visible) {
      if (host.hidden) preShownHosts.add(eid)
      setHidden(host, false)
    }
    const key = damageLayoutKey(!!anchor.visible)
    for (const d of list) {
      if (d.eid !== eid || !d.el) continue
      if (!d.layout || d.layoutKey !== key) setHidden(d.el, false)
    }
  }
  for (const eid of eids) {
    const anchor = anchors.get(eid)
    if (!anchor?.projected) continue
    const key = damageLayoutKey(!!anchor.visible)
    for (const d of list) {
      if (d.eid !== eid || !d.el) continue
      if (d.layout && d.layoutKey === key) continue
      const layout = measureDamageLayout(eid, d.el, d.stack, !!anchor.visible)
      if (layout) {
        d.layout = layout
        d.layoutKey = key
        d.layoutPending = false
      } else {
        d.layoutPending = true
      }
    }
  }
  for (const eid of eids) {
    const anchor = anchors.get(eid)
    paint(elements.get(eid), anchor, preShownHosts.has(eid))
    if (!anchor) continue
    const projected = !!anchor.projected
    for (const d of list) {
      if (d.eid !== eid || !d.el) continue
      if (!projected) {
        d.wasProjected = false
        d.layoutPending = false
        setHidden(d.el, true)
        continue
      }
      if (d.layoutPending || !d.layout) {
        setHidden(d.el, true)
        continue
      }
      setHidden(d.el, false)
      const side = resolveDamageSide(d.layout, anchor.x, stageW, d.side)
      if (side !== d.side) {
        d.side = side
        applyDamageDrift(d)
      }
      if (d.wasProjected === false) syncDamageAnimationPhase(d)
      d.wasProjected = true
      const dx = side === SIDE_LEFT ? d.layout.dxLeft : d.layout.dxRight
      d.el.style.transform = `translate3d(${anchor.x + dx}px, ${anchor.y + d.layout.dy}px, 0)`
    }
  }
}
function applyDamageDrift(d) {
  if (!d.el || !d.side) return
  d.el.style.setProperty('--pb-damage-drift-x', `${d.side === SIDE_LEFT ? -DMG_DRIFT_PX : DMG_DRIFT_PX}px`)
}
function syncDamageAnimationPhase(d) {
  const text = d.el?.querySelector('.pb-damage-text')
  if (!text) return
  const age = Math.max(0, performance.now() - d.bornMs)
  text.style.animationDuration = `${d.durationMs}ms`
  text.style.animationDelay = `${-age}ms`
}
watch(() => props.hidden, (hidden, previous) => {
  if (previous === true && hidden === false) {
    for (const d of damages.value) syncDamageAnimationPhase(d)
    for (const el of elements.values()) syncGhostPhase(el)
  }
}, { flush: 'post' })
function bindDamage(d, el) {
  if (!el) { d.el = null; return }
  if (d.el === el) return
  d.el = el
  applyDamageDrift(d)
}
function spawnDamage(eid, hpLoss, durationMs) {
  const id = ++damageSeq
  const occupied = new Set(damages.value.filter((d) => d.eid === eid).map((d) => d.stack))
  let stack = 0
  while (stack < DMG_STACK_SLOTS && occupied.has(stack)) stack++
  if (stack === DMG_STACK_SLOTS) stack = 0
  damages.value = [...damages.value, {
    id, eid, stack, text: '-' + hpLoss, bornMs: performance.now(), durationMs,
    layout: null, layoutKey: null, side: null, el: null, wasProjected: null, layoutPending: false,
  }]
  setTimeout(() => removeDamage(id), Math.max(1, Number(durationMs) || 0))
  return id
}
function removeDamage(id) {
  const next = damages.value.filter((d) => d.id !== id)
  if (next.length === damages.value.length) return
  damages.value = next
}
function clearDamages() { damages.value = [] }
function damageAnimStyle(d) { return { animationDuration: `${d.durationMs}ms` } }
let batchingAnchors = false
let batchStageW = 0
const batchEids = []
function copyAnchor(eid, anchor) {
  let cur = anchors.get(eid)
  if (!cur) { cur = { x: 0, y: 0, visible: false, occluded: false, projected: false }; anchors.set(eid, cur) }
  cur.x = anchor.x; cur.y = anchor.y; cur.visible = anchor.visible; cur.occluded = anchor.occluded
  cur.projected = anchor.projected ?? anchor.visible
  return cur
}
function beginAnchors(stage) {
  batchingAnchors = true
  batchEids.length = 0
  batchStageW = Number.isFinite(stage?.x) ? stage.x : 0
}
function endAnchors() {
  if (!batchingAnchors) return
  batchingAnchors = false
  flushAnchors(batchEids, batchStageW)
  batchEids.length = 0
}
function setAnchor(eid, anchor, stage) {
  copyAnchor(eid, anchor)
  if (batchingAnchors) { batchEids.push(eid); return }
  flushAnchors([eid], Number.isFinite(stage?.x) ? stage.x : batchStageW)
}
function setLabels(rows) { labels.value = rows; labelsSeq++ }
function setMarkerLabels(rows) { markerLabels.value = rows }
function setMarkerAnchor(key, anchor) {
  let cur = markerAnchors.get(key)
  if (!cur) { cur = { x: 0, y: 0, visible: false, opacity: 1 }; markerAnchors.set(key, cur) }
  cur.x = anchor.x; cur.y = anchor.y; cur.visible = anchor.visible !== false
  cur.opacity = anchor.opacity ?? 1
  paintMarker(markerEls.get(key), cur)
}
function paintMarker(el, anchor) {
  if (!el || !anchor) return
  el.hidden = !anchor.visible
  el.style.opacity = String(anchor.opacity)
  el.style.transform = `translate(${anchor.x}px, ${anchor.y}px) translate(-50%, -100%)`
}
function clear() {
  labels.value = []; anchors.clear(); elements.clear()
  markerLabels.value = []; markerEls.clear(); markerAnchors.clear()
  batchingAnchors = false; batchEids.length = 0; batchStageW = 0
  clearDamages()
}
defineExpose({ setLabels, setAnchor, beginAnchors, endAnchors, clear, spawnDamage, removeDamage, clearDamages, setMarkerLabels, setMarkerAnchor })
</script>

<template>
  <div ref="rootEl" class="vehicle-label-overlay" :class="{ 'label-layer-static': !props.interactive }" :hidden="hidden" :style="occludedStyle" data-testid="vehicle-label-overlay">
    <div v-for="row in labels" :key="row.eid" :ref="el => bind(row.eid, el)"
      class="vehicle-label-anchor" :data-eid="row.eid" hidden>
      <PlaybackVehicleLabel
        :player-name="row.playerName" :tank-name="row.tankName" :gun-marks="gunMarks.get(row.accountId)" :friendly="row.friendly"
        :destroyed="row.destroyed" :last-known="row.lastKnown" :last-known-label="lastKnownLabel" :hp="row.hp" :reload="row.reload"
        :consumables="row.consumables"
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
    <div v-for="row in markerLabels" :key="row.key" :ref="el => bindMarker(row.key, el)"
      class="vehicle-label-anchor battle-marker-anchor" :data-marker="row.key" :data-target="row.target || null" hidden>
      <p v-if="markerKindLabel(row)" class="battle-marker-kind" :data-kind="row.kind === 'target' ? row.intent : row.kind" aria-hidden="true">{{ markerKindLabel(row) }}</p>
      <PlaybackVehicleLabel
        v-if="row.kind !== 'target' && (row.player || row.tank)"
        :player-name="row.player" :tank-name="row.tank" :friendly="null"
        :show-player-name="true" :show-tank-name="true"
        :show-hp="false" :show-reload="false"
      />
    </div>
    <div class="pb-damage-layer" aria-hidden="true">
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
.vehicle-label-overlay :deep(.pb-labels) {
  backdrop-filter: none;
  background: color-mix(in oklab, var(--color-canvas) 58%, transparent);
}
.vehicle-label-overlay.label-layer-static .vehicle-class-button { pointer-events: none; }
.vehicle-label-anchor { position: absolute; left: 0; top: 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; }
.vehicle-label-anchor:not([hidden]) { will-change: transform; }
.battle-marker-kind {
  margin: 0 0 2px;
  padding: 1px 10px;
  border-radius: var(--radius-full);
  corner-shape: round;
  background: color-mix(in oklab, var(--color-canvas) 72%, transparent);
  color: var(--color-text-primary);
  font: var(--type-caption);
  white-space: nowrap;
}
.label-occluded { opacity: var(--pb-label-occluded-opacity, .35); }
.pb-damage-layer { position: absolute; inset: 0; pointer-events: none; }
.pb-damage { position: absolute; left: 0; top: 0; --pb-damage-drift-x: 0px; }
.pb-damage[hidden] { display: none; }
.pb-damage-text {
  display: block;
  color: var(--color-playback-damage-text);
  font: var(--type-caption);
  font-size: var(--font-size-h3);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-shadow: var(--text-shadow-playback-damage);
  transform: translate(0, -50%);
  animation: pb-damage-rise linear forwards;
}
@keyframes pb-damage-rise {
  0% { transform: translate(0, -50%); opacity: 1; }
  50% { opacity: 1; }
  100% { transform: translate(var(--pb-damage-drift-x), calc(-50% - var(--space-6))); opacity: 0; }
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
