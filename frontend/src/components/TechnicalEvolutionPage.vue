<script setup>
import technicalEvolutionSource from '../../../docs/architecture/TECHNICAL_EVOLUTION.md?raw'
import MarkdownDocPage from './MarkdownDocPage.vue'
</script>

<template>
  <MarkdownDocPage class="technical-evolution-page" :source="technicalEvolutionSource" />
</template>
