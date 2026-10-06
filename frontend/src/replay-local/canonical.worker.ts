/// <reference lib="webworker" />
/**
 * 规范投影 Worker：整条 `parseLocalPlayback`（Rust 三次解析 + 整场 JS 投影 + 地图概览）
 * 都在后台线程完成，主线程只收进度无关的一条结果——避免"播放正常一小段后整页卡住"。
 */
import { parseLocalPlayback } from './playback/index.js'
import type { CanonicalMessage, CanonicalRequest } from './canonicalWorkerProtocol.js'

const post = (message: CanonicalMessage) => (self as DedicatedWorkerGlobalScope).postMessage(message)

self.onmessage = async (event: MessageEvent<CanonicalRequest>) => {
  const { id, bytes, playback } = event.data
  try {
    // 已解析的 playback facet 直接复用：同一回放不二次 parsePlayback
    const result = await parseLocalPlayback(new Uint8Array(bytes), { playback })
    post({ type: 'done', id, playback: result })
  } catch (error) {
    post({ type: 'error', id, error: error instanceof Error ? error.message : String(error) })
  }
}
