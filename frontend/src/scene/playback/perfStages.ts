// ?perf 有界分段归因的单帧累加器（owner = renderLoop.installPerfProbe）。
// 父子区间分开记录，报告中禁止相加；count 为 0 也是有效样本（例如本帧没有幽灵），
// 必须保留，否则 statistics 会把“没有幽灵”的帧丢弃、只统计有幽灵的帧。
export type PerfStageMap = Record<string, number>

export function addPerfStage(stages: PerfStageMap | null | undefined, key: string, ms: number, count?: number): void {
  if (!stages || !key) return
  if (Number.isFinite(ms) && ms > 0) stages[key] = (stages[key] || 0) + ms
  if (count !== undefined && Number.isFinite(count) && count >= 0) {
    const countKey = `${key}${ms > 0 ? 'Calls' : 'Count'}`
    stages[countKey] = (stages[countKey] || 0) + count
  }
}
