import { callBridge, getCapabilities, isAndroidApp } from './usePlatformBridge.js'
import { NATIVE_HAPTICS_CAPABILITY, NATIVE_HAPTICS_METHODS } from '../platform/nativeBridgeContract.js'
import { feedbackPrefs } from './useFeedbackPrefs.js'

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
