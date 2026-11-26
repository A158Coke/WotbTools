<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import GunMarksBadge from './GunMarksBadge.vue'
import { useI18n } from 'vue-i18n'
import {
  healthDisplayAt,
  lifeAt,
  positionCoveredAtV2,
  consumableRuntimeSlotsAt,
  moduleCrewStatesAt,
} from '../utils/battlePlaybackV2.ts'
import { loadoutItemLabel } from '../data/loadoutItems.js'
import { deviceById, itemIconUrl, loadDevices } from '../utils/researchCatalog.js'
import { consumableIconUrl, provisionIconUrl } from '../utils/loadoutIcons.js'
import { romanLevel } from '../utils/tierFormat.js'

const props = defineProps({
  track: { type: Object, required: true },
  timeSec: { type: Number, required: true },
  gunMarks: { default: null }
})

const { t, te, locale } = useI18n()
const router = useRouter()

const devices = ref(null)
const devicesState = ref('loading')
onMounted(async () => {
  try {
    devices.value = (await loadDevices()).devices
    devicesState.value = 'ready'
  } catch {
    devices.value = null
    devicesState.value = 'error'
  }
})
function equipmentIcon(id) {
  const device = deviceById(devices.value, id)
  return device ? itemIconUrl('devices', device.icon) : null
}

const equipmentIdList = computed(() => (props.track.loadout?.equipmentIds || []).filter(id => Number.isInteger(id) && id > 0))
function openInConfigurator() {
  if (!(props.track.tankId > 0)) return
  router.push({
    query: {
      view: 'agent-tankopedia',
      tank: String(props.track.tankId),
      ...(equipmentIdList.value.length ? { eq: equipmentIdList.value.join(',') } : {}),
    },
  })
}

const life = computed(() => lifeAt(props.track, props.timeSec))
const health = computed(() => healthDisplayAt(props.track, props.timeSec))
const covered = computed(() => positionCoveredAtV2(props.track.positionSegments, props.timeSec))
const loadout = computed(() => props.track.loadout || null)

function itemLabel(scope, id) {
  const name = loadoutItemLabel(scope, id, locale.value)
  if (name) return name
  let key = 'recon.map.playback.loadout_unknown_equipment'
  if (scope === 'consumable') key = 'recon.map.playback.loadout_unknown_consumable'
  if (scope === 'provision') key = 'recon.map.playback.loadout_unknown_provision'
  return t(key)
}

function consumableStateLabel(state) {
  if (!state || state === 'UNKNOWN') return ''
  const key = `recon.map.playback.consumable_state.${state}`
  return te(key) ? t(key) : t('recon.map.playback.consumable_state.UNKNOWN')
}

const consumables = computed(() => {
  if (!loadout.value) return []
  const wireCodes = loadout.value.consumableWireCodes || []
  const ids = loadout.value.consumables || []
  const runtimes = consumableRuntimeSlotsAt(props.track.consumableTransitions, props.timeSec)
  return Array.from({ length: 3 }, (_, i) => {
    const id = ids[i] ?? null
    const slotWire = wireCodes[i]
    const rt = runtimes.get(i)
    const logicalItemId = rt?.logicalItemId || id
    const empty = id == null && !(Number.isInteger(slotWire) && slotWire > 0)
    return {
      slot: i,
      logicalItemId,
      wireCode: slotWire,
      runtimeState: rt?.state || 'UNKNOWN',
      empty,
      icon: empty ? null : consumableIconUrl(logicalItemId),
      label: empty ? t('recon.map.playback.equipment_empty') : itemLabel('consumable', logicalItemId),
      ariaLabel: (() => {
        const base = empty ? t('recon.map.playback.equipment_empty') : itemLabel('consumable', logicalItemId)
        const state = rt?.state && rt.state !== 'UNKNOWN' ? consumableStateLabel(rt.state) : ''
        return state ? `${base} · ${state}` : base
      })(),
    }
  })
})

const provisionLabels = computed(() => {
  if (!loadout.value) return []
  return Array.from({ length: 3 }, (_, i) => {
    const id = loadout.value.provisions?.[i] ?? null
    const wire = loadout.value.provisionWireCodes?.[i] ?? null
    const empty = id == null && !(Number.isInteger(wire) && wire > 0)
    return {
      slot: i,
      empty,
      icon: empty ? null : provisionIconUrl(id),
      label: empty ? t('recon.map.playback.equipment_empty') : itemLabel('provision', id),
    }
  })
})

const equipmentLabels = computed(() => {
  if (!loadout.value) return []
  return (loadout.value.equipmentIds || [])
    .filter(id => Number.isInteger(id) && id > 0)
    .map((id, index) => ({
      slot: index,
      id,
      icon: equipmentIcon(id),
      label: itemLabel('equipment', id),
    }))
})

const modules = computed(() => moduleCrewStatesAt(props.track.moduleCrewTransitions, props.timeSec))

