import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { encodeCsv, type CsvDocument } from './index.js'

const ROOT = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)))
const FIXTURES = resolve(ROOT, 'common/fixtures/tabular/csv')
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)))
const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)

describe('shared CSV encoder', () => {
  it('matches shared ASCII and empty cell bytes', () => {
    const document: CsvDocument = { headers: ['name', 'value', 'empty'], rows: [['alpha', 'plain', '']] }
    expect(encodeCsv(document)).toEqual(fixture('basic.csv'))
  })

  it('matches Unicode bytes', () => {
    expect(encodeCsv({ headers: ['name', 'value'], rows: [['中文', 'русский']] })).toEqual(fixture('unicode.csv'))
  })

  it('quotes delimiters and doubles embedded quotes', () => {
    expect(encodeCsv({ headers: ['name', 'value'], rows: [['quoted', 'a,b and "quote"']] })).toEqual(fixture('quoted.csv'))
  })

  it('quotes embedded CRLF and preserves it in the cell', () => {
    const document: CsvDocument = { headers: ['name', 'value'], rows: [['multiline', 'line one\r\nline two']] }
    expect(encodeCsv(document)).toEqual(fixture('multiline.csv'))
  })

  it('adds only an optional leading UTF-8 BOM', () => {
    const document: CsvDocument = { headers: ['name', 'value'], rows: [['start', 'with BOM']] }
    const withoutBom = encodeCsv(document)
    expect(encodeCsv(document, { includeBom: true })).toEqual(fixture('bom.csv'))
    expect(encodeCsv(document, { includeBom: true }).slice(3)).toEqual(withoutBom)
    expect([...encodeCsv(document, { includeBom: true }).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(text(fixture('bom.csv')).startsWith('\ufeff')).toBe(true)
    expect(text(fixture('lf.csv'))).toContain('\n')
  })

  it.each(['=SUM(A1:A2)', '+123', '@abc'])('preserves formula-like text %s losslessly', (value) => {
    const bytes = encodeCsv({ headers: ['value'], rows: [[value]] })
    expect(text(bytes)).toBe(`value\r\n${value}`)
  })
})
