<script setup lang="ts">
import { ChevronDown, Settings2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import AppButton from './AppButton.vue'

defineOptions({ name: 'Replay3DSettingsEntry' })

defineProps<{ open?: boolean; compact?: boolean }>()

const emit = defineEmits<{ toggle: [event: MouseEvent] }>()

const { t } = useI18n()
</script>

<template>
  <AppButton
    variant="ghost"
    size="sm"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-label="compact ? t('agentReplay.settings_title') : undefined"
    :title="compact ? t('agentReplay.settings_title') : undefined"
    @click="emit('toggle', $event)"
  >
    <Settings2 :size="16" aria-hidden="true" />
    <span v-if="!compact">{{ t('agentReplay.settings_title') }}</span>
    <ChevronDown v-if="!compact" :size="14" :class="['viewer-settings-chevron', { 'is-open': open }]" aria-hidden="true" />
  </AppButton>
</template>

<style scoped>
.viewer-settings-chevron { transition: transform var(--duration-fast) var(--ease-standard); }
.viewer-settings-chevron.is-open { transform: rotate(180deg); }
</style>
