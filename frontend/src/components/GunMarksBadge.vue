<script setup>
import { computed } from 'vue'
import atlas from '../assets/gun-marks/gun-marks.png'
import { gunMarksCount } from '../utils/gunMarks.js'

const props = defineProps({ marks: { default: null }, showCount: Boolean })
const count = computed(() => gunMarksCount(props.marks))
// Center each opaque badge inside a common viewport, preserving its natural height and scale.
const CELL_LEFT = [173, 898, 1589]
const CELL_TOP = [175.5, 134, 94]
const ATLAS_WIDTH = 2172
const ATLAS_HEIGHT = 724
const hasMarks = computed(() => count.value != null && count.value > 0)
const viewBox = computed(() => {
  const index = Math.max(1, count.value ?? 1) - 1
  return `${CELL_LEFT[index] - 4} ${CELL_TOP[index]} 384 501`
})
</script>

<template>
  <span v-if="hasMarks || showCount" class="gun-marks-badge" :data-gun-marks="count" :title="count == null ? undefined : $t('player_labels.gun_marks_tip')">
    <svg v-if="hasMarks" :viewBox="viewBox" role="img" :aria-label="$t('player_labels.gun_marks_count', { count })" focusable="false">
      <image :href="atlas" :width="ATLAS_WIDTH" :height="ATLAS_HEIGHT" />
    </svg>
    <span v-if="showCount">{{ count == null ? '—' : $t('player_labels.gun_marks_count', { count }) }}</span>
  </span>
</template>

<style scoped>
.gun-marks-badge { display: inline-flex; align-items: center; gap: var(--space-1); flex: none; vertical-align: middle; white-space: nowrap; }
.gun-marks-badge svg { inline-size: var(--gun-marks-width, var(--space-4)); block-size: var(--gun-marks-height, var(--space-5)); flex: none; }
</style>
