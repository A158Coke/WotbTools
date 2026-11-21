<script setup>
/**
 * VehicleMarker——Battle Playback 正式单车 marker 组件。
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
 * - dedicated turreted：hull.webp 填满等比 square render box 绕中心旋转 + turret assembly
 *   （父层 rotate(H) around 盒中心；子层按 turretRaster 百分比定位，绕 image-local
 *   pivot rotate(T-H)）——数学见 vehicle-models/pivot.js（marker*Transform）；
 * - dedicated turretless：仅 hull（gun/mantlet 已 bake 进 hull；无 fake turret layer）。
 */
import { computed } from 'vue'
import PlaybackVehicleLabel from './PlaybackVehicleLabel.vue'
import TankClassIcon from './TankClassIcon.vue'
import { healthRingDiameter } from '../utils/vehicleMarkerSizing'
import {
  markerTurretAssemblyTransform,
  markerTurretImageTransform,
} from '../vehicle-models/pivot.js'

const props = defineProps({
  /** vehicleState 视图模型（BattlePlayback 构建；含 model / hullScreenDeg / turretScreenDeg / 状态） */
  marker: { type: Object, required: true },
  /** 是否选中（selectedAccountId === accountId） */
  selected: { type: Boolean, default: false },
  classIcons: Boolean,
  showStatus: { type: Boolean, default: true },
  /** PR4 §26–§35：标签显示/碰撞结果（BattlePlayback 计算，本组件只渲染） */
  label: {
    type: Object,
    default: () => ({
      showPlayer: false, showTank: true, tankDy: 0, blockHidden: false, hpHidden: false,
    }),
  },
  /** HP HUD presentation（current/pct/state/knowledge/destroyed）；null=不渲染 */
  hp: { type: Object, default: null },
  /** HP HUD 开关（关闭后隐藏数字/bar/ghost，不影响其余 combat feedback） */
  hpVisible: { type: Boolean, default: true },
  hpMode: { type: String, default: 'bar', validator: value => ['bar', 'ring'].includes(value) },
  /** lost-HP ghost：{prevPct,nextPct}|null（§11；同阵营色浅版，约 600ms 消退） */
  hpGhost: { type: Object, default: null },
  /** 受击 hit flash（§10.3；约 280ms 短暂亮起） */
  hpFlash: { type: Boolean, default: false },
  /** seek/恢复状态帧：禁用 HP bar 过渡动画（§20.1 seek 只恢复状态不补动画） */
  hpNoTransition: { type: Boolean, default: false },
  /** i18n t() 函数（父组件传入，HP 状态 tooltip 文案） */
  t: { type: Function, default: null },
})

const emit = defineEmits(['select'])

const st = computed(() => props.marker)
const model = computed(() => st.value.model || null)
const isDedicated = computed(() => model.value !== null)
const isTurreted = computed(() => model.value?.kind === 'turreted')
const hullDeg = computed(() => st.value.hullScreenDeg)
const turretDeg = computed(() => st.value.turretScreenDeg)

// 2D 是 3D 回放的**严格俯视投影**（2026-10-16）：只呈现平面内姿态（车体/炮塔朝向），
// 不再呈现"多出的维度"（俯仰/侧倾）——原地形高度场合成倾斜已删（见
// docs/features/battle-playback.md「2D 位姿与 3D 同源」）。
// 命中盒 / HP / 名牌 / 选中标记保持屏幕对齐与既有碰撞契约。

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
// hull 图片样式：dedicated 填满等比 square render box（0/0/100%/100%，绕盒中心 = 自身中心旋转）；
// generic 居中模式：scale 134%（PR3 增补重新校准——generic 素材车体 bbox ≈210×336/512
// （长边 65.6%），dedicated hull.webp 车体长边 ≈88.1%（fit padding 0.88）；134% = 0.881/0.656
// 使 generic 车体长边视觉与 dedicated 对齐（≈31.7px @36px box），img 物理尺寸略大于 box
// 属素材透明 padding 的正常溢出，不构成视觉偏大。
const hullImageStyle = computed(() => {
  if (!isDedicated.value) return null
  return { transform: hullDeg.value != null ? `rotate(${hullDeg.value}deg)` : 'none' }
})
// generic 模式 hull/turret：现有 translate(-50%,-50%) rotate() 组合
// destroyed 且无方向时仅保留既有未旋转素材可见性；projected state 仍保持 null。
const genericHullStyle = computed(() =>
  hullDeg.value != null
    ? { transform: `translate(-50%, -50%) rotate(${hullDeg.value}deg)` }
    : st.value.destroyed ? { transform: 'translate(-50%, -50%) rotate(0deg)' } : null,
)
const genericTurretStyle = computed(() =>
  turretDeg.value != null
    ? { transform: `translate(-50%, -50%) rotate(${turretDeg.value}deg)` }
    : st.value.destroyed ? { transform: 'translate(-50%, -50%) rotate(0deg)' } : null,
)

