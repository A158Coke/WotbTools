import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacy from '../../typescript.legacy.json'

// typescript.legacy.json 是只减不增的迁移基线：新 prod 模块必须是 TS，迁完一个删一个。
const FRONTEND = fileURLToPath(new URL('../../', import.meta.url))
const SRC = join(FRONTEND, 'src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path)
    return /\.(?:js|ts|vue)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

const files = sourceFiles(SRC).map(path => ({
  path: relative(FRONTEND, path).split(sep).join('/'),
  source: readFileSync(path, 'utf8'),
}))
const isTest = (path: string) => /\.test\./.test(path) || path.startsWith('src/test/')
const production = files.filter(file => !isTest(file.path))
const typedProduction = production.filter(file => file.path.endsWith('.ts') || /<script\b[^>]*\blang="ts"/.test(file.source))

function occurrences(pattern: RegExp): number {
  return typedProduction.reduce((sum, file) => sum + file.source.split('\n').filter(line => pattern.test(line)).length, 0)
}

describe('TypeScript migration baseline', () => {
  it('lists exactly the production modules that are not TypeScript yet', () => {
    const untyped = production.filter(file => !typedProduction.includes(file)).map(file => file.path).sort()
    const listed = [...Object.keys(legacy.retained), ...legacy.p1, ...legacy.p2].sort()
    expect(listed).toEqual(untyped)
  })

  it('states why every retained module stays JavaScript', () => {
    expect(Object.values(legacy.retained).filter(reason => !reason.trim())).toEqual([])
  })

  it('does not silence the compiler', () => {
    const silenced = files.filter(file => /@ts-(?:ignore|nocheck)/.test(file.source)
      || (/@ts-expect-error/.test(file.source) && !file.path.endsWith('.test.ts')))
    expect(silenced.map(file => file.path).filter(path => path !== 'src/shared/typescript-ownership.test.ts')).toEqual([])
  })

  it('keeps type escape hatches at the recorded count', () => {
    expect({
      any: occurrences(/:\s*any\b|<any>|\bas any\b|any\[\]/),
      asUnknownAs: occurrences(/as unknown as/),
    }).toEqual(legacy.escapeHatches)
  })
})
