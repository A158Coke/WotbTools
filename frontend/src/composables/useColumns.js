import { ref, computed, watch } from 'vue'
import {
  AGG_DEFAULT_VISIBLE,
  DEFAULT_VISIBLE,
  EXTENDED_ONLY_PLAYER_KEYS,
  LEAGUE_DEFAULT_VISIBLE,
  LEAGUE_FIXED_KEYS,
  CW_SUMMARY_DEFAULT_VISIBLE,
  LEGACY_CW_SUMMARY_DEFAULT_VISIBLE,
  LEGACY_DEFAULT_VISIBLE,
  UNPRESENTABLE_COLUMN_KEYS
} from '../utils/helpers.js'
import { mergeCwPlayerColumns } from '../utils/playerSummaryMerge.js'

const STORAGE_KEYS = {
  playerVisible: 'wotb-replay-player-visible-cols',
  playerOrder: 'wotb-replay-player-order',
  aggVisible: 'wotb-replay-agg-visible-cols',
  aggOrder: 'wotb-replay-agg-order',
}

const LEAGUE_STORAGE_KEYS = {
  playerVisible: 'wotb-league-player-visible-cols',
  playerOrder: 'wotb-league-player-order',
  aggVisible: 'wotb-league-agg-visible-cols',
  aggOrder: 'wotb-league-agg-order',
  cwVisible: 'wotb-league-cw-visible-cols',
  cwOrder: 'wotb-league-cw-order',
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

const COLUMN_DEFAULTS_VERSION_KEY = 'wotb-columns-defaults-v'
const COLUMN_DEFAULTS_VERSION = '2'

function needsDefaultsMigration() {
  try {
    return localStorage.getItem(COLUMN_DEFAULTS_VERSION_KEY) !== COLUMN_DEFAULTS_VERSION
  } catch (_) {
    return false
  }
}

function markDefaultsMigrated() {
  try {
    localStorage.setItem(COLUMN_DEFAULTS_VERSION_KEY, COLUMN_DEFAULTS_VERSION)
  } catch (_) {
    // 隐私模式等：下次仍会尝试迁移，但只影响「与旧默认值完全相同」的存档
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
  if (storedVisible == null) return availableKeys.filter(key => defaults.includes(key))
  const available = new Set(availableKeys)
  const visible = uniqueKeys((storedVisible || []).filter(key => available.has(key)))
  const missingDefault = availableKeys.filter(key =>
    !(storedOrder || []).includes(key) && defaults.includes(key))
  return [...visible, ...missingDefault.filter(key => !visible.includes(key))]
}

function migrateUntouchedDefaults(storedVisible, legacyDefaults, migrate) {
  if (storedVisible == null) return null
  if (!migrate) return storedVisible
  const stored = new Set(storedVisible)
  const untouched = legacyDefaults.some(defaults =>
    defaults.length === stored.size && defaults.every(key => stored.has(key)))
  return untouched ? null : storedVisible
}

function aggDefaults(availableKeys) {
  const defaults = availableKeys.filter(key => AGG_DEFAULT_VISIBLE.includes(key))
  return defaults.length ? defaults : [...availableKeys]
}

function restoreAggVisible(availableKeys, storedOrder, storedVisible, migrate) {
  if (storedVisible == null || (migrate && hadAllColumnsVisible(storedOrder, storedVisible))) return aggDefaults(availableKeys)
  const available = new Set(availableKeys)
  return uniqueKeys(storedVisible.filter(key => available.has(key)))
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

function pinLeagueOrder(order) {
  const rest = order.filter(key => !LEAGUE_FIXED_KEYS.includes(key))
  return [...LEAGUE_FIXED_KEYS, ...rest]
}

function forceLeagueVisible(visible) {
  return uniqueKeys([...visible, ...LEAGUE_FIXED_KEYS])
}

export function useColumns(playerCols, aggCols, dataViewModeRef, leagueModeRef = ref(false)) {
  const visibleKeys = ref([])
  const aggVisibleKeys = ref([])
  const playerOrder = ref([])
  const aggOrder = ref([])
  const cwVisibleKeys = ref([])
  const cwOrder = ref([])
  const cwAvailableKeys = ref([])
  const showColPicker = ref(false)
  const pickerScope = ref('player')

  const leagueMode = computed(() => leagueModeRef.value)

  const colScope = computed(() => {
    if (dataViewModeRef.value === 'SUMMARY') return leagueMode.value ? 'cw' : 'agg'
    return 'player'
  })
  const currentOrder = computed(() =>
    pickerScope.value === 'agg' ? aggOrder.value
      : pickerScope.value === 'cw' ? cwOrder.value
        : playerOrder.value)
  const basePlayerCols = computed(() =>
    playerCols.value.filter(c => !EXTENDED_ONLY_PLAYER_KEYS.has(c.key)))
  const presentableAggCols = computed(() =>
    (aggCols.value || []).filter(c => !UNPRESENTABLE_COLUMN_KEYS.has(c.key)))

  const playerColMap = computed(() => Object.fromEntries(basePlayerCols.value.map(c => [c.key, c])))
  const aggColMap = computed(() => Object.fromEntries(presentableAggCols.value.map(c => [c.key, c])))

  const shownCols = computed(() =>
    playerOrder.value.filter(k => visibleKeys.value.includes(k)).map(k => playerColMap.value[k]).filter(Boolean))
  const shownAggCols = computed(() =>
    aggOrder.value.filter(k => aggVisibleKeys.value.includes(k)).map(k => aggColMap.value[k]).filter(Boolean))

  function initFromResponse(resp) {
    const migrate = needsDefaultsMigration()
    const league = resp.leagueMode === true
    const storage = league ? LEAGUE_STORAGE_KEYS : STORAGE_KEYS
    const defaults = league ? LEAGUE_DEFAULT_VISIBLE : DEFAULT_VISIBLE
    const pk = (resp.playerColumns || [])
      .filter(c => !EXTENDED_ONLY_PLAYER_KEYS.has(c.key))
      .map(c => c.key)
    const ak = presentableAggCols.value.map(c => c.key)

    const storedPlayerOrder = readStoredList(storage.playerOrder)
    const storedPlayerVisible = league
      ? readStoredList(storage.playerVisible)
      : migrateUntouchedDefaults(readStoredList(storage.playerVisible), LEGACY_DEFAULT_VISIBLE, migrate)
    const storedAggOrder = readStoredList(storage.aggOrder)
    const storedAggVisible = readStoredList(storage.aggVisible)

    playerOrder.value = league
      ? pinLeagueOrder(mergeOrder(pk, storedPlayerOrder))
      : mergeOrder(pk, storedPlayerOrder)
    visibleKeys.value = league
      ? forceLeagueVisible(restorePlayerVisible(pk, storedPlayerOrder, storedPlayerVisible, defaults))
      : restorePlayerVisible(pk, storedPlayerOrder, storedPlayerVisible, defaults)
    aggOrder.value = mergeOrder(ak, storedAggOrder)
    aggVisibleKeys.value = restoreAggVisible(ak, storedAggOrder, storedAggVisible, migrate)

    if (league) {
      const ck = mergeCwPlayerColumns(
        resp.league?.playerSummaryColumns || [],
        resp.aggregateColumns || []
      ).filter(c => !EXTENDED_ONLY_PLAYER_KEYS.has(c.key)).map(c => c.key)
      cwAvailableKeys.value = ck
      const storedCwOrder = readStoredList(storage.cwOrder)
      const storedCwVisible = migrateUntouchedDefaults(readStoredList(storage.cwVisible), LEGACY_CW_SUMMARY_DEFAULT_VISIBLE, migrate)
      cwOrder.value = pinLeagueOrder(mergeOrder(ck, storedCwOrder))
      cwVisibleKeys.value = forceLeagueVisible(
        restorePlayerVisible(ck, storedCwOrder, storedCwVisible, CW_SUMMARY_DEFAULT_VISIBLE))
    }
    if (migrate) markDefaultsMigrated()
  }

  function toggleColPicker() {
    if (showColPicker.value) { showColPicker.value = false; return }
    pickerScope.value = colScope.value
    showColPicker.value = true
  }

  function toggleCol(e) {
    if (e.scope === 'cw') {
      if (LEAGUE_FIXED_KEYS.includes(e.key)) return
      cwVisibleKeys.value = cwVisibleKeys.value.includes(e.key)
        ? cwVisibleKeys.value.filter(k => k !== e.key)
        : [...cwVisibleKeys.value, e.key]
      return
    }
    const target = e.scope === 'agg' ? aggVisibleKeys : visibleKeys
    if (e.scope === 'player' && leagueMode.value && LEAGUE_FIXED_KEYS.includes(e.key)) {
      return
    }
    target.value = target.value.includes(e.key)
      ? target.value.filter(k => k !== e.key)
      : [...target.value, e.key]
  }

  function selectAllCols(scope) {
    if (scope === 'cw') { cwVisibleKeys.value = cwOrder.value.slice(); return }
    const all = (scope === 'agg' ? aggOrder : playerOrder).value.slice()
    if (scope === 'agg') aggVisibleKeys.value = all
    else visibleKeys.value = all
  }

  function resetCols(scope) {
    if (scope === 'cw') {
      cwOrder.value = pinLeagueOrder([...cwAvailableKeys.value])
      cwVisibleKeys.value = forceLeagueVisible([...CW_SUMMARY_DEFAULT_VISIBLE])
    } else if (scope === 'agg') {
      aggOrder.value = presentableAggCols.value.map(c => c.key)
      aggVisibleKeys.value = aggDefaults(aggOrder.value)
    } else if (leagueMode.value) {
      playerOrder.value = pinLeagueOrder(basePlayerCols.value.map(c => c.key))
      visibleKeys.value = forceLeagueVisible([...LEAGUE_DEFAULT_VISIBLE])
    } else {
      playerOrder.value = basePlayerCols.value.map(c => c.key)
      visibleKeys.value = [...DEFAULT_VISIBLE]
    }
  }

  function handleReorder(next) {
    if (pickerScope.value === 'cw') {
      cwOrder.value = pinLeagueOrder(next)
    } else if (pickerScope.value === 'agg') {
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
  watch(cwVisibleKeys, value => writeStoredList(LEAGUE_STORAGE_KEYS.cwVisible, value))
  watch(cwOrder, value => writeStoredList(LEAGUE_STORAGE_KEYS.cwOrder, value))

  return {
    visibleKeys, aggVisibleKeys, playerOrder, aggOrder,
    cwVisibleKeys, cwOrder,
    showColPicker, pickerScope, colScope, currentOrder,
    playerColMap, aggColMap, shownCols, shownAggCols,
    leagueMode,
    initFromResponse,
    toggleColPicker, toggleCol, selectAllCols, resetCols, handleReorder,
  }
}
