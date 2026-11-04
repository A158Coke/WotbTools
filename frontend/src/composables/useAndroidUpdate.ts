import { computed, onMounted, onUnmounted, readonly, ref, shallowReadonly, shallowRef, watch } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import contract from '../../../contracts/android-native-bridge.json'
import {
  beginUpdateDownload, dismissOptionalUpdate, getCapabilities, getUpdateStatus,
  installUpdate, isAndroidApp, refreshUpdateStatus,
} from './usePlatformBridge.js'
import { NATIVE_UPDATE_CAPABILITY, NATIVE_UPDATE_CHANGED_GLOBAL } from '../platform/nativeBridgeContract.js'
import type { AndroidUpdateController, AndroidUpdateSnapshot } from '../shared/androidUpdate.js'

interface Field {
  type: string
  required?: boolean
  nullable?: boolean
  enum?: readonly unknown[]
  minimum?: number
  maximum?: number
  fields?: Record<string, Field>
}

function matches(value: unknown, field: Field): boolean {
  if (value === null) return field.nullable === true
  if (field.enum && !field.enum.includes(value)) return false
  if (field.type === 'integer') {
    return typeof value === 'number' && Number.isSafeInteger(value)
      && (field.minimum === undefined || value >= field.minimum)
      && (field.maximum === undefined || value <= field.maximum)
  }
  if (field.type === 'string') return typeof value === 'string'
  if (field.type === 'boolean') return typeof value === 'boolean'
  if (field.type !== 'object' || typeof value !== 'object' || Array.isArray(value)) return false
  const object = value as Record<string, unknown>
  return Object.entries(field.fields ?? {}).every(([key, child]) =>
    Object.hasOwn(object, key) ? matches(object[key], child) : child.required !== true,
  )
}

/** The contract owns enum/nullable/required rules; malformed producers never look up-to-date. */
export function isAndroidUpdateSnapshot(value: unknown): value is AndroidUpdateSnapshot {
  return matches(value, contract.methods.getUpdateStatus.response)
}

