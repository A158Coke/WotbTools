<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import TankCatalogIcon from '../TankCatalogIcon.vue'
import TankCoverNation from '../TankCoverNation.vue'
import { TYPE_CLS, tankNationLabel, tankTypeLabel } from '../../scene/tankMeta.js'
import { romanLevel } from '../../utils/tierFormat.js'

const props = defineProps<{
  name: string
  nation?: string
  tier?: number
  type?: string
  image: string
  cropStyle?: { transform: string } | null
  compact?: boolean
  /** 金币/收藏身份：与坦克百科的车名配色共用同一套口径（collector 仅在非 premium 时生效）。 */
  premium?: boolean
  collector?: boolean
}>()
const { t, te } = useI18n()
const failed = ref(false)
watch(() => props.image, () => { failed.value = false })
const typeClass = computed(() => TYPE_CLS[props.type as keyof typeof TYPE_CLS] || 't-unknown')
const identityClass = computed(() => ({
  'is-compact': props.compact,
  'is-premium': props.premium === true,
  'is-collector': props.collector === true && props.premium !== true,
}))
</script>

<template>
  <span class="vd-identity" :class="identityClass">
    <span class="tp-media">
      <TankCoverNation :nation="nation" />
      <img v-if="image && !failed" :src="image" alt="" width="160" height="100" loading="lazy"
        decoding="async" :style="cropStyle" @error="failed = true">
    </span>
    <span class="vd-identity-copy">
      <span class="tp-card-name" :title="name">{{ name }}</span>
      <span class="tp-badges">
        <span v-if="tier != null" class="tp-pill is-tier">{{ romanLevel(tier) }}</span>
        <span v-if="nation" class="tp-pill">{{ tankNationLabel(t, te, nation) }}</span>
        <span v-if="type" class="tp-pill" :class="typeClass">
          <TankCatalogIcon kind="type" :value="type" />{{ tankTypeLabel(t, te, type) }}
        </span>
      </span>
    </span>
  </span>
</template>

<style scoped src="../tank-catalog-identity.css"></style>

<style scoped>
.vd-identity { display: grid; gap: var(--space-2); min-inline-size: 0; }
.vd-identity-copy { display: grid; gap: var(--space-1); min-inline-size: 0; }
.vd-identity.is-compact { grid-template-columns: 80px minmax(0, 1fr); align-items: center; }
.vd-identity.is-compact .tp-card-name { min-block-size: 0; }
</style>
