<script setup>
/**
 * VehicleMarker（计划 §17）——Battle Playback 正式单车 marker 组件。
 *
 * 职责：dedicated/generic model display + hull rotation + turret rotation
 * （含 OFF_CENTER turret assembly 嵌套 transform）。Selected/Recorder/Destroyed/
 * Last-known 视觉状态沿用现有 class（PR3 重设计后整体迁移）。
 * 不负责：replay parsing / Tankopedia lookup / resource fallback decision /
 * 全局 label collision / playback timeline / map orchestration（外层 BattlePlayback 完成）。
 *
 * 渲染路径：
 * - generic（marker.model == null）：现有通用 PNG 双层（共同 pivot 居中旋转，行为不变）；
 * - dedicated turreted：hull.webp 填满标记盒绕中心旋转 + turret assembly
 *   （父层 rotate(H) around 盒中心；子层按 turretRaster 百分比定位，绕 image-local
 *   pivot rotate(T-H)）——数学见 vehicle-models/pivot.js（marker*Transform）；
 * - dedicated turretless：仅 hull（gun/mantlet 已 bake 进 hull；无 fake turret layer）。
 */
import { computed } from 'vue'
import {
  markerTurretAssemblyTransform,
  markerTurretImageTransform,
} from '../vehicle-models/pivot.js'

const props = defineProps({
  /** vehicleState 视图模型（BattlePlayback 构建；含 model / hullScreenDeg / turretScreenDeg / 状态） */
  marker: { type: Object, required: true },
  /** 是否选中（selectedAccountId === accountId） */
  selected: { type: Boolean, default: false },
})

const emit = defineEmits(['select'])

const st = computed(() => props.marker)
const model = computed(() => st.value.model || null)
const isDedicated = computed(() => model.value !== null)
const isTurreted = computed(() => model.value?.kind === 'turreted')
const hullDeg = computed(() => st.value.hullScreenDeg)
const turretDeg = computed(() => st.value.turretScreenDeg)

// —— dedicated turret assembly（嵌套 transform）——
const assemblyStyle = computed(() =>
  isDedicated.value && isTurreted.value && turretDeg.value != null
    ? markerTurretAssemblyTransform({ hullDeg: hullDeg.value ?? 0 })
    : null,
)
const turretImageStyle = computed(() => {
  if (!isDedicated.value || !isTurreted.value || turretDeg.value == null) return null
  return markerTurretImageTransform({
    hullDeg: hullDeg.value ?? 0,
    turretWorldDeg: turretDeg.value,
    raster: model.value.turretRaster,
  })
})
// hull 图片样式：dedicated 填满标记盒（0/0/100%/100%，绕盒中心 = 自身中心旋转）；
// generic 保持现有 131% 居中模式（视觉不变）。
const hullImageStyle = computed(() => {
  if (!isDedicated.value) return null
  return { transform: hullDeg.value != null ? `rotate(${hullDeg.value}deg)` : 'none' }
})
// generic 模式 hull/turret：现有 translate(-50%,-50%) rotate() 组合
const genericHullStyle = computed(() =>
  hullDeg.value != null ? { transform: `translate(-50%, -50%) rotate(${hullDeg.value}deg)` } : null,
)
const genericTurretStyle = computed(() =>
  turretDeg.value != null ? { transform: `translate(-50%, -50%) rotate(${turretDeg.value}deg)` } : null,
)

const stateClasses = computed(() => ({
  'pb-last-known': st.value.lastKnown && !st.value.destroyed,
  'pb-destroyed': st.value.destroyed,
  'pb-recorder': st.value.recorder,
  'pb-selected': props.selected,
}))
</script>

