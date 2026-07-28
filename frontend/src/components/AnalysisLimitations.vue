<script setup>
import { useI18n } from 'vue-i18n'
import { localizeLimitation } from '../utils/reconstruction-analysis.js'

defineProps({
  codes: {
    type: Array,
    required: true
  }
})

const { t } = useI18n()
</script>

<template>
  <section class="analysis-limitations">
    <h3>{{ $t('recon.data_limitations') }}</h3>
    <ul class="limitation-list">
      <li v-for="code in codes" :key="code">
        {{ localizeLimitation(code, $t) }}
      </li>
    </ul>
  </section>
</template>
