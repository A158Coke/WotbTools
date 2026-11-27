<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import AppSheet from '../components/AppSheet.vue'
import AppSidebar from './AppSidebar.vue'

const props = defineProps<{ open: boolean, returnFocusTo?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()
const route = useRoute()

watch(() => route.fullPath, () => {
  if (props.open) emit('close')
})

function onNavClick(event: MouseEvent) {
  if ((event.target as Element | null)?.closest?.('a[href]')) emit('close')
}

const fullscreenRoot = ref<HTMLElement | null>(typeof document === 'undefined' ? null : document.fullscreenElement as HTMLElement | null)
useEventListener(typeof document === 'undefined' ? null : document, 'fullscreenchange', () => {
  fullscreenRoot.value = document.fullscreenElement as HTMLElement | null
})
watch(() => props.open, (open) => { if (open) fullscreenRoot.value = document.fullscreenElement as HTMLElement | null })
</script>

<template>
  <AppSheet
    :open="open"
    side="start"
    :title="$t('nav.primary')"
    :return-focus-to="returnFocusTo"
    :portal-to="fullscreenRoot"
    data-testid="nav-drawer"
    @close="emit('close')"
  >
    <div class="nav-drawer-body" @click="onNavClick">
      <AppSidebar drawer @close="emit('close')" />
    </div>
  </AppSheet>
</template>

<style scoped>
.nav-drawer-body { display: contents; }
</style>