const stateLabel = computed(() => {
  if (life.value?.lifeState === 'DESTROYED') return t('recon.map.playback.state_destroyed')
  if (covered.value) return t('recon.map.playback.state_current_observation')
  if (valueSeen.value) return t('recon.map.playback.state_last_known')
  return t('recon.map.playback.unknown')
})

const valueSeen = computed(() => health.value != null || loadout.value != null)

const VEHICLE_CLASS_KEYS = {
  'Heavy tank': 'recon.map.playback.vehicle_class_heavy',
  'Medium tank': 'recon.map.playback.vehicle_class_medium',
  'Light tank': 'recon.map.playback.vehicle_class_light',
  'Tank destroyer': 'recon.map.playback.vehicle_class_td',
  'SPG': 'recon.map.playback.vehicle_class_spg',
}
const tankClassLabel = computed(() => {
  const cls = props.track.tankClass
  if (!cls) return '—'
  const key = VEHICLE_CLASS_KEYS[cls]
  return key ? t(key) : cls
})

function moduleComponentLabel(component) {
  const key = `recon.map.playback.module_component.${component}`
  return te(key) ? t(key) : t('recon.map.playback.module_component.UNKNOWN')
}

function moduleStateLabel(state) {
  const key = `recon.map.playback.module_value.${state}`
  return te(key) ? t(key) : t('recon.map.playback.module_value.UNKNOWN')
}
</script>

