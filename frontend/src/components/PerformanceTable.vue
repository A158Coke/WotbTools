<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

// 战斗表现表：复用 /api/preview 同一次回放处理产出的 performance facts（只读展示 + 排序）。
// 迁移自原独立 ExtendedPage 的表格 UI——不再存在独立入口/独立 pipeline。
const { t, te } = useI18n()
const props = defineProps({ rows: Array, columns: Array })
const sortKey = ref('')
const sortReverse = ref(false)

const sorted = computed(() => {
  if (!sortKey.value) return props.rows || []
  const arr = [...(props.rows || [])]
  const col = (props.columns || []).find(c => c.key === sortKey.value)
  arr.sort((a, b) => {
    let av = a.cells?.[sortKey.value]
    let bv = b.cells?.[sortKey.value]
    if (col?.num) {
      av = parseFloat(String(av ?? '').replace('%', '')) || 0
      bv = parseFloat(String(bv ?? '').replace('%', '')) || 0
      return av - bv
    }
    return String(av ?? '').localeCompare(String(bv ?? ''))
  })
  return sortReverse.value ? arr.reverse() : arr
})

function sortBy(col) {
  if (sortKey.value === col.key) sortReverse.value = !sortReverse.value
  else { sortKey.value = col.key; sortReverse.value = false }
}

function arrow(key) {
  return sortKey.value === key ? (sortReverse.value ? ' ▼' : ' ▲') : ''
}

function label(key) {
  const path = 'performance_labels.' + key
  return te(path) ? t(path) : key
}
</script>

<template>
  <div class="tablewrap">
    <table>
      <thead><tr>
        <th v-for="c in columns" :key="c.key" @click="sortBy(c)" :class="{ num: c.num }">
          {{ label(c.key) }}{{ arrow(c.key) }}
        </th>
      </tr></thead>
      <tbody>
        <tr v-for="(row, i) in sorted" :key="i">
          <td v-for="c in columns" :key="c.key" :class="{ num: c.num }">{{ row.cells[c.key] }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
