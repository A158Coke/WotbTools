/// <reference lib="webworker" />
/**
 * 3D 回放解析 Worker：把上游 Rust Core WASM 的 `parsePlayback`（单场约 95ms 量级）
 * 移出 UI 线程——3D 路径此前在主线程同步解析，加载期整页卡顿。
 *
 * **只回传 JSON 字符串**：主线程的 `JSON.parse`（约 15ms）与契约校验留在主线程做。
 * 结构化克隆整个 PlaybackData 对象图比「字符串拷贝 + JSON.parse」更贵，所以不在这里
 * 解析成对象。文件不出本机。
 *
 * 与 `replay-local/parse.worker.ts`（批量导入的 `parseResult`）同一套装载入口，
 * 不复制 WASM identity/门禁逻辑。
 */
import { loadAgentWasmModule } from '../api/agent-replay-facets.js'

export interface PlaybackParseRequest { id: number; bytes: ArrayBuffer }
export type PlaybackParseResponse =
  | { id: number; json: string; error?: undefined }
  | { id: number; json?: undefined; error: string }

const post = (message: PlaybackParseResponse) =>
  (self as DedicatedWorkerGlobalScope).postMessage(message)

self.onmessage = async (event: MessageEvent<PlaybackParseRequest>) => {
  const { id, bytes } = event.data
  try {
    const mod = await loadAgentWasmModule()
    if (typeof mod.parsePlayback !== 'function') {
      throw new Error('agent wasm: parsePlayback 缺失（产物版本早于契约 v2）')
    }
    post({ id, json: mod.parsePlayback(new Uint8Array(bytes)) })
  } catch (error) {
    post({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
