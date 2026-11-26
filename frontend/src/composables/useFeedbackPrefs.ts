import { ref } from 'vue'

export const FEEDBACK_PREFS_STORAGE_KEY = 'wotb-feedback'
export interface FeedbackPrefs { haptics: boolean, sound: boolean, battleSound: boolean }
const DEFAULTS: FeedbackPrefs = Object.freeze({ haptics: true, sound: false, battleSound: true })

function read(): FeedbackPrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FEEDBACK_PREFS_STORAGE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
    return {
      haptics: typeof raw.haptics === 'boolean' ? raw.haptics : DEFAULTS.haptics,
      sound: typeof raw.sound === 'boolean' ? raw.sound : DEFAULTS.sound,
      battleSound: typeof raw.battleSound === 'boolean' ? raw.battleSound : DEFAULTS.battleSound,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export const feedbackPrefs = ref<FeedbackPrefs>(typeof window === 'undefined' ? { ...DEFAULTS } : read())

export function setFeedbackPref(key: keyof FeedbackPrefs, value: boolean) {
  feedbackPrefs.value = { ...feedbackPrefs.value, [key]: value }
  try {
    window.localStorage.setItem(FEEDBACK_PREFS_STORAGE_KEY, JSON.stringify(feedbackPrefs.value))
  } catch {
    // 隐私模式 / 配额：保持内存态
  }
}

export function __reloadFeedbackPrefsForTest() {
  feedbackPrefs.value = read()
}
