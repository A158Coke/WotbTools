/**
 * 客户端回放 xlsx 导出（取代服务端 `ReplayExportJobService` + Java `ExcelExporter`/POI）。
 *
 * 用法：
 *   const dataset = finalizeBatch(entries, tankopedia)
 *   const file = await exportAggregateXlsx(dataset, tankopedia, { teamNames })  // mode=aggregate
 *   const zip = await exportEachZip(dataset, tankopedia, { teamNames })         // mode=each
 *   download(file.blob, file.filename)
 *
 * 工作簿结构是纯数据（sheets.ts，同步、可测）；exceljs / fflate 只在 render.ts 中动态加载。
 * 与 Java 的逐格一致由 `__golden__/java-export.json` 锁定（export.golden.test.ts）。
 */

import type { ProcessedDataset } from '../compute/finalize.js'
import { resultFor } from '../compute/league-batch.js'
import type { Tankopedia } from '../compute/tankopedia.js'
import { renderXlsx, zipFiles } from './render.js'
import {
  aggregateLeagueWorkbook,
  aggregateWorkbook,
  singleLeagueWorkbook,
  singleWorkbook,
  type SheetContext,
  type TeamNameOverrides,
} from './sheets.js'
import type { WorkbookSpec } from './spec.js'

export type { TeamNameOverrides } from './sheets.js'
export type { CellSpec, SheetSpec, StyleKey, WorkbookSpec } from './spec.js'
export { renderXlsx } from './render.js'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const ZIP_MIME = 'application/zip'
/** 多场纯 League（CW）汇总文件名（Java `ReplayExportNames.LEAGUE_AGGREGATE`）。 */
export const LEAGUE_AGGREGATE_FILENAME = '联赛汇总.xlsx'
/** 多场 Standard / Mixed 汇总文件名（Java `ReplayExportNames.STANDARD_AGGREGATE`）。 */
export const STANDARD_AGGREGATE_FILENAME = '回放汇总.xlsx'
/** 逐场导出 zip 文件名。 */
export const EACH_ZIP_FILENAME = '逐场导出.zip'

/**
 * 战队名称覆盖输入（与服务端 `teamNames` 参数同一契约）：
 * `{"battle": {"arenaId:team": 名}, "summary": {teamKey: 名}}`；扁平 `{"arenaId:team": 名}` 视为 battle。
 * 可传对象或 JSON 字符串；非法 → 空（不抛错）。
 */
export type TeamNamesInput = string | Readonly<Record<string, unknown>> | null | undefined

export interface ExportOptions {
  teamNames?: TeamNamesInput
  /** IANA 时区（日期列）；省略 = 浏览器本地时区。 */
  timeZone?: string
}

export interface ExportFile {
  filename: string
  mime: string
  blob: Blob
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function collectText(node: unknown, out: Map<string, string>): void {
  if (!isObject(node)) return
  for (const [k, v] of Object.entries(node)) if (typeof v === 'string') out.set(k, v)
}

/** Java `ReplayExportJobService.parseTeamNames`。 */
export function parseTeamNames(input: TeamNamesInput): TeamNameOverrides {
  const empty: TeamNameOverrides = { battle: new Map(), summary: new Map() }
  let node: unknown = input
  if (typeof input === 'string') {
    if (input.trim() === '') return empty
    try {
      node = JSON.parse(input)
    } catch {
      return empty
    }
  }
  if (!isObject(node)) return empty
  const battle = new Map<string, string>()
  const summary = new Map<string, string>()
  if (isObject(node.battle) || isObject(node.summary)) {
    collectText(node.battle, battle)
    collectText(node.summary, summary)
    return { battle, summary }
  }
  collectText(node, battle)
  return { battle, summary }
}

/** Java `ReplayJobFiles.stripExt`。 */
function stripExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.substring(0, dot) : name
}

