<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

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
const batchRow = ref(null)

function selectBattle(sourceId) {
  emit('select-battle', sourceId)
  batchOpen.value = false
}
function closeBatch() { batchOpen.value = false }

// 移动端 bottom sheet 的 outside-tap 关闭（照 UserMenu：document 级监听 + cleanup）。
// 仅 <768px bottom-sheet 布局启用：桌面 dropdown 无遮罩、行为不变。
function onDocumentClick(event) {
  if (!batchOpen.value || window.innerWidth >= 768) return
  if (!batchRow.value?.contains(event.target)) closeBatch()
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))

watch(() => props.files, () => {
  if (!props.battleOptions.length) batchOpen.value = false
})
</script>

<template>
  <div v-if="props.files.length" class="replay-source" data-test="replay-source">
    <div class="rs-batch-row" ref="batchRow">
      <span class="ws-batch-count">{{ $t('workspace.batch_count', { count: props.files.length }) }}</span>
      <button v-if="props.currentBattleIndex >= 0" class="ghost sm ws-selector" data-testid="ws-batch-selector" @click="batchOpen = !batchOpen">
        {{ $t('workspace.current_battle', { name: props.currentBattleName, idx: props.currentBattleIndex + 1 }) }} ▾
      </button>
      <!-- 移动端 bottom sheet 遮罩（仅 <768px 显示，z-order 低于 sheet）：点击关闭 -->
      <div v-if="batchOpen && props.battleOptions.length" class="ws-batch-backdrop" data-testid="ws-batch-backdrop" aria-hidden="true" @click="closeBatch"></div>
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
/* 遮罩仅移动端 bottom-sheet 模式出现（桌面 dropdown 无遮罩，行为不变） */
.ws-batch-backdrop { display: none; }
@media (width < 768px) {
  .ws-selector { width: 100%; justify-content: space-between; }
  .ws-batch-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 55; /* 低于 sheet(60)，盖住其余内容承接 outside-tap */
    background: rgb(0 0 0 / .35);
  }
  .ws-batch-sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    max-height: 55vh;
    border-radius: 14px 14px 0 0;
    padding: 12px;
    /* Android edge-to-edge 预备：env() 今日解析为 0，视觉零变化 */
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
    box-shadow: var(--hard-shadow);
  }
}
</style>
