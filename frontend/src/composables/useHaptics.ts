import { callBridge, getCapabilities, isAndroidApp } from './usePlatformBridge.js'
import { NATIVE_HAPTICS_CAPABILITY, NATIVE_HAPTICS_METHODS } from '../platform/nativeBridgeContract.js'
import { feedbackPrefs } from './useFeedbackPrefs.js'

/**
 * 触感（design-language §10「反馈」）：同一事件同一种反馈，视觉反馈始终存在，触感只是加强。
 * - Android App：Native Bridge 可选能力 `haptics`（系统触感常量，随系统触感设置）；
 * - Android 浏览器：navigator.vibrate；
 * - iPhone Safari：不支持，静默。
 * 设置里关闭或不支持时一律静默，不抛错。
 */
export type HapticKind = 'selection' | 'primary' | 'success' | 'error' | 'endpoint'
export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = Object.freeze({
  selection: 10,
  primary: 20,
  success: [12, 60, 12],
  error: [80],
  endpoint: 8,
})

let nativeHaptics: Promise<boolean> | null = null
function nativeSupported() {
  nativeHaptics ??= isAndroidApp() ? getCapabilities().then(caps => caps.includes(NATIVE_HAPTICS_CAPABILITY)) : Promise.resolve(false)
  return nativeHaptics
}

export async function haptic(kind: HapticKind): Promise<void> {
  if (!feedbackPrefs.value.haptics) return
  if (isAndroidApp()) {
    if (await nativeSupported()) void callBridge(NATIVE_HAPTICS_METHODS.haptic, { kind })
    return
  }
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  const pattern = HAPTIC_PATTERNS[kind]
  try {
    navigator.vibrate(typeof pattern === 'number' ? pattern : [...pattern])
  } catch {
    // 某些浏览器在无用户手势时拒绝：静默
  }
}

export function __resetHapticsForTest() {
  nativeHaptics = null
}
