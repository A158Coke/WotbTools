import { onUnmounted, toRaw } from 'vue'
import { recordUsage } from './useUsageTelemetry.js'
import { isOfficialDemo } from '../replay-local/demo.js'
import type { Composer } from 'vue-i18n'
import { parseReplayFiles, ReplayEngineUnavailableError } from '../replay-local/parseReplays.js'
import { analyzeReplayBatch } from '../replay-local/analyzeReplays.js'
import { loadTankopedia, markDraws, NoValidReplaysError, type ProcessedDataset, type Tankopedia } from '../replay-local/compute/index.js'
import { downloadBlob } from '../utils/exportReplayPng.js'
import type { TeamNamesInput } from '../replay-local/export/index.js'
import type { ParsedReplayFile } from '../replay-local/parseWorkerProtocol.js'
import type { ReplayResult } from '../types/replay.js'
import type { ReplayAnalysisFailure } from '../types/workspace.js'
import type { useReplaySession } from './useReplaySession.js'

type I18nContext = Pick<Composer, 't'>
type ReplaySession = ReturnType<typeof useReplaySession>

/**
 * `analyze` 的可判定结果：Android pending replay 的 ACK 依据。
 * `completed` = 这批文件已在本机分析完毕（无论有没有有效场次），重新导入同一份不会有不同结果。
 */
export type AnalyzeResult =
  | { completed: true }
  | { completed: false; reason: 'EMPTY_SELECTION' | 'ALREADY_ACTIVE' | 'SUPERSEDED' | 'ENGINE_UNAVAILABLE' }

function failureOf(error: unknown): ReplayAnalysisFailure {
  if (error instanceof ReplayEngineUnavailableError) return 'ENGINE_UNAVAILABLE'
  if (error instanceof NoValidReplaysError) return 'NO_VALID_REPLAYS'
  return 'UNKNOWN'
}

/**
 * 本地回放分析生命周期（取代服务端 processing-jobs）：Worker 解析 → 批次计算 → 提交结果。
 * 服务器没有 parser：失败只显示原因，不回退服务端。选择变化 / 取消即作废在途分析。
 */
