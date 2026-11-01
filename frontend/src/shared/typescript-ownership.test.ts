import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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

// 按 AST 计数：覆盖全部 any 语法，一行多处都算，注释与字符串不算。SFC 只解析 <script>。
function escapeHatches(path: string, source: string) {
  const code = path.endsWith('.vue')
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n')
    : source
  const counts = { any: 0, asUnknownAs: 0 }
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) counts.any++
    if (ts.isAsExpression(node)) {
      let inner = node.expression
      while (ts.isParenthesizedExpression(inner)) inner = inner.expression
      if (ts.isAsExpression(inner) && inner.type.kind === ts.SyntaxKind.UnknownKeyword) counts.asUnknownAs++
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile('source.ts', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS))
  return counts
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
    const counted = typedProduction.map(file => escapeHatches(file.path, file.source))
    expect({
      any: counted.reduce((sum, counts) => sum + counts.any, 0),
      asUnknownAs: counted.reduce((sum, counts) => sum + counts.asUnknownAs, 0),
    }).toEqual(legacy.escapeHatches)
  })

  it('counts every any spelling and ignores comments and strings', () => {
    const source = `
      type Payload = any
      const record: Record<string, any> = {}
      const pair = call<any, any>(value as any)
      const list: any[] = (value as unknown as string[])
      const wrapped = (value as unknown) as string
      // any as unknown as string
      const text = 'as any'
    `
    expect(escapeHatches('sample.ts', source)).toEqual({ any: 6, asUnknownAs: 2 })
    expect(escapeHatches('sample.vue', '<template><a :b="c as any" /></template><script setup lang="ts">let x: any</script>'))
      .toEqual({ any: 1, asUnknownAs: 0 })
  })
})
