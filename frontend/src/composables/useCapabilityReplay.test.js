// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useCapabilityReplay } from './useCapabilityReplay.js'

const { t, te } = vi.hoisted(() => ({ t: (k) => k, te: () => false }))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t, te, locale: { value: 'zh' } }),
}))

vi.mock('../utils/helpers.js', () => ({
  fileKey: (f) => f?.name,
}))

function makeFile(name) {
  return { name }
}

function makeReplay() {
  const requestDirectAction = vi.fn(async () => ({ processingJobId: 'p1', sourceId: 'r0' }))
  return { requestDirectAction }
}

describe('useCapabilityReplay', () => {
  it('prepareForFile 成功后 datasetRef 就绪（stale-safe）', async () => {
    const replay = makeReplay()
    const cap = useCapabilityReplay(replay)
    const f = makeFile('a.wotbreplay')
    cap.prepareForFile(f)
    expect(replay.requestDirectAction).toHaveBeenCalledTimes(1)
    expect(cap.datasetRef.value).toBeNull()
    await nextTick()
    expect(cap.datasetRef.value).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
    expect(cap.targetFile.value).toEqual(f)
  })

  it('幂等（plan §9.1）：同一目标文件 + 已有 dataset → 不重复请求', async () => {
    const replay = makeReplay()
    const cap = useCapabilityReplay(replay)
    const f = makeFile('a.wotbreplay')
    cap.prepareForFile(f)
    await nextTick()
    cap.prepareForFile(f) // 同文件已有 dataset 引用
    await nextTick()
    expect(replay.requestDirectAction).toHaveBeenCalledTimes(1)
    expect(cap.datasetRef.value).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
  })

  it('recover（plan §9.3 过期恢复）绕过幂等守卫强制重新请求', async () => {
    const replay = makeReplay()
    const cap = useCapabilityReplay(replay)
    const f = makeFile('a.wotbreplay')
    cap.prepareForFile(f)
    await nextTick()
    expect(cap.datasetRef.value).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
    // dataset 过期：recover 必须强制重试，不能因 datasetRef 已存在而短路
    cap.recover()
    await nextTick()
    expect(replay.requestDirectAction).toHaveBeenCalledTimes(2)
  })

  it('切换文件 stale-safe：旧请求迟到不得写入新文件（极简）', async () => {
    let resolveA
    const replay = {
      requestDirectAction: vi.fn()
        .mockImplementationOnce(() => new Promise((res) => { resolveA = res }))
        .mockResolvedValueOnce({ processingJobId: 'p2', sourceId: 'r1' }),
    }
    const cap = useCapabilityReplay(replay)
    const fa = makeFile('a.wotbreplay')
    const fb = makeFile('b.wotbreplay')
    cap.prepareForFile(fa)
    cap.prepareForFile(fb)
    resolveA({ processingJobId: 'pStale', sourceId: 'r0' }) // A 迟到
    await nextTick()
    await nextTick()
    expect(cap.datasetRef.value).toEqual({ processingJobId: 'p2', sourceId: 'r1' })
    expect(cap.datasetRef.value.processingJobId).not.toBe('pStale')
  })

  it('reset 清空 targetFile / datasetRef / datasetError', () => {
    const replay = makeReplay()
    const cap = useCapabilityReplay(replay)
    cap.prepareForFile(makeFile('a.wotbreplay'))
    cap.reset()
    expect(cap.targetFile.value).toBeNull()
    expect(cap.datasetRef.value).toBeNull()
    expect(cap.datasetError.value).toBe('')
  })

  it('reconcile 幂等：同 identity + 已 resolve → 不重复请求；active=false 的 capability 不动', async () => {
    const replay = makeReplay()
    const cap = useCapabilityReplay(replay)
    const f = makeFile('a.wotbreplay')
    cap.reconcile({ file: f, selectionRevision: 1 })
    await nextTick()
    expect(replay.requestDirectAction).toHaveBeenCalledTimes(1)
    expect(cap.datasetRef.value).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
    // 同 identity 已 resolve → no-op
    cap.reconcile({ file: f, selectionRevision: 1 })
    await nextTick()
    expect(replay.requestDirectAction).toHaveBeenCalledTimes(1)
    // active=false → 保持不动（不 prepare 也不清空）
    cap.reconcile({ file: makeFile('b.wotbreplay'), selectionRevision: 2, active: false })
    expect(replay.requestDirectAction).toHaveBeenCalledTimes(1)
    expect(cap.datasetRef.value).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
  })

  it('reconcile 同 identity + 在途 → 不重复请求，等 resolve 落 datasetRef', async () => {
    let resolveRA
    const replay = { requestDirectAction: vi.fn(() => new Promise((res) => { resolveRA = res })) }
    const cap = useCapabilityReplay(replay)
    const f = makeFile('a.wotbreplay')
    cap.reconcile({ file: f, selectionRevision: 1 })   // 在途
    expect(replay.requestDirectAction).toHaveBeenCalledTimes(1)
    // READY / 其它触发再次 reconcile：同 identity 在途 → 不重发
    cap.reconcile({ file: f, selectionRevision: 1 })
    expect(replay.requestDirectAction).toHaveBeenCalledTimes(1)
    resolveRA({ processingJobId: 'p1', sourceId: 'r0' })
    await nextTick()
    expect(cap.datasetRef.value).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
  })

  it('reconcile 身份切换（新 selectionRevision / 新文件）→ 重新 prepare（旧在途 token 失效）', async () => {
    let resolveOld
    const replay = {
      requestDirectAction: vi.fn()
        .mockImplementationOnce(() => new Promise((res) => { resolveOld = res }))
        .mockResolvedValueOnce({ processingJobId: 'p2', sourceId: 'r1' }),
    }
    const cap = useCapabilityReplay(replay)
    const fa = makeFile('a.wotbreplay')
    const fb = makeFile('b.wotbreplay')
    cap.reconcile({ file: fa, selectionRevision: 1 })  // 在途 (old)
    cap.reconcile({ file: fb, selectionRevision: 2 })  // 身份变化 → 重新 prepare
    resolveOld({ processingJobId: 'pStale', sourceId: 'r0' })  // 旧响应迟到
    await nextTick()
    await nextTick()
    expect(cap.datasetRef.value).toEqual({ processingJobId: 'p2', sourceId: 'r1' })
    expect(cap.datasetRef.value.processingJobId).not.toBe('pStale')
  })
})