// —— overlay 屏幕间距恒定（B2）：selected/recorder 的 layout offset（bottom/top calc）处于
//    viewport 整体 scale 空间——乘以 overlayInverse（=1/view.scale）反缩放，zoom 下屏幕间距
//    不按 1×/2×/4× 增长；元素自身尺寸仍由 transform scale(inv) 保证。 ——
const overlayInv = computed(() =>
  Number.isFinite(st.value.overlayInverse) && st.value.overlayInverse > 0 ? st.value.overlayInverse : 1,
)
const ringMode = computed(() => props.hpMode === 'ring')
const ringDiameter = computed(() => healthRingDiameter(st.value, props.classIcons))
const ringPct = computed(() => {
  if (props.hp?.state === 'UNKNOWN') return null
  if (Number.isFinite(props.hp?.pct)) return Math.max(0, Math.min(100, props.hp.pct))
  return props.hp?.state === 'RELATIVE_FULL' ? 100 : null
})
const ringStyle = computed(() => ({
  width: `${ringDiameter.value}px`, height: `${ringDiameter.value}px`,
  transform: `translate(-50%, -50%) ${st.value.overlayInverseScale || ''}`,
}))
const hitboxStyle = computed(() => {
  const size = st.value.hitTargetSize
  if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) {
    const ringSize = ringMode.value && props.hpVisible && props.hp && !st.value.destroyed
      ? ringDiameter.value * overlayInv.value : 0
    return { width: `${Math.max(size.width, ringSize)}px`, height: `${Math.max(size.height, ringSize)}px` }
  }
  if (ringMode.value && props.hpVisible && props.hp && !st.value.destroyed) {
    const size = ringDiameter.value * overlayInv.value
    return { width: `${size}px`, height: `${size}px` }
  }
  return {
    width: Math.round((st.value.hitbox ? st.value.hitbox.w : 0.9) * 100) + '%',
    height: Math.round((st.value.hitbox ? st.value.hitbox.h : 0.9) * 100) + '%',
  }
})
// selected 三角 bottom（layout px）推导（B2 残余 + PR4 §27 label 块高度适配）：
//
// 契约：三角底边停在名称块顶边上方 `NAME_GAP_SCREEN_PX`（1× 值 3px）。
//
// 屏幕几何（真实 Chrome，1×/2×/4× 三点实测反解；探针见 scripts/browser-workspace-interaction.mjs
// 的 selected 断言，临时探针脚本已删除）：
// - 名称块是**屏幕恒定尺寸**的一块面，其顶边距 marker 下沿 ≈ `BLOCK_SCREEN_TOP_PX · inv`。
// - 三角 `bottom: calc(100% + X)` 随宿主一起反缩放，落点 ≈ `(X + MARK_LAYOUT_HALF_PX) · inv`；
//   三角是 `width/height: 0` + 9px 上边框、且没有 transform-origin，绕中心 scale 时边框会相对
//   定位点漂 `MARK_LAYOUT_HALF_PX · (1 − inv)` —— 这一项正是旧式漏掉的。
//
// 令 块顶 − 三角底边 = gap，解得 `X = gap + 4.5 + (BLOCK_SCREEN_TOP_PX − 4.5)·inv`。
// 实测（两行名称 + HP）：1× gap = 3.00（契约值），2× = 6.5，4× = 8.25 —— 偏离来自块的屏幕
// 尺寸不随 inv 缩放这一固有性质，属已接受的行为（方向正确、数值有界，不再压住名称）。
//
// 旧式把「块半高」同时当作块顶屏幕偏移用，只在「块高 ≈ 两行名称」时成立；块里加上 HP 段之后
// 块高变了而屏幕偏移没变，三角就被放低了整整一个 combat 块（实测 1× gap −25px，压住玩家名）。
const LABEL_ANCHOR_PX = 2 // .pb-presentation bottom offset（labelsStyle 的唯一事实源）
const MARK_LAYOUT_HALF_PX = 4.5 // 三角高 9px 的一半
const NAME_GAP_SCREEN_PX = 3 // 三角底边 ↔ 名称块顶边的 1× gap
/** 名称块顶边距 marker 下沿的屏幕偏移（1× 校准值，见上方实测说明）。 */
const BLOCK_SCREEN_TOP_PX = 62
/** `tankDy`（碰撞 lane 位移）是屏幕 px，落在缩放坐标系里要乘以 inv。 */
const selectedMarkStyle = computed(() => {
  const inv = overlayInv.value
  const x = NAME_GAP_SCREEN_PX + MARK_LAYOUT_HALF_PX
    + (BLOCK_SCREEN_TOP_PX - MARK_LAYOUT_HALF_PX) * inv
    - props.label.tankDy * inv
  return {
    transform: `translateX(-50%) ${st.value.overlayInverseScale}`,
    bottom: `calc(100% + ${x}px)`,
    // 浮动动画幅度（CSS keyframes calc(2px * var(--pb-overlay-inv))）→ 任意 zoom 恒 ≈2px
    '--pb-overlay-inv': inv,
  }
})

