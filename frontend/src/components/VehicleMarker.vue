<script setup>
/**
 * VehicleMarker（计划 §17/§19–§25）——Battle Playback 正式单车 marker 组件。
 *
 * 职责：dedicated/generic model display + hull rotation + turret rotation
 * （含 OFF_CENTER turret assembly 嵌套 transform）+ PR3 状态视觉：
 * - team outline/glow（§19/§20/§21：friendly green|blue / enemy red，CSS vars 由
 *   BattlePlayback 根元素提供；整车 silhouette 表达，generic 与 dedicated 同构）；
 * - Selected 红色倒三角（§22：label 上方、朝下、screen-space 恒定、轻微浮动、
 *   prefers-reduced-motion 停止浮动）；
 * - Recorder 空心菱形（§23：tank 下方居中、地图 friendly 色、静态）；
 * - Destroyed（§24：中度变暗 + grayscale、team outline 弱化保留、红色 ✕ 完整、
 *   一次性 transition <1s、reduced-motion 直达终态）；
 * - Last-known（§25：模型明显弱化、仅弱 outline、label 文字弱化背景正常）。
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
// generic 居中模式：scale 134%（PR3 增补重新校准——generic 素材车体 bbox ≈210×336/512
// （长边 65.6%），dedicated hull.webp 车体长边 ≈88.1%（fit padding 0.88）；134% = 0.881/0.656
// 使 generic 车体长边视觉与 dedicated 对齐（≈31.7px @36px box），img 物理尺寸略大于 box
// 属素材透明 padding 的正常溢出，不构成视觉偏大。
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

// 仅保留有 CSS 规则消费的状态类；Selected/Recorder 改由独立元素表达
// （.pb-selected-mark / .pb-recorder-badge），不再产出无样式 class。
const stateClasses = computed(() => ({
  'pb-last-known': st.value.lastKnown && !st.value.destroyed,
  'pb-destroyed': st.value.destroyed,
  // team 语义 token（PR3 §19/§20：friendly green|blue / enemy red；generic + dedicated 都走）
  'pb-friendly': st.value.friendly === true,
  'pb-enemy': st.value.friendly === false,
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
    <!-- 车型视觉层容器：destroyed/last-known 的 opacity/grayscale/team 光晕精确作用于此处
         （而非整个 button）——pb-death ✕ / pb-selected-mark / pb-recorder-badge / pb-name
         是 button 直接子元素、在容器外，保持完整强度（parent opacity 无法被子元素抵消）。 -->
    <div class="pb-graphics">
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
    </div>

    <!-- PR3 §24 阵亡 ✕：红色 + 大号 + 多层描边（PR #92 Review 通过项）——容器外，完整强度 -->
    <span
      v-if="st.destroyed"
      class="pb-death"
      aria-hidden="true"
      :style="{ color: '#ff4d4f', fontSize: '22px', fontWeight: '800', zIndex: 6, transform: `translateX(-50%) ${st.overlayInverseScale}` }"
    >✕</span>

    <!-- PR3 §22 Selected：红色倒三角（label 上方、永远朝下、screen-space 恒定、轻微浮动） -->
    <span
      v-if="selected"
      class="pb-selected-mark"
      aria-hidden="true"
      :style="{ transform: `translateX(-50%) ${st.overlayInverseScale}` }"
    ></span>

    <!-- PR3 §23 Recorder：空心菱形（tank 下方居中、地图 friendly 色、静态） -->
    <span
      v-if="st.recorder"
      class="pb-recorder-badge"
      aria-hidden="true"
      :style="{ transform: `translate(-50%, -50%) rotate(45deg) ${st.overlayInverseScale}` }"
    ></span>

    <span
      class="pb-name"
      aria-hidden="true"
      :style="{ transform: `translateX(-50%) ${st.overlayInverseScale}` }"
    >{{ st.vehicle.tankName || st.vehicle.tankId }}</span>
  </button>
</template>

<style scoped>
/* —— marker 内部样式（随组件迁移；父组件 scoped 不作用于子元素）—— */
/* generic 素材 512×512 含大量透明留白：放大到按钮 134% 居中（PR3 增补校准，
   见 script 注释的素材占比推导），共同 pivot 旋转 */
