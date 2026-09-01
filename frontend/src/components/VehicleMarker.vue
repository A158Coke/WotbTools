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
 * - dedicated turreted：hull.webp 填满标记盒绕中心旋转 + turret assembly
 *   （父层 rotate(H) around 盒中心；子层按 turretRaster 百分比定位，绕 image-local
 *   pivot rotate(T-H)）——数学见 vehicle-models/pivot.js（marker*Transform）；
 * - dedicated turretless：仅 hull（gun/mantlet 已 bake 进 hull；无 fake turret layer）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import {
  markerTurretAssemblyTransform,
  markerTurretImageTransform,
} from '../vehicle-models/pivot.js'
import { LABEL_LINE_H, LABEL_PAD_Y } from '../utils/labelLayout'

const props = defineProps({
  /** vehicleState 视图模型（BattlePlayback 构建；含 model / hullScreenDeg / turretScreenDeg / 状态） */
  marker: { type: Object, required: true },
  /** 是否选中（selectedAccountId === accountId） */
  selected: { type: Boolean, default: false },
  /** PR4 §26–§35：标签显示/碰撞结果（BattlePlayback 计算，本组件只渲染） */
  label: {
    type: Object,
    default: () => ({
      showPlayer: false, showTank: true, tankDy: 0, blockHidden: false, hpHidden: false,
      playerHidden: false, playerFading: false,
    }),
  },
  /** HP HUD presentation（current/pct/state/knowledge/destroyed）；null=不渲染 */
  hp: { type: Object, default: null },
  /** HP HUD 开关（关闭后隐藏数字/bar/ghost，不影响其余 combat feedback） */
  hpVisible: { type: Boolean, default: true },
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

// —— overlay 屏幕间距恒定（B2）：selected/recorder 的 layout offset（bottom/top calc）处于
//    viewport 整体 scale 空间——乘以 overlayInverse（=1/view.scale）反缩放，zoom 下屏幕间距
//    不按 1×/2×/4× 增长；元素自身尺寸仍由 transform scale(inv) 保证。 ——
const overlayInv = computed(() =>
  Number.isFinite(st.value.overlayInverse) && st.value.overlayInverse > 0 ? st.value.overlayInverse : 1,
)
// selected 三角 bottom（layout px）推导（B2 残余 + PR4 §27 label 块高度适配）：
// - label 块：bottom anchor 2px；块高 = 显示行数 × 行高 + 块 padding（PR4 单行/双行自适应）；
//   transform scale(inv) 绕中心 → 块顶边 screen = (2 + half)·s + half。
// - 三角：高 9px（border-top）→ 底边 screen = (X + 4.5)·s − 4.5。
// - 要求 底边 = 块顶 + 3px（单行 tank 时 1× 即 19px，既有车辆契约）→ X = 2 + half − 4.5
//   + (half + 3 + 4.5)·inv；§34 tankDy 时三角随块上移（+tankDy×inv）。
const LABEL_ANCHOR_PX = 2 // .pb-labels bottom offset（.pb-labels CSS 唯一事实源）
// 行高/块 padding 单一事实源 = utils/labelLayout（碰撞盒与选中偏移共用同一数字）
const LABEL_TANK_LINE_H = LABEL_LINE_H.tank // .pb-label-tank 行高（font 10px × 1.2）
const LABEL_PLAYER_LINE_H = LABEL_LINE_H.player // .pb-label-player 行高（font 9px × 1.22）
const MARK_LAYOUT_HALF_PX = 4.5 // 三角高 9px 的一半
const NAME_GAP_SCREEN_PX = 3 // 三角底边 ↔ 块顶边屏幕 gap（单行 1× = 19 − 16）
const labelBlockHalf = computed(() => {
  const lines = (props.label.showTank ? LABEL_TANK_LINE_H : 0) + (props.label.showPlayer ? LABEL_PLAYER_LINE_H : 0)
  return (lines + LABEL_PAD_Y) / 2
})
const selectedMarkStyle = computed(() => {
  const inv = overlayInv.value
  const half = labelBlockHalf.value
  const x = LABEL_ANCHOR_PX + half - MARK_LAYOUT_HALF_PX
    + (half + NAME_GAP_SCREEN_PX + MARK_LAYOUT_HALF_PX) * inv
    + props.label.tankDy * inv
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
  bottom: `calc(100% + ${LABEL_ANCHOR_PX + props.label.tankDy * overlayInv.value}px)`,
}))
const playerLineEl = ref(null)
const playerTruncated = ref(false)
watch(
  () => [props.label.showPlayer, props.label.playerHidden, st.value.playerName],
  () => {
    nextTick(() => {
      const el = playerLineEl.value
      playerTruncated.value = !!el && el.scrollWidth > el.clientWidth + 1
    })
  },
  { immediate: true },
)
const playerTooltip = computed(() =>
  playerTruncated.value && props.label.showPlayer && !props.label.playerHidden && st.value.playerName
    ? st.value.playerName
    : undefined,
)
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

// ---- HP HUD（docs/features/battle-playback.md HP HUD）----
// 布局：HP 数字 + 定宽 bar 位于 marker 上方；标签块在有内容时让位（HP 优先级最高）。
// offset（screen px，沿 labelsStyle 同款 inverse-scale 模式）：
//   base 2px + 标签块屏幕高度 + 4px 间隙；标签全关时 = 2 + 0 + 4 = 6px。
const HP_HUD_GAP_PX = 4
const labelScreenHeight = computed(() => {
  const inv = overlayInv.value
  const lines = (props.label.showTank ? LABEL_TANK_LINE_H : 0)
    + (props.label.showPlayer ? LABEL_PLAYER_LINE_H : 0)
  return (lines + LABEL_PAD_Y) * inv
})
const hpHudStyle = computed(() => ({
  transform: 'translateX(-50%) ' + st.value.overlayInverseScale,
  // §22：HP HUD 与 label 块同源位移（labelLayout tankDy 联动；碰撞位移只作用于堆叠，不影响车体）
  bottom: 'calc(100% + ' + (LABEL_ANCHOR_PX + labelScreenHeight.value + HP_HUD_GAP_PX + props.label.tankDy * overlayInv.value) + 'px)',
}))
// 填充只消费 canonical health state：RELATIVE_FULL / CURRENT / LAST_KNOWN /
// UNKNOWN / DESTROYED；没有可证明百分比时不推导比例。
const hpFillWidth = computed(() => {
  const d = props.hp
  if (!d) return '0%'
  if (d.state === 'DESTROYED' || d.state === 'UNKNOWN') return '0%'
  if (d.state === 'RELATIVE_FULL') return '100%'
  if ((d.state === 'CURRENT' || d.state === 'LAST_KNOWN') && d.pct != null) return d.pct + '%'
  return (d.state === 'CURRENT' || d.state === 'LAST_KNOWN') && d.current != null ? '100%' : '0%'
})
// 当前/最后已知 HP 有数字但没有可证明容量时，显示 indeterminate 纹理；
// RELATIVE_FULL 是相对展示状态，UNKNOWN/DESTROYED 不冒充已知 HP。
const hpFillUnknown = computed(() => !!props.hp
  && (props.hp.state === 'CURRENT' || props.hp.state === 'LAST_KNOWN')
  && props.hp.current != null && props.hp.pct == null)
const hpGhostWidth = computed(() => {
  const g = props.hpGhost
  if (!g || !Number.isFinite(g.prevPct) || !Number.isFinite(g.nextPct)) return null
  const w = g.prevPct - g.nextPct
  return w > 0.5 ? w : null
})
const hpGhostLeft = computed(() => {
  const g = props.hpGhost
  return g && Number.isFinite(g.nextPct) ? g.nextPct + '%' : '0%'
})
const hpTitle = computed(() => {
  const d = props.hp
  if (!d) return ''
  if (d.state === 'RELATIVE_FULL') {
    return props.t ? props.t('recon.map.playback.hp_full_spawn') : ''
  }
  return ''
})
const hpClasses = computed(() => ({
  'pb-hp-lastknown': props.hp && props.hp.state === 'LAST_KNOWN' && !props.hp.destroyed,
  'pb-hp-destroyed': st.value.destroyed,
  'pb-hp-flash': props.hpFlash,
  'pb-hp-no-transition': props.hpNoTransition,
  // 相对满血 → 阵营色实心条
  'pb-hp-full-spawn': props.hp && props.hp.state === 'RELATIVE_FULL',
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
    <!-- PR4 §36：hull hitbox（车体视觉范围 + 小 padding，随 marker 缩放；
         按钮其余区域 pointer-events:none 不拦截点击，label/✕/三角/菱形均不可点） -->
    <span
      class="pb-hitbox"
      :style="{ width: Math.round((st.hitbox ? st.hitbox.w : 0.9) * 100) + '%', height: Math.round((st.hitbox ? st.hitbox.h : 0.9) * 100) + '%' }"
      aria-hidden="true"
    ></span>
    <!-- 车型视觉层容器：destroyed/last-known 的 opacity/grayscale/team 光晕精确作用于此处
         （而非整个 button）——pb-death ✕ / pb-selected-mark / pb-recorder-badge / pb-labels
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

    <!-- PR3 增补 阵亡 ✕ 主状态化：红色 + 明显放大（30px）+ 覆盖车体中心（不再像名字旁的状态角标）；
         容器外完整强度，不随 .pb-graphics grayscale/opacity 变淡；
         overlayInverseScale 反缩放 → 不随地图 zoom 异常放大，保持屏幕恒定 -->
    <span
      v-if="st.destroyed"
      class="pb-death"
      aria-hidden="true"
      :style="{ color: '#ff4d4f', fontSize: '30px', fontWeight: '800', zIndex: 6, transform: `translate(-50%, -50%) ${st.overlayInverseScale}` }"
    >✕</span>

    <!-- PR3 §22 Selected：红色倒三角（label 上方、永远朝下、screen-space 恒定、轻微浮动）；
         阵亡车切换克制变体（pb-selected-restrained：更小 + 更淡，destroyed > selected，
         仍可辨认被选中） -->
    <span
      v-if="selected"
      class="pb-selected-mark"
      :class="{ 'pb-selected-restrained': st.destroyed }"
      aria-hidden="true"
      :style="selectedMarkStyle"
    ></span>

    <!-- PR3 §23 Recorder：空心菱形（tank 下方居中、地图 friendly 色、静态） -->
    <span
      v-if="st.recorder"
      class="pb-recorder-badge"
      aria-hidden="true"
      :style="recorderBadgeStyle"
    ></span>

    <!-- HP HUD（docs/features/battle-playback.md HP HUD）：HP 数字 + 定宽 bar，
         位于 marker 上方、标签块之上（HP 优先级最高）；last-known 弱化、destroyed 归零、
         UNKNOWN 显示 —；ghost/flash 由外层 transient 状态驱动；hpVisible=false 整体隐藏 -->
    <div
      v-if="hpVisible && hp && !label.hpHidden"
      class="pb-hp-hud"
      :class="hpClasses"
      :style="hpHudStyle"
      data-test="pb-hp-hud"
      aria-hidden="true"
      :title="hpTitle"
    >
      <span class="pb-hp-num" data-test="pb-hp-num">{{ hp.current != null ? hp.current : '—' }}</span>
      <span class="pb-hp-bar" :class="{ 'pb-hp-unknown-track': hpFillUnknown }">
        <span
          class="pb-hp-fill"
          :class="{ 'pb-hp-fill-unknown': hpFillUnknown }"
          :style="{ width: hpFillWidth }"
        ></span>
        <span
          v-if="hpGhostWidth != null"
          class="pb-hp-ghost"
          :style="{ left: hpGhostLeft, width: hpGhostWidth + '%' }"
        ></span>
      </span>
    </div>

    <!-- PR4 §27/§28：PlayerName + TankName 共享背景 label 块（两行 centered；只显示一项时
         背景自动收缩到单行；tankDy 上移让位）；team 文字色见 CSS；
         destroyed/last-known 只弱化文字、background 保持正常 -->
    <div
      class="pb-labels"
      v-show="!label.blockHidden"
      aria-hidden="true"
      :style="labelsStyle"
    >
      <span
        v-if="label.showPlayer && st.playerName"
        v-show="!label.playerHidden"
        ref="playerLineEl"
        class="pb-label-player"
        :class="{ 'pb-label-fading': label.playerFading }"
        :title="playerTooltip"
        data-test="pb-label-player"
      >{{ st.playerName }}</span>
      <span
        v-if="label.showTank"
        class="pb-label-tank pb-name"
        data-test="pb-label-tank"
      >{{ st.tankName }}</span>
    </div>
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

/* —— PR4 §36 hull hitbox：车体视觉范围 + 小 padding（inline 尺寸 % 随 marker 缩放）；
   不含 gun overflow / 三角 / 菱形 / ✕ / label；destroyed/last-known 仍可点击（§36）—— */
.pb-hitbox {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  cursor: pointer;
  z-index: 3;
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
   label 文字弱化、background 正常（见 .pb-labels）；Selected/Recorder 正常强度（容器外）。 */
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
   B2 残余：实际 bottom 由 inline style 按推导式 X = 4.5 + 14.5×inv px 提供（三角底边
   跟随 name 顶边，屏幕 gap 恒 3px；此处 19px 为 1× 兜底值）；浮动幅度 =
   calc(2px * var(--pb-overlay-inv))（inline 注入 var）→ 任意 zoom 恒 ≈2px。 */
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
  50% { margin-top: calc(2px * var(--pb-overlay-inv, 1)); }
}

/* —— PR3 增补 destroyed + selected 克制表达：阵亡车仍可辨认被选中，但 selected 权重低于
   destroyed——三角线性缩小 67%（9px→6px 高、6px→4px 边） + 透明度 0.55；存活 selected 保持
   完整强度。与 .pb-selected-mark 同特异性且在其后 → border-width 覆盖生效。 —— */
.pb-selected-restrained {
  opacity: 0.55;
  border-left-width: 4px;
  border-right-width: 4px;
  border-top-width: 6px;
}

/* —— PR3 §23 Recorder 空心菱形：tank 下方居中、地图 friendly 色（team outline）、静态；
   B2：实际 offset 由 inline style 按 overlayInverse 反缩放（5×inv px），此处为 1× 兜底值。 —— */
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

/* 阵亡 ✕（PR #92 Review A 通过项 + PR3 增补主状态化）：红色 + 明显放大 + 多层描边——
   深/亮色地图背景都清晰可读，与 last-known（仅淡化，无 ✕）语义区分明显。
   位置改为车体中心（top/left 50% + translate(-50%,-50%)，inline style 提供反缩放），
   覆盖车辆主体而非名字旁角标——第一眼看出"这辆车死了"。
   颜色/字号/z-index 由 inline style 提供（可测试）；此块负责位置/形状/描边。 */
.pb-death {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
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
/* —— PR4 §27/§28：PlayerName + TankName 共享背景 label 块（screen-space 恒定；
   单行/双行自适应；team 文字色 §29；destroyed/last-known 只弱化文字 §24/§25）—— */
.pb-labels {
  position: absolute;
  bottom: calc(100% + 2px); /* 1× 兜底；实际 offset 由 inline style 提供 */
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(0, 0, 0, .55);
  border: 1px solid rgba(255, 255, 255, .14);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .35);
  z-index: 5;
  pointer-events: none;
}
/* §31 TankName 永远完整：不截断、不缩字——无 max-width/ellipsis，允许 background 自然变宽；
   150px 上限只存在于 labelLayout 碰撞估算（TANK_MAX_WIDTH_PX），不作用于视觉。 */
.pb-label-tank {
  font-size: 10px;
  line-height: 1.2;
  font-weight: 600;
  white-space: nowrap;
}
/* §30 PlayerName：按实际像素宽度截断（max-width + ellipsis），截断才有 tooltip（inline title）；
   pointer-events:auto 只为 hover 触发原生 title（§36 点击不选中的拦截在 BattlePlayback 层） */
.pb-label-player {
  font-size: 9px;
  line-height: 1.22;
  opacity: .9;
  white-space: nowrap;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: auto;
}
/* §29 文字跟随 team text token（friendly green|blue / enemy red，根元素 CSS vars） */
.pb-friendly .pb-label-tank,
.pb-friendly .pb-label-player {
  color: var(--pb-team-text, #fff);
}
.pb-enemy .pb-label-tank,
.pb-enemy .pb-label-player {
  color: var(--pb-enemy-text, #ff8d8d);
}
/* §24/§25 destroyed/last-known：只弱化文字，background/border/shadow 保持正常强度 */
.pb-destroyed .pb-labels .pb-label-tank,
.pb-destroyed .pb-labels .pb-label-player,
.pb-last-known .pb-labels .pb-label-tank,
.pb-last-known .pb-labels .pb-label-player {
  opacity: .65;
}
/* §33 恢复 fade-in（约 120ms，仅 opacity；无 translate/bounce/背景过渡） */
.pb-label-fading {
  animation: pb-label-fade-in 0.12s ease;
}
@keyframes pb-label-fade-in {
  from { opacity: 0; }
  to { opacity: 0.9; }
}
@media (prefers-reduced-motion: reduce) {
  .pb-label-fading { animation: none; }
}

/* —— HP HUD（docs/features/battle-playback.md HP HUD）：数字 + 定宽 bar，screen-space
   恒定（overlayInverseScale 反缩放）；friendly/enemy 沿用 team token（§4.2 现有阵营色）——
    friendly = --pb-team-text（地图 tone），enemy = --pb-enemy-text（red）——与整车 outline 同源。
   UNKNOWN（maxHp 缺失）时 fill 进入斜纹 UNKNOWN 语义（§5.2：不伪造百分比、不隐藏 HP）。 */
.pb-hp-hud {
  position: absolute;
  bottom: calc(100% + 6px); /* 1× 兜底；实际 offset 由 inline style 提供 */
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  z-index: 8;
  pointer-events: none;
  white-space: nowrap;
}
.pb-hp-num {
  font-size: 10px;
  line-height: 1.1;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff;
  text-shadow:
    0 0 2px rgba(0, 0, 0, 0.9),
    0 0 3px rgba(0, 0, 0, 0.9),
    0 1px 2px rgba(0, 0, 0, 0.8);
}
.pb-hp-bar {
  position: relative;
  width: 46px;
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.18);
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}
.pb-hp-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  transition: width 0.2s linear; /* §10.3：150–300ms 快速缩短（seek 由 pb-hp-no-transition 禁用） */
}
.pb-friendly .pb-hp-fill { background: var(--pb-team-text, #4ade80); }
.pb-enemy .pb-hp-fill { background: var(--pb-enemy-text, #f87171); }
/* §5.2 UNKNOWN：maxHp 缺失 → 斜纹灰段，不伪造百分比 */
.pb-hp-fill-unknown {
  background: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.28) 0 3px, transparent 3px 6px) !important;
}
/* §11 lost-HP ghost：同阵营色浅版（低透明），约 GHOST_MS 线性消退 */
.pb-hp-ghost {
  position: absolute;
  top: 0;
  bottom: 0;
  animation: pb-ghost-fade 0.6s ease forwards;
}
.pb-friendly .pb-hp-ghost { background: var(--pb-team-text, #4ade80); }
.pb-enemy .pb-hp-ghost { background: var(--pb-enemy-text, #f87171); }
@keyframes pb-ghost-fade {
  from { opacity: 0.55; }
  to { opacity: 0; }
}
/* §10.3 hit flash：短暂亮起（约 FLASH_MS） */
.pb-hp-flash .pb-hp-fill {
  animation: pb-hp-flash 0.28s ease-out;
}
@keyframes pb-hp-flash {
  0% { filter: brightness(2.2); }
  100% { filter: brightness(1); }
}
/* §7.1 last-known：HP 冻结为最后可信值，整体弱化/desaturate */
.pb-hp-lastknown .pb-hp-num { opacity: 0.55; }
.pb-hp-lastknown .pb-hp-fill { opacity: 0.45; }
/* §12 destroyed：HP 归零，弱化表达 */
.pb-hp-destroyed .pb-hp-num { opacity: 0.5; }
.pb-hp-destroyed .pb-hp-fill { opacity: 0.5; }
/* §20.1 seek/状态恢复帧：禁用 HP bar transition（不补动画） */
.pb-hp-no-transition .pb-hp-fill { transition: none; }

/* —— PR3 §22/§24 reduced motion：停止浮动动画、跳过 destroyed transition（直达终态） —— */
@media (prefers-reduced-motion: reduce) {
  .pb-selected-mark { animation: none; }
  .pb-destroyed .pb-graphics { transition: none; }
  /* §21 prefers-reduced-motion：取消 ghost/flash 动画（保留准确 HP/伤害事实） */
  .pb-hp-ghost { animation: none; opacity: 0.3; }
  .pb-hp-flash .pb-hp-fill { animation: none; }
}
</style>
