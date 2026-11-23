// 迟到的 loadData 不得把旧回放摘要写进共享 ?perf identity。
// 场景：A 的 loadScene 慢，B 先接管（A 被 destroy / 同实例新一代）；A 恢复时即便
// gen 守卫在 export 层看似成立，也必须用与 observer 相同的 ownsLoading + epoch 判定。
import { describe, expect, it, vi } from 'vitest'
import { createSessionLifecycle, type SessionLifecycleDeps } from './sessionLifecycle'

function fakePerf() {
  return {
    epoch: 0,
    identity: { replayDigest: null as string | null },
    beginSession() { this.epoch += 1 },
    interrupt: vi.fn(),
    event: vi.fn(),
    setIdentity(patch: Record<string, unknown>) { Object.assign(this.identity, patch) },
  }
}

function fakeStore() {
  return {
    hasData: false, mapReady: false, err: '', loading: false, assetStage: false,
    assetProgress: null, playbackSession: null, mapName: '', startTime: 0, duration: 0,
  }
}

/** 只提供 loadData 在守卫前会碰到的依赖；其余调用在迟到分支不应发生。 */
function fakeDeps(perf: ReturnType<typeof fakePerf>, store: ReturnType<typeof fakeStore>, destroyed = false) {
  const base = {
    store,
    perf: () => perf as never,
    destroyed: () => destroyed,
    clearCanonicalClock: vi.fn(),
  }
  return new Proxy(base, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target]
      return vi.fn()
    },
  }) as unknown as SessionLifecycleDeps
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const file = { name: 'a.wotbreplay' } as File

describe('sessionLifecycle replayDigest identity ownership', () => {
  it('被新实例接管的旧 A 恢复后不覆盖 B 的 identity', async () => {
    const perf = fakePerf()
    const store = fakeStore()
    const a = createSessionLifecycle(fakeDeps(perf, store))
    const b = createSessionLifecycle(fakeDeps(perf, store))
    const lateA = deferred<unknown>()
    const lateB = deferred<unknown>()
    const digestA = 'a'.repeat(64)
    const digestB = 'b'.repeat(64)

    const loadingA = a.loadData({ file, session: {
      loadScene: () => lateA.promise,
      getState: () => ({ replayDigest: digestA }),
    } as never })
    const loadingB = b.loadData({ file, session: {
      loadScene: () => lateB.promise,
      getState: () => ({ replayDigest: digestB }),
    } as never })

    // B 接管 3D：旧实例失效；B 的 beginSession 已把 epoch 推进、identity 清空。
    a.invalidateForDestroy()
    expect(perf.identity.replayDigest).toBeNull()

    lateA.resolve({ meta: {} })
    await loadingA
    expect(perf.identity.replayDigest, 'A 的迟到摘要不得写入共享 identity').toBeNull()

    lateB.reject(new Error('stop test load'))
    await loadingB
  })

  it('同一实例的新一代加载等待期间，旧一代恢复也不写 identity', async () => {
    const perf = fakePerf()
    const store = fakeStore()
    const handle = createSessionLifecycle(fakeDeps(perf, store))
    const lateA = deferred<unknown>()
    const lateB = deferred<unknown>()
    const digestA = 'a'.repeat(64)
    const digestB = 'b'.repeat(64)

    const loadingA = handle.loadData({ file, session: {
      loadScene: () => lateA.promise,
      getState: () => ({ replayDigest: digestA }),
    } as never })
    const loadingB = handle.loadData({ file, session: {
      loadScene: () => lateB.promise,
      getState: () => ({ replayDigest: digestB }),
    } as never })

    lateA.resolve({ meta: {} })
    await loadingA
    expect(perf.identity.replayDigest).toBeNull()

    lateB.reject(new Error('stop test load'))
    await loadingB
  })
})