.pb-hull, .pb-turret {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 134%;
  height: 134%;
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
/* 车型视觉层容器：与 button 同盒（imgs 百分比定位的 containing block 不变） */
.pb-graphics {
  position: absolute;
  inset: 0;
}

/* —— PR3 §19/§20/§21 team outline + glow（整车 silhouette；generic + dedicated）——
   双层 drop-shadow：近扩散 = outline，远扩散 = glow；色值来自 BattlePlayback 根元素
   CSS vars（friendly = 地图显式 tone green|blue；enemy = red）。
   :not(pb-destroyed/pb-last-known)：与弱化规则互斥（§24/§25 弱化由下面规则负责）。 */
.pb-friendly:not(.pb-destroyed):not(.pb-last-known) .pb-graphics {
  filter:
    drop-shadow(0 0 1px var(--pb-team-outline, rgba(255, 255, 255, 0.5)))
    drop-shadow(0 0 6px var(--pb-team-glow, transparent));
}
.pb-enemy:not(.pb-destroyed):not(.pb-last-known) .pb-graphics {
  filter:
    drop-shadow(0 0 1px var(--pb-enemy-outline, rgba(255, 255, 255, 0.5)))
    drop-shadow(0 0 6px var(--pb-enemy-glow, transparent));
}

/* —— PR3 §24 Destroyed：中度变暗（不再极端透明）+ grayscale + team outline 弱化保留
   （drop-shadow 在 grayscale 之后绘制 → 轮廓不被灰化）；一次性 transition <1s；
   ✕ 在容器外保持完整强度。 —— */
.pb-destroyed .pb-graphics {
  opacity: 0.55;
  transition: opacity 0.45s ease, filter 0.45s ease;
}
.pb-destroyed.pb-friendly .pb-graphics {
  filter: grayscale(1) drop-shadow(0 0 1px var(--pb-team-outline, rgba(255, 255, 255, 0.35)));
}
.pb-destroyed.pb-enemy .pb-graphics {
  filter: grayscale(1) drop-shadow(0 0 1px var(--pb-enemy-outline, rgba(255, 255, 255, 0.35)));
}

/* —— PR3 §25 Last-known：模型明显弱于 OBSERVED（淡化 + 仅弱 outline，无 glow）；
   label 文字弱化、background 正常（见 .pb-name）；Selected/Recorder 正常强度（容器外）。 */
.pb-last-known.pb-friendly .pb-graphics {
  opacity: 0.35;
  filter: drop-shadow(0 0 1px var(--pb-team-outline, rgba(255, 255, 255, 0.35)));
}
.pb-last-known.pb-enemy .pb-graphics {
  opacity: 0.35;
  filter: drop-shadow(0 0 1px var(--pb-enemy-outline, rgba(255, 255, 255, 0.35)));
}

/* —— PR3 §22 Selected 红色倒三角：label 上方、永远朝下、screen-space 恒定
   （overlayInverseScale 反缩放）、轻微上下浮动、深色阴影对比边。
   bottom 19px：name label 顶边 ≈ box 顶 +18px（底边 +2px + 高 ~16px），三角底边 +19px
   避免与 label 重叠（PR3 增补 QA 微调）。 */
.pb-selected-mark {
  position: absolute;
  bottom: calc(100% + 19px);
  left: 50%;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 9px solid #e5484d;
  z-index: 7;
  pointer-events: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
  animation: pb-selected-float 1.6s ease-in-out infinite;
}
@keyframes pb-selected-float {
  0%, 100% { margin-top: 0; }
  50% { margin-top: 2px; }
}

/* —— PR3 §23 Recorder 空心菱形：tank 下方居中、地图 friendly 色（team outline）、静态 —— */
.pb-recorder-badge {
  position: absolute;
  left: 50%;
  top: calc(100% + 5px);
  width: 7px;
  height: 7px;
  border: 1.5px solid var(--pb-team-outline, #ffd76a);
  z-index: 4;
  pointer-events: none;
}

/* 阵亡 ✕（PR #92 Review A 通过项）：红色 + 更大 + 多层描边——深/亮色地图背景都清晰可读，
   与 last-known（仅淡化，无 ✕）语义区分明显。颜色/字号/z-index 由 inline style 提供
   （可测试）；此块负责位置/形状/描边。 */
.pb-death {
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
  line-height: 1;
  z-index: 6;
  pointer-events: none;
  text-shadow:
    0 0 3px rgba(0, 0, 0, 0.9),
    0 0 3px rgba(0, 0, 0, 0.9),
    0 1px 2px rgba(0, 0, 0, 0.8),
    -1px -1px 0 rgba(0, 0, 0, 0.55),
    1px 1px 0 rgba(0, 0, 0, 0.55);
}
/* 常显坦克型号名标签：位于图标上方，经 overlayInverseScale 反缩放 → 字号不随地图缩放；
   last-known 时仅文字弱化（§25：background 保持正常） */
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
.pb-last-known .pb-name {
  color: rgba(255, 255, 255, 0.7);
}

/* —— PR3 §22/§24 reduced motion：停止浮动动画、跳过 destroyed transition（直达终态） —— */
@media (prefers-reduced-motion: reduce) {
  .pb-selected-mark { animation: none; }
  .pb-destroyed .pb-graphics { transition: none; }
}
</style>
