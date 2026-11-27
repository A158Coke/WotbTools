import { toBattleFacts } from './battleFacts.js'
import { finalizeBatch, toPreviewResponse, type ParsedEntry, type PreviewResponse, type ProcessedDataset, type Tankopedia } from './compute/index.js'
import type { ParsedReplayFile } from './parseWorkerProtocol.js'

export function toParsedEntries(files: ParsedReplayFile[]): ParsedEntry[] {
  return files.map((file, sourceIndex) => {
    if (!file.result) {
      return { sourceIndex, sourceName: file.name, battle: null, failureMessage: file.error ?? 'parse failed' }
    }
    try {
      return { sourceIndex, sourceName: file.name, battle: toBattleFacts(file.result), failureMessage: null }
    } catch (error) {
      return { sourceIndex, sourceName: file.name, battle: null, failureMessage: error instanceof Error ? error.message : String(error) }
    }
  })
}

export interface ReplayAnalysisResult {
  dataset: ProcessedDataset
  preview: PreviewResponse
}

export function analyzeReplayBatch(files: ParsedReplayFile[], tankopedia: Tankopedia): ReplayAnalysisResult {
  const dataset = finalizeBatch(toParsedEntries(files), tankopedia)
  return { dataset, preview: toPreviewResponse(dataset, tankopedia) }
}

export function analyzeReplays(files: ParsedReplayFile[], tankopedia: Tankopedia): PreviewResponse {
  return analyzeReplayBatch(files, tankopedia).preview
}
