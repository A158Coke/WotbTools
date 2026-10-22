import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../../', import.meta.url))
const OWNER = resolve(SRC, 'shared/tabular/xlsx')
const IMPORT = /\b(?:from\s*|import\s*\(|import\s+|require\s*\()\s*['"]exceljs['"]/g

function productionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return productionFiles(path)
    return /\.(js|ts|vue|mjs)$/.test(name) && !/\.test\.|\.spec\./.test(name) ? [path] : []
  })
}

describe('XLSX ExcelJS ownership', () => {
  it('keeps all production ExcelJS imports inside the shared XLSX capability', () => {
    const references = productionFiles(SRC).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      return [...source.matchAll(IMPORT)].map(() => path)
    })
    const outsideOwner = references
      .filter((path) => relative(OWNER, path).startsWith('..'))
      .map((path) => relative(SRC, path))

    expect(references.length).toBeGreaterThan(0)
    expect(outsideOwner).toEqual([])
  })
})
