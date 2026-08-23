import { ref, computed, watch } from 'vue'
import {
  DEFAULT_VISIBLE,
  EXTENDED_ONLY_PLAYER_KEYS,
  LEAGUE_DEFAULT_VISIBLE,
  LEAGUE_FIXED_KEYS,
  isLeagueColumns
} from '../utils/helpers.js'

const STORAGE_KEYS = {
  playerVisible: 'wotb-replay-player-visible-cols',
  playerOrder: 'wotb-replay-player-order',
  aggVisible: 'wotb-replay-agg-visible-cols',
  aggOrder: 'wotb-replay-agg-order',
}

/** League Rating 模式独立 storage scope（plan §16：普通与 League 列偏好互不污染）。 */
const LEAGUE_STORAGE_KEYS = {
  playerVisible: 'wotb-league-player-visible-cols',
  playerOrder: 'wotb-league-player-order',
  aggVisible: 'wotb-league-agg-visible-cols',
  aggOrder: 'wotb-league-agg-order',
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

function restorePlayerVisible(availableKeys, storedOrder, storedVisible, defaults) {
  const available = new Set(availableKeys)
  const visible = uniqueKeys((storedVisible || []).filter(key => available.has(key)))
  const missingDefault = availableKeys.filter(key =>
    !(storedOrder || []).includes(key) && defaults.includes(key))
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

/** League 固定列（玩家 + 总 Rating）必须位于前两位并始终可见（sticky 布局依据）。 */
function pinLeagueOrder(order) {
  const rest = order.filter(key => !LEAGUE_FIXED_KEYS.includes(key))
  return [...LEAGUE_FIXED_KEYS, ...rest]
}

function forceLeagueVisible(visible) {
  return uniqueKeys([...visible, ...LEAGUE_FIXED_KEYS])
}

export function useColumns(playerCols, aggCols, activeTab) {
  const visibleKeys = ref([])
  const aggVisibleKeys = ref([])
  const playerOrder = ref([])
  const aggOrder = ref([])
  const showColPicker = ref(false)
  const pickerScope = ref('player')

  /** League Rating 模式：playerColumns 含 league_rating。 */
  const leagueMode = computed(() => isLeagueColumns(playerCols.value))

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
    const league = isLeagueColumns(resp.playerColumns || [])
    const storage = league ? LEAGUE_STORAGE_KEYS : STORAGE_KEYS
    const defaults = league ? LEAGUE_DEFAULT_VISIBLE : DEFAULT_VISIBLE
    const pk = (resp.playerColumns || [])
      .filter(c => !EXTENDED_ONLY_PLAYER_KEYS.has(c.key))
      .map(c => c.key)
    const ak = (resp.aggregateColumns || []).map(c => c.key)

    const storedPlayerOrder = readStoredList(storage.playerOrder)
    const storedPlayerVisible = readStoredList(storage.playerVisible)
    const storedAggOrder = readStoredList(storage.aggOrder)
    const storedAggVisible = readStoredList(storage.aggVisible)

    playerOrder.value = league
      ? pinLeagueOrder(mergeOrder(pk, storedPlayerOrder))
      : mergeOrder(pk, storedPlayerOrder)
    visibleKeys.value = league
      ? forceLeagueVisible(restorePlayerVisible(pk, storedPlayerOrder, storedPlayerVisible, defaults))
      : restorePlayerVisible(pk, storedPlayerOrder, storedPlayerVisible, defaults)
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
    if (e.scope === 'player' && leagueMode.value && LEAGUE_FIXED_KEYS.includes(e.key)) {
      return // 总 Rating 固定显示，不允许被 ColumnPicker 隐藏
    }
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
    } else if (leagueMode.value) {
      playerOrder.value = pinLeagueOrder(basePlayerCols.value.map(c => c.key))
      visibleKeys.value = forceLeagueVisible([...LEAGUE_DEFAULT_VISIBLE])
    } else {
      playerOrder.value = basePlayerCols.value.map(c => c.key)
      visibleKeys.value = [...DEFAULT_VISIBLE]
    }
  }

  function handleReorder(next) {
    if (pickerScope.value === 'agg') {
      aggOrder.value = next
    } else if (leagueMode.value) {
      playerOrder.value = pinLeagueOrder(next)
    } else {
      playerOrder.value = next
    }
  }

  watch(visibleKeys, value => writeStoredList(
    leagueMode.value ? LEAGUE_STORAGE_KEYS.playerVisible : STORAGE_KEYS.playerVisible, value))
  watch(playerOrder, value => writeStoredList(
    leagueMode.value ? LEAGUE_STORAGE_KEYS.playerOrder : STORAGE_KEYS.playerOrder, value))
  watch(aggVisibleKeys, value => writeStoredList(
    leagueMode.value ? LEAGUE_STORAGE_KEYS.aggVisible : STORAGE_KEYS.aggVisible, value))
  watch(aggOrder, value => writeStoredList(
    leagueMode.value ? LEAGUE_STORAGE_KEYS.aggOrder : STORAGE_KEYS.aggOrder, value))

  return {
    visibleKeys, aggVisibleKeys, playerOrder, aggOrder,
    showColPicker, pickerScope, colScope, currentOrder,
    playerColMap, aggColMap, shownCols, shownAggCols,
    leagueMode,
    initFromResponse,
    toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder,
  }
}
