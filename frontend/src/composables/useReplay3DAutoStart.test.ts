// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useReplay3DAutoStart } from './useReplay3DAutoStart'

const PREFIX = 'wotb.pb.3d-auto-start:'

function mountAuto(initialUserId: string | null = 'user-a') {
  const userId = ref<string | null>(initialUserId)
  const scope = effectScope()
  const auto = scope.run(() => useReplay3DAutoStart(userId))!
  return { userId, auto, scope }
}

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('useReplay3DAutoStart', () => {
  it('有用户 sub 时缺省开启，偏好按 encodeURIComponent(sub) 持久化', () => {
    const { auto } = mountAuto('user/a')
    expect(auto.available.value).toBe(true)
    expect(auto.enabled.value).toBe(true)

    auto.enabled.value = false
    expect(auto.enabled.value).toBe(false)
    expect(localStorage.getItem(`${PREFIX}user%2Fa`)).toBe('0')

    auto.enabled.value = true
    expect(auto.enabled.value).toBe(true)
    expect(localStorage.getItem(`${PREFIX}user%2Fa`)).toBe('1')
  })

  it('关闭后新挂载读取关闭；重新打开后新挂载读取开启', () => {
    const first = mountAuto('user-a')
    first.auto.enabled.value = false
    first.scope.stop()
    const second = mountAuto('user-a')
    expect(second.auto.enabled.value).toBe(false)
    second.auto.enabled.value = true
    second.scope.stop()
    const third = mountAuto('user-a')
    expect(third.auto.enabled.value).toBe(true)
  })

  it('没有 sub / 空白 sub 不可用，不读写任何 key', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const anonymous = mountAuto(null)
    expect(anonymous.auto.available.value).toBe(false)
    expect(anonymous.auto.enabled.value).toBe(false)
    anonymous.auto.enabled.value = true
    expect(anonymous.auto.enabled.value).toBe(false)

    const blank = mountAuto('   ')
    expect(blank.auto.available.value).toBe(false)
    expect(blank.auto.enabled.value).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
    expect(Object.keys(localStorage)).toHaveLength(0)
  })

  it('切换用户重新读取各自偏好，不串状态', async () => {
    const { auto, userId } = mountAuto('user-a')
    auto.enabled.value = false

    userId.value = 'user-b'
    await nextTick()
    expect(auto.enabled.value).toBe(true)

    auto.enabled.value = false
    expect(localStorage.getItem(`${PREFIX}user-b`)).toBe('0')
    expect(localStorage.getItem(`${PREFIX}user-a`)).toBe('0')

    userId.value = 'user-a'
    await nextTick()
    expect(auto.enabled.value).toBe(false)

    userId.value = null
    await nextTick()
    expect(auto.available.value).toBe(false)
    expect(auto.enabled.value).toBe(false)
  })

  it('refresh 读取同页另一实例写入的偏好（KeepAlive 面板即时生效）', () => {
    const { auto } = mountAuto('user-a')
    expect(auto.enabled.value).toBe(true)

    localStorage.setItem(`${PREFIX}user-a`, '0')
    auto.refresh()
    expect(auto.enabled.value).toBe(false)

    localStorage.setItem(`${PREFIX}user-a`, '1')
    auto.refresh()
    expect(auto.enabled.value).toBe(true)
  })

  it('写失败时按用户共享会话兜底，同账号其他实例仍保持关闭且不串到其他账号', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => null)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    const first = mountAuto('user-storage-fail')
    expect(first.auto.enabled.value).toBe(true)
    first.auto.enabled.value = false
    first.scope.stop()

    // 模拟 Profile 与回放面板是两个实例：后挂载者读不到持久值，但必须共享本次会话的关闭状态。
    const second = mountAuto('user-storage-fail')
    expect(second.auto.enabled.value).toBe(false)

    const other = mountAuto('user-storage-other')
    expect(other.auto.enabled.value).toBe(true)

    // 同一偏好不会被错误地当成全局开关。
    expect(localStorage.getItem(PREFIX + 'user-storage-fail')).toBeNull()
  })

  it('localStorage 不可用时默认开启，写偏好不抛出', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const { auto } = mountAuto('user-storage-unavailable')
    expect(auto.available.value).toBe(true)
    expect(auto.enabled.value).toBe(true)
    expect(() => { auto.enabled.value = false }).not.toThrow()
    expect(auto.enabled.value).toBe(false)
  })
})