// —— PR4 §26–§35：label 块样式 + PlayerName 截断 tooltip（§30：只有截断才显示完整名）——
const labelsStyle = computed(() => ({
  transform: `translateX(-50%) ${st.value.overlayInverseScale}`,
  // tankDy（screen px）→ layout px（×overlayInv）；碰撞位移只作用于标签块，不影响车体
  bottom: ringMode.value && props.hpVisible && props.hp && !st.value.destroyed
    ? `calc(50% + ${(ringDiameter.value / 2 + LABEL_ANCHOR_PX - props.label.tankDy) * overlayInv.value}px)`
    : props.classIcons
    ? `calc(50% + (var(--space-5) / 2 + var(--space-1) - ${props.label.tankDy}px) * ${overlayInv.value})`
    : `calc(100% + ${LABEL_ANCHOR_PX - props.label.tankDy * overlayInv.value}px)`,
}))
const recorderBadgeStyle = computed(() => ({
  transform: `translate(-50%, -50%) rotate(45deg) ${st.value.overlayInverseScale}`,
  top: `calc(100% + ${5 * overlayInv.value}px)`,
}))


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
    @click="emit('select', $event)"
  >
    <!-- Hull hit target follows the vehicle-aware marker box. It is slightly
         larger than the visible model for touch usability, but is not part of
         visual collision. -->
    <span
      class="pb-hitbox"
      :style="hitboxStyle"
      aria-hidden="true"
    ></span>
    <svg v-if="ringMode && hpVisible && hp && !st.destroyed" class="pb-hp-ring" data-test="pb-hp-ring"
      :class="{ 'is-stale': st.lastKnown || hp.state === 'LAST_KNOWN', 'is-unknown': ringPct == null, 'is-flashing': hpFlash, 'no-transition': hpNoTransition }"
      :style="ringStyle" :data-hp-pct="ringPct" viewBox="0 0 100 100" aria-hidden="true">
      <title v-if="t">{{ hp.state === 'RELATIVE_FULL' ? t('recon.map.playback.hp_full_spawn') : ringPct == null ? t('recon.map.playback.hp_unknown') : `${t('recon.map.playback.current_hp')}: ${hp.current ?? '—'}` }}</title>
      <circle class="pb-hp-ring-track" cx="50" cy="50" r="46" />
      <circle class="pb-hp-ring-fill" cx="50" cy="50" r="46" pathLength="100"
        :stroke-dasharray="ringPct == null ? '3 5' : `${ringPct} ${100 - ringPct}`" transform="rotate(-90 50 50)" />
    </svg>
    <!-- 车型视觉层容器：destroyed/last-known 的 opacity/grayscale/team 光晕精确作用于此处
         （而非整个 button）——pb-death ✕ / pb-selected-mark / pb-recorder-badge / pb-labels
         是 button 直接子元素、在容器外，保持完整强度（parent opacity 无法被子元素抵消）。 -->
    <div v-if="classIcons" class="pb-class-symbol" :class="{ 'is-selected': selected }"
      :style="{ transform: `translate(-50%, -50%) ${st.overlayInverseScale}` }" aria-hidden="true">
      <TankClassIcon :tank-class="st.vehicle.tankClass" />
    </div>
    <div v-else class="pb-graphics">
      <!-- dedicated turreted：hull 填满等比 square render box + turret assembly
           （父层绕盒中心 H，子层绕 image-local pivot T-H） -->
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
          v-if="hullDeg != null || st.destroyed"
          class="pb-hull"
          :src="st.hullImage"
          alt=""
          aria-hidden="true"
          :style="genericHullStyle"
        />
        <img
          v-if="turretDeg != null || st.destroyed"
          class="pb-turret"
          :src="st.turretImage"
          alt=""
          aria-hidden="true"
          :style="genericTurretStyle"
        />
      </template>
    </div>

    <!-- PR3 增补 阵亡 ✕ 主状态化：红色 + 明显放大（30px）+ 覆盖车体中心（不再像名字旁的状态角标）；
         容器外完整强度，不随 .pb-graphics grayscale/opacity 变淡；
         overlayInverseScale 反缩放 → 不随地图 zoom 异常放大，保持屏幕恒定 -->
    <span
      v-if="showStatus && st.destroyed"
      class="pb-death"
      aria-hidden="true"
      :style="{ color: '#ff4d4f', fontSize: '30px', fontWeight: '800', zIndex: 6, transform: `translate(-50%, -50%) ${st.overlayInverseScale}` }"
    >✕</span>

    <!-- PR3 §22 Selected：红色倒三角（label 上方、永远朝下、screen-space 恒定、轻微浮动）；
         阵亡车切换克制变体（pb-selected-restrained：更小 + 更淡，destroyed > selected，
         仍可辨认被选中） -->
    <span
      v-if="showStatus && selected"
      class="pb-selected-mark"
      :class="{ 'pb-selected-restrained': st.destroyed }"
      aria-hidden="true"
      :style="selectedMarkStyle"
    ></span>

    <!-- PR3 §23 Recorder：空心菱形（tank 下方居中、地图 friendly 色、静态） -->
    <span
      v-if="showStatus && st.recorder"
      class="pb-recorder-badge"
      aria-hidden="true"
      :style="recorderBadgeStyle"
    ></span>

    <div class="pb-presentation" :style="labelsStyle">
      <PlaybackVehicleLabel
        :player-name="st.playerName" :tank-name="st.tankName" :gun-marks="st.gunMarks" :friendly="st.friendly"
        :destroyed="st.destroyed" :last-known="st.lastKnown"
        :show-player-name="label.showPlayer && !label.blockHidden"
        :show-tank-name="label.showTank && !label.blockHidden"
        :show-hp="!ringMode && hpVisible && !label.hpHidden" :show-reload="!ringMode && label.showReload !== false"
        :hp="hp" :reload="st.reloadShells" :consumables="st.consumables"
        :hp-ghost="hpGhost" :hp-flash="hpFlash" :hp-no-transition="hpNoTransition"
        :hp-title="hp?.state === 'RELATIVE_FULL' && t ? t('recon.map.playback.hp_full_spawn') : ''"
        name-tooltips
      />
    </div>
  </button>
</template>

<style scoped src="./vehicle-marker.css"></style>
