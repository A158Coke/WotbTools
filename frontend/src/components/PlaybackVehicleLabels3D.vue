<script setup>
import { shallowRef } from 'vue'
import PlaybackVehicleLabel from './PlaybackVehicleLabel.vue'
import { LABEL_OCCLUDED_OPACITY } from '../utils/labelLayout.js'

defineProps({
  labelPrefs: { type: Object, required: true },
  hpPrefs: { type: Object, required: true },
  hidden: Boolean,
})
// Only this child receives 10 Hz content snapshots. Screen coordinates bypass
// Vue entirely: Three.js moves a bounded set of DOM anchors at render speed.
const labels = shallowRef([])
const elements = new Map()
const anchors = new Map()
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
function setAnchor(eid, anchor) {
  // 契约：**同步拷贝**进自有 per-eid 存储，不持有调用方对象引用——场景内核逐帧逐车
  // 复用同一个 scratch 对象喂所有 eid（60Hz ×14 个对象的分配热路径），若这里存引用，
  // 全部 eid 会共享最后一辆车的坐标。
  let cur = anchors.get(eid)
  if (!cur) { cur = { x: 0, y: 0, visible: false, occluded: false }; anchors.set(eid, cur) }
  cur.x = anchor.x; cur.y = anchor.y; cur.visible = anchor.visible; cur.occluded = anchor.occluded
  paint(elements.get(eid), cur)
}
function setLabels(rows) { labels.value = rows }
function clear() { labels.value = []; anchors.clear(); elements.clear() }
defineExpose({ setLabels, setAnchor, clear })
</script>

<template>
  <div class="vehicle-label-overlay" :hidden="hidden" :style="occludedStyle" data-testid="vehicle-label-overlay">
    <div v-for="row in labels" :key="row.eid" :ref="el => bind(row.eid, el)"
      class="vehicle-label-anchor" :data-eid="row.eid" hidden>
      <PlaybackVehicleLabel
        :player-name="row.playerName" :tank-name="row.tankName" :friendly="row.friendly"
        :destroyed="row.destroyed" :last-known="row.lastKnown" :hp="row.hp" :reload="row.reload"
        :hp-ghost="row.hpGhost" :hp-flash="row.hpFlash" :hp-no-transition="true"
        :show-player-name="labelPrefs.showPlayerName" :show-tank-name="labelPrefs.showTankName"
        :show-hp="hpPrefs.showHp" :show-reload="labelPrefs.showReload"
      />
    </div>
  </div>
</template>

<style scoped>
.vehicle-label-overlay { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: var(--pb-z-canvas); }
.vehicle-label-overlay[hidden], .vehicle-label-anchor[hidden] { display: none; }
.vehicle-label-anchor { position: absolute; left: 0; top: 0; pointer-events: none; }
.label-occluded { opacity: var(--pb-label-occluded-opacity, .35); }
</style>
