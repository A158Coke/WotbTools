<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  before?: string
  value: string
  unit?: string
  delta?: string
  good?: boolean | null
}>()

const direction = computed(() => props.delta?.match(/^[+−-]/)?.[0])
</script>

<template>
  <span class="vd-reading">
    <span class="vd-reading-pair">
      <template v-if="before !== undefined">
        <span class="tp-param-value vd-reading-before">{{ before }}</span>
        <span class="vd-reading-arrow">→</span>
      </template>
      <span class="vd-reading-current">
        <strong class="tp-param-value">{{ value }}</strong>
        <small v-if="unit" class="tp-param-unit">{{ unit }}</small>
      </span>
    </span>
    <small
      v-if="delta"
      class="tp-param-delta vd-reading-delta"
      :class="{ 'is-good': good === true, 'is-bad': good === false }"
      :aria-label="delta"
    >
      {{ direction ? delta.slice(1) : delta }}<span v-if="direction" aria-hidden="true">{{ direction === '+' ? '▲' : '▼' }}</span>
    </small>
  </span>
</template>

<style scoped src="../tank-param-readings.css"></style>

<style scoped>
.vd-reading,
.vd-reading-pair,
.vd-reading-current {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: baseline;
  gap: 0 var(--space-1);
  min-inline-size: 0;
  max-inline-size: 100%;
}

.vd-reading { column-gap: var(--space-2); }

.vd-reading .tp-param-value {
  white-space: normal;
  overflow-wrap: anywhere;
}

.vd-reading .vd-reading-before { color: var(--color-text-secondary); font-weight: 400; }
.vd-reading-arrow, .vd-reading-delta { color: var(--color-text-secondary); }
.vd-reading .tp-param-unit { white-space: nowrap; }
</style>
