<script setup>
import V2VehicleInspector from './V2VehicleInspector.vue'

defineOptions({ name: 'VehicleDetailsPanel' })

const props = defineProps({
  selectedState: { type: Object, default: null },
  friendlyTeam: { type: [Number, String], default: null },
  selectedPortraitUrl: { type: String, default: null },
  selLastKnownSec: { type: Number, default: null },
  selCurStats: { type: Object, default: () => ({ dealt: 0, received: 0, kills: 0 }) },
  selectedV2Track: { type: Object, default: null },
  currentTime: { type: Number, default: 0 },
  selDamageLog: { type: Array, default: () => [] },
  formatClock: { type: Function, required: true },
})

const emit = defineEmits(['close'])
</script>

<template>
  <aside v-if="props.selectedState" class="pb-sidebar" data-test="pb-info" :aria-label="$t('recon.map.playback.detail')">
    <div class="pb-sb-head">
      <div class="pb-sb-title">
        <strong data-test="pb-sb-tank">{{ props.selectedState.vehicle.tankName || props.selectedState.vehicle.tankId }}</strong>
        <span class="pb-sb-player" data-test="pb-sb-player">{{ props.selectedState.vehicle.playerName }}</span>
      </div>
      <button type="button" class="pb-close pb-sb-close" data-test="pb-sb-close" :aria-label="$t('recon.map.playback.close')" @click="emit('close')">&times;</button>
    </div>
    <div v-if="props.selectedPortraitUrl" class="pb-sb-portrait" data-test="pb-sb-portrait">
      <img :src="props.selectedPortraitUrl" :alt="props.selectedState.vehicle.tankName || String(props.selectedState.vehicle.tankId)" />
    </div>
    <dl class="pb-sb-grid">
      <dt>{{ $t('recon.map.playback.team') }}</dt>
      <dd>{{ $t(props.selectedState.vehicle.team === props.friendlyTeam ? 'recon.map.playback.team_friendly' : 'recon.map.playback.team_enemy') }}</dd>
      <template v-if="props.selLastKnownSec != null">
        <dt>{{ $t('recon.map.playback.last_spotted') }}</dt>
        <dd>{{ props.formatClock(props.selLastKnownSec) }}</dd>
      </template>
      <template v-if="props.selectedState.destroyed && props.selectedState.destroyedKnownAtSec != null">
        <dt>{{ $t('recon.map.playback.destroyed_at') }}</dt>
        <dd>{{ props.formatClock(props.selectedState.destroyedKnownAtSec) }}</dd>
      </template>
      <dt>{{ $t('recon.map.playback.playback_time') }}</dt>
      <dd>{{ props.formatClock(props.currentTime) }}</dd>
      <dt>{{ $t('recon.map.playback.damage_recorded') }}</dt>
      <dd data-test="pb-sb-dealt">{{ props.selCurStats.dealt }}</dd>
      <dt>{{ $t('recon.map.playback.damage_received') }}</dt>
      <dd>{{ props.selCurStats.received }}</dd>
      <dt>{{ $t('recon.map.playback.kills') }}</dt>
      <dd>{{ props.selCurStats.kills }}</dd>
    </dl>
    <V2VehicleInspector
      v-if="props.selectedV2Track"
      data-test="pb-sb-v2-inspector"
      :track="props.selectedV2Track"
      :time-sec="props.currentTime"
    />
    <template v-if="props.selDamageLog.length">
      <div class="pb-sb-section">{{ $t('recon.map.playback.damage_log') }}</div>
      <ul class="pb-sb-log">
        <li v-for="(damage, index) in props.selDamageLog" :key="index">
          <span class="pb-sb-log-time">{{ props.formatClock(damage.timeSec) }}</span>
          <span v-if="damage.dir === 'in'" class="pb-sb-log-in">−{{ damage.hpLoss }} <em>{{ damage.label }}</em></span>
          <span v-else class="pb-sb-log-out">+{{ damage.hpLoss }} → {{ damage.label }}</span>
        </li>
      </ul>
    </template>
  </aside>
</template>

<style scoped>
.pb-sidebar { width: 260px; flex-shrink: 0; align-self: stretch; font-size: .8rem; color: var(--text-label); background: var(--bg-card); border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; overflow-y: auto; max-height: 72vh; }
.pb-sb-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 4px; }
.pb-sb-title { display: flex; flex-direction: column; min-width: 0; }
.pb-sb-title strong { color: var(--text-heading); font-size: .85rem; line-height: 1.3; }
.pb-sb-player { color: var(--text-muted); font-size: .75rem; word-break: break-all; }
.pb-sb-close { font-size: 1.05rem; line-height: 1; padding: 0 3px; }
.pb-sb-portrait { display: grid; place-items: center; min-height: 92px; margin: 2px 0 6px; border-radius: 4px; background: linear-gradient(180deg, color-mix(in srgb, var(--bg-chip) 68%, transparent), transparent); overflow: hidden; }
.pb-sb-portrait img { display: block; width: min(100%, 190px); height: 96px; object-fit: contain; filter: drop-shadow(0 5px 7px color-mix(in srgb, var(--text) 28%, transparent)); }
.pb-sb-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; }
.pb-sb-grid dt { color: var(--text-muted); white-space: nowrap; }
.pb-sb-grid dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.pb-sb-section { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border); font-weight: 700; color: var(--text-heading); }
.pb-sb-log { margin: 4px 0 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 1px; max-height: 120px; overflow-y: auto; }
.pb-sb-log li { display: flex; gap: 6px; font-variant-numeric: tabular-nums; align-items: baseline; }
.pb-sb-log-time { color: var(--text-muted); flex-shrink: 0; }
.pb-sb-log-in { color: var(--pb-enemy-text, #f87171); }
.pb-sb-log-out { color: var(--pb-team-text, #4ade80); }
.pb-sb-log em { font-style: normal; opacity: .75; }
@media (max-width: 768px) { .pb-sidebar { width: 100%; max-height: none; } }
</style>
