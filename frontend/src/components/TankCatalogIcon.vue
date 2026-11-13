<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import sources from '../assets/tank-catalog/sources.json'
import { tankClassIcon } from '../utils/tankClassIcon.js'

const props = withDefaults(defineProps<{
  kind: 'nation' | 'type' | 'category'
  value?: string
  variant?: 'text' | 'filter'
}>(), { value: '', variant: 'text' })
const assets: Record<string, { canvas: number[], bounds: number[] }> = sources.assets
const files = import.meta.glob<string>('../assets/tank-catalog/*.{webp,png}', { eager: true, query: '?url', import: 'default' })
const classStems: Record<string, string> = { LT: 'light', MT: 'medium', HT: 'heavy', TD: 'at-spg' }
const key = computed(() => {
  if (props.kind === 'nation') {
    const shared = `nation-${props.value}`
    return assets[shared] ? shared : `nation-${props.variant}-${props.value}`
  }
  if (props.kind === 'type') return `type-${classStems[tankClassIcon(props.value)?.key || '']}`
  return `category-${props.value}`
})
const asset = computed(() => assets[key.value])
const url = computed(() => files[`../assets/tank-catalog/${key.value}.webp`] ?? files[`../assets/tank-catalog/${key.value}.png`])
const failed = ref(false)
watch(url, () => { failed.value = false })
// Packed client textures include transparent padding. Keep every visible pixel and its original aspect.
const cropStyle = computed(() => {
  if (!asset.value) return {}
  const [x, y, right, bottom] = asset.value.bounds
  const [width, height] = asset.value.canvas
  return {
    aspectRatio: `${right - x} / ${bottom - y}`,
    '--catalog-image-aspect': (right - x) / (bottom - y),
    '--catalog-image-width': `${width / (right - x) * 100}%`,
    '--catalog-image-height': `${height / (bottom - y) * 100}%`,
    '--catalog-image-left': `${-x / (right - x) * 100}%`,
    '--catalog-image-top': `${-y / (bottom - y) * 100}%`,
  }
})
</script>

<template>
  <span v-if="asset && url && !failed" class="catalog-icon" :class="`is-${kind}`" aria-hidden="true">
    <span class="catalog-icon-crop" :style="cropStyle">
      <img :src="url" alt="" @error="failed = true">
    </span>
  </span>
</template>

<style scoped>
.catalog-icon { display: inline-grid; place-items: center; flex: none; inline-size: var(--space-8); block-size: var(--space-6); vertical-align: middle; }
.catalog-icon.is-type { inline-size: var(--space-5); }
.catalog-icon-crop { display: block; position: relative; inline-size: min(100%, calc(var(--space-6) * var(--catalog-image-aspect))); overflow: hidden; }
.catalog-icon-crop img { position: absolute; inline-size: var(--catalog-image-width); block-size: var(--catalog-image-height); max-inline-size: none; inset-inline-start: var(--catalog-image-left); inset-block-start: var(--catalog-image-top); }
</style>
