<script setup>
import { ref, watch } from 'vue'

defineOptions({ name: 'ReplaySourcePanel' })

const props = defineProps({
  files: { type: Array, default: () => [] },
  currentBattleIndex: { type: Number, default: -1 },
  currentBattleName: { type: String, default: '' },
  currentBattleId: { type: String, default: null },
  battleOptions: { type: Array, default: () => [] },
})

const emit = defineEmits(['select-battle'])
const batchOpen = ref(false)

function selectBattle(sourceId) {
  emit('select-battle', sourceId)
  batchOpen.value = false
}

watch(() => props.files, () => {
  if (!props.battleOptions.length) batchOpen.value = false
})
</script>

<template>
  <div v-if="props.files.length" class="replay-source" data-test="replay-source">
    <div class="rs-batch-row">
      <span class="ws-batch-count">{{ $t('workspace.batch_count', { count: props.files.length }) }}</span>
      <button v-if="props.currentBattleIndex >= 0" class="ghost sm ws-selector" data-testid="ws-batch-selector" @click="batchOpen = !batchOpen">
        {{ $t('workspace.current_battle', { name: props.currentBattleName, idx: props.currentBattleIndex + 1 }) }} ▾
      </button>
      <div v-if="batchOpen && props.battleOptions.length" class="ws-batch-sheet" data-testid="ws-batch-sheet">
        <button
          v-for="option in props.battleOptions"
          :key="option.sourceId"
          type="button"
          class="ws-batch-item"
          :class="{ active: props.currentBattleId === option.sourceId }"
          @click="selectBattle(option.sourceId)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.replay-source { margin: 0 0 10px; }
.ws-selector { min-height: 30px; }
.rs-batch-row { display: inline-flex; align-items: center; gap: 10px; position: relative; }
.ws-batch-sheet {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 60;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
  box-shadow: var(--hard-shadow);
  min-width: 240px;
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ws-batch-item { text-align: left; padding: 8px 10px; border-radius: 6px; border: none; background: transparent; color: var(--text-label); font-size: .82rem; cursor: pointer; font-family: inherit; }
.ws-batch-item:hover { background: var(--bg-list-hover); }
.ws-batch-item.active { background: var(--bg-blue); color: var(--accent-dark); font-weight: 700; }
@media (max-width: 768px) {
  .ws-selector { width: 100%; justify-content: space-between; }
  .ws-batch-sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    max-height: 55vh;
    border-radius: 14px 14px 0 0;
    padding: 12px;
    box-shadow: var(--hard-shadow);
  }
}
</style>
