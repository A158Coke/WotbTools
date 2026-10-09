<script setup>
import { computed } from 'vue'
import { tankClassIcon } from '../utils/tankClassIcon.js'

const props = defineProps({ tankClass: { type: String, default: '' } })
const icon = computed(() => tankClassIcon(props.tankClass))
</script>

<template>
  <svg class="tank-class-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" :data-tank-class="icon?.key || 'unknown'">
    <path v-if="icon" :d="icon.path" fill="currentColor" />
    <circle v-else cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2" />
  </svg>
</template>

<style scoped>
.tank-class-icon { display: inline-block; flex-shrink: 0; width: var(--space-5); height: var(--space-5); vertical-align: middle; }
</style>
