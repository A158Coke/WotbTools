/**
 * ReplayWorkspace —— 官方示例装载（拆分自 ReplayWorkspace.vue，行为原样）。
 * 拥有 demoController 生命周期；selectionRevision 变化即作废在飞装载。
 */
import { ref, watch } from 'vue'
import { REPLACE_DECLINED } from '../../shared/onboarding.js'
import { loadOfficialDemo } from '../../replay-local/demo.js'

/**
 * @param {{
 *  workspace: { replay: { files: Ref, loading: Ref, error: Ref, resp: Ref, updateDemoFile(file): void,
 *    isDemoSelection: Ref<boolean>, selectionRevision: Ref<number>, analysis: Ref<{ phase: string }> } },
 *  setCapability: (key: string) => Promise<void>,
 *  analyze: () => Promise<{ completed?: boolean } | undefined>,
 *  confirm: (options: unknown) => Promise<boolean>,
 *  t: (key: string) => string,
 *  sampleOpened: () => void,
 * }} ctx
 */
type DemoFile = Awaited<ReturnType<typeof loadOfficialDemo>>
type DemoWorkspace = {
  replay: {
    files: import('vue').Ref<DemoFile[]>
    loading: import('vue').Ref<boolean>
    resp: import('vue').Ref<unknown | null>
    updateDemoFile: (file: DemoFile) => void
    isDemoSelection: import('vue').Ref<boolean>
    selectionRevision: import('vue').Ref<number>
    analysis: import('vue').Ref<{ phase: string }>
  }
}

export function useWorkspaceDemoLoad({ workspace, setCapability, analyze, confirm, t, sampleOpened }: {
  workspace: DemoWorkspace
  setCapability: (key: string) => Promise<void>
  analyze: () => Promise<{ completed?: boolean } | undefined>
  confirm: (options: { title: string; message: string; confirmLabel: string; cancelLabel: string; signal: AbortSignal }) => Promise<boolean>
  t: (key: string) => string
  sampleOpened: () => void
}) {
  const { files, loading, resp, updateDemoFile, isDemoSelection, selectionRevision, analysis } = workspace.replay
  const demoLoading = ref(false)
  const demoError = ref('')
  let demoController: AbortController | null = null
  let disposed = false

  /** Reuse the existing session. A confirmation never authorizes a later changed selection. */
  async function loadDemo(signal?: AbortSignal): Promise<void> {
    if (isDemoSelection.value && resp.value && analysis.value.phase === 'ready') {
      await setCapability('data')
      return
    }
    if (demoLoading.value || loading.value) throw new Error('Replay workspace is busy')
    const revision = selectionRevision.value
    const controller = new AbortController()
    demoController = controller
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    demoLoading.value = true
    demoError.value = ''
    try {
      controller.signal.throwIfAborted()
      if (files.value.length && !isDemoSelection.value) {
        const confirmed = await confirm({
          title: t('onboarding.demo_replace_title'), message: t('onboarding.demo_replace_message'),
          confirmLabel: t('onboarding.demo_replace_confirm'), cancelLabel: t('onboarding.demo_replace_cancel'),
          signal: controller.signal,
        })
        controller.signal.throwIfAborted()
        if (!confirmed) throw new DOMException('Official replay replacement declined', REPLACE_DECLINED)
      }
      controller.signal.throwIfAborted()
      if (!isDemoSelection.value) {
        const file = await loadOfficialDemo(controller.signal)
        controller.signal.throwIfAborted()
        if (disposed || selectionRevision.value !== revision) throw new DOMException('Official replay superseded', 'AbortError')
        // The synchronous selection commit must not abort its own completed download.
        demoController = null
        updateDemoFile(file)
      }
      const demoRevision = selectionRevision.value
      await setCapability('data')
      controller.signal.throwIfAborted()
      const result = await analyze()
      controller.signal.throwIfAborted()
      if (disposed || selectionRevision.value !== demoRevision) throw new DOMException('Official replay superseded', 'AbortError')
      if (!result?.completed || !resp.value) throw new Error('Official replay analysis failed')
    } catch (e: unknown) {
      const name = e instanceof Error ? e.name : ''
      if (name !== 'AbortError' && name !== REPLACE_DECLINED) demoError.value = t('onboarding.demo_failed')
      throw e
    } finally {
      signal?.removeEventListener('abort', abort)
      if (demoController === controller) demoController = null
      demoLoading.value = false
    }
  }

  async function onDemoClick(): Promise<void> {
    try {
      await loadDemo()
      sampleOpened()
    } catch { /* Visible error above; cancelled replacement keeps the current selection. */ }
  }

  watch(selectionRevision, () => {
    demoController?.abort()
    demoError.value = ''
  }, { flush: 'sync' })

  /** 宿主卸载：作废在飞装载并标记 disposed（不再接受新的完成回调）。 */
  function dispose() {
    disposed = true
    demoController?.abort()
  }

  return { demoLoading, demoError, loadDemo, onDemoClick, dispose }
}
