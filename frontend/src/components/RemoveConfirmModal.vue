<script setup>
defineProps({ pending: Object })
const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <div v-if="pending" class="modal-mask" @click.self="$emit('cancel')">
    <div class="modal">
      <p class="modal-title">{{ $t('modal.remove_title') }}</p>
      <p>{{ $t('modal.remove_confirm', { label: pending.label }) }}</p>
      <p class="modal-sub">{{ $t('modal.remove_hint') }}</p>
      <div class="modal-actions">
        <button @click="$emit('confirm')">{{ $t('modal.confirm') }}</button>
        <button class="ghost" @click="$emit('cancel')">{{ $t('modal.cancel') }}</button>
      </div>
    </div>
  </div>
</template>