/** Java `ReplayExportJobService.uniqueName`：替换路径分隔符，重名追加 `-2`、`-3`…。 */
function uniqueName(preferred: string, used: Set<string>): string {
  const safe = preferred.replaceAll('\\', '_').replaceAll('/', '_')
  if (!used.has(safe)) {
    used.add(safe)
    return safe
  }
  const dot = safe.lastIndexOf('.')
  const base = dot > 0 ? safe.substring(0, dot) : safe
  const ext = dot > 0 ? safe.substring(dot) : ''
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/** mode=aggregate 的文件名：单场 = 源文件名.xlsx；多场 League = 联赛汇总；否则回放汇总。 */
export function aggregateFilename(dataset: ProcessedDataset): string {
  if (dataset.battles.length === 1) return `${stripExt(dataset.battleSourceNames[0])}.xlsx`
  return dataset.league !== null ? LEAGUE_AGGREGATE_FILENAME : STANDARD_AGGREGATE_FILENAME
}

/** mode=aggregate 的工作簿（Java `processAggregateFromResult`）。 */
export function buildAggregateWorkbook(dataset: ProcessedDataset, tankopedia: Tankopedia,
  options: ExportOptions = {}): WorkbookSpec {
  const ctx: SheetContext = { tankopedia, timeZone: options.timeZone }
  const names = parseTeamNames(options.teamNames)
  const { battles, league } = dataset
  if (league !== null) {
    if (battles.length === 1) {
      // identity 绑定；未评分单场回退普通单场工作簿（基础数据仍可导出）
      const single = resultFor(league, battles[0].arenaId)
      return single !== null
        ? singleLeagueWorkbook(battles[0], single, ctx, names.battle)
        : singleWorkbook(battles[0], ctx)
    }
    return aggregateLeagueWorkbook(battles, dataset.battleSourceNames, dataset.duplicates, league, ctx, names)
  }
  if (battles.length === 1) return singleWorkbook(battles[0], ctx)
  return aggregateWorkbook(battles, dataset.battleSourceNames, dataset.duplicates, ctx)
}

/** mode=each 的逐场工作簿（Java `processEachFromResult`）：未评分的 League 场次也导出普通单场。 */
export function buildEachWorkbooks(dataset: ProcessedDataset, tankopedia: Tankopedia,
  options: ExportOptions = {}): { name: string; workbook: WorkbookSpec }[] {
  const ctx: SheetContext = { tankopedia, timeZone: options.timeZone }
  const names = parseTeamNames(options.teamNames)
  const used = new Set<string>()
  return dataset.battles.map((battle, i) => {
    const result = dataset.league !== null ? resultFor(dataset.league, battle.arenaId) : null
    return {
      name: uniqueName(`${stripExt(dataset.battleSourceNames[i])}.xlsx`, used),
      workbook: result !== null ? singleLeagueWorkbook(battle, result, ctx, names.battle) : singleWorkbook(battle, ctx),
    }
  })
}

function toBlob(bytes: Uint8Array, mime: string): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })
}

/** 导出 mode=aggregate 的 xlsx。 */
export async function exportAggregateXlsx(dataset: ProcessedDataset, tankopedia: Tankopedia,
  options: ExportOptions = {}): Promise<ExportFile> {
  const bytes = await renderXlsx(buildAggregateWorkbook(dataset, tankopedia, options))
  return { filename: aggregateFilename(dataset), mime: XLSX_MIME, blob: toBlob(bytes, XLSX_MIME) }
}

/** 导出 mode=each 的 zip（每场一个 xlsx）。 */
export async function exportEachZip(dataset: ProcessedDataset, tankopedia: Tankopedia,
  options: ExportOptions = {}): Promise<ExportFile> {
  const files: { name: string; data: Uint8Array }[] = []
  for (const { name, workbook } of buildEachWorkbooks(dataset, tankopedia, options)) {
    files.push({ name, data: await renderXlsx(workbook) })
  }
  return { filename: EACH_ZIP_FILENAME, mime: ZIP_MIME, blob: toBlob(await zipFiles(files), ZIP_MIME) }
}
