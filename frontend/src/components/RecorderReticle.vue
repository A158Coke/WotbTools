<script setup>
// 录像者视角的 C-lite 准星：中心标记 = Type39 瞄准轴，扩散圆 = method36 bloom。
// 位置与半径由场景逐帧写入，不走响应式；圆的绝对尺寸是校准值，不是协议结论。
import { ref } from 'vue'

defineOptions({ name: 'RecorderReticle' })

const root = ref(null)
const circle = ref(null)

function update(x, y, radius) {
  if (!root.value) return
  root.value.style.display = 'block'
  root.value.style.transform = `translate(${x}px, ${y}px)`
  circle.value?.setAttribute('r', String(radius))
}
function hide() {
  if (root.value) root.value.style.display = 'none'
}

defineExpose({ update, hide })
</script>

<template>
  <div ref="root" class="recorder-reticle" data-testid="recorder-reticle" aria-hidden="true">
    <svg class="reticle-svg" viewBox="-500 -500 1000 1000" width="1000" height="1000">
      <circle ref="circle" class="reticle-circle" r="24" />
      <circle class="reticle-center" r="2" />
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
  width: 0;
  height: 0;
  pointer-events: none;
}
.reticle-svg { position: absolute; top: -500px; left: -500px; overflow: visible; }
.reticle-circle { fill: none; stroke: var(--color-on-accent); stroke-width: 1.5; opacity: .8; }
.reticle-center { fill: var(--color-on-accent); stroke: var(--color-text-primary); stroke-width: .5; }
</style>
