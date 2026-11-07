import { ref } from 'vue'

/**
 * 反馈偏好（design-language §10「反馈」）的唯一持久化 owner：触感默认开、音效默认关。
 * 存储 key `wotb-feedback`；读取边界校验形状，非法值回落默认。
 */
export const FEEDBACK_PREFS_STORAGE_KEY = 'wotb-feedback'
export interface FeedbackPrefs { haptics: boolean, sound: boolean }
const DEFAULTS: FeedbackPrefs = Object.freeze({ haptics: true, sound: false })

function read(): FeedbackPrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FEEDBACK_PREFS_STORAGE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
    return {
      haptics: typeof raw.haptics === 'boolean' ? raw.haptics : DEFAULTS.haptics,
      sound: typeof raw.sound === 'boolean' ? raw.sound : DEFAULTS.sound,
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