<template>
  <div class="v2-inspector" data-test="v2-vehicle-inspector">
    <div class="v2-inspector-row" data-test="v2-inspector-hp">
      <span class="v2-inspector-key">{{ $t('recon.map.playback.current_hp') }}</span>
      <span class="v2-inspector-val">
        <template v-if="health?.destroyed">{{ $t('recon.map.playback.state_destroyed') }}</template>
        <template v-else>
          {{ health?.currentHp ?? '—' }}
          <span v-if="health?.knowledge === 'LAST_KNOWN'" class="v2-inspector-badge">
            {{ $t('recon.map.playback.last_known_hp') }}
          </span>
          <span v-if="health?.displayCapacityHp" class="v2-inspector-cap">
            / {{ health.displayCapacityHp }}
          </span>
        </template>
      </span>
    </div>

    <div class="v2-inspector-row" data-test="v2-inspector-life">
      <span class="v2-inspector-key">{{ $t('recon.map.playback.state') }}</span>
      <span class="v2-inspector-val">{{ stateLabel }}</span>
    </div>

    <div class="v2-inspector-row" data-test="v2-inspector-knowledge">
      <span class="v2-inspector-key">{{ $t('recon.map.playback.vehicle_type') }}</span>
      <span class="v2-inspector-val">{{ tankClassLabel }}</span>
    </div>

    <div class="v2-inspector-row" data-test="v2-inspector-gun-marks">
      <span class="v2-inspector-key">{{ $t('player_labels.gun_marks') }}</span>
      <span class="v2-inspector-val"><GunMarksBadge :marks="gunMarks" show-count /></span>
    </div>

    <div class="v2-inspector-row" data-test="v2-inspector-tier">
      <span class="v2-inspector-key">{{ $t('recon.map.playback.tank_tier') }}</span>
      <span class="v2-inspector-val">{{ romanLevel(track.tankTier) || '—' }}</span>
    </div>

    <template v-if="loadout">
      <div class="v2-inspector-section">{{ $t('recon.map.playback.loadout') }}</div>
      <div class="v2-inspector-loadout" data-test="v2-inspector-loadout">
        <div class="v2-loadout-group" data-test="v2-inspector-consumables">
          <div class="v2-loadout-group-title">{{ $t('recon.map.playback.consumable') }}</div>
          <div class="v2-loadout-grid">
        <div
          v-for="c in consumables"
          :key="'c' + c.slot"
          class="v2-inspector-chip"
          :class="{ 'is-empty': c.empty, 'is-unknown': !c.empty && !c.icon }"
          role="img"
          :title="c.ariaLabel"
          :aria-label="c.ariaLabel"
          :data-consumable-slot="c.slot"
          :data-state="c.runtimeState"
        >
          <img v-if="c.icon" class="v2-chip-icon" :src="c.icon" alt="" width="32" height="32" loading="lazy">
          <span v-else class="v2-chip-placeholder"></span>
          <span class="v2-chip-name">{{ c.label }}</span>
        </div>
          </div>
        </div>
        <div class="v2-loadout-group" data-test="v2-inspector-provisions">
          <div class="v2-loadout-group-title">{{ $t('recon.map.playback.provision') }}</div>
          <div class="v2-loadout-grid">
        <div
          v-for="p in provisionLabels"
          :key="'p' + p.slot"
          class="v2-inspector-chip"
          :class="{ 'is-empty': p.empty, 'is-unknown': !p.empty && !p.icon }"
          role="img"
          :title="p.label"
          :aria-label="p.label"
          :data-provision-slot="p.slot"
        >
          <img v-if="p.icon" class="v2-chip-icon" :src="p.icon" alt="" width="32" height="32" loading="lazy">
          <span v-else class="v2-chip-placeholder"></span>
          <span class="v2-chip-name">{{ p.label }}</span>
        </div>
          </div>
        </div>
        <div class="v2-loadout-group" data-test="v2-inspector-equipment">
          <div class="v2-loadout-group-title">{{ $t('recon.map.playback.equipment') }}</div>
          <div class="v2-loadout-grid" data-test="v2-inspector-equipment-grid">
            <div
              v-for="e in equipmentLabels"
              :key="'e' + e.slot"
              class="v2-inspector-chip"
              :class="{ 'is-unknown': !e.icon && devicesState !== 'loading', 'is-loading': !e.icon && devicesState === 'loading' }"
              :data-equipment-id="e.id"
              role="img"
              :title="e.label"
              :aria-label="e.label"
            >
              <img v-if="e.icon" class="v2-chip-icon" :src="e.icon" alt="" width="32" height="32" loading="lazy">
              <span v-else class="v2-chip-placeholder"></span>
              <span class="v2-chip-name">{{ e.label }}</span>
            </div>
          </div>
          <button
            v-if="track.tankId > 0"
            type="button"
            class="v2-configurator-link"
            data-test="v2-inspector-open-configurator"
            @click="openInConfigurator"
          >{{ $t('research.open_in_configurator') }}</button>
        </div>
      </div>
    </template>
    <div v-else class="v2-inspector-row" data-test="v2-inspector-loadout-unknown">
      <span class="v2-inspector-key">{{ $t('recon.map.playback.loadout') }}</span>
      <span class="v2-inspector-val">{{ $t('recon.map.playback.unknown') }}</span>
    </div>

    <template v-if="modules.length">
      <div class="v2-inspector-section">{{ $t('recon.map.playback.module_state') }}</div>
      <div v-for="module in modules" :key="module.component" class="v2-inspector-row" data-test="v2-inspector-module">
        <span class="v2-inspector-key">{{ moduleComponentLabel(module.component) }}</span>
        <span class="v2-inspector-val">
          {{ moduleStateLabel(module.state) }}
          <span v-if="module.recorderVisible" class="v2-inspector-badge">{{ $t('recon.map.playback.recorder_visible') }}</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.v2-inspector {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  font-size: 12px;
}
.v2-inspector-section {
  margin-top: 6px;
  font-weight: 600;
  border-top: 1px solid rgba(255,255,255,0.08);
  padding-top: 6px;
}
.v2-inspector-row { display: flex; justify-content: space-between; gap: 8px; }
.v2-inspector-key { color: var(--pb-dim, #9aa) }
.v2-inspector-val { text-align: right; }
.v2-inspector-badge {
  margin-left: 6px; padding: 1px 5px; border-radius: 3px;
  background: rgba(255,255,255,0.12); font-size: 10px;
}
.v2-inspector-cap { margin-left: 4px; color: var(--pb-dim, #9aa); }
.v2-inspector-loadout { display: flex; flex-direction: column; gap: 8px; }
.v2-loadout-group { display: flex; flex-direction: column; gap: 4px; }
.v2-loadout-group-title { color: var(--pb-dim, #9aa); font-size: 10px; }
.v2-loadout-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.v2-inspector-chip {
  display: flex; flex-direction: column; gap: 2px; padding: 4px 6px;
  border-radius: 4px; background: rgba(255,255,255,0.06); font-size: 11px;
}
@media (width < 768px) {
  .v2-loadout-grid { grid-template-columns: repeat(3, minmax(92px, 1fr)); overflow-x: auto; }
}
.v2-configurator-link {
  margin-block-start: var(--space-1);
  align-self: flex-start;
  padding: var(--space-1) var(--space-2);
  min-block-size: var(--control-h-sm);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
  cursor: pointer;
}
.v2-configurator-link:hover { border-color: var(--color-border-strong); }
.v2-configurator-link:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.v2-inspector-chip .v2-chip-icon { width: 32px; height: 32px; object-fit: contain; }
.v2-chip-name {
  display: block; max-width: 100%; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; text-align: center;
  color: var(--color-text-secondary); font: var(--type-caption);
}
.v2-inspector-chip.is-empty .v2-chip-name { color: var(--color-text-tertiary); }
.v2-inspector-chip .v2-chip-placeholder {
  width: 32px; height: 32px; border-radius: var(--radius-sm);
  border: 1px dashed var(--color-border-subtle); opacity: .5;
}
.v2-inspector-chip.is-unknown .v2-chip-placeholder {
  position: relative; opacity: 1; border-style: solid;
  border-color: var(--color-warning);
}
.v2-inspector-chip.is-loading .v2-chip-placeholder {
  opacity: .75; border-style: solid;
  border-color: var(--color-border-strong);
}
.v2-inspector-chip.is-unknown .v2-chip-placeholder::after {
  content: ''; position: absolute; inset: 7px;
  border-top: 1.5px solid var(--color-warning);
  transform: rotate(-45deg); transform-origin: center;
}
.v2-inspector-chip[role="img"] { cursor: help; }
</style>
