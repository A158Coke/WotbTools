import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { stylelintBaselineViolations } from '../../scripts/check-typescript-baseline.mjs'
import legacy from '../../typescript.legacy.json'

// typescript.legacy.json 必须等于当前源码；只减不增由 scripts/check-typescript-baseline.mjs 在 CI 中比较 base 与 head。
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
const typedProduction = production.filter(file => file.path.endsWith('.ts') || /<script\b[^>]*\blang="ts"/i.test(file.source))

// 按 AST 计数：覆盖全部 any 语法，一行多处都算，注释与字符串不算。SFC 只解析 <script>。
function escapeHatches(path: string, source: string) {
  const code = path.endsWith('.vue')
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script(?:[ \t\n\r\f/][^>]*)?>/gi)].map(match => match[1]).join('\n')
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

  it('records the escape hatches of every production file', () => {
    const counted = typedProduction.flatMap(file => {
      const counts = escapeHatches(file.path, file.source)
      return counts.any || counts.asUnknownAs ? [[file.path, counts] as const] : []
    })
    expect(Object.fromEntries(counted)).toEqual(legacy.escapeHatches)
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

  it('does not end a Vue script block at a non-end-tag script prefix', () => {
    expect(escapeHatches('sample.vue', '<script>const marker="</script-x>"; let x: any</script>'))
      .toEqual({ any: 1, asUnknownAs: 0 })
  })
})

describe('stylelint legacy baseline', () => {
  // 这两个用例锁定 check-typescript-baseline.mjs 的 stylelintBaselineViolations：
  // 名单只减不增——新增豁免必须红，删除与持平必须绿（故意违规的合成输入，不依赖仓库现状）。
  it('rejects a path added to the legacy list', () => {
    const base = { files: ['src/App.vue'] }
    const head = { files: ['src/App.vue', 'src/components/NewThing.vue'] }
    expect(stylelintBaselineViolations(base, head)).toEqual(['src/components/NewThing.vue: 新增了 stylelint legacy 豁免'])
  })

  it('allows removal and stability', () => {
    const base = { files: ['src/App.vue', 'src/components/Old.vue'] }
    expect(stylelintBaselineViolations(base, { files: ['src/App.vue'] })).toEqual([])
    expect(stylelintBaselineViolations(base, base)).toEqual([])
  })
})
