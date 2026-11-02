import { afterEach, describe, expect, it, vi } from 'vitest'
import { callBridge, getCapabilities, getNativeBridgeVersion, getPendingReplay } from './usePlatformBridge.js'

function stubReply(result: unknown) {
  vi.stubGlobal('window', {
    WotbNative: {
      postMessage(raw: string) {
        const { id } = JSON.parse(raw)
        queueMicrotask(() => listener?.({ data: { id, result } }))
      },
      addEventListener(_type: 'message', next: (event: { data: unknown }) => void) { listener = next },
      removeEventListener() { listener = undefined },
    },
  })
}
let listener: ((event: { data: unknown }) => void) | undefined

afterEach(() => {
  listener = undefined
  vi.unstubAllGlobals()
})

describe('Native Bridge reply narrowing', () => {
  it.each([
    ['missing identity', { name: 'a.wotbreplay', size: 1, uri: 'x' }],
    ['non-string identity', { pendingId: 7, name: 'a.wotbreplay', size: 1, uri: 'x' }],
    ['missing size', { pendingId: 'p', name: 'a.wotbreplay', uri: 'x' }],
    ['fractional size', { pendingId: 'p', name: 'a.wotbreplay', size: 1.5, uri: 'x' }],
    ['negative size', { pendingId: 'p', name: 'a.wotbreplay', size: -1, uri: 'x' }],
    ['not an object', 'p'],
  ])('treats a pending replay with %s as no pending replay', async (_case, reply) => {
    stubReply(reply)
    await expect(getPendingReplay()).resolves.toBeNull()
  })

  it('returns a contract-shaped pending replay', async () => {
    const reply = { pendingId: 'p', name: 'a.wotbreplay', size: 1, uri: 'x' }
    stubReply(reply)
    await expect(getPendingReplay()).resolves.toEqual(reply)
  })

  it('fails closed on malformed capabilities and versions', async () => {
    stubReply(['native-auth', 3])
    await expect(getCapabilities()).resolves.toEqual([])
    stubReply('3')
    await expect(getNativeBridgeVersion()).resolves.toBeNull()
  })
})

// 只做编译期证明，从不运行：类型一旦放宽，@ts-expect-error 自身就会让 typecheck 失败。
export async function bridgeTypeProofs() {
  // @ts-expect-error 方法名必须来自 contracts/android-native-bridge.json
  await callBridge('authGetStat')
  // @ts-expect-error consumePendingReplay 必须携带 expectedPendingId
  await callBridge('consumePendingReplay')
  // @ts-expect-error 参数形状来自契约
  await callBridge('consumePendingReplay', { pendingId: 'p' })
  const reply = await callBridge('authGetAccessToken')
  // @ts-expect-error Native 回复不可信，未收窄不得读取字段
  void reply.token
}