<template>
  <button
    type="button"
    class="pb-vehicle"
    :class="stateClasses"
    :style="st.markerStyle"
    :aria-label="st.ariaLabel"
    :data-test="`pb-marker-${st.vehicle.accountId}`"
    @click="emit('select')"
  >
    <!-- dedicated turreted：hull 满盒 + turret assembly（父层绕盒中心 H，子层绕 image-local pivot T-H） -->
    <template v-if="isDedicated && isTurreted">
      <img
        v-if="hullDeg != null"
        class="pb-hull pb-hull-dedicated"
        :src="model.hullSrc"
        alt=""
        aria-hidden="true"
        :style="hullImageStyle"
      />
      <div
        v-if="turretDeg != null"
        class="pb-turret-assembly"
        :style="assemblyStyle"
      >
        <img
          class="pb-turret pb-turret-dedicated"
          :src="model.turretSrc"
          alt=""
          aria-hidden="true"
          :style="turretImageStyle"
        />
      </div>
    </template>

    <!-- dedicated turretless：仅 hull（gun 已 bake 进 hull；无 fake turret layer） -->
    <template v-else-if="isDedicated">
      <img
        v-if="hullDeg != null"
        class="pb-hull pb-hull-dedicated"
        :src="model.hullSrc"
        alt=""
        aria-hidden="true"
        :style="hullImageStyle"
      />
    </template>

    <!-- generic：现有双层 PNG（共同 pivot 居中旋转，行为不变） -->
    <template v-else>
      <img
        v-if="hullDeg != null"
        class="pb-hull"
        :src="st.hullImage"
        alt=""
        aria-hidden="true"
        :style="genericHullStyle"
      />
      <img
        v-if="turretDeg != null"
        class="pb-turret"
        :src="st.turretImage"
        alt=""
        aria-hidden="true"
        :style="genericTurretStyle"
      />
    </template>

    <span
      v-if="st.destroyed"
      class="pb-death"
      aria-hidden="true"
      :style="{ transform: `translateX(-50%) ${st.overlayInverseScale}` }"
    >✕</span>
    <span
      class="pb-name"
      aria-hidden="true"
      :style="{ transform: `translateX(-50%) ${st.overlayInverseScale}` }"
    >{{ st.vehicle.tankName || st.vehicle.tankId }}</span>
  </button>
</template>

<style scoped>
/* —— marker 内部样式（原 BattlePlayback.vue，随组件迁移；父组件 scoped 不作用于子元素）—— */
/* generic 素材 512×512 含大量透明留白：放大到按钮 131% 居中，共同 pivot 旋转 */
.pb-hull, .pb-turret {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 131%;
  height: 131%;
  transform: translate(-50%, -50%);
}
.pb-hull { z-index: 1; }
.pb-turret { z-index: 2; }
/* dedicated hull：填满标记盒，绕盒中心（= 自身中心）旋转（rotate 由 inline style 提供） */
.pb-hull-dedicated {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
/* dedicated turret assembly：随 hull 绕盒中心旋转（座圈随车体移动） */
.pb-turret-assembly {
  position: absolute;
  inset: 0;
  z-index: 2;
}
/* dedicated turret：raster 百分比定位 + image-local pivot 旋转（inline style 提供） */
.pb-turret-dedicated {
  position: absolute;
  z-index: 1;
}
/* 阵亡：整层灰化（含 dedicated hull/turret） */
.pb-destroyed .pb-hull, .pb-destroyed .pb-turret, .pb-destroyed .pb-turret-assembly { filter: grayscale(1); }
.pb-death {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  z-index: 4;
  pointer-events: none;
  text-shadow: 0 0 2px #000, 0 0 2px #000;
}
/* 常显坦克型号名标签：位于图标上方，经 overlayInverseScale 反缩放 → 字号不随地图缩放 */
.pb-name {
  position: absolute;
  bottom: calc(100% + 2px);
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  line-height: 1.2;
  color: #fff;
  background: rgba(0, 0, 0, .55);
  padding: 1px 4px;
  border-radius: 3px;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  z-index: 5;
  pointer-events: none;
}
</style>

