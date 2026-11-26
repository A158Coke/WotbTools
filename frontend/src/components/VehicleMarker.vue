<script setup>
import { computed } from 'vue'
import PlaybackVehicleLabel from './PlaybackVehicleLabel.vue'
import TankClassIcon from './TankClassIcon.vue'
import { healthRingDiameter } from '../utils/vehicleMarkerSizing'
import {
  markerTurretAssemblyTransform,
  markerTurretImageTransform,
} from '../vehicle-models/pivot.js'

const props = defineProps({
  marker: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  classIcons: Boolean,
  showStatus: { type: Boolean, default: true },
  label: {
    type: Object,
    default: () => ({
      showPlayer: false, showTank: true, tankDy: 0, blockHidden: false, hpHidden: false,
    }),
  },
  hp: { type: Object, default: null },
  hpVisible: { type: Boolean, default: true },
  hpMode: { type: String, default: 'bar', validator: value => ['bar', 'ring'].includes(value) },
  hpGhost: { type: Object, default: null },
  hpFlash: { type: Boolean, default: false },
  hpNoTransition: { type: Boolean, default: false },
  t: { type: Function, default: null },
})

const emit = defineEmits(['select'])

const st = computed(() => props.marker)
const model = computed(() => st.value.model || null)
const isDedicated = computed(() => model.value !== null)
const isTurreted = computed(() => model.value?.kind === 'turreted')
const hullDeg = computed(() => st.value.hullScreenDeg)
const turretDeg = computed(() => st.value.turretScreenDeg)


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
const hullImageStyle = computed(() => {
  if (!isDedicated.value) return null
  return { transform: hullDeg.value != null ? `rotate(${hullDeg.value}deg)` : 'none' }
})
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
const LABEL_ANCHOR_PX = 2
const MARK_LAYOUT_HALF_PX = 4.5
const NAME_GAP_SCREEN_PX = 3
const BLOCK_SCREEN_TOP_PX = 62
const selectedMarkStyle = computed(() => {
  const inv = overlayInv.value
  const x = NAME_GAP_SCREEN_PX + MARK_LAYOUT_HALF_PX
    + (BLOCK_SCREEN_TOP_PX - MARK_LAYOUT_HALF_PX) * inv
    - props.label.tankDy * inv
  return {
    transform: `translateX(-50%) ${st.value.overlayInverseScale}`,
    bottom: `calc(100% + ${x}px)`,
    '--pb-overlay-inv': inv,
  }
})

const labelsStyle = computed(() => ({
  transform: `translateX(-50%) ${st.value.overlayInverseScale}`,
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


const stateClasses = computed(() => ({
  'pb-last-known': st.value.lastKnown && !st.value.destroyed,
  'pb-destroyed': st.value.destroyed,
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
    <div v-if="classIcons" class="pb-class-symbol" :class="{ 'is-selected': selected }"
      :style="{ transform: `translate(-50%, -50%) ${st.overlayInverseScale}` }" aria-hidden="true">
      <TankClassIcon :tank-class="st.vehicle.tankClass" />
    </div>
    <div v-else class="pb-graphics">
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

    <span
      v-if="showStatus && st.destroyed"
      class="pb-death"
      aria-hidden="true"
      :style="{ color: '#ff4d4f', fontSize: '30px', fontWeight: '800', zIndex: 6, transform: `translate(-50%, -50%) ${st.overlayInverseScale}` }"
    >✕</span>

    <span
      v-if="showStatus && selected"
      class="pb-selected-mark"
      :class="{ 'pb-selected-restrained': st.destroyed }"
      aria-hidden="true"
      :style="selectedMarkStyle"
    ></span>

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
