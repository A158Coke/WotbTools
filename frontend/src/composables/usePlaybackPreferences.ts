import { reactive, ref, watch } from 'vue'

export interface PlaybackLabelPreferences {
  showPlayerName: boolean
  showTankName: boolean
}

export interface PlaybackHpPreferences {
  showHp: boolean
}

export interface PlaybackPaneWidths {
  rail: number | null
  details: number | null
}

const LABEL_PREFS_KEY = 'wotb.pb.label-prefs'
const HP_PREFS_KEY = 'wotb.pb.hp-prefs'
const PANE_WIDTH_KEY = 'wotb.pb.pane-widths'
const RAIL_COLLAPSED_KEY = 'wotb.pb.rail-collapsed'

function readJson<T>(key: string, fallback: T, normalize: (value: unknown) => T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? normalize(JSON.parse(raw)) : fallback
  } catch {
    return fallback
  }
}

function persistJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Privacy mode / quota exhaustion: keep the in-memory session preference.
  }
}

export function usePlaybackPreferences() {
  const labelPrefs = reactive<PlaybackLabelPreferences>(readJson(
    LABEL_PREFS_KEY,
    { showPlayerName: false, showTankName: true },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return {
        showPlayerName: record.showPlayerName === true,
        showTankName: record.showTankName !== false,
      }
    },
  ))

  const hpPrefs = reactive<PlaybackHpPreferences>(readJson(
    HP_PREFS_KEY,
    { showHp: true },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return { showHp: record.showHp !== false }
    },
  ))

  const paneWidths = reactive<PlaybackPaneWidths>(readJson(
    PANE_WIDTH_KEY,
    { rail: null, details: null },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return {
        rail: Number.isFinite(record.rail) ? record.rail as number : null,
        details: Number.isFinite(record.details) ? record.details as number : null,
      }
    },
  ))

  const railCollapsed = ref(false)
  try {
    railCollapsed.value = localStorage.getItem(RAIL_COLLAPSED_KEY) === '1'
  } catch {
    railCollapsed.value = false
  }

  watch(labelPrefs, (value) => persistJson(LABEL_PREFS_KEY, value), { deep: true })
  watch(hpPrefs, (value) => persistJson(HP_PREFS_KEY, value), { deep: true })
  watch(paneWidths, (value) => persistJson(PANE_WIDTH_KEY, value), { deep: true })
  watch(railCollapsed, (value) => {
    try {
      localStorage.setItem(RAIL_COLLAPSED_KEY, value ? '1' : '0')
    } catch {
      // Privacy mode / quota exhaustion: keep the in-memory session preference.
    }
  })

  return { labelPrefs, hpPrefs, paneWidths, railCollapsed }
}
