import type { InjectionKey } from 'vue'

export const DIALOG_INLINE_KEY: InjectionKey<boolean> = Symbol('dialog-inline')

let openDialogs = 0
let nextLayer = 0

export function acquireDialogLayer(): number {
  openDialogs++
  return ++nextLayer
}

export function releaseDialogLayer(): void {
  if (--openDialogs === 0) nextLayer = 0
}
