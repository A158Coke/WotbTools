// 交接搭载配置富化的回归测试（评审 4597024398）：
// 真实实现（不 mock annotateMountedConfigs）+ 可控的逐车资产 Promise，
// 锁定「单车就绪即写回、无关慢车不清空已到证据」的增量语义。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  json: vi.fn(),
  resolveMountedConfig: vi.fn(),
  fetchShotTankData: vi.fn(),
}))

vi.mock('./agentData.js', () => ({
  assetProvider: { json: mocks.json },
  fetchShotTankData: mocks.fetchShotTankData,
}))
vi.mock('./reloadBar.js', () => ({
  resolveMountedConfig: mocks.resolveMountedConfig,
}))

import { annotateMountedConfigs } from './shotHandoff.ts'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 让挂起的 async 续体走完（真实定时器，不引入 fake timer 与组件计时耦合）。 */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

/** 交接行最小形状：注入了 config idx 的字段在断言期可见。 */
interface TestShot {
  shooter_eid: number
  target_eid: number | null
  shooter_tank_id: number
  target_tank_id?: number
  shooter_config_idx?: number
  target_config_idx?: number
}

beforeEach(() => {
  mocks.json.mockReset()
  mocks.resolveMountedConfig.mockReset()
  // 测试专用：vehicle.config_index 直接对号 data.configs（真实实现由 comp locals 判定）。
  mocks.resolveMountedConfig.mockImplementation((vehicle: { config_index?: number } | undefined, data: {
    configs?: ReadonlyArray<unknown>
  } | null | undefined) => data?.configs?.[vehicle?.config_index ?? 0] ?? null)
})

describe('annotateMountedConfigs', () => {
  it('逐车就绪即写回：无关车型挂起也保留已到配置（评审 4597024398）', async () => {
    const d100 = deferred<{ configs: ReadonlyArray<{ id: string }> }>()
    const d200 = deferred<{ configs: ReadonlyArray<{ id: string }> }>()
    const d300 = deferred<{ configs: ReadonlyArray<{ id: string }> }>()
    mocks.json.mockImplementation((url: string) => {
      if (url === '/tank/100.json') return d100.promise
      if (url === '/tank/200.json') return d200.promise
      if (url === '/tank/300.json') return d300.promise
      return Promise.resolve(null)
    })
    const shots: TestShot[] = [
      { shooter_eid: 1, target_eid: 2, shooter_tank_id: 100, target_tank_id: 200 },
      { shooter_eid: 1, target_eid: 2, shooter_tank_id: 100, target_tank_id: 200 },
      { shooter_eid: 3, target_eid: null, shooter_tank_id: 300 },
    ]
    const vehicles = [
      { eid: 1, tank_id: 100, config_index: 0 },
      { eid: 2, tank_id: 200, config_index: 1 },
      { eid: 3, tank_id: 300, config_index: 0 },
    ]
    const pending = annotateMountedConfigs(shots as never, vehicles as never)
    expect(mocks.json).toHaveBeenCalledTimes(3)

    // 只有 100 返回：引用它的两行立刻拿到射手配置；目标证据未到仍为空。
    d100.resolve({ configs: [{ id: 's0' }, { id: 's1' }] })
    await settle()
    expect(shots[0].shooter_config_idx).toBe(0)
    expect(shots[1].shooter_config_idx).toBe(0)
    expect(shots[0].target_config_idx).toBeUndefined()

    // 200 返回：目标配置按自己的 config 表命中 index 1，与 300 是否返回无关。
    d200.resolve({ configs: [{ id: 't0' }, { id: 't1' }] })
    await settle()
    expect(shots[0].target_config_idx).toBe(1)
    expect(shots[1].target_config_idx).toBe(1)
    expect(shots[2].shooter_config_idx).toBeUndefined()

    // 300 仍挂起：函数本身未结算，但已到证据已经写入行对象（调用方有界等待可取快照）。
    let settled = false
    void pending.then(() => { settled = true })
    await settle()
    expect(settled).toBe(false)

    d300.resolve({ configs: [{ id: 'x0' }] })
    await pending
    expect(settled).toBe(true)
    expect(shots[2].shooter_config_idx).toBe(0)
  })

  it('单车请求失败不影响其他车的已到证据', async () => {
    mocks.json.mockImplementation((url: string) => {
      if (url === '/tank/100.json') return Promise.resolve({ configs: [{ id: 'ok' }] })
      if (url === '/tank/200.json') return Promise.reject(new Error('asset down'))
      return Promise.resolve(null)
    })
    const shots: TestShot[] = [{ shooter_eid: 1, target_eid: 2, shooter_tank_id: 100, target_tank_id: 200 }]
    const vehicles = [
      { eid: 1, tank_id: 100, config_index: 0 },
      { eid: 2, tank_id: 200, config_index: 0 },
    ]
    await annotateMountedConfigs(shots as never, vehicles as never)
    expect(shots[0].shooter_config_idx).toBe(0)
    expect(shots[0].target_config_idx).toBeUndefined()
  })
})