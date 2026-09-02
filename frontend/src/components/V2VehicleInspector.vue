<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  healthDisplayAt,
  lifeAt,
  positionCoveredAtV2,
  consumableRuntimeSlotsAt,
  moduleCrewStatesAt,
} from '../utils/battlePlaybackV2.ts'
import { loadoutItemLabel } from '../data/loadoutItems.js'

/**
 * V2 车辆检查器（plan §24）：选中任意 materialized vehicle 后，展示「在 t 时刻我们到底知道什么」。
 * 只消费 canonical facts / knowledge / provenance，前端不再做 HP/AoI/death/loadout 推理。
 */
const props = defineProps({
  track: { type: Object, required: true },
  timeSec: { type: Number, required: true }
})

const { t, te, locale } = useI18n()

const life = computed(() => lifeAt(props.track, props.timeSec))
const health = computed(() => healthDisplayAt(props.track, props.timeSec))
const covered = computed(() => positionCoveredAtV2(props.track.positionSegments, props.timeSec))
const loadout = computed(() => props.track.loadout || null)

/**
 * loadout 条目显示名：优先本地化名称；未知/未映射走通用 i18n fallback。
 * raw wire/id 仍由后端保留，但不进入普通用户界面。
 */
function itemLabel(scope, id) {
  const name = loadoutItemLabel(scope, id, locale.value)
  if (name) return name
  let key = 'recon.map.playback.loadout_unknown_equipment'
  if (scope === 'consumable') key = 'recon.map.playback.loadout_unknown_consumable'
  if (scope === 'provision') key = 'recon.map.playback.loadout_unknown_provision'
  return t(key)
}

/**
 * consumable runtime state 本地化（plan Major）：不裸显 internal enum。
 * UNKNOWN 保持现有隐藏/未知语义；未知/未映射 state 走 localized fallback。
 */
function consumableStateLabel(state) {
  if (!state || state === 'UNKNOWN') return ''
  const key = `recon.map.playback.consumable_state.${state}`
  return te(key) ? t(key) : t('recon.map.playback.consumable_state.UNKNOWN')
}

// consumable runtime：hidden interval → UNKNOWN，绝不显示 READY
const consumables = computed(() => {
  if (!loadout.value) return []
  const wireCodes = loadout.value.consumableWireCodes || []
  const ids = loadout.value.consumables || []
  const runtimes = consumableRuntimeSlotsAt(props.track.consumableTransitions, props.timeSec)
  return Array.from({ length: 3 }, (_, i) => {
    const id = ids[i] ?? null
    const slotWire = wireCodes[i]
    const rt = runtimes.get(i)
    return {
      slot: i,
      logicalItemId: rt?.logicalItemId || id,
      wireCode: slotWire,
      runtimeState: rt?.state || 'UNKNOWN',
      label: itemLabel('consumable', rt?.logicalItemId || id),
    }
  })
})

const provisionLabels = computed(() => {
  if (!loadout.value) return []
  return Array.from({ length: 3 }, (_, i) => ({
    slot: i,
    label: itemLabel('provision', loadout.value.provisions?.[i] ?? null),
  }))
})

const equipmentLabels = computed(() => {
  if (!loadout.value) return []
  const slotKeys = ['f1', 'v1', 's1', 'f2', 'v2', 's2', 'f3', 'v3', 's3']
  return Array.from({ length: 9 }, (_, i) => ({
    slot: i,
    semanticKey: slotKeys[i],
    label: itemLabel('equipment', loadout.value.equipmentIds?.[i] ?? null),
  }))
})

const equipmentRows = computed(() => [
  { key: 'row1', slots: equipmentLabels.value.slice(0, 3) },
  { key: 'row2', slots: equipmentLabels.value.slice(3, 6) },
  { key: 'row3', slots: equipmentLabels.value.slice(6, 9) },
])

const modules = computed(() => moduleCrewStatesAt(props.track.moduleCrewTransitions, props.timeSec))

const stateLabel = computed(() => {
  if (life.value?.lifeState === 'DESTROYED') return t('recon.map.playback.state_destroyed')
  // AoI/position coverage ≠ 点亮：CURRENT observation 表达「当前观测」，不用 Detected/已发现。
  if (covered.value) return t('recon.map.playback.state_current_observation')
  if (valueSeen.value) return t('recon.map.playback.state_last_known')
  return t('recon.map.playback.unknown')
})

const valueSeen = computed(() => health.value != null || loadout.value != null)

/** tankClass 为 canonical 英文 class（Heavy tank/Medium tank/...）；UI 用已有三语翻译，不裸显英文。 */
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
        {{ health?.currentHp ?? '—' }}
        <span v-if="health?.knowledge === 'LAST_KNOWN'" class="v2-inspector-badge">
          {{ $t('recon.map.playback.last_known_hp') }}
        </span>
        <span v-if="health?.displayCapacityHp" class="v2-inspector-cap">
          / {{ health.displayCapacityHp }}
        </span>
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

    <div class="v2-inspector-row" data-test="v2-inspector-tier">
      <span class="v2-inspector-key">{{ $t('recon.map.playback.tank_tier') }}</span>
      <span class="v2-inspector-val">{{ track.tankTier ?? '—' }}</span>
    </div>

    <template v-if="loadout">
      <div class="v2-inspector-section">{{ $t('recon.map.playback.loadout') }}</div>
      <div class="v2-inspector-loadout" data-test="v2-inspector-loadout">
        <div class="v2-loadout-group" data-test="v2-inspector-consumables">
          <div class="v2-loadout-group-title">{{ $t('recon.map.playback.consumable') }}</div>
          <div class="v2-loadout-grid">
        <div v-for="c in consumables" :key="'c' + c.slot" class="v2-inspector-chip">
          <span>{{ c.label }}</span>
          <span v-if="c.runtimeState !== 'UNKNOWN'" class="v2-chip-state">{{ consumableStateLabel(c.runtimeState) }}</span>
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
        >
          <span>{{ p.label }}</span>
        </div>
          </div>
        </div>
        <div class="v2-loadout-group" data-test="v2-inspector-equipment">
          <div class="v2-loadout-group-title">{{ $t('recon.map.playback.equipment') }}</div>
          <div v-for="row in equipmentRows" :key="row.key" class="v2-equipment-row" :data-equipment-group="row.key">
            <div class="v2-loadout-grid">
        <div
          v-for="e in row.slots"
          :key="'e' + e.slot"
          class="v2-inspector-chip"
          :data-equipment-slot="e.slot"
        >
          <span class="v2-chip-type">{{ $t(`recon.map.playback.equipment_slot_${e.semanticKey}`) }}</span>
          <span>{{ e.label }}</span>
        </div>
            </div>
          </div>
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
.v2-equipment-row { display: block; }
.v2-inspector-chip {
  display: flex; flex-direction: column; gap: 2px; padding: 4px 6px;
  border-radius: 4px; background: rgba(255,255,255,0.06); font-size: 11px;
}
.v2-chip-state { color: var(--pb-dim, #9aa); font-size: 9px; }
@media (max-width: 520px) {
  .v2-loadout-grid { grid-template-columns: repeat(3, minmax(92px, 1fr)); overflow-x: auto; }
  .v2-equipment-row { display: block; }
}
.v2-chip-type { color: var(--pb-dim, #9aa); font-size: 9px; text-transform: uppercase; }
</style>
