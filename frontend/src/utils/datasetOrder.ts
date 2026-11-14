/**
 * 数据版本（dataset）的陈列顺序。
 *
 * 口径（2026-11-14 反馈）：**最新超测 → 最新正式 → 其余按版本号递降**。
 * 类别判定不按 id 猜：`variant` 非空 = 超测（stamp --variant）；正式与 SmartDLC 槽位
 * 以 id 是否带 `_N` 槽位段区分（槽位自 _1 起，Agent 仓 asset_release.py 命名契约）。
 *
 * 版本比较键 = id 的数值段（`11.21.0_1` → [11,21,0,0,1]，槽位段补在末尾且大于无槽位），
 * 逐段数值比较——`11.21.0_1` > `11.21.0`、`11.4.0.138` > `11.4.0.130`、
 * `11.21.0` > `11.4.0.130` 均由此得出，不按字符串比。
 */

export interface DatasetOrderEntry {
  id: string
  /** stamp --variant 的变体标记（超测预览轮次）；正式版本没有。 */
  variant?: string | null
}

/** id 的数值段键；无法解析的 id 返回空数组（排序时沉底，由 id 字典序兜底）。 */
export function datasetVersionKey(id: string): number[] {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:_(\d+))?$/.exec(id)
  if (!match) return []
  return [match[1], match[2], match[3], match[4], match[5]].map(
    part => (part == null ? 0 : Number(part)),
  )
}

/** 版本递降比较（键逐段数值比；同版本按 id 字典序兜底，保证排序稳定）。 */
export function compareDatasetVersionDesc(
  a: DatasetOrderEntry,
  b: DatasetOrderEntry,
): number {
  const ka = datasetVersionKey(a.id)
  const kb = datasetVersionKey(b.id)
  const len = Math.max(ka.length, kb.length)
  for (let i = 0; i < len; i++) {
    const diff = (kb[i] ?? 0) - (ka[i] ?? 0)
    if (diff) return diff
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 正式版本（非超测、非 SmartDLC 槽位）＝ variant 空且 id 不带 `_` 槽位段。 */
function isRelease(entry: DatasetOrderEntry): boolean {
  return !entry.variant && !entry.id.includes('_')
}

/**
 * 陈列顺序：最新超测（variant 非空中版本最大）在最上，其次最新正式版本，
 * 其余（旧超测轮次、SmartDLC 槽位）按版本号递降排在后面。
 * 输入顺序无关；输出为新数组，不修改入参。
 */
export function orderDatasetsForDisplay<T extends DatasetOrderEntry>(entries: readonly T[]): T[] {
  const sorted = [...entries].sort(compareDatasetVersionDesc)
  const latestSupertest = sorted.find(entry => Boolean(entry.variant)) ?? null
  const latestRelease = sorted.find(isRelease) ?? null
  const picked = new Set<DatasetOrderEntry>()
  const out: T[] = []
  for (const head of [latestSupertest, latestRelease]) {
    if (head && !picked.has(head)) {
      picked.add(head)
      out.push(head)
    }
  }
  for (const entry of sorted) {
    if (!picked.has(entry)) out.push(entry)
  }
  return out
}
