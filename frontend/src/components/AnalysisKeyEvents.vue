<script setup>
import { useI18n } from 'vue-i18n'
import { eventTypeLabel } from '../utils/reconstruction-analysis.js'

defineProps({
  events: {
    type: Array,
    required: true
  }
})

const { t } = useI18n()

function localizedEventType(type) {
  return eventTypeLabel(type, t)
}
</script>

<template>
  <details class="recon-details">
    <summary>{{ $t('recon.key_events') }} ({{ events.length }})</summary>
    <ul class="key-events">
      <li v-for="(event, index) in events" :key="index">
        <span class="ke-time">{{ event.clockSec?.toFixed(1) }}s</span>
        <span class="ke-type">{{ localizedEventType(event.type) }}</span>
        <span class="ke-label">{{ event.label }}</span>
      </li>
    </ul>
  </details>
</template>
