<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  healthAt,
  lifeAt,
  positionCoveredAtV2,
  orientationKnownAt,
  consumableRuntimeAt,
  moduleCrewAt,
} from '../utils/battlePlaybackV2.js'

/**
 * V2 车辆检查器（plan §24）：选中任意 materialized vehicle 后，展示「在 t 时刻我们到底知道什么」。
 * 只消费 canonical facts / knowledge / provenance，前端不再做 HP/AoI/death/loadout 推理。
 */
const props = defineProps({
  track: { type: Object, required: true },
  timeSec: { type: Number, required: true }
})

const { t } = useI18n()

const life = computed(() => lifeAt(props.track, props.timeSec))
const health = computed(() => {
  // 与 marker/HUD 一致：阵亡为权威事实，current=0（绝不显示阵亡前最后一次健康值）。
  if (life.value?.lifeState === 'DESTROYED') {
    return {
      currentHp: 0,
      knowledge: 'CURRENT',
      displayCapacityHp: healthAt(props.track, props.timeSec)?.displayCapacityHp ?? null,
      source: 'DESTROYED',
    }
  }
  return healthAt(props.track, props.timeSec)
})
const covered = computed(() => positionCoveredAtV2(props.track.positionSegments, props.timeSec))
const orientation = computed(() => orientationKnownAt(props.track, props.timeSec))
const loadout = computed(() => props.track.loadout || null)

// consumable runtime：hidden interval → UNKNOWN，绝不显示 READY
const consumables = computed(() => {
  if (!loadout.value) return []
  const wireCodes = loadout.value.consumableWireCodes || []
  const ids = loadout.value.consumables || []
  return ids.map((id, i) => {
    const slotWire = wireCodes[i]
    const rt = consumableRuntimeAt(props.track.consumableTransitions, props.timeSec)
    const slotMatch = rt.wireCode == null || rt.wireCode === slotWire
    return {
      slot: i,
      logicalItemId: slotMatch ? (rt.logicalItemId || id) : id,
      wireCode: slotWire,
      runtimeState: slotMatch ? rt.state : 'UNKNOWN',
    }
  })
})

const modules = computed(() => moduleCrewAt(props.track.moduleCrewTransitions, props.timeSec))

const stateLabel = computed(() => {
  if (life.value?.lifeState === 'DESTROYED') return t('recon.map.playback.state_destroyed')
  if (covered.value) return t('recon.map.playback.state_detected')
  if (valueSeen.value) return t('recon.map.playback.state_last_known')
  return t('recon.map.playback.unknown')
})

const valueSeen = computed(() => health.value != null || loadout.value != null)

const orientationLabel = computed(() => {
  if (orientation.value === 'CURRENT') return t('recon.map.playback.orientation_current')
  if (orientation.value === 'LAST_KNOWN') return t('recon.map.playback.orientation_last_known')
  return t('recon.map.playback.unknown')
})
</script>

<template>
  <div class="v2-inspector" data-test="v2-vehicle-inspector">
    <div class="v2-inspector-title" data-test="v2-inspector-title">
      {{ track.playerName || `#${track.accountId}` }} — {{ track.tankName || '—' }}
    </div>

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
      <span class="v2-inspector-val">{{ track.tankClass || '—' }}</span>
    </div>

    <div class="v2-inspector-row" data-test="v2-inspector-orientation">
      <span class="v2-inspector-key">{{ $t('recon.map.playback.orientation') }}</span>
      <span class="v2-inspector-val">
        {{ orientation === 'CURRENT' ? $t('recon.map.playback.state_detected') : orientation }}
      </span>
    </div>

    <template v-if="loadout">
      <div class="v2-inspector-section">{{ $t('recon.map.playback.loadout') }}</div>
      <div class="v2-inspector-grid" data-test="v2-inspector-loadout">
        <div v-for="c in consumables" :key="'c' + c.slot" class="v2-inspector-chip">
          <span class="v2-chip-type">{{ $t('recon.map.playback.consumable') }}</span>
          <span>{{ c.logicalItemId || $t('recon.map.playback.unknown') }}</span>
          <span v-if="c.runtimeState !== 'UNKNOWN'" class="v2-chip-state">{{ c.runtimeState }}</span>
        </div>
        <div
          v-for="(p, i) in loadout.provisions || []"
          :key="'p' + i"
          class="v2-inspector-chip"
        >
          <span class="v2-chip-type">{{ $t('recon.map.playback.provision') }}</span>
          <span>{{ p || $t('recon.map.playback.unknown') }}</span>
        </div>
        <div
          v-for="(e, i) in loadout.equipmentIds || []"
          :key="'e' + i"
          class="v2-inspector-chip"
        >
          <span class="v2-chip-type">{{ $t('recon.map.playback.equipment') }} #{{ i + 1 }}</span>
          <span>{{ e }}</span>
        </div>
      </div>
    </template>
    <div v-else class="v2-inspector-row" data-test="v2-inspector-loadout-unknown">
      <span class="v2-inspector-key">{{ $t('recon.map.playback.loadout') }}</span>
      <span class="v2-inspector-val">{{ $t('recon.map.playback.unknown') }}</span>
    </div>

    <template v-if="modules">
      <div class="v2-inspector-section">{{ $t('recon.map.playback.module_state') }}</div>
      <div class="v2-inspector-row" data-test="v2-inspector-module">
        <span class="v2-inspector-key">{{ modules.component }}</span>
        <span class="v2-inspector-val">
          {{ modules.state }}
          <span v-if="modules.recorderVisible" class="v2-inspector-badge">{{ $t('recon.map.playback.recorder_visible') }}</span>
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
.v2-inspector-title { font-weight: 600; }
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
.v2-inspector-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.v2-inspector-chip {
  display: flex; flex-direction: column; gap: 2px; padding: 4px 6px;
  border-radius: 4px; background: rgba(255,255,255,0.06); font-size: 11px;
}
.v2-chip-type { color: var(--pb-dim, #9aa); font-size: 9px; text-transform: uppercase; }
.v2-chip-state { color: var(--pb-dim, #9aa); font-size: 9px; }
</style>
