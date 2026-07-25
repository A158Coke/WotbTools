<script setup>
defineProps({
  result: {
    type: Object,
    required: true
  }
})
</script>

<template>
  <div class="panel">
    <h2>{{ $t('recon.result_title') }}</h2>
    <div class="recon-stats">
      <div class="stat-item">
        <span class="stat-label">{{ $t('recon.packet_count') }}</span>
        <span class="stat-value">{{ result.packetCount?.toLocaleString() }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ $t('recon.decoded_count') }}</span>
        <span class="stat-value">{{ result.decodedPacketCount?.toLocaleString() }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ $t('recon.event_count') }}</span>
        <span class="stat-value">{{ result.eventCount?.toLocaleString() }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ $t('recon.duration') }}</span>
        <span class="stat-value">{{ result.replayDurationSec?.toFixed(2) }}s</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ $t('recon.participants') }}</span>
        <span class="stat-value">{{ result.participantCount }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ $t('recon.entities') }}</span>
        <span class="stat-value">{{ result.entityCount }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ $t('recon.checkpoints') }}</span>
        <span class="stat-value">{{ result.checkpointCount }}</span>
      </div>
    </div>
    <details class="recon-details">
      <summary>{{ $t('recon.raw_json') }}</summary>
      <pre class="json-block">{{ JSON.stringify(result, null, 2) }}</pre>
    </details>
  </div>
</template>
