/**
 * 引导的官方示例装载控制器（拆分自 useOnboarding.ts，行为原样）。
 * 拥有 demoAbort/demoGeneration/demoLoad 生命周期：离开引导即 cancel；
 * prepareStep 用 awaitDemoLoad 等待当前装载，retry 用 demoGeneration 判定归属。
 */
import type { Ref } from 'vue'
import { watch } from 'vue'

export interface OnboardingDemoLoadCtx {
  mode: Ref<'idle' | 'welcome' | 'tour' | 'finish' | 'directory'>
  workspace: Ref<{ hasFiles(): boolean; busy(): boolean; loadDemo(signal: AbortSignal): Promise<void> } | null>
  demoFailed: Ref<boolean>
  preparingDemo: Ref<boolean>
  ensureReplayView: () => Promise<void>
}

/** 通用「读值就绪」等待：轮询改为同步 watch，10s 上限，AbortSignal 可中断。 */
export function waitForValue<T>(read: () => T | null, signal: AbortSignal): Promise<T> {
  const initial = read()
  if (initial) return Promise.resolve(initial)
  return new Promise((resolve, reject) => {
    let stop = () => {}
    const finish = (value?: T) => {
      stop()
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      value ? resolve(value) : reject(new Error('GUIDE_SURFACE_UNAVAILABLE'))
    }
    const abort = () => finish()
    const timeout = setTimeout(() => finish(), 10000)
    signal.addEventListener('abort', abort, { once: true })
    stop = watch(read, value => { if (value) finish(value) }, { flush: 'sync' })
    if (signal.aborted) finish()
  })
}

export function createOnboardingDemoLoad(ctx: OnboardingDemoLoadCtx) {
  let demoAbort = new AbortController()
  let demoLoad: Promise<void> | null = null
  /** Sample-load ownership: only stopRun()/a newer load invalidates a continuation (step changes do not). */
  let demoGeneration = 0

  /** 离开引导 / 开始新教程：作废在飞装载（原 stopRun 内联逻辑）。 */
  function cancelDemoLoad() {
    ++demoGeneration
    demoAbort.abort()
    demoAbort = new AbortController()
    demoLoad = null
  }

  /**
   * Official-sample loading owns its own lifecycle: only leaving the guide cancels it.
   * Sharing the step's AbortController cancelled the download on Next, so the playback step
   * waited for a sample that would never arrive and Retry could not recover (#668).
   */
  function beginDemoLoad() {
    demoAbort.abort()
    demoAbort = new AbortController()
    const generation = ++demoGeneration
    const signal = demoAbort.signal
    // A late continuation after skip/interrupt must never call loadDemo(): its ready fast path
    // could still switch capability after the guide is gone.
    const owns = () => generation === demoGeneration && ctx.mode.value === 'tour' && !signal.aborted
    const promise = (async () => {
      await ctx.ensureReplayView()
      if (!owns()) throw new Error('GUIDE_SAMPLE_CANCELLED')
      signal.throwIfAborted()
      const owner = await waitForValue(() => ctx.workspace.value, signal)
      if (!owns()) throw new Error('GUIDE_SAMPLE_CANCELLED')
      signal.throwIfAborted()
      ctx.preparingDemo.value = true
      try { await owner.loadDemo(signal) } finally { ctx.preparingDemo.value = false }
    })()
    demoLoad = promise
    void promise.catch(() => {}).then(() => { if (demoLoad === promise) demoLoad = null })
    return promise
  }

  /**
   * Wait for the sample when the step needs it.
   * @returns false when this wait became stale (guide closed / newer sample load), so the caller stops.
   */
  async function awaitDemoLoad() {
    if (!demoLoad) return true
    const generation = demoGeneration
    try { await demoLoad; return true } catch {
      if (generation !== demoGeneration) return false
      if (ctx.mode.value === 'tour') ctx.demoFailed.value = true
      throw new Error('GUIDE_SAMPLE_UNAVAILABLE')
    }
  }

  return { beginDemoLoad, awaitDemoLoad, cancelDemoLoad, currentDemoGeneration: () => demoGeneration }
}
