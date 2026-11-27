<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Crosshair, MoveVertical, Shield } from 'lucide-vue-next'
import { fetchTankData } from '../scene/agentData.js'
import { loadDevices, shellIconUrl, itemIconUrl } from '../utils/researchCatalog.js'
import { shellLabel } from '../scene/tankMeta.js'
import { calibratedPenMul, shellTypeOf, rolledPenetration } from '../scene/viewer/armorPlateModel.js'
import { damageFactorAt, trayShellDamage, trayShellFor } from '../scene/tankMechanics'

const props = defineProps({
  distanceState: { type: Object, default: null },
  shotState: { type: Object, default: null },
  shooterId: { type: Number, default: null },
  scfg: { type: [Number, String], default: null },
  config: { type: [Number, String], default: null },
  upgrade: { type: String, default: null },
  abilities: { type: [String, Array], default: null },
  shell: { type: [Number, String], default: null },
  eqcal: { type: [Number, String], default: null },
  eqenh: { type: [Number, String], default: null },
  eqpitch: { type: [Number, String], default: null },
  calibratedDefault: { type: Boolean, default: false },
  enhancedDefault: { type: Boolean, default: false },
  pitchDefault: { type: Boolean, default: false },
  pitchAvailable: { type: Boolean, default: false },
})
const emit = defineEmits(['shell', 'calibrated', 'enhanced', 'pitch', 'ready', 'distance'])

const { t } = useI18n()
const details = ref(null)
const devices = ref({ calibrated: null, enhanced: null, pitch: null })
let request = 0
onBeforeUnmount(() => { request++ })

async function load(shooterId) {
  const seq = ++request
  details.value = null
  devices.value = { calibrated: null, enhanced: null, pitch: null }
  if (!(shooterId > 0)) return
  try {
    const upgrade = props.upgrade === 'stock' ? 'stock'
      : props.upgrade === 'custom' ? 'custom' : 'top'
    const detailRequest = fetchTankData(shooterId, { upgrade, abilities: props.abilities })
    const [detail, catalog] = await Promise.all([detailRequest, loadDevices()])
    if (seq !== request) return
    details.value = detail
    const list = catalog?.devices || []
    devices.value = {
      calibrated: list.find(item => item.id === 103) || null,
      enhanced: list.find(item => item.id === 110) || null,
      pitch: list.find(item => item.id === 122) || null,
    }
  } catch {
    if (seq === request) details.value = null
  }
}
watch(() => [props.shooterId, props.upgrade, props.abilities], ([id]) => load(id), { immediate: true })

const configs = computed(() => details.value?.configs || [])
const cfgIndex = computed(() => {
  if (!configs.value.length) return null
  const raw = props.scfg ?? props.config
  const wanted = raw == null || raw === '' ? NaN : Number(raw)
  return Number.isInteger(wanted) && wanted >= 0 && wanted < configs.value.length
    ? wanted
    : configs.value.length - 1
})
const shells = computed(() => {
  const configured = configs.value[cfgIndex.value]?.shells
  if (Array.isArray(configured) && configured.length) return configured
  return details.value?.shells || []
})
const hasShells = computed(() => shells.value.length > 0)
watch(hasShells, value => { emit('ready', value) }, { immediate: true })
const shellIndex = computed(() => {
  const n = Number(props.shell)
  return Number.isInteger(n) && n >= 0 && n < shells.value.length ? n : 0
})
const calibrated = computed(() => (props.eqcal == null ? props.calibratedDefault : String(props.eqcal) === '1'))
const enhanced = computed(() => (props.eqenh == null ? props.enhancedDefault : String(props.eqenh) === '1'))
const pitchDevice = computed(() => (props.eqpitch == null ? props.pitchDefault : String(props.eqpitch) === '1'))
const distance = computed(() => props.distanceState?.distance ?? null)
const exactDistance = computed(() => {
  const exact = props.distanceState?.exactDistance
  return typeof exact === 'number' && Number.isFinite(exact) ? exact : distance.value
})
const distanceHint = computed(() => t(props.distanceState?.readOnly ? 'armor.recorded_distance' : 'armor.distance_center'))
const distanceLabel = computed(() => t(props.distanceState?.readOnly ? 'armor.distance_recorded_short' : 'armor.distance_short'))
function changeDistance(event) {
  if (!props.distanceState || props.distanceState.readOnly) return
  const value = Number(event.target.value)
  if (Number.isFinite(value)) emit('distance', value)
}
const shellOptions = computed(() => shells.value.map(shell => {
  const penetration = exactDistance.value != null && typeof shell.penetration === 'number' && Number.isFinite(shell.penetration) && shell.penetration >= 0
    ? Math.round(rolledPenetration(shell.penetration, shell.penetration_far, exactDistance.value, shellTypeOf(shell) === 'he') * (calibrated.value ? calibratedPenMul(shellTypeOf(shell)) : 1))
    : null
  const name = (typeof shell.name === 'string' && shell.name.trim()) || shellLabel(shell) || shell.type || ''
  const tray = trayShellFor(details.value?.mechanics, shell)
  const baseDamage = typeof shell.damage === 'number' && Number.isFinite(shell.damage) ? shell.damage : null
  const damage = tray && (exactDistance.value == null || !Number.isFinite(exactDistance.value))
    ? null
    : trayShellDamage(baseDamage, tray?.sectors, exactDistance.value)
  const multiplier = tray ? damageFactorAt(tray.sectors, exactDistance.value) : null
  return {
    shell,
    name,
    penetration,
    damage,
    multiplier,
    label: `${name} · ${penetration ?? '—'}mm · ${t('armor.shell_distance_basis', { distance: distance.value ?? '—' })}${damage == null ? '' : ` · ${Math.round(damage)}`}`,
  }
}))
const selected = computed(() => shellOptions.value[shellIndex.value])
const shotDistance = computed(() => {
  const exact = props.shotState?.exactDistance
  if (typeof exact !== 'number' || !Number.isFinite(exact)) return props.shotState?.distance ?? null
  const rounded = Math.round(exact)
  return Math.abs(rounded - exact) < 0.05 ? rounded : (Math.round(exact * 10) / 10).toFixed(1)
})
const shotMultiplier = computed(() => {
  const value = props.shotState?.factor
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null
})
</script>

