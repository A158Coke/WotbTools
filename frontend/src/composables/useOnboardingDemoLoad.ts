import type { Ref } from 'vue'
import { watch } from 'vue'

export interface OnboardingDemoLoadCtx {
  mode: Ref<'idle' | 'welcome' | 'tour' | 'finish' | 'directory'>
  workspace: Ref<{ hasFiles(): boolean; busy(): boolean; loadDemo(signal: AbortSignal): Promise<void> } | null>
  demoFailed: Ref<boolean>
  preparingDemo: Ref<boolean>
  ensureReplayView: () => Promise<void>
}

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
  let demoGeneration = 0

  function cancelDemoLoad() {
    ++demoGeneration
    demoAbort.abort()
    demoAbort = new AbortController()
    demoLoad = null
  }

  function beginDemoLoad() {
    demoAbort.abort()
    demoAbort = new AbortController()
    const generation = ++demoGeneration
    const signal = demoAbort.signal
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
