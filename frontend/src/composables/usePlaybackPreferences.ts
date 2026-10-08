import { effectScope, reactive, readonly, ref, watch } from 'vue'

export interface PlaybackLabelPreferences {
  showPlayerName: boolean
  showTankName: boolean
  /** 实时装填状态（2D / 3D 共享）——只在有可信遥测时才有内容，无遥测不画 */
  showReload: boolean
}

export interface PlaybackHpPreferences {
  showHp: boolean
}

export interface PlaybackTrailPreferences {
  showTrail: boolean
}

export interface PlaybackMarkerPreferences {
  classIcons: boolean
  /** Recorder/death badges and floating damage; battle facts remain unchanged. */
  showStatus: boolean
}

/**
 * 战场 UI 分块开关（3D 回放覆盖层）。与标签/血量偏好同一个 owner ——
 * 场景组件不再自建第二套 localStorage 状态。
 */
export interface PlaybackUiPreferences {
  showTopbar: boolean
  showRoster: boolean
  showKillfeed: boolean
  showBaseStatus: boolean
}

const LABEL_PREFS_KEY = 'wotb.pb.label-prefs'
const HP_PREFS_KEY = 'wotb.pb.hp-prefs'
const TRAIL_PREFS_KEY = 'wotb.pb.trail-prefs'
const UI_PREFS_KEY = 'wotb.pb.ui-prefs'
const MARKER_PREFS_KEY = 'wotb.pb.marker-prefs'

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
        // 新增字段：老持久化值（无该键）默认开启，不重置用户已有的昵称/车型选择
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
    { showHp: true },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return { showHp: record.showHp !== false }
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
    { classIcons: false, showStatus: true },
    (value) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return { classIcons: record.classIcons === true, showStatus: record.showStatus !== false }
    },
  ))

  const declutterActive = ref(false)
  const capture = () => ({
    labels: { ...labelPrefs }, hp: { ...hpPrefs }, trails: { ...trailPrefs }, markers: { ...markerPrefs },
  })
  let previous: ReturnType<typeof capture> | null = null
  let applyingPreset = false
  function persistPresentation() {
    // The preset is temporary. Reloading returns to the user's saved settings,
    // rather than losing the restoration snapshot and leaving an unexplained mix.
    const value = previous || capture()
    persistJson(LABEL_PREFS_KEY, value.labels)
    persistJson(HP_PREFS_KEY, value.hp)
    persistJson(TRAIL_PREFS_KEY, value.trails)
    persistJson(MARKER_PREFS_KEY, value.markers)
  }
  function toggleDeclutter() {
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
      hpPrefs.showHp = false
      trailPrefs.showTrail = false
      Object.assign(markerPrefs, { classIcons: true, showStatus: false })
    }
    applyingPreset = false
    persistPresentation()
  }
  watch([labelPrefs, hpPrefs, trailPrefs, markerPrefs], () => {
    if (applyingPreset) return
    // An explicit setting change becomes the new custom view; never restore
    // an older snapshot over a subsequent user edit.
    previous = null
    declutterActive.value = false
    persistPresentation()
  }, { deep: true, flush: 'sync' })
  watch(uiPrefs, (value) => persistJson(UI_PREFS_KEY, value), { deep: true })

  return { labelPrefs, hpPrefs, trailPrefs, markerPrefs, uiPrefs, declutterActive: readonly(declutterActive), toggleDeclutter }
}

// Initialize lazily so persisted values hydrate on the first consumer. A detached
// scope owns persistence: unmounting that consumer must not stop session writes.
let sharedPreferences: ReturnType<typeof createPlaybackPreferences> | undefined

export function usePlaybackPreferences() {
  if (!sharedPreferences) {
    sharedPreferences = effectScope(true).run(createPlaybackPreferences)!
  }
  return sharedPreferences
}
