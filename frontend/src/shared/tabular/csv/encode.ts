import type { CsvDocument, CsvEncodeOptions } from './spec.js'

const encoder = new TextEncoder()

function encodeField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replaceAll('"', '""')}"`
}

function encodeRecord(row: readonly string[]): string {
  const fields = row.map(encodeField)
  return fields.length === 1 && fields[0] === '' ? '""' : fields.join(',')
}

/** Encode a string table as UTF-8 RFC4180 records separated by CRLF. */
export function encodeCsv(document: CsvDocument, options: CsvEncodeOptions = {}): Uint8Array {
  const records = [document.headers, ...document.rows]
    .map(encodeRecord)
    .join('\r\n')
  const content = encoder.encode(records)
  if (!options.includeBom) return content
  const output = new Uint8Array(content.length + 3)
  output.set([0xef, 0xbb, 0xbf])
  output.set(content, 3)
  return output
}
