<script setup>
defineProps({
  file: {
    type: Object,
    default: null
  },
  loading: {
    type: Boolean,
    required: true
  },
  queryTime: {
    type: String,
    required: true
  }
})

defineEmits(['reconstruct', 'state-at', 'update:queryTime'])
</script>

<template>
  <div class="actionrow">
    <button class="lg" :disabled="loading || !file" @click="$emit('reconstruct')">
      {{ loading ? $t('action.processing') : $t('recon.reconstruct_btn') }}
    </button>
    <div v-if="file" class="time-action">
      <input
        class="time-input"
        type="number"
        step="0.1"
        min="0"
        :placeholder="$t('recon.time_placeholder')"
        :value="queryTime"
        @input="$emit('update:queryTime', $event.target.value)"
      >
      <button
        class="ghost"
        :disabled="loading || !queryTime"
        @click="$emit('state-at')"
      >
        {{ $t('recon.query_btn') }}
      </button>
    </div>
  </div>
</template>
