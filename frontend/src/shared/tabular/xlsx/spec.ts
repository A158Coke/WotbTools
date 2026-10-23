/** Business-neutral data model consumed by the shared XLSX renderer. */

export type CellValue = string | number | null

export interface CellColor {
  argb?: string
  indexed?: number
}

export interface CellStyle {
  font?: {
    name?: string
    size?: number
    family?: number
    bold?: boolean
    color?: CellColor
  }
  fill?: {
    type: 'pattern'
    pattern: 'solid'
    fgColor: CellColor
  }
  alignment?: {
    horizontal?: 'left' | 'center' | 'right'
    vertical?: 'middle'
    wrapText?: boolean
  }
  border?: Partial<Record<'top' | 'bottom' | 'left' | 'right', { style: 'thin' }>>
  numberFormat?: string
}

export interface CellSpec {
  value: CellValue
  style?: CellStyle
}

export interface ColumnSpec {
  width?: number
}

export interface RowSpec {
  cells: (CellSpec | null | undefined)[]
  height?: number
}

export interface PageSetupSpec {
  orientation?: 'portrait' | 'landscape'
  fitToPage?: boolean
  fitToWidth?: number
  fitToHeight?: number
  printTitlesRow?: string
}

export interface MergeSpec {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
}

export interface SheetSpec {
  name: string
  columns: ColumnSpec[]
  /** A null entry preserves a sparse row in the source workbook description. */
  rows: (RowSpec | null | undefined)[]
  freeze?: { xSplit: number; ySplit: number } | null
  autoFilter?: string | { from: { row: number; column: number }; to: { row: number; column: number } } | null
  merges?: MergeSpec[]
  pageSetup?: PageSetupSpec
}

export interface WorkbookSpec {
  sheets: SheetSpec[]
  activeTab: number
}
