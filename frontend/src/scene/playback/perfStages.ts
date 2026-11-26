export type PerfStageMap = Record<string, number>

export function addPerfStage(stages: PerfStageMap | null | undefined, key: string, ms: number, count?: number): void {
  if (!stages || !key) return
  if (Number.isFinite(ms) && ms > 0) stages[key] = (stages[key] || 0) + ms
  if (count !== undefined && Number.isFinite(count) && count >= 0) {
    const countKey = `${key}${ms > 0 ? 'Calls' : 'Count'}`
    stages[countKey] = (stages[countKey] || 0) + count
  }
}
