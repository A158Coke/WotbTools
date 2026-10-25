// playbackScene 内核的共享常量与并发工具（2026-10-24 自 initPlayback 所在文件出仓，
// 拆分计划与模式说明见 docs/current-plan.md；代码与搬移前逐字一致）。

export const GRID_DT = 0.1

// 资产加载并发上限：全串行（9 张地表贴图 / 逐张 await）白等网络往返；无限并发
// （14 台坦克 GLB 同时 fetch + 主线程 parse）会把主线程解析排满。取 4。
export const ASSET_CONCURRENCY = 4

/** 有限并发映射（保持结果顺序）；用于资产下载/解析 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
