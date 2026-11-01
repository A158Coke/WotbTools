#!/usr/bin/env node
// typescript.legacy.json 的 base→head 单调门禁：名单只减不增，escape hatch 逐文件不增。
// src/shared/typescript-ownership.test.ts 保证名单等于当前源码，这里保证名单不能跟着源码一起放宽。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASELINE_PATH = 'frontend/typescript.legacy.json'

const legacyPaths = (baseline) => new Set([...Object.keys(baseline.retained), ...baseline.p1, ...baseline.p2])

export function baselineViolations(base, head) {
  const allowed = legacyPaths(base)
  const added = [...legacyPaths(head)].filter(path => !allowed.has(path))
    .map(path => `${path}: 新增了非 TypeScript 模块`)
  const grown = Object.entries(head.escapeHatches).flatMap(([path, counts]) =>
    Object.entries(counts).flatMap(([kind, count]) => {
      const limit = base.escapeHatches[path]?.[kind] ?? 0
      return count > limit ? [`${path}: ${kind} 从 ${limit} 增加到 ${count}`] : []
    }))
  return [...added, ...grown]
}

function readBaseBaseline(sha) {
  // 基线随本门禁一起引入；此前的 base 没有该文件。sha 不可达时 cat-file 失败，不当作无基线放行。
  execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'inherit' })
  try {
    return JSON.parse(execFileSync('git', ['show', `${sha}:${BASELINE_PATH}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
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
  const base = readBaseBaseline(sha)
  if (!base) {
    console.log(`typescript baseline: ${sha} 没有基线，跳过单调比较`)
    process.exit(0)
  }
  const head = JSON.parse(readFileSync(new URL('../typescript.legacy.json', import.meta.url), 'utf8'))
  const violations = baselineViolations(base, head)
  if (violations.length) {
    console.error(`typescript baseline 相对 ${sha} 增长（分支落后 base 时先合入 main）：\n${violations.map(line => `- ${line}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`typescript baseline: 相对 ${sha} 未增长`)
}
