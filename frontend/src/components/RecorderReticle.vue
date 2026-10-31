<script setup>
// 录像者视角的 C-lite 准星：中心点 = Type39 瞄准轴，扩散圆 = 炮管实际指向 + method36 bloom。
// 位置与半径由场景逐帧写入，不走响应式；圆的绝对尺寸是校准值，不是协议结论。
import { ref, watch } from 'vue'

defineOptions({ name: 'RecorderReticle' })

const props = defineProps({
  /** 「隐藏全部 UI」：场景逐帧写入也不能让准星重新出现。 */
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
/** aim / gun 是舞台像素坐标；投影不到时传 null，只隐藏对应部分。 */
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
/* 准星画在 3D 场景上，不随主题变色：经典绿芯 + 深色描边，在雪地、草地和暗处都看得清。 */
.reticle-halo { fill: none; stroke: var(--pb-reticle-outline); stroke-width: 3.5; }
.reticle-circle { fill: none; stroke: var(--pb-reticle-ink); stroke-width: 1.5; }
.reticle-center { fill: var(--pb-reticle-ink); stroke: var(--pb-reticle-outline); stroke-width: 1; }
</style>
