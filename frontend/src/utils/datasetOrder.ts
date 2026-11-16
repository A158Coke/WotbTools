/**
 * 数据版本（dataset）的陈列顺序。
 *
 * 口径（2026-11-16 反馈）：**最新超测 → 最新现行版本 → 其余按版本号递降**。
 * 类别判定只看 catalog 的语义字段：`variant` 非空 = 超测（stamp --variant）；
 * 其余都是现行版本——SmartDLC 槽位（`11.21.0_1`）是同一客户端版本的内容更新，
 * 属于现行版本并按版本号排在 `11.21.0` 之上，不因 `_N` 槽位段改变类别。
 *
 * 版本比较键 = id 的数值段（`11.21.0_1` → [11,21,0,0,1,0]、
 * `11.4.0.138-r5` → [11,4,0,138,0,5]）：第 4 段是客户端构建号，第 5 段是
 * SmartDLC 槽位（自 _1 起，Agent 仓 asset_release.py 命名契约），第 6 段是同一
 * dataset 的发布修订（`-rN`）。逐段数值比较——`11.21.0_1` > `11.21.0`、
 * `11.4.0.138-r5` > `11.4.0.130`、`11.21.0` > `11.4.0.130` 均由此得出，
 * 不按字符串比。
 */

export interface DatasetOrderEntry {
  id: string
  /** stamp --variant 的变体标记（超测预览轮次）；正式版本没有。 */
  variant?: string | null
}

/** id 的数值段键；无法解析的 id 返回空数组（排序时沉底，由 id 字典序兜底）。 */
export function datasetVersionKey(id: string): number[] {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:_(\d+))?(?:-r(\d+))?$/.exec(id)
  if (!match) return []
  return [match[1], match[2], match[3], match[4], match[5], match[6]].map(
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

/** 现行版本（非超测）＝ catalog 的 variant 为空；SmartDLC `_N` 槽位同样是现行版本。 */
function isRelease(entry: DatasetOrderEntry): boolean {
  return !entry.variant
}

/**
 * 陈列顺序：最新超测（variant 非空中版本最大）在最上，其次最新现行版本，
 * 其余（旧超测轮次、旧版本）按版本号递降排在后面。
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
