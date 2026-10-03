import { reactive, ref, watch } from 'vue'

export interface PlaybackLabelPreferences {
  showPlayerName: boolean
  showTankName: boolean
  /** 实时装填状态（3D 逐发装填格）——只在有可信遥测时才有内容，无遥测不画 */
  showReload: boolean
}

export interface PlaybackHpPreferences {
  showHp: boolean
}

export interface PlaybackTrailPreferences {
  showTrail: boolean
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

export interface PlaybackPaneWidths {
  rail: number | null
  details: number | null
}

const LABEL_PREFS_KEY = 'wotb.pb.label-prefs'
const HP_PREFS_KEY = 'wotb.pb.hp-prefs'
const TRAIL_PREFS_KEY = 'wotb.pb.trail-prefs'
const UI_PREFS_KEY = 'wotb.pb.ui-prefs'
const PANE_WIDTH_KEY = 'wotb.pb.pane-widths'
// v2 deliberately resets the old persisted value once. The rail became persistent
// in desktop non-fullscreen layout after the original preference was introduced;
// an old collapsed=true value could therefore produce an empty 44px strip with no
// visible recovery control. New values remain persisted normally.
const RAIL_COLLAPSED_KEY = 'wotb.pb.rail-collapsed.v2'

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
  watch(trailPrefs, (value) => persistJson(TRAIL_PREFS_KEY, value), { deep: true })
  watch(uiPrefs, (value) => persistJson(UI_PREFS_KEY, value), { deep: true })
  watch(paneWidths, (value) => persistJson(PANE_WIDTH_KEY, value), { deep: true })
  watch(railCollapsed, (value) => {
    try {
      localStorage.setItem(RAIL_COLLAPSED_KEY, value ? '1' : '0')
    } catch {
      // Privacy mode / quota exhaustion: keep the in-memory session preference.
    }
  })

  return { labelPrefs, hpPrefs, trailPrefs, uiPrefs, paneWidths, railCollapsed }
}
