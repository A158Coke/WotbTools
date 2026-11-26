
import type { ProcessedDataset } from '../compute/finalize.js'
import { resultFor } from '../compute/league-batch.js'
import type { Tankopedia } from '../compute/tankopedia.js'
import { renderXlsx } from '../../shared/tabular/xlsx/index.js'
import { zipFiles } from './render.js'
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
export type { WorkbookSpec } from './spec.js'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const ZIP_MIME = 'application/zip'
const LEAGUE_AGGREGATE_FILENAME = '联赛汇总.xlsx'
const STANDARD_AGGREGATE_FILENAME = '回放汇总.xlsx'
const EACH_ZIP_FILENAME = '逐场导出.zip'

export type TeamNamesInput = string | Readonly<Record<string, unknown>> | null | undefined

export interface ExportOptions {
  teamNames?: TeamNamesInput
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

function stripExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.substring(0, dot) : name
}

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

function aggregateFilename(dataset: ProcessedDataset): string {
  if (dataset.battles.length === 1) return `${stripExt(dataset.battleSourceNames[0])}.xlsx`
  return dataset.league !== null ? LEAGUE_AGGREGATE_FILENAME : STANDARD_AGGREGATE_FILENAME
}

export function buildAggregateWorkbook(dataset: ProcessedDataset, tankopedia: Tankopedia,
  options: ExportOptions = {}): WorkbookSpec {
  const ctx: SheetContext = { tankopedia, timeZone: options.timeZone }
  const names = parseTeamNames(options.teamNames)
  const { battles, league } = dataset
  if (league !== null) {
    if (battles.length === 1) {
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

function buildEachWorkbooks(dataset: ProcessedDataset, tankopedia: Tankopedia,
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

export async function exportAggregateXlsx(dataset: ProcessedDataset, tankopedia: Tankopedia,
  options: ExportOptions = {}): Promise<ExportFile> {
  const bytes = await renderXlsx(buildAggregateWorkbook(dataset, tankopedia, options))
  return { filename: aggregateFilename(dataset), mime: XLSX_MIME, blob: toBlob(bytes, XLSX_MIME) }
}

export async function exportEachZip(dataset: ProcessedDataset, tankopedia: Tankopedia,
  options: ExportOptions = {}): Promise<ExportFile> {
  const files: { name: string; data: Uint8Array }[] = []
  for (const { name, workbook } of buildEachWorkbooks(dataset, tankopedia, options)) {
    files.push({ name, data: await renderXlsx(workbook) })
  }
  return { filename: EACH_ZIP_FILENAME, mime: ZIP_MIME, blob: toBlob(await zipFiles(files), ZIP_MIME) }
}
