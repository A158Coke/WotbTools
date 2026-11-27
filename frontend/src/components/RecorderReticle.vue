<script setup>
import { ref, watch } from 'vue'

defineOptions({ name: 'RecorderReticle' })

const props = defineProps({
  suppressed: Boolean,
})

const root = ref(null)
const center = ref(null)
const circle = ref(null)
const halo = ref(null)
let active = false

function syncDisplay() {
  if (root.value) root.value.style.display = active && !props.suppressed ? 'block' : 'none'
}
function place(node, point) {
  if (!node) return
  node.style.display = point ? '' : 'none'
  if (!point) return
  node.setAttribute('cx', String(point.x))
  node.setAttribute('cy', String(point.y))
}
function update(aim, gun, radius) {
  if (!root.value) return
  active = true
  place(center.value, aim)
  place(circle.value, gun)
  place(halo.value, gun)
  circle.value?.setAttribute('r', String(radius))
  halo.value?.setAttribute('r', String(radius))
  syncDisplay()
}
function hide() {
  active = false
  syncDisplay()
}
watch(() => props.suppressed, syncDisplay)

defineExpose({ update, hide })
</script>

<template>
  <div ref="root" class="recorder-reticle" data-testid="recorder-reticle" aria-hidden="true">
    <svg class="reticle-svg" width="1" height="1">
      <circle ref="halo" class="reticle-halo" r="24" />
      <circle ref="circle" class="reticle-circle" r="24" />
      <circle ref="center" class="reticle-center" r="2" />
    </svg>
  </div>
</template>

<style scoped>
.recorder-reticle {
  position: absolute;
  top: 0;
  left: 0;
  z-index: var(--pb-z-hud);
  display: none;
  pointer-events: none;
}
.reticle-svg { position: absolute; top: 0; left: 0; overflow: visible; }
.reticle-halo { fill: none; stroke: var(--pb-reticle-outline); stroke-width: 3.5; }
.reticle-circle { fill: none; stroke: var(--pb-reticle-ink); stroke-width: 1.5; }
.reticle-center { fill: var(--pb-reticle-ink); stroke: var(--pb-reticle-outline); stroke-width: 1; }
</style>
