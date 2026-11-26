import { computed, ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

const KEY_PREFIX = 'wotb.pb.3d-auto-start:'
const ON = '1'
const OFF = '0'

function normalizeUserId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(userId)}`
}

type StoredRead = { ok: true; value: string | null } | { ok: false }

function readStored(key: string): StoredRead {
  try {
    const storage = globalThis.localStorage
    if (!storage) return { ok: false }
    return { ok: true, value: storage.getItem(key) }
  } catch {
    return { ok: false }
  }
}

function writeStored(key: string, value: string): boolean {
  try {
    const storage = globalThis.localStorage
    if (!storage) return false
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

const sessionFallbacks = new Map<string, boolean>()

export function useReplay3DAutoStart(userId: MaybeRefOrGetter<string | null | undefined>) {
  const currentId = computed(() => normalizeUserId(toValue(userId)))
  const available = computed(() => currentId.value !== '')
  const key = computed(() => (available.value ? storageKey(currentId.value) : ''))
  const storedEnabled = ref(false)

  function refresh(): void {
    if (!available.value) {
      storedEnabled.value = false
      return
    }
    if (sessionFallbacks.has(key.value)) {
      storedEnabled.value = sessionFallbacks.get(key.value) === true
      return
    }
    const stored = readStored(key.value)
    if (!stored.ok) {
      storedEnabled.value = true
      return
    }
    if (stored.value !== null) sessionFallbacks.delete(key.value)
    storedEnabled.value = stored.value !== OFF
  }

  watch([available, key], refresh, { immediate: true })

  const enabled = computed<boolean>({
    get: () => storedEnabled.value,
    set: (value) => {
      if (!available.value) {
        storedEnabled.value = false
        return
      }
      storedEnabled.value = Boolean(value)
      const written = writeStored(key.value, storedEnabled.value ? ON : OFF)
      if (written) sessionFallbacks.delete(key.value)
      else sessionFallbacks.set(key.value, storedEnabled.value)
    },
  })

  return { available, enabled, refresh }
}
