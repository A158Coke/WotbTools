import { onUnmounted } from 'vue'
import { isOfficialDemo } from '../replay-local/demo.js'
import type { Composer } from 'vue-i18n'
import { parseReplayFiles, ReplayEngineUnavailableError } from '../replay-local/parseReplays.js'
import { analyzeReplayBatch } from '../replay-local/analyzeReplays.js'
import { loadTankopedia, NoValidReplaysError, type ProcessedDataset, type Tankopedia } from '../replay-local/compute/index.js'
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
  /** 最近一次成功分析的逐文件解析结果与批次计算结果（导出等下游复用，不重复解析 / 计算） */
  let lastParsed: ParsedReplayFile[] = []
  let lastDataset: { dataset: ProcessedDataset; tankopedia: Tankopedia } | null = null

  function abortInFlight() {
    inFlight?.abort()
    inFlight = null
  }

  function resetAnalysis(): void {
    abortInFlight()
    lastParsed = []
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

    const revision = selectionRevision.value
    const selection = files.value
    const controller = new AbortController()
    inFlight = controller
    error.value = ''
    loading.value = true
    resp.value = null
    analysis.value = { phase: 'parsing', done: 0, total: selection.length, failure: null }
    const stale = () => controller.signal.aborted || selectionRevision.value !== revision

    try {
      const [parsed, tankopedia] = await Promise.all([
        parseReplayFiles(selection, {
          signal: controller.signal,
          onProgress: (done, total) => {
            if (!stale()) analysis.value = { phase: 'parsing', done, total, failure: null }
          },
        }),
        loadTankopedia(),
      ])
      if (stale()) return { completed: false, reason: 'SUPERSEDED' }
      lastParsed = parsed
      const { dataset, preview } = analyzeReplayBatch(parsed, tankopedia)
      lastDataset = { dataset, tankopedia }
      commitReadyResult(preview as unknown as ReplayResult)
      analysis.value = { phase: 'ready', done: selection.length, total: selection.length, failure: null }
      return { completed: true }
    } catch (e) {
      if (stale()) return { completed: false, reason: 'SUPERSEDED' }
      const failure = failureOf(e)
      if (failure === 'UNKNOWN') console.error('[replay-local] analysis failed', e)
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

  function dismiss(): void {
    if (analysisActive.value) return
    analysis.value = { phase: 'idle', done: 0, total: 0, failure: null }
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
    updateDemoFile,
    analyze,
    cancel,
    dismiss,
    exportExcel,
    /** 最近一次分析的逐文件解析结果（与 files 同序） */
    parsedFiles: () => lastParsed,
  }
}
