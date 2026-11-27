<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from './AppButton.vue'

const props = withDefaults(defineProps<{
  actionLabel: string
  confirmLabel?: string
  hint?: string
  message?: string
  keyword?: string
  keywordLabel?: string
  busy?: boolean
  disabled?: boolean
}>(), { confirmLabel: '', hint: '', message: '', keyword: '', keywordLabel: '', busy: false, disabled: false })
const emit = defineEmits<{ confirm: [] }>()
const { t } = useI18n()

const armed = ref(false)
const typed = ref('')
const startButton = ref<InstanceType<typeof AppButton> | null>(null)
const cancelButton = ref<InstanceType<typeof AppButton> | null>(null)
const input = ref<HTMLInputElement | null>(null)
const ready = computed(() => !props.keyword || typed.value === props.keyword)

async function arm() {
  armed.value = true
  typed.value = ''
  await nextTick()
  if (input.value) input.value.focus()
  else cancelButton.value?.$el.focus()
}
function reset() {
  armed.value = false
  typed.value = ''
}
async function cancel() {
  reset()
  await nextTick()
  startButton.value?.$el.focus()
}
function confirm() {
  if (!ready.value || props.busy) return
  emit('confirm')
}
defineExpose({ reset })
</script>

<template>
  <section class="admin-danger" :aria-label="t('adminList.dangerZone')" data-testid="admin-danger-zone">
    <div v-if="!armed" class="admin-danger-row">
      <span v-if="hint" class="admin-danger-hint">{{ hint }}</span>
      <AppButton ref="startButton" variant="danger" class="admin-danger-start" data-testid="admin-danger-start" :disabled="disabled" @click="arm">{{ actionLabel }}</AppButton>
    </div>
    <div v-else class="admin-danger-confirm-panel">
      <p v-if="message" class="admin-danger-message">{{ message }}</p>
      <slot />
      <label v-if="keyword" class="admin-danger-field">
        <span>{{ keywordLabel }}</span>
        <input ref="input" v-model="typed" class="admin-danger-input" data-testid="admin-danger-input" autocomplete="off" autocapitalize="characters" spellcheck="false" :placeholder="keyword" @keydown.enter.prevent="confirm" />
      </label>
      <div class="admin-danger-actions">
        <AppButton ref="cancelButton" variant="ghost" data-testid="admin-danger-cancel" :disabled="busy" @click="cancel">{{ t('adminList.cancel') }}</AppButton>
        <AppButton variant="danger" class="admin-danger-confirm" data-testid="admin-danger-confirm" :disabled="!ready || busy" :loading="busy" @click="confirm">{{ confirmLabel || actionLabel }}</AppButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.admin-danger-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
.admin-danger-hint { color: var(--color-text-secondary); font: var(--type-caption); }
.admin-danger-confirm-panel { display: grid; gap: var(--space-3); }
.admin-danger-message { margin: 0; color: var(--color-text-primary); }
.admin-danger-field { display: grid; gap: var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); }
.admin-danger-input {
  box-sizing: border-box;
  width: 100%;
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}
.admin-danger-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
</style>
