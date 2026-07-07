import { ref, computed, watch } from 'vue'
import { DEFAULT_VISIBLE, EXTENDED_ONLY_PLAYER_KEYS } from '../utils/helpers.js'

const STORAGE_KEYS = {
  playerVisible: 'wotb-replay-player-visible-cols',
  playerOrder: 'wotb-replay-player-order',
  aggVisible: 'wotb-replay-agg-visible-cols',
  aggOrder: 'wotb-replay-agg-order',
}

function readStoredList(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? uniqueKeys(parsed.filter(value => typeof value === 'string')) : null
  } catch (_) {
    return null
  }
}

function writeStoredList(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify(values))
  } catch (_) {
    // Ignore quota/private-mode failures and keep in-memory behavior.
  }
}

function mergeOrder(availableKeys, storedOrder) {
  const available = new Set(availableKeys)
  const sanitized = uniqueKeys((storedOrder || []).filter(key => available.has(key)))
  return appendMissingKeys(sanitized, availableKeys)
}

function restorePlayerVisible(availableKeys, storedOrder, storedVisible) {
  const available = new Set(availableKeys)
  const visible = uniqueKeys((storedVisible || []).filter(key => available.has(key)))
  const missingDefault = availableKeys.filter(key =>
    !(storedOrder || []).includes(key) && DEFAULT_VISIBLE.includes(key))
  return [...visible, ...missingDefault.filter(key => !visible.includes(key))]
}

function restoreAggVisible(availableKeys, storedOrder, storedVisible) {
  if (storedVisible == null) return [...availableKeys]
  const available = new Set(availableKeys)
  const visible = uniqueKeys(storedVisible.filter(key => available.has(key)))
  return hadAllColumnsVisible(storedOrder, storedVisible)
    ? appendMissingKeys(visible, availableKeys.filter(key => !(storedOrder || []).includes(key)))
    : visible
}

function uniqueKeys(keys) {
  return [...new Set(keys)]
}

function appendMissingKeys(baseKeys, candidateKeys) {
  const missing = candidateKeys.filter(key => !baseKeys.includes(key))
  return [...baseKeys, ...missing]
}

function hadAllColumnsVisible(storedOrder, storedVisible) {
  return Array.isArray(storedOrder)
    && storedOrder.length > 0
    && storedOrder.every(key => storedVisible.includes(key))
}

export function useColumns(playerCols, aggCols, activeTab) {
  const visibleKeys = ref([])
  const aggVisibleKeys = ref([])
  const playerOrder = ref([])
  const aggOrder = ref([])
  const showColPicker = ref(false)
  const pickerScope = ref('player')

  const colScope = computed(() => activeTab.value === 'aggregate' ? 'agg' : 'player')
  const currentOrder = computed(() => pickerScope.value === 'agg' ? aggOrder.value : playerOrder.value)
  const basePlayerCols = computed(() =>
    playerCols.value.filter(c => !EXTENDED_ONLY_PLAYER_KEYS.has(c.key)))

  const playerColMap = computed(() => Object.fromEntries(basePlayerCols.value.map(c => [c.key, c])))
  const aggColMap = computed(() => Object.fromEntries(aggCols.value.map(c => [c.key, c])))

  const shownCols = computed(() =>
    playerOrder.value.filter(k => visibleKeys.value.includes(k)).map(k => playerColMap.value[k]).filter(Boolean))
  const shownAggCols = computed(() =>
    aggOrder.value.filter(k => aggVisibleKeys.value.includes(k)).map(k => aggColMap.value[k]).filter(Boolean))

  function initFromResponse(resp) {
    const pk = (resp.playerColumns || [])
      .filter(c => !EXTENDED_ONLY_PLAYER_KEYS.has(c.key))
      .map(c => c.key)
    const ak = (resp.aggregateColumns || []).map(c => c.key)

    const storedPlayerOrder = readStoredList(STORAGE_KEYS.playerOrder)
    const storedPlayerVisible = readStoredList(STORAGE_KEYS.playerVisible)
    const storedAggOrder = readStoredList(STORAGE_KEYS.aggOrder)
    const storedAggVisible = readStoredList(STORAGE_KEYS.aggVisible)

    playerOrder.value = mergeOrder(pk, storedPlayerOrder)
    visibleKeys.value = restorePlayerVisible(pk, storedPlayerOrder, storedPlayerVisible)
    aggOrder.value = mergeOrder(ak, storedAggOrder)
    aggVisibleKeys.value = restoreAggVisible(ak, storedAggOrder, storedAggVisible)
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
      playerOrder.value = basePlayerCols.value.map(c => c.key)
      visibleKeys.value = [...DEFAULT_VISIBLE]
    }
  }

  function handleReorder(next) {
    ;(pickerScope.value === 'agg' ? aggOrder : playerOrder).value = next
  }

  watch(visibleKeys, value => writeStoredList(STORAGE_KEYS.playerVisible, value))
  watch(playerOrder, value => writeStoredList(STORAGE_KEYS.playerOrder, value))
  watch(aggVisibleKeys, value => writeStoredList(STORAGE_KEYS.aggVisible, value))
  watch(aggOrder, value => writeStoredList(STORAGE_KEYS.aggOrder, value))

  return {
    visibleKeys, aggVisibleKeys, playerOrder, aggOrder,
    showColPicker, pickerScope, colScope, currentOrder,
    playerColMap, aggColMap, shownCols, shownAggCols,
    initFromResponse,
    toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder,
  }
}
