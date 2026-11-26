<script setup lang="ts">
import Banner from '../components/Banner.vue'
import AppButton from '../components/AppButton.vue'
import { reloadForFreshBundle } from '../utils/lazyModule'

function reload() {
  reloadForFreshBundle({ explicit: true })
}

defineOptions({ inheritAttrs: false })
</script>

<template>
  <div class="view-load-error" data-testid="view-load-error">
    <Banner tone="danger">
      {{ $t('app.view_load_error') }}
      <template #actions>
        <AppButton data-testid="view-load-reload" @click="reload">{{ $t('app.view_load_reload') }}</AppButton>
      </template>
    </Banner>
  </div>
</template>

<style scoped>
.view-load-error {
  flex: 1 1 auto;
  display: grid;
  align-content: center;
  padding: var(--space-4);
}
</style>
