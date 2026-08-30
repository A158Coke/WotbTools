<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { viewFromRoute } from './navigation.js'
import { replayInitialCapability, VIEW_COMPONENTS } from './viewRegistry.js'

const route = useRoute()
const activeView = computed(() => viewFromRoute(route))
const currentView = computed(() => VIEW_COMPONENTS[activeView.value] || VIEW_COMPONENTS.replay)
const initialCapability = computed(() => replayInitialCapability(activeView.value))
</script>

<template>
  <div class="tb-content">
    <KeepAlive :include="['ReplayWorkspace']">
      <component :is="currentView" :initial-capability="initialCapability" />
    </KeepAlive>
  </div>
</template>
