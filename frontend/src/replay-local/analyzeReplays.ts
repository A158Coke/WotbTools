/**
 * 客户端回放分析管线：解析结果（parseResult，逐文件）→ 结算事实 → 批次计算 → Preview 结果。
 *
 * 取代服务端 processing-jobs 的「上传 → 解析 → FINALIZING_BATCH → /result」：输出形状即原
 * `/api/replay/processing-jobs/{id}/result`，工作台现有的表格 / 汇总 / 联赛视图直接消费。
 * 服务器没有 parser，也不参与计算。
 */
import { toBattleFacts } from './battleFacts.js'
import { finalizeBatch, toPreviewResponse, type ParsedEntry, type PreviewResponse, type Tankopedia } from './compute/index.js'
import type { ParsedReplayFile } from './parseWorkerProtocol.js'

/** 逐文件解析结果 → 批次条目：解析失败 / 非法结算都是「该文件失败」，不影响同批其它文件 */
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

/** 0 场有效回放时抛 NoValidReplaysError（与服务端 NO_VALID_REPLAYS 同语义） */
export function analyzeReplays(files: ParsedReplayFile[], tankopedia: Tankopedia): PreviewResponse {
  return toPreviewResponse(finalizeBatch(toParsedEntries(files), tankopedia), tankopedia)
}
