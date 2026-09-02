<script setup>
import { ref } from 'vue'
import { catOf } from '../utils/helpers.js'

const props = defineProps({
  scope: String,
  order: Array,
  visible: Array,
  /** 固定列 key：不可隐藏、不可拖拽（League 模式总 Rating 列）。 */
  fixedKeys: { type: Array, default: () => [] },
})

const emit = defineEmits(['toggle', 'selectAll', 'reset', 'reorder'])
const dragIdx = ref(-1)

function onDragStart(i) { dragIdx.value = i }
/** 合法移动判断（▲/▼ 按钮与 drag/drop 共用，唯一语义）：目标不越界、被移列非固定列，
 *  且移动后所有 fixedKeys 仍停留在原索引（不可跨越或插入固定列区域）。
 *  合法时返回重排后的新数组，非法返回 null。 */
function legalReorder(idx, to) {
  if (to < 0 || to >= props.order.length) return null
  if (props.fixedKeys.includes(props.order[idx])) return null
  const next = props.order.slice()
  const [moved] = next.splice(idx, 1)
  next.splice(to, 0, moved)
  const fixedKept = props.fixedKeys.every((f) => next[props.order.indexOf(f)] === f)
  return fixedKept ? next : null
}
function move(idx, delta) {
  const next = legalReorder(idx, idx + delta)
  if (next) emit('reorder', next)
}
function onDrop(i) {
  const from = dragIdx.value
  dragIdx.value = -1
  if (from < 0 || from === i) return
  move(from, i - from)
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
      <li v-for="(key, idx) in order" :key="key" :draggable="!fixedKeys.includes(key)"
          @dragstart="onDragStart(idx)" @dragover.prevent @drop="onDrop(idx)"
          :class="{ dragging: dragIdx === idx, fixed: fixedKeys.includes(key) }">
        <span class="grip" :title="$t('col_picker.drag')">::</span>
        <label class="colitem">
          <input type="checkbox" :checked="visible.includes(key)" :disabled="fixedKeys.includes(key)"
                 @change="$emit('toggle', { key, scope })" />
          {{ $t((scope === 'player' ? 'player_labels.' : 'agg_labels.') + key) }}
        </label>
        <span class="cat">{{ catOf(key, $t) }}</span>
        <!-- 触屏/键盘替代拖拽的上下移按钮：fixedKeys 不渲染（占位 span 保持 grid 对齐），
             方向不合法（越界/会穿过固定列）时禁用；桌面仍可用 HTML5 拖拽。 -->
        <span class="colmove">
          <template v-if="!fixedKeys.includes(key)">
            <button type="button" class="colmove-btn" :disabled="!legalReorder(idx, idx - 1)"
                    :aria-label="$t('col_picker.move_up')" :title="$t('col_picker.move_up')"
                    @click="move(idx, -1)">▲</button>
            <button type="button" class="colmove-btn" :disabled="!legalReorder(idx, idx + 1)"
                    :aria-label="$t('col_picker.move_down')" :title="$t('col_picker.move_down')"
                    @click="move(idx, 1)">▼</button>
          </template>
        </span>
      </li>
    </ul>
  </div>
</template>