export function useLocalReplayAnalysis(session: ReplaySession, { t }: I18nContext) {
  const { files, selectionRevision, loading, error, resp, analysis, analysisActive, replaceSelection, commitReadyResult } = session

  let inFlight: AbortController | null = null
  /** 逐文件解析结果（含失败）：集合增删只解析新文件；显式重试才放弃失败项。 */
  const parsedByFile = new WeakMap<File, ParsedReplayFile>()
  let lastTankopedia: Tankopedia | null = null
  /** 最近一次成功分析的批次计算结果（导出等下游复用，不重复计算） */
  let lastDataset: { dataset: ProcessedDataset; tankopedia: Tankopedia } | null = null

  function abortInFlight() {
    inFlight?.abort()
    inFlight = null
  }

  function resetAnalysis(): void {
    abortInFlight()
    lastDataset = null
  }

  function updateFiles(next: File[]): void {
    resetAnalysis()
    replaceSelection(next)
  }

  function updateDemoFile(file: File): void {
    // Validate before cancelling the existing user's analysis or replacing their selection.
    if (!isOfficialDemo(file)) throw new Error('Unverified official replay')
    resetAnalysis()
    session.replaceDemoSelection(file)
  }

  async function analyze(): Promise<AnalyzeResult> {
    if (!files.value.length) {
      error.value = t('replay.no_files')
      return { completed: false, reason: 'EMPTY_SELECTION' }
    }
    if (analysisActive.value) return { completed: false, reason: 'ALREADY_ACTIVE' }
    for (const file of files.value.map(item => toRaw(item))) {
      if (!parsedByFile.get(file)?.result) parsedByFile.delete(file)
    }
    return run(false)
  }

  /** 集合增删：旧结果留在屏幕上直到新结果提交，当前场次不受影响。 */
  async function changeFiles(next: File[]): Promise<AnalyzeResult> {
    abortInFlight()
    session.changeSelection(next)
    return run(!!resp.value)
  }

  async function run(keepResult: boolean): Promise<AnalyzeResult> {
    const revision = selectionRevision.value
    const selection = files.value.map(file => toRaw(file))
    const missing = selection.filter(file => !parsedByFile.has(file))
    const controller = new AbortController()
    // Correlation IDs identify only this attempt, never the file or the user.
    const operations = missing.map(() => {
      let id: string | undefined
      try { id = crypto.randomUUID() } catch { /* Unsupported telemetry cannot break parsing. */ }
      return { id, settled: false }
    })
    const settle = (index: number, outcome: 'success' | 'failure' | 'cancelled',
      errorCode?: 'PARSE_FAILED' | 'RESOURCE_UNAVAILABLE' | 'UNKNOWN') => {
      const operation = operations[index]
      if (!operation || operation.settled) return
      operation.settled = true
      if (!operation.id) return
      recordUsage({ event: 'replay_parse', feature: 'replay_parse', operation_id: operation.id, outcome,
        ...(errorCode ? { error_code: errorCode, error_id: operation.id } : {}) })
    }
    operations.forEach(operation => {
      if (operation.id) recordUsage({ event: 'replay_parse', feature: 'replay_parse',
        operation_id: operation.id, outcome: 'start' })
    })
    controller.signal.addEventListener('abort', () => operations.forEach((_, index) => settle(index, 'cancelled')), { once: true })
    inFlight = controller
    error.value = ''
    if (!keepResult) {
      loading.value = true
      resp.value = null
    }
    analysis.value = { phase: 'parsing', done: 0, total: missing.length, failure: null }
    const stale = () => controller.signal.aborted || selectionRevision.value !== revision

    try {
      let tankopedia = lastTankopedia
      // 无新文件时不进 await：移除是一次同步提交，不存在旧结果与新 files 并存的窗口。
      if (missing.length || !tankopedia) {
        const [parsed, loaded] = await Promise.all([
          missing.length ? parseReplayFiles(missing, {
            signal: controller.signal,
            onFile: (index, file) => {
              parsedByFile.set(missing[index], file)
              if (!stale()) settle(index, file.result ? 'success' : 'failure', file.result ? undefined : 'PARSE_FAILED')
            },
            onProgress: (done, total) => {
              if (!stale()) analysis.value = { phase: 'parsing', done, total, failure: null }
            },
          }) : [],
          loadTankopedia(),
        ])
        parsed.forEach((file, index) => parsedByFile.set(missing[index], file))
        tankopedia = loaded
        lastTankopedia = loaded
        if (stale()) return { completed: false, reason: 'SUPERSEDED' }
        parsed.forEach((file, index) => settle(index, file.result ? 'success' : 'failure', file.result ? undefined : 'PARSE_FAILED'))
      }
      const { dataset, preview } = analyzeReplayBatch(selection.map(file => parsedByFile.get(file) as ParsedReplayFile), tankopedia)
      lastDataset = { dataset, tankopedia }
      commitReadyResult(markDraws(preview, dataset) as unknown as ReplayResult)
      analysis.value = { phase: 'ready', done: selection.length, total: selection.length, failure: null }
      return { completed: true }
    } catch (e) {
      if (stale()) return { completed: false, reason: 'SUPERSEDED' }
      const failure = failureOf(e)
      operations.forEach((_, index) => settle(index, 'failure', failure === 'ENGINE_UNAVAILABLE' ? 'RESOURCE_UNAVAILABLE' : 'UNKNOWN'))
      if (failure === 'UNKNOWN') console.error('[replay-local] analysis failed', e)
      if (keepResult && failure === 'ENGINE_UNAVAILABLE') {
        // 已有场次仍然可用：只有新文件没进来。
        error.value = t('replay.analysis.engine_unavailable')
        analysis.value = { phase: 'ready', done: 0, total: 0, failure: null }
        return { completed: false, reason: 'ENGINE_UNAVAILABLE' }
      }
      resp.value = null
      analysis.value = { phase: 'failed', done: analysis.value.done, total: selection.length, failure }
      return failure === 'ENGINE_UNAVAILABLE' ? { completed: false, reason: 'ENGINE_UNAVAILABLE' } : { completed: true }
    } finally {
      if (inFlight === controller) inFlight = null
      if (selectionRevision.value === revision) loading.value = false
    }
  }

  function cancel(): void {
    if (!analysisActive.value) return
    abortInFlight()
    loading.value = false
    analysis.value = { ...analysis.value, phase: 'cancelled' }
  }

  /**
   * 客户端 xlsx 导出（exceljs 按需加载）：aggregate = 汇总工作簿，each = 逐场 zip。
   * 直接复用最近一次分析的批次结果，不重新解析。
   */
  async function exportExcel(mode: 'aggregate' | 'each', teamNames?: TeamNamesInput): Promise<void> {
    // 没有可导出的分析结果是调用方错误：抛出，让页面显示导出失败，而不是静默当作成功
    if (!lastDataset) throw new Error('no analysis result to export')
    const { dataset, tankopedia } = lastDataset
    const { exportAggregateXlsx, exportEachZip } = await import('../replay-local/export/index.js')
    const options = { teamNames }
    const file = mode === 'each'
      ? await exportEachZip(dataset, tankopedia, options)
      : await exportAggregateXlsx(dataset, tankopedia, options)
    await downloadBlob(file.blob, file.filename)
  }

  onUnmounted(abortInFlight)

  return {
    updateFiles,
    changeFiles,
    updateDemoFile,
    analyze,
    cancel,
    exportExcel,
  }
}
