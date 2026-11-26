export interface CsvDocument {
  headers: readonly string[]
  rows: readonly (readonly string[])[]
}

export interface CsvEncodeOptions {
  includeBom?: boolean
}
