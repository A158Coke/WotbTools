<script setup>
defineProps({
  analyzing: {
    type: Boolean,
    required: true
  }
})

defineEmits(['analyze', 'cancel'])
</script>

<template>
  <div class="ai-action">
    <button class="lg" :disabled="analyzing" @click="$emit('analyze')">
      {{ analyzing ? $t('action.processing') : $t('recon.analyze_btn') }}
    </button>
    <button v-if="analyzing" class="cancel" type="button" @click="$emit('cancel')">
      {{ $t('recon.cancel_btn') }}
    </button>
  </div>
</template>

<style scoped>
/* AI 战术复盘主按钮：与 btn-primary 主题一致（accent 强调色，双主题变量） */
.ai-action {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-action .lg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 28px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: .95rem;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 2px 10px var(--accent-shadow);
  transition: background .15s ease, transform .1s ease;
}

.ai-action .lg:hover:not(:disabled) {
  background: var(--accent-hover);
}

.ai-action .lg:active:not(:disabled) {
  transform: translateY(1px);
}

.ai-action .cancel {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-label);
  font-size: .85rem;
  font-family: inherit;
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}

.ai-action .cancel:hover {
  background: var(--error);
  border-color: var(--error);
  color: var(--accent-text);
}

.ai-action .lg:disabled {
  opacity: .55;
  cursor: not-allowed;
  box-shadow: none;
}
</style>
