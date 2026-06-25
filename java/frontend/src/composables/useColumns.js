import { ref, computed } from 'vue'
import { DEFAULT_VISIBLE } from '../utils/helpers.js'

export function useColumns(playerCols, aggCols, activeTab) {
  const visibleKeys = ref([])
  const aggVisibleKeys = ref([])
  const playerOrder = ref([])
  const aggOrder = ref([])
  const showColPicker = ref(false)
  const pickerScope = ref('player')

  const colScope = computed(() => activeTab.value === 'aggregate' ? 'agg' : 'player')
  const currentOrder = computed(() => pickerScope.value === 'agg' ? aggOrder.value : playerOrder.value)

  const playerColMap = computed(() => Object.fromEntries(playerCols.value.map(c => [c.key, c])))
  const aggColMap = computed(() => Object.fromEntries(aggCols.value.map(c => [c.key, c])))

  const shownCols = computed(() =>
    playerOrder.value.filter(k => visibleKeys.value.includes(k)).map(k => playerColMap.value[k]).filter(Boolean))
  const shownAggCols = computed(() =>
    aggOrder.value.filter(k => aggVisibleKeys.value.includes(k)).map(k => aggColMap.value[k]).filter(Boolean))

  function initFromResponse(resp) {
    const pk = resp.playerColumns.map(c => c.key)
    const ak = (resp.aggregateColumns || []).map(c => c.key)
    if (!visibleKeys.value.length) visibleKeys.value = [...DEFAULT_VISIBLE]
    if (!playerOrder.value.length) playerOrder.value = [...pk]
    if (!aggVisibleKeys.value.length) aggVisibleKeys.value = [...ak]
    if (!aggOrder.value.length) aggOrder.value = [...ak]
  }

  function toggleColPicker() {
    if (showColPicker.value) { showColPicker.value = false; return }
    pickerScope.value = colScope.value
    showColPicker.value = true
  }

  function toggleCol(e) {
    const target = e.scope === 'agg' ? aggVisibleKeys : visibleKeys
    target.value = target.value.includes(e.key)
      ? target.value.filter(k => k !== e.key)
      : [...target.value, e.key]
  }

  function selectAllCols(scope) {
    const all = (scope === 'agg' ? aggOrder : playerOrder).value.slice()
    if (scope === 'agg') aggVisibleKeys.value = all
    else visibleKeys.value = all
  }

  function resetCols(scope) {
    if (scope === 'agg') {
      aggOrder.value = aggCols.value.map(c => c.key)
      aggVisibleKeys.value = aggCols.value.map(c => c.key)
    } else {
      playerOrder.value = playerCols.value.map(c => c.key)
      visibleKeys.value = [...DEFAULT_VISIBLE]
    }
  }

  function handleReorder(next) {
    ;(pickerScope.value === 'agg' ? aggOrder : playerOrder).value = next
  }

  return {
    visibleKeys, aggVisibleKeys, playerOrder, aggOrder,
    showColPicker, pickerScope, colScope, currentOrder,
    playerColMap, aggColMap, shownCols, shownAggCols,
    initFromResponse,
    toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder,
  }
}
