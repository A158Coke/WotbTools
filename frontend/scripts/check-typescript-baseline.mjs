// typescript.legacy.json / stylelint.legacy.json 的 base→head 单调门禁：名单只减不增，
// typescript 的 escape hatch 逐文件不增；显式拆分迁移只能把基线源额度逐类型转给唯一新路径。
// src/shared/typescript-ownership.test.ts 保证名单等于当前源码，这里保证名单不能跟着源码一起放宽。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const BASELINE_PATH = 'frontend/typescript.legacy.json'
const STYLELINT_BASELINE_PATH = 'frontend/stylelint.legacy.json'
const FRONTEND = fileURLToPath(new URL('../', import.meta.url))
const REPO_ROOT = resolve(FRONTEND, '..')

const legacyPaths = (baseline) => new Set([...Object.keys(baseline.retained), ...baseline.p1, ...baseline.p2])

export function inferEscapeHatchTransfers(base, head, reexportsBySource, baseSourcePaths = new Set()) {
  const newPaths = new Set(Object.keys(head.escapeHatches).filter(path => !base.escapeHatches[path]))
  const owners = new Map()
  const violations = []
  for (const source of Object.keys(base.escapeHatches)) {
    for (const target of reexportsBySource[source] ?? []) {
      if (!newPaths.has(target)) continue
      if (baseSourcePaths.has(target)) {
        violations.push(`${target}: 不得把预算转入基线中已存在的文件`)
        continue
      }
      const sources = owners.get(target) ?? []
      sources.push(source)
      owners.set(target, sources)
    }
  }

  const transfers = {}
  for (const [target, sources] of owners) {
    if (sources.length !== 1) {
      violations.push(`${target}: escape hatch split 目标必须只有一个旧基线来源`)
      continue
    }
    const source = sources[0]
    transfers[source] ??= []
    transfers[source].push(target)
  }
  return { transfers, violations }
}

