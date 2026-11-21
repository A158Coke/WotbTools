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
export function useWorkspaceDemoLoad({ workspace, setCapability, analyze, confirm, t, sampleOpened }) {
  const { files, loading, error, resp, updateDemoFile, isDemoSelection, selectionRevision, analysis } = workspace.replay
  const demoLoading = ref(false)
  const demoError = ref('')
  let demoController = null
  let disposed = false

  /** Reuse the existing session. A confirmation never authorizes a later changed selection. */
  async function loadDemo(signal) {
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
    } catch (e) {
      if (e?.name !== 'AbortError' && e?.name !== REPLACE_DECLINED) demoError.value = t('onboarding.demo_failed')
      throw e
    } finally {
      signal?.removeEventListener('abort', abort)
      if (demoController === controller) demoController = null
      demoLoading.value = false
    }
  }

  async function onDemoClick() {
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
