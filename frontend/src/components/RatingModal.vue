<script setup>
import { ref, computed, watch } from 'vue'
import { RATING_DEFAULTS, RATING_TIERS, tierRange } from '../utils/helpers.js'

const emit = defineEmits(['close'])
const props = defineProps({ show: Boolean })
const ratingCfg = ref(null)

const cfg = computed(() => ({ ...RATING_DEFAULTS, ...(ratingCfg.value || {}) }))

watch(() => props.show, async (v) => {
  if (v && !ratingCfg.value) {
    try { ratingCfg.value = await (await fetch('/api/rating')).json() } catch { ratingCfg.value = {} }
  }
})
</script>

<template>
  <div v-if="show" class="modal-mask" @click.self="$emit('close')">
    <div class="modal modal-rating">
      <p class="modal-title">{{ $t('rating_help.title') }}</p>
      <p class="modal-sub">{{ $t('rating_help.intro') }}</p>

      <div class="rh-block">
        <div class="rh-h">{{ $t('rating_help.ec_title') }}</div>
        <code class="rh-f">EC = {{ $t('rating_help.dmg') }} + {{ cfg.assist }}·{{ $t('rating_help.assist') }} + {{ cfg.block }}·{{ $t('rating_help.block') }} + {{ cfg.killValue }}·{{ $t('rating_help.kills') }}</code>
      </div>

      <div class="rh-block">
        <div class="rh-h">{{ $t('rating_help.baseline_title') }}</div>
        <p class="rh-p">{{ $t('rating_help.baseline_desc', { n: cfg.minSamples }) }}</p>
        <div class="rh-factors">
          <span v-for="(f, k) in cfg.classFactor" :key="k" class="rh-tag">{{ k }} ×{{ f }}</span>
        </div>
      </div>

      <div class="rh-block">
        <div class="rh-h">{{ $t('rating_help.score_title') }}</div>
        <code class="rh-f">{{ $t('rating_help.score_word') }} = round( {{ cfg.scale }} × EC / {{ $t('rating_help.baseline_word') }} × (1 + {{ cfg.winBonus }} {{ $t('rating_help.if_win') }}) )</code>
      </div>

      <div class="rh-block">
        <div class="rh-h">{{ $t('rating_help.tier_title') }}</div>
        <div class="rh-tiers">
          <span v-for="(tr, i) in RATING_TIERS" :key="tr.key" class="rbadge" :class="tr.cls">{{ $t('rating_help.tiers.' + tr.key) }} {{ tierRange(i) }}</span>
        </div>
      </div>

      <p class="modal-sub">{{ $t('rating_help.note') }}</p>
      <div class="modal-actions">
        <button class="ghost" @click="$emit('close')">{{ $t('rating_help.close') }}</button>
      </div>
    </div>
  </div>
</template>
