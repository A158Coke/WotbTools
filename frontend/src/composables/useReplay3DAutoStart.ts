import { computed, ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

/** 按用户隔离的 3D 自动播放偏好；无用户 sub 时不可用（不回退到全局 key）。 */
const KEY_PREFIX = 'wotb.pb.3d-auto-start:'
const ON = '1'
const OFF = '0'

function normalizeUserId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(userId)}`
}

function readStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // 与 usePlaybackPreferences 一致：隐私模式 / 配额失败时本次会话仍可切换。
  }
}

/**
 * 3D 回放自动播放偏好。
 *
 * - 有用户 sub 时可用；无 sub（匿名 / 未登录）不可用，也不读写全局 key。
 * - 缺省（从未设置）= 开启；'0' = 关闭；'1' = 开启。
 * - 一个组件实例一个状态源，不做模块单例（避免跨挂载 / 跨用户串状态）。
 */
export function useReplay3DAutoStart(userId: MaybeRefOrGetter<string | null | undefined>) {
  const currentId = computed(() => normalizeUserId(toValue(userId)))
  const available = computed(() => currentId.value !== '')
  const key = computed(() => (available.value ? storageKey(currentId.value) : ''))
  const storedEnabled = ref(false)

  /** 重新读取当前用户的存储值：Profile 与回放面板是同一 SPA 里的两个实例，回放面板被 KeepAlive
   *  缓存时不会因 Profile 的写入而重建；进入 3D / 换文件前调用它，保证偏好即时生效。 */
  function refresh(): void {
    if (!available.value) {
      storedEnabled.value = false
      return
    }
    storedEnabled.value = readStored(key.value) !== OFF
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
      writeStored(key.value, storedEnabled.value ? ON : OFF)
    },
  })

  return { available, enabled, refresh }
}