export function reexportedModulePaths(sourcePath, sourceText, fileExists = existsSync) {
  const blocks = sourcePath.endsWith('.vue')
    ? [...sourceText.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script(?:[ \t\n\r\f/][^>]*)?>/gi)].map(match => match[1])
    : [sourceText]
  const targets = new Set()
  for (const block of blocks) {
    const ast = ts.createSourceFile(sourcePath, block, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
    const visit = (node) => {
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text
        if (specifier.startsWith('.')) {
          const path = resolve(FRONTEND, dirname(sourcePath), specifier)
          const extension = extname(path)
          const extensions = extension === '.js'
            ? [`${path.slice(0, -3)}.ts`, `${path.slice(0, -3)}.tsx`, path]
            : extension ? [path] : ['.ts', '.tsx', '.vue', '.js'].map(suffix => `${path}${suffix}`)
          const match = extensions.find(fileExists)
          if (match) targets.add(relative(FRONTEND, match).split(sep).join('/'))
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  return [...targets]
}

export function baselineViolations(base, head, transfers = {}) {
  const allowed = legacyPaths(base)
  const added = [...legacyPaths(head)].filter(path => !allowed.has(path))
    .map(path => `${path}: 新增了非 TypeScript 模块`)
  const transferredFrom = new Map()
  const transferredTo = new Map()
  const targetOwners = new Map()
  const invalidTransfers = []
  for (const [source, targets] of Object.entries(transfers)) {
    if (!base.escapeHatches[source] || !Array.isArray(targets)) {
      invalidTransfers.push(`${source}: 非法 TypeScript escape hatch 迁移源`)
      continue
    }
    if (targets.length === 0) invalidTransfers.push(`${source}: 迁移目标不能为空`)
    for (const target of targets) {
      if (target === source || base.escapeHatches[target] || !head.escapeHatches[target]
        || typeof target !== 'string') {
        invalidTransfers.push(`${source} → ${target}: 非法 TypeScript escape hatch 迁移目标`)
        continue
      }
      if (targetOwners.has(target)) {
        invalidTransfers.push(`${source} → ${target}: 迁移目标重复（已由 ${targetOwners.get(target)} 声明）`)
        continue
      }
      targetOwners.set(target, source)
      for (const kind of ['any', 'asUnknownAs']) {
        const count = head.escapeHatches[target][kind] ?? 0
        if (count === 0) continue
        const from = transferredFrom.get(source) ?? { any: 0, asUnknownAs: 0 }
        const to = transferredTo.get(target) ?? { any: 0, asUnknownAs: 0 }
        from[kind] += count
        to[kind] += count
        transferredFrom.set(source, from)
        transferredTo.set(target, to)
      }
    }
  }
  for (const source of Object.keys(transfers)) {
    if (targetOwners.has(source)) invalidTransfers.push(`${source}: 迁移目标不能再次作为迁移源`)
  }
  for (const [source, counts] of transferredFrom) {
    for (const kind of ['any', 'asUnknownAs']) {
      if (counts[kind] > (base.escapeHatches[source]?.[kind] ?? 0)) {
        invalidTransfers.push(`${source}: ${kind} 迁移额度超过原基线`)
      }
    }
  }
  const grown = Object.entries(head.escapeHatches).flatMap(([path, counts]) =>
    Object.entries(counts).flatMap(([kind, count]) => {
      const limit = (base.escapeHatches[path]?.[kind] ?? 0)
        - (transferredFrom.get(path)?.[kind] ?? 0)
        + (transferredTo.get(path)?.[kind] ?? 0)
      return count > limit ? [`${path}: ${kind} 从 ${limit} 增加到 ${count}`] : []
    }))
  return [...added, ...invalidTransfers, ...grown]
}

// stylelint.legacy.json 的 files[] 同样只减不增：文件迁完设计语言 token 后从名单删除，
// 不允许把新文件加进名单来豁免严格规则。
export function stylelintBaselineViolations(base, head) {
  const allowed = new Set(base.files ?? [])
  return (head.files ?? []).filter(path => !allowed.has(path)).map(path => `${path}: 新增了 stylelint legacy 豁免`)
}

function readBaseJson(sha, path) {
  // 基线随本门禁一起引入；此前的 base 没有该文件。sha 不可达时 cat-file 失败，不当作无基线放行。
  execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'inherit' })
  try {
    return JSON.parse(execFileSync('git', ['show', `${sha}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch (error) {
    if (error instanceof SyntaxError) throw error
    return null
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseIndex = process.argv.indexOf('--base')
  const sha = baseIndex > 0 ? process.argv[baseIndex + 1] : undefined
  if (!sha) {
    console.error('用法：check-typescript-baseline.mjs --base <sha>')
    process.exit(2)
  }
  const base = readBaseJson(sha, BASELINE_PATH)
  if (!base) {
    console.log(`typescript baseline: ${sha} 没有基线，跳过单调比较`)
  } else {
    const head = JSON.parse(readFileSync(new URL('../typescript.legacy.json', import.meta.url), 'utf8'))
    const baseSourcePaths = new Set(execFileSync(
      'git', ['ls-tree', '-r', '--name-only', sha, '--', 'frontend/src'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).split(/\r?\n/).filter(Boolean).map(path => path.replace(/^frontend\//, '')))
    const reexportsBySource = Object.fromEntries(Object.keys(base.escapeHatches).map(source => {
      const path = resolve(FRONTEND, source)
      return [source, existsSync(path) ? reexportedModulePaths(source, readFileSync(path, 'utf8')) : []]
    }))
    const inferred = inferEscapeHatchTransfers(base, head, reexportsBySource, baseSourcePaths)
    const violations = [...inferred.violations, ...baselineViolations(base, head, inferred.transfers)]
    if (violations.length) {
      console.error(`typescript baseline 相对 ${sha} 增长（分支落后 base 时先合入 main）：\n${violations.map(line => `- ${line}`).join('\n')}`)
      process.exit(1)
    }
    console.log(`typescript baseline: 相对 ${sha} 未增长`)
  }

  const stylelintBase = readBaseJson(sha, STYLELINT_BASELINE_PATH)
  if (!stylelintBase) {
    console.log(`stylelint baseline: ${sha} 没有基线，跳过单调比较`)
  } else {
    const stylelintHead = JSON.parse(readFileSync(new URL('../stylelint.legacy.json', import.meta.url), 'utf8'))
    const stylelintViolations = stylelintBaselineViolations(stylelintBase, stylelintHead)
    if (stylelintViolations.length) {
      console.error(`stylelint baseline 相对 ${sha} 增长（分支落后 base 时先合入 main）：\n${stylelintViolations.map(line => `- ${line}`).join('\n')}`)
      process.exit(1)
    }
    console.log(`stylelint baseline: 相对 ${sha} 未增长`)
  }
}
