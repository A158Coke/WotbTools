import { effectScope, reactive, readonly, ref, watch } from 'vue'

export interface PlaybackLabelPreferences {
  showPlayerName: boolean
  showTankName: boolean
  showReload: boolean
}

export interface PlaybackHpPreferences {
  showHp: boolean
  mode: 'bar' | 'ring'
}

export interface PlaybackTrailPreferences {
  showTrail: boolean
}

export interface PlaybackMarkerPreferences {
  classIcons: boolean
  showStatus: boolean
  battleMarkers: boolean
}

export interface PlaybackUiPreferences {
  showTopbar: boolean
  showRoster: boolean
  showKillfeed: boolean
  showBaseStatus: boolean
}

export interface PlaybackLastKnownPreferences {
  showLastKnown: boolean
}

const LABEL_PREFS_KEY = 'wotb.pb.label-prefs'
const HP_PREFS_KEY = 'wotb.pb.hp-prefs'
const TRAIL_PREFS_KEY = 'wotb.pb.trail-prefs'
const UI_PREFS_KEY = 'wotb.pb.ui-prefs'
const MARKER_PREFS_KEY = 'wotb.pb.marker-prefs'
const LAST_KNOWN_PREFS_KEY = 'wotb.pb.last-known-prefs'

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

function createPlaybackPreferences() {
  const labelPrefs = reactive<PlaybackLabelPreferences>(readJson(
    LABEL_PREFS_KEY,
    { showPlayerName: false, showTankName: true, showReload: true },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return {
        showPlayerName: record.showPlayerName === true,
        showTankName: record.showTankName !== false,
        showReload: record.showReload !== false,
      }
    },
  ))

  const uiPrefs = reactive<PlaybackUiPreferences>(readJson(
    UI_PREFS_KEY,
    { showTopbar: true, showRoster: true, showKillfeed: true, showBaseStatus: true },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return {
        showTopbar: record.showTopbar !== false,
        showRoster: record.showRoster !== false,
        showKillfeed: record.showKillfeed !== false,
        showBaseStatus: record.showBaseStatus !== false,
      }
    },
  ))

  const hpPrefs = reactive<PlaybackHpPreferences>(readJson(
    HP_PREFS_KEY,
    { showHp: true, mode: 'bar' },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return { showHp: record.showHp !== false, mode: record.mode === 'ring' ? 'ring' : 'bar' }
    },
  ))

  const trailPrefs = reactive<PlaybackTrailPreferences>(readJson(
    TRAIL_PREFS_KEY,
    { showTrail: true },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return { showTrail: record.showTrail !== false }
    },
  ))

  const markerPrefs = reactive<PlaybackMarkerPreferences>(readJson(
    MARKER_PREFS_KEY,
    { classIcons: false, showStatus: true, battleMarkers: true },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return { classIcons: record.classIcons === true, showStatus: record.showStatus !== false, battleMarkers: record.battleMarkers !== false }
    },
  ))

  const lastKnownPrefs = reactive<PlaybackLastKnownPreferences>(readJson(
    LAST_KNOWN_PREFS_KEY,
    { showLastKnown: true },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return { showLastKnown: record.showLastKnown !== false }
    },
  ))

  const declutterActive = ref(false)
  const capture = () => ({
    labels: { ...labelPrefs }, hp: { ...hpPrefs }, trails: { ...trailPrefs }, markers: { ...markerPrefs },
  })
  let previous: ReturnType<typeof capture> | null = null
  let applyingPreset = false
  function persistPresentation() {
    const value = previous || capture()
    persistJson(LABEL_PREFS_KEY, value.labels)
    persistJson(HP_PREFS_KEY, value.hp)
    persistJson(TRAIL_PREFS_KEY, value.trails)
    persistJson(MARKER_PREFS_KEY, value.markers)
  }
  function toggleDeclutter(healthStyle: 'ring' | 'hidden' = 'ring') {
    const restore = previous
    applyingPreset = true
    if (restore) {
      Object.assign(labelPrefs, restore.labels)
      Object.assign(hpPrefs, restore.hp)
      Object.assign(trailPrefs, restore.trails)
      Object.assign(markerPrefs, restore.markers)
      previous = null
      declutterActive.value = false
    } else {
      previous = capture()
      declutterActive.value = true
      Object.assign(labelPrefs, { showPlayerName: false, showTankName: true, showReload: false })
      if (healthStyle === 'hidden') hpPrefs.showHp = false
      else Object.assign(hpPrefs, { showHp: true, mode: 'ring' })
      trailPrefs.showTrail = false
      Object.assign(markerPrefs, { classIcons: true, showStatus: false })
    }
    applyingPreset = false
    persistPresentation()
  }
  watch([labelPrefs, hpPrefs, trailPrefs, markerPrefs], () => {
    if (applyingPreset) return
    previous = null
    declutterActive.value = false
    persistPresentation()
  }, { deep: true, flush: 'sync' })
  watch(uiPrefs, (value) => persistJson(UI_PREFS_KEY, value), { deep: true })
  watch(lastKnownPrefs, (value) => persistJson(LAST_KNOWN_PREFS_KEY, value), { deep: true })

  return { labelPrefs, hpPrefs, trailPrefs, markerPrefs, uiPrefs, lastKnownPrefs, declutterActive: readonly(declutterActive), toggleDeclutter }
}

let sharedPreferences: ReturnType<typeof createPlaybackPreferences> | undefined

export function usePlaybackPreferences() {
  if (!sharedPreferences) {
    sharedPreferences = effectScope(true).run(createPlaybackPreferences)!
  }
  return sharedPreferences
}