<template>
  <div v-if="shells.length" class="shot-hud" data-testid="armor-shot-hud">
    <div class="hud-controls">
      <div class="hud-row hud-shells" role="group" :aria-label="t('armor.shell')">
        <button
          v-for="(option, index) in shellOptions"
          :key="`hud-shell-${index}`"
          type="button"
          class="hud-shell"
          :class="{ 'is-on': index === shellIndex }"
          :aria-pressed="index === shellIndex"
          :aria-label="option.label"
          :title="option.label"
          :data-testid="`hud-shell-${index}`"
          @click="index === shellIndex ? null : emit('shell', index)"
        >
          <img :src="shellIconUrl(option.shell.type)" alt="" width="28" height="28" loading="eager">
        </button>
      </div>
      <div class="hud-row hud-equipment">
        <button
          type="button"
          class="hud-eq"
          :class="{ 'is-on': calibrated }"
          :aria-pressed="calibrated"
          :aria-label="t('armor.calibrated')"
          :title="t('armor.calibrated')"
          data-testid="hud-calibrated"
          @click="emit('calibrated', !calibrated)"
        >
          <img v-if="devices.calibrated?.icon" :src="itemIconUrl('devices', devices.calibrated.icon)" alt="" width="28" height="28" loading="lazy">
          <Crosshair v-else :size="22" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="hud-eq"
          :class="{ 'is-on': enhanced }"
          :aria-pressed="enhanced"
          :aria-label="t('armor.enhanced')"
          :title="t('armor.enhanced')"
          data-testid="hud-enhanced"
          @click="emit('enhanced', !enhanced)"
        >
          <img v-if="devices.enhanced?.icon" :src="itemIconUrl('devices', devices.enhanced.icon)" alt="" width="28" height="28" loading="lazy">
          <Shield v-else :size="22" aria-hidden="true" />
        </button>
        <button
          v-if="pitchAvailable"
          type="button"
          class="hud-eq"
          :class="{ 'is-on': pitchDevice }"
          :aria-pressed="pitchDevice"
          :aria-label="t('armor.pitch_device')"
          :title="t('armor.pitch_device')"
          data-testid="hud-pitch-device"
          @click="emit('pitch', !pitchDevice)"
        >
          <img v-if="devices.pitch?.icon" :src="itemIconUrl('devices', devices.pitch.icon)" alt="" width="28" height="28" loading="lazy">
          <MoveVertical v-else :size="22" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div class="hud-distance" :title="distanceHint">
      <label for="armor-distance">{{ distanceLabel }}</label>
      <input id="armor-distance" data-testid="hud-distance" type="range"
        :min="distanceState?.min ?? 3" :max="distanceState?.max ?? 500" step="1"
        :value="distance ?? 3" :disabled="!distanceState || distanceState.readOnly"
        :aria-label="distanceHint" :aria-valuetext="`${distance ?? '—'} ${t('armor.distance_unit')}`"
        @input="changeDistance">
      <output for="armor-distance" class="hud-reading" data-testid="hud-distance-value">{{ distance ?? '—' }}<span class="hud-unit"> {{ t('armor.distance_unit') }}</span></output>
    </div>
    <div class="hud-summary" :title="selected?.label">
      <span class="hud-shell-name">{{ selected?.name }}</span>
      <span class="hud-reading hud-penetration" data-testid="hud-penetration">{{ selected?.penetration ?? '—' }}<span class="hud-unit"> mm</span></span>
      <span class="hud-damage-label">
        {{ t('armor.estimated_damage') }}
        <span v-if="selected?.multiplier != null" class="hud-multiplier" data-testid="hud-multiplier">×{{ Math.round(selected.multiplier * 100) }}%</span>
      </span>
      <span class="hud-reading hud-damage" data-testid="hud-damage">{{ selected?.damage == null ? '—' : Math.round(selected.damage) }}<span class="hud-unit"> HP</span></span>
    </div>
    <div v-if="shotState && !distanceState?.readOnly" class="hud-shot" data-testid="hud-shot">
      <span class="hud-shot-label">{{ t('armor.shot_path') }}</span>
      <span class="hud-shot-values">
        <span class="hud-reading" data-testid="hud-shot-distance">{{ shotDistance ?? '—' }}<span class="hud-unit"> {{ t('armor.distance_unit') }}</span></span>
        <span v-if="shotMultiplier != null" class="hud-multiplier" data-testid="hud-shot-multiplier">×{{ shotMultiplier }}%</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.shot-hud { display: grid; gap: var(--space-2); min-inline-size: 0; inline-size: 100%; }
