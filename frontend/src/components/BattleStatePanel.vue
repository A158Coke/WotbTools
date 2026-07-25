<script setup>
defineProps({
  result: {
    type: Object,
    required: true
  }
})
</script>

<template>
  <div class="panel state-panel">
    <h2>{{ $t('recon.state_title', { time: result.rawClockSec?.toFixed(1) }) }}</h2>
    <div class="recon-stats">
      <div class="stat-item">
        <span class="stat-label">{{ $t('recon.lifecycle') }}</span>
        <span class="stat-value">{{ result.lifecycle }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ $t('recon.vehicle_count') }}</span>
        <span class="stat-value">{{ result.vehicles?.length }}</span>
      </div>
    </div>
    <div v-if="result.vehicles?.length" class="tablewrap state-table">
      <table class="recon-table">
        <thead>
          <tr>
            <th>{{ $t('recon.eid') }}</th>
            <th>{{ $t('recon.team') }}</th>
            <th>{{ $t('recon.hp') }}</th>
            <th>{{ $t('recon.maxhp') }}</th>
            <th>{{ $t('recon.life') }}</th>
            <th>{{ $t('recon.obs') }}</th>
            <th>{{ $t('recon.damage_dealt') }}</th>
            <th>{{ $t('recon.damage_recv') }}</th>
            <th>{{ $t('recon.position') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vehicle in result.vehicles" :key="vehicle.entityId">
            <td class="num">{{ vehicle.entityId }}</td>
            <td class="num">{{ vehicle.team }}</td>
            <td class="num">{{ vehicle.currentHealth ?? '--' }}</td>
            <td class="num">{{ vehicle.maxHealth ?? '--' }}</td>
            <td>{{ vehicle.lifeState }}</td>
            <td>{{ vehicle.observationState }}</td>
            <td class="num">{{ vehicle.damageDealt }}</td>
            <td class="num">{{ vehicle.damageReceived }}</td>
            <td class="mono">
              {{ vehicle.position
                ? `(${vehicle.position.map(value => value.toFixed(1)).join(', ')})`
                : '--' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <details class="recon-details">
      <summary>{{ $t('recon.raw_json') }}</summary>
      <pre class="json-block">{{ JSON.stringify(result, null, 2) }}</pre>
    </details>
  </div>
</template>