/** One shell-owned, read-only projection. Native alone classifies and persists update state. */
export function useAndroidUpdate(routing?: { route: RouteLocationNormalizedLoaded, router: Router }): AndroidUpdateController {
  const supported = ref(false)
  const snapshot = shallowRef<AndroidUpdateSnapshot | null>(null)
  const panelOpen = ref(false)
  const returnFocusTo = shallowRef<HTMLElement | null>(null)
  const checking = ref(false)
  const acting = ref(false)
  const error = ref<'unavailable' | 'rejected' | 'confirming' | null>(null)
  let uncertainInstall: { token: string, initialState: string, initialReason: string | null } | null = null
  let disposed = false
  let priorNotification: unknown
  let listening = false
  let consumingNotification = false

  function accept(raw: unknown): boolean {
    if (disposed) return false
    if (!isAndroidUpdateSnapshot(raw)) {
      error.value = 'unavailable'
      return false
    }
    if (snapshot.value && raw.revision < snapshot.value.revision) return true
    snapshot.value = raw
    if (uncertainInstall) {
      const download = raw.download
      const changed = download.state !== uncertainInstall.initialState || download.failureReason !== uncertainInstall.initialReason
      const terminal = ['installRequested', 'installPermissionRequired', 'installRequestFailed', 'verifyFailed', 'downloadFailed'].includes(download.state)
      if (download.taskToken !== uncertainInstall.token || download.failureReason === 'unsupportedArtifact' || (changed && terminal)) {
        uncertainInstall = null
        acting.value = false
        error.value = null
      } else error.value = 'confirming'
    } else error.value = null
    return true
  }

  async function read() {
    if (!supported.value || disposed) return
    try { accept(await getUpdateStatus()) } catch { if (!disposed) error.value = 'unavailable' }
  }

  const notify = () => { void read() }
  const onVisible = () => { if (document.visibilityState === 'visible') void read() }

  async function open(opener?: HTMLElement | null) {
    if (supported.value && !disposed) {
      returnFocusTo.value = opener instanceof HTMLElement ? opener : null
      panelOpen.value = true
      await read()
    }
  }

  // A system download notification is an explicit request to open the existing panel.
  // Consume only on capable Native; ordinary Web/legacy clients never auto-open it.
  watch([supported, () => routing?.route.query.androidUpdate], async ([available, marker]) => {
    if (!routing || !available || marker !== '1' || consumingNotification || disposed) return
    consumingNotification = true
    try {
      const query = { ...routing.route.query }
      delete query.androidUpdate
      const failure = await routing.router.replace({ path: routing.route.path, query, hash: routing.route.hash })
      if (failure) { error.value = 'unavailable'; return }
      await open()
    } catch { if (!disposed) error.value = 'unavailable' }
    finally { consumingNotification = false }
  }, { flush: 'post' })

  onMounted(async () => {
    if (!isAndroidApp()) return
    try {
      const capabilities = await getCapabilities()
      if (disposed || !capabilities.includes(NATIVE_UPDATE_CAPABILITY)) return
      supported.value = true
      priorNotification = Reflect.get(window, NATIVE_UPDATE_CHANGED_GLOBAL)
      Reflect.set(window, NATIVE_UPDATE_CHANGED_GLOBAL, notify)
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', notify)
      listening = true
      await read()
    } catch { if (!disposed) error.value = 'unavailable' }
  })

  onUnmounted(() => {
    disposed = true
    if (!listening) return
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', notify)
    if (Reflect.get(window, NATIVE_UPDATE_CHANGED_GLOBAL) === notify) {
      if (priorNotification === undefined) Reflect.deleteProperty(window, NATIVE_UPDATE_CHANGED_GLOBAL)
      else Reflect.set(window, NATIVE_UPDATE_CHANGED_GLOBAL, priorNotification)
    }
  })

  async function refresh() {
    if (!supported.value || checking.value || disposed) return
    checking.value = true
    error.value = null
    try { accept(await refreshUpdateStatus()) } catch { if (!disposed) error.value = 'unavailable' }
    finally { if (!disposed) checking.value = false }
  }

  async function act(command: () => Promise<boolean | null>, install?: { token: string, initialState: string, initialReason: string | null }) {
    if (!supported.value || acting.value || disposed) return
    acting.value = true
    try {
      const accepted = await command()
      if (accepted === null && install) {
        uncertainInstall = install
        error.value = 'confirming'
      }
      await read()
      if (!disposed && accepted === false) error.value = 'rejected'
    } catch { if (!disposed) error.value = 'unavailable' }
    finally { if (!disposed && !uncertainInstall) acting.value = false }
  }

  return {
    supported: readonly(supported), snapshot: readonly(snapshot), panelOpen: readonly(panelOpen),
    returnFocusTo: shallowReadonly(returnFocusTo),
    checking: readonly(checking), acting: readonly(acting), error: readonly(error),
    showPrompt: computed(() => supported.value && snapshot.value?.state === 'optional'
      && !snapshot.value.optionalPromptSuppressed && snapshot.value.download.state === 'idle'),
    open,
    close() { panelOpen.value = false },
    refresh,
    async download() {
      const expected = snapshot.value?.latestVersionCode
      if (expected !== undefined && expected !== null) await act(() => beginUpdateDownload(expected))
    },
    async install() {
      const download = snapshot.value?.download
      const expected = download?.taskToken
      if (expected && download) await act(() => installUpdate(expected), {
        token: expected, initialState: download.state, initialReason: download.failureReason,
      })
    },
    async dismiss() {
      const expected = snapshot.value?.latestVersionCode
      if (snapshot.value?.state === 'optional' && expected !== undefined && expected !== null) {
        await act(() => dismissOptionalUpdate(expected))
      }
    },
  }
}
