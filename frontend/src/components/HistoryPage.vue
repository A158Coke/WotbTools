<script setup>
import historySource from '../../../HISTORY.md?raw'
import MarkdownDocPage from './MarkdownDocPage.vue'
</script>

<template>
  <MarkdownDocPage class="history-page" section-hero :source="historySource" />
</template>
