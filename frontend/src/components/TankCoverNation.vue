<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import sources from '../assets/tank-catalog/sources.json'
import { assetProvider } from '../scene/assetProvider.js'

const COVER_ASPECT = 8 / 5
const props = defineProps<{ nation?: string }>()
const assets: Record<string, { canvas?: number[]; bounds?: number[]; remote?: string }> = sources.assets
const meta = computed(() => (props.nation ? assets[`cover-${props.nation}`] : undefined))
const url = computed<string | null>(() => {
  const remote = meta.value?.remote
  if (!remote) return null
  try { return assetProvider.imageUrl(remote) } catch { return null }
})
const failed = ref(false)
watch(url, () => { failed.value = false })

const visible = computed(() => {
  const record = meta.value
  if (!record?.canvas || !record.bounds) return null
  const [canvasW, canvasH] = record.canvas
  const [x, y, right, bottom] = record.bounds
  const width = right - x
  const height = bottom - y
  if (canvasW <= 0 || canvasH <= 0 || width <= 0 || height <= 0) return null
  return { canvasW, canvasH, x, y, width, height, aspect: width / height }
})

const cropStyle = computed(() => {
  const v = visible.value
  if (!v) return {}
  return v.aspect >= COVER_ASPECT
    ? { inlineSize: `${(v.aspect / COVER_ASPECT) * 100}%`, blockSize: '100%' }
    : { inlineSize: '100%', blockSize: `${(COVER_ASPECT / v.aspect) * 100}%` }
})

const imageStyle = computed(() => {
  const v = visible.value
  if (!v) return {}
  return {
    inlineSize: `${(v.canvasW / v.width) * 100}%`,
    blockSize: `${(v.canvasH / v.height) * 100}%`,
    insetInlineStart: `${(-v.x / v.width) * 100}%`,
    insetBlockStart: `${(-v.y / v.height) * 100}%`,
  }
})
</script>

<template>
  <span
    v-if="url && !failed"
    class="tank-cover-flag"
    data-testid="tank-cover-nation"
    aria-hidden="true"
  >
    <span class="tank-cover-flag-crop" :style="cropStyle">
      <img
        :src="url"
        alt=""
        loading="lazy"
        decoding="async"
        :style="imageStyle"
        @error="failed = true"
      >
    </span>
  </span>
</template>

<style scoped>
.tank-cover-flag {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  pointer-events: none;
}

.tank-cover-flag-crop {
  position: relative;
  flex: none;
  overflow: hidden;
}

.tank-cover-flag-crop img {
  position: absolute;
  max-inline-size: none;
  max-block-size: none;
}
</style>