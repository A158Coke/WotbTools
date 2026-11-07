import { callBridge, getCapabilities, isAndroidApp } from '../composables/usePlatformBridge.js'
import { NATIVE_SCREEN_FORM_CAPABILITY } from './nativeBridgeContract.js'
import { isRecord } from '../types/primitive-guards.js'

/**
 * 强制横屏的适用设备（design-language §9「强制横屏」，D8）：只有两类。
 * - `android-phone-app`：Android 手机上的 WotbTools App（Native Bridge `screen-form` 报告 phone）；
 * - `iphone-safari`：iPhone 上的 Safari（UA 含 iPhone；iPad 与「请求桌面网站」的 iPadOS 都不含）。
 * 桌面（含缩窄的浏览器窗口）、所有平板、Android 手机浏览器都不适用：判定只看设备，不看视口宽高。
 */
export type ForcedLandscapeDevice = 'android-phone-app' | 'iphone-safari' | null

export function isIphoneSafari(userAgent: string): boolean {
  return /\biPhone\b/.test(userAgent) && !/\biPad\b/.test(userAgent)
}

let cached: Promise<ForcedLandscapeDevice> | null = null

async function detect(): Promise<ForcedLandscapeDevice> {
  if (isAndroidApp()) {
    if (!(await getCapabilities()).includes(NATIVE_SCREEN_FORM_CAPABILITY)) return null
    const form = await callBridge('getScreenForm')
    return isRecord(form) && form.phone === true ? 'android-phone-app' : null
  }
  return typeof navigator !== 'undefined' && isIphoneSafari(navigator.userAgent) ? 'iphone-safari' : null
}

/** 设备在进程内不变：只判定一次。 */
export function forcedLandscapeDevice(): Promise<ForcedLandscapeDevice> {
  cached ??= detect()
  return cached
}

/** 只在 Android 手机 App 上有效；其它设备 resolve false。 */
export async function setNativeLandscapeLock(locked: boolean): Promise<boolean> {
  return (await forcedLandscapeDevice()) === 'android-phone-app' && (await callBridge('setLandscapeLock', { locked })) === true
}

export function __resetForcedLandscapeDeviceForTest() {
  cached = null
}
