import { callBridge, getCapabilities, isAndroidApp } from '../composables/usePlatformBridge.js'
import { NATIVE_SCREEN_FORM_CAPABILITY, NATIVE_SCREEN_FORM_METHODS } from './nativeBridgeContract.js'
import { isRecord } from '../types/primitive-guards.js'

export type ForcedLandscapeDevice = 'android-phone-app' | 'iphone-safari' | null

export function isIphoneSafari(userAgent: string): boolean {
  return /\biPhone\b/.test(userAgent) && !/\biPad\b/.test(userAgent)
}

let cached: Promise<ForcedLandscapeDevice> | null = null

async function detect(): Promise<ForcedLandscapeDevice> {
  if (isAndroidApp()) {
    if (!(await getCapabilities()).includes(NATIVE_SCREEN_FORM_CAPABILITY)) return null
    const form = await callBridge(NATIVE_SCREEN_FORM_METHODS.getForm)
    return isRecord(form) && form.phone === true ? 'android-phone-app' : null
  }
  return typeof navigator !== 'undefined' && isIphoneSafari(navigator.userAgent) ? 'iphone-safari' : null
}

export function forcedLandscapeDevice(): Promise<ForcedLandscapeDevice> {
  cached ??= detect()
  return cached
}

export type NativeOrientationLock = 'landscape' | 'portrait' | 'unspecified'

export async function setNativeOrientationLock(orientation: NativeOrientationLock): Promise<boolean> {
  return (await forcedLandscapeDevice()) === 'android-phone-app' && (await callBridge(NATIVE_SCREEN_FORM_METHODS.setOrientationLock, { orientation })) === true
}

export function __resetForcedLandscapeDeviceForTest() {
  cached = null
}
