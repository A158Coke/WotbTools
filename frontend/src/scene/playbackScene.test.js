// @vitest-environment happy-dom
/**
 * `playbackScene` 的会话状态所有权契约。
 *
 * PR #465 review 指出两个真实缺陷，且都必须在**场景层**修（组件层镜像状态会制造第二 owner）：
 *
 * 1. loading 归属：`loadData()` 用 `++sessionGen` 建立代数令牌，并且只在
 *    `gen === sessionGen || gen + 1 === sessionGen` 时写 `store.loading` / `store.err`。
 *    因此「旧会话迟到的完成」无法清掉新会话的 loading。
 * 2. 就绪归属：`store.hasData` ⟺ 当前会话已完成加载且 DATA 可用。
 *    新会话被接受时与 teardown 时都必须落下。
 *
 * 这里驱动**真实** `initPlayback` + `loadData`（只 mock 数据源与资产面），
 * 所以锁定的是生产代数逻辑，而不是测试自己手写的状态机。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackStore } from './playbackStore.js'

const source = vi.hoisted(() => ({ loadPlaybackData: vi.fn() }))
vi.mock('./replaySource.js', () => ({ loadPlaybackData: source.loadPlaybackData }))

import { initPlayback } from './playbackScene.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 场景内核需要一个容器元素；渲染器在数据就位后才惰性创建，这里给空节点即可。 */
function mountContainer() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

let api = null

beforeEach(() => {
  source.loadPlaybackData.mockReset()
  // 默认：永不 settle 的加载（测试自己决定何时完成），避免真实解析链
  source.loadPlaybackData.mockImplementation(() => new Promise(() => {}))
  api = null
})

afterEach(() => {
  api?.destroy?.()
  api = null
  document.body.innerHTML = ''
})

function createScene() {
  const store = createPlaybackStore()
  api = initPlayback(mountContainer(), store)
  return { store, api }
}

describe('playbackScene 会话代数契约', () => {
  it('同一 scene 上接受新文件后：旧加载迟到完成不得清掉新加载的 loading', async () => {
    const { store, api } = createScene()
    const first = deferred()
    const second = deferred()
    source.loadPlaybackData
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)

    // 新会话被接受：仍是 loading，且不得继承上一会话的就绪态
    const loadB = api.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)

    // A 迟到完成（gen 落后两代）：owned 状态必须纹丝不动
    first.reject(new Error('stale A failed'))
    await loadA
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.err).toBe('')

    // B 完成才允许落下 loading（数据源拒绝 → 走错误路径，但其 finally 仍属最新代）
    second.reject(new Error('B failed'))
    await loadB
    expect(store.loading).toBe(false)
    expect(store.hasData).toBe(false)
    expect(store.err).toContain('B failed')
  })

  it('新 loadData 被接受的那一刻即落下就绪态（解析/资产阶段的旧 UI 不得仍是 ready）', async () => {
    const { store, api } = createScene()
    source.loadPlaybackData.mockImplementation(() => new Promise(() => {}))

    expect(store.hasData).toBe(false)
    void api.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(true)
    // 关键：不是等解析结束才清，而是接受新会话即清
    expect(store.hasData).toBe(false)
  })

  it('teardown（destroy）落下就绪态：会话终止后不得继续自称已就绪', () => {
    const { store, api } = createScene()
    store.hasData = true
    store.loading = false

    api.destroy()
    expect(store.hasData).toBe(false)
    expect(store.loading).toBe(false)
  })
})
