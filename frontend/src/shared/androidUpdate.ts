import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { NativeBridgeResponse } from '../api/generated/android-native-bridge.js'

/** Native-owned data after validation against android-native-bridge.json. */
export type AndroidUpdateSnapshot = NativeBridgeResponse<'getUpdateStatus'>

export interface AndroidUpdateController {
  supported: Readonly<Ref<boolean>>
  snapshot: Readonly<Ref<AndroidUpdateSnapshot | null>>
  panelOpen: Readonly<Ref<boolean>>
  returnFocusTo: Readonly<Ref<HTMLElement | null>>
  checking: Readonly<Ref<boolean>>
  acting: Readonly<Ref<boolean>>
  error: Readonly<Ref<'unavailable' | 'rejected' | null>>
  showPrompt: ComputedRef<boolean>
  open(returnFocusTo?: HTMLElement | null): Promise<void>
  close(): void
  refresh(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  dismiss(): Promise<void>
}

export const ANDROID_UPDATE_KEY: InjectionKey<AndroidUpdateController> = Symbol('wotbtools.androidUpdate')
