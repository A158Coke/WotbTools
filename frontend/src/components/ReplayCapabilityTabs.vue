<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SegmentedControl from './SegmentedControl.vue'

defineOptions({ name: 'ReplayCapabilityTabs' })

const props = defineProps({
  options: { type: Array, default: () => [] },
  activeCapability: { type: String, default: 'data' },
})

const emit = defineEmits(['select'])
const { t } = useI18n()

const segmentedOptions = computed(() => props.options.map(option => ({
  value: option.key,
  label: t(option.labelKey),
  testid: 'ws-tab',
  data: { 'data-cap': option.key },
})))
</script>

<template>
  <SegmentedControl
    :model-value="activeCapability"
    :options="segmentedOptions"
    :aria-label="$t('workspace.title')"
    wrap
    @update:model-value="emit('select', $event)"
  />
</template>
