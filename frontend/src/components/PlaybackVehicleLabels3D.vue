<script setup>
import { shallowRef } from 'vue'
import PlaybackVehicleLabel from './PlaybackVehicleLabel.vue'

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
  anchors.set(eid, anchor)
  paint(elements.get(eid), anchor)
}
function setLabels(rows) { labels.value = rows }
function clear() { labels.value = []; anchors.clear(); elements.clear() }
defineExpose({ setLabels, setAnchor, clear })
</script>

<template>
  <div class="vehicle-label-overlay" :hidden="hidden" data-testid="vehicle-label-overlay">
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
.label-occluded { opacity: .35; }
</style>