.hud-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); }
.hud-row { display: flex; align-items: center; gap: var(--space-1); }
.hud-shells { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-full); corner-shape: round; background: var(--color-surface-2); }
.hud-shell,
.hud-eq { display: grid; place-items: center; flex-shrink: 0; inline-size: var(--hit-min-comfortable); block-size: var(--hit-min-comfortable); padding: 0; border: 1px solid transparent; border-radius: var(--radius-sm); background: var(--color-surface-2); color: var(--color-text-secondary); cursor: pointer; }
.hud-shell { border-radius: var(--radius-full); corner-shape: round; background: transparent; }
.hud-shell img,
.hud-eq img { inline-size: var(--armor-shot-icon-size); block-size: var(--armor-shot-icon-size); object-fit: contain; }
.hud-shell.is-on,
.hud-eq.is-on { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1)); color: var(--color-accent-text); }
.hud-shell:focus-visible,
.hud-eq:focus-visible,
.hud-distance input:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.hud-distance { display: grid; grid-template-columns: auto minmax(0, 1fr) var(--armor-shot-reading-width); align-items: center; gap: var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); }
.hud-distance input { inline-size: 100%; min-inline-size: 0; min-block-size: var(--hit-min-comfortable); margin: 0; accent-color: var(--color-accent); cursor: pointer; }
.hud-distance input:disabled { cursor: default; }
.hud-summary { display: grid; grid-template-columns: minmax(0, 1fr) var(--armor-shot-reading-width); align-items: baseline; gap: var(--space-2); font: var(--type-caption); }
.hud-shell-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-secondary); }
.hud-reading { color: var(--color-text-primary); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; text-align: end; }
.hud-penetration { color: var(--color-accent-text); }
.hud-unit { color: var(--color-text-secondary); font-weight: 400; }
.hud-damage-label { color: var(--color-text-secondary); font: var(--type-caption); }
.hud-damage { color: var(--color-text-primary); }
.hud-multiplier { margin-inline-start: var(--space-1); color: var(--color-warning); font-variant-numeric: tabular-nums; }
.hud-shot { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); font: var(--type-caption); }
.hud-shot-label { color: var(--color-text-secondary); white-space: nowrap; }
.hud-shot-values { display: inline-flex; align-items: baseline; gap: var(--space-1); min-inline-size: 0; white-space: nowrap; }

@media (pointer: coarse) and (orientation: landscape) and (height <= 500px) {
    .shot-hud {
        grid-template-columns: auto minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 2px 6px;
    }
    .hud-controls { display: contents; }
    .hud-shells {
        grid-column: 1 / -1;
        grid-row: 1;
        justify-self: start;
        gap: 2px;
        border: 0;
    }
    .hud-equipment {
        grid-column: 1 / -1;
        grid-row: 2;
        justify-self: start;
        gap: 2px;
    }
    .hud-shell,
    .hud-eq {
        inline-size: 36px;
        block-size: 36px;
        min-block-size: 36px;
    }
    .hud-shell img,
    .hud-eq img {
        inline-size: 24px;
        block-size: 24px;
    }
    .hud-distance { display: contents; }
    .hud-distance label { grid-column: 1; grid-row: 3; font-size: var(--font-size-caption-xs); line-height: var(--line-height-caption-xs); }
    .hud-distance input {
        grid-column: 2;
        grid-row: 3;
        min-block-size: 30px;
    }
    .hud-distance output { grid-column: 3; grid-row: 3; }
    .hud-summary { display: contents; }
    .hud-shell-name { display: none; }
    .hud-penetration { grid-column: 4; grid-row: 3; }
    .hud-damage-label { grid-column: 1; grid-row: 4; font-size: var(--font-size-caption-xs); line-height: var(--line-height-caption-xs); }
    .hud-damage { grid-column: 3 / -1; grid-row: 4; }
    .hud-shot { grid-column: 1 / -1; grid-row: 5; }
}
</style>
