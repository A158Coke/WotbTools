// 跨视图文件传递（Phase 2 V2）：ReplayPage Battle context → ReconstructionPage。
// ReplayPage 在具体 battle 上点击「战局回放 / AI 复盘」时把对应 replay 文件暂存于此，
// 由 ReconstructionPage 在 ready 后取走接管（take 语义：取走即清空，避免重复接管）。
// 无响应式需求：仅一次跨视图交接，App.vue 无状态管理库（plan §51 允许，未引入 pinia）。

let pending = null

export function setPendingReplayFiles(files, mode) {
  pending = { files, mode }
}

/** 取走并清空（消费语义，防止 onActivated 重复接管）。 */
export function takePendingReplayFiles() {
  const p = pending
  pending = null
  return p
}