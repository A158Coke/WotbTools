<script setup>
import { ref } from 'vue'
import { catOf } from '../utils/helpers.js'

const props = defineProps({
  scope: String,
  order: Array,
  visible: Array,
})

const emit = defineEmits(['toggle', 'selectAll', 'reset', 'reorder'])
const dragIdx = ref(-1)

function onDragStart(i) { dragIdx.value = i }
function onDrop(i) {
  const from = dragIdx.value
  dragIdx.value = -1
  if (from < 0 || from === i) return
  const next = props.order.slice()
  const [moved] = next.splice(from, 1)
  next.splice(i, 0, moved)
  emit('reorder', next)
}
</script>

<template>
  <div class="colpanel">
    <div class="colpanel-head">
      <span class="cph-title">{{ scope === 'agg' ? $t('col_picker.title_agg') : $t('col_picker.title_player') }} · {{ $t('col_picker.desc') }}</span>
      <button class="linkbtn" @click="$emit('selectAll', scope)">{{ $t('col_picker.select_all') }}</button>
      <button class="linkbtn" @click="$emit('reset', scope)">{{ $t('col_picker.reset') }}</button>
      <button class="linkbtn" @click="$emit('close')">{{ $t('col_picker.done') }}</button>
    </div>
    <ul class="collist">
      <li v-for="(key, idx) in order" :key="key" draggable="true"
          @dragstart="onDragStart(idx)" @dragover.prevent @drop="onDrop(idx)"
          :class="{ dragging: dragIdx === idx }">
        <span class="grip" title="⋮⋮">⋮⋮</span>
        <label class="colitem">
          <input type="checkbox" :checked="visible.includes(key)" @change="$emit('toggle', { key, scope })" />
          {{ $t((scope === 'agg' ? 'agg_labels.' : 'player_labels.') + key) }}
        </label>
        <span class="cat">{{ catOf(key, $t) }}</span>
      </li>
    </ul>
  </div>
</template>
