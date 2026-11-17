<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Activations, BoostOption, ItemCatalog } from '../composables/tankMobility'
const props = defineProps<{ options?: BoostOption[]; modelValue?: Activations; catalog?: ItemCatalog | null }>()
const emit = defineEmits(['update:modelValue'])
const { t, locale } = useI18n()
function change(stem: string, value: number | null) {
  const next = { ...props.modelValue }
  if (value == null) delete next[stem]
  else if (Number.isFinite(value) && value >= 0) next[stem] = value
  emit('update:modelValue', next)
}
function name(stem: string) {
  const item = props.catalog?.consumables?.find(i => i.stem === stem)
  return item?.[locale.value === 'zh' ? 'name_zh-Hans' : 'name_en'] || stem
}
</script>
<template>
  <fieldset v-if="options?.length">
    <legend>{{ t('mobility.activation') }}</legend>
    <div v-for="o in options" :key="o.stem">
      <label><input type="checkbox" :checked="modelValue?.[o.stem] != null" :disabled="!o.supported"
        @change="change(o.stem, ($event.target as HTMLInputElement).checked ? 0 : null)" /> {{ name(o.stem) }}</label>
      <label v-if="o.supported && modelValue?.[o.stem] != null">{{ t('mobility.from') }}
        <input type="number" min="0" step="0.1" :value="modelValue?.[o.stem]" @change="change(o.stem, ($event.target as HTMLInputElement).valueAsNumber)" /> · {{ t('agentTanks.configurator.consumable_timing', { name: name(o.stem), duration: o.duration, cooldown: o.cooldown ?? '—' }) }}
      </label>
      <span v-if="!o.supported">{{ t('mobility.unsupported') }}</span>
    </div>
  </fieldset>
</template>
