import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionFiles(path)
    return /\.(?:js|ts|mjs|vue)$/.test(entry.name) && !/\.(?:test|spec)\.|\.d\.ts$/.test(entry.name) ? [path] : []
  })
}

function violations(path: string, source: string): string[] {
  // http.ts 的 path→feature 表只做 Android defense-in-depth，不拥有业务请求。
  if (path.startsWith('api/') || path === 'utils/http.ts') return []
  // Vue 只检查脚本；模板属性/文档不作为 JavaScript token 解释。
  const code = path.endsWith('.vue')
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n')
    : source
  // 有限 token 扫描：先消费完整注释/字符串，避免把字符串内 https:// 当作注释。
  const tokens = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g
  return [...code.matchAll(tokens)]
    .map(match => match[0])
    .filter(token => /^["'`]/.test(token) && token.slice(1).startsWith('/api/'))
    .map(token => `${path}: ${token}`)
}

describe('业务 HTTP endpoint ownership', () => {
  it('生产 endpoint literal 只归 api 或明确的 transport 基础设施例外', () => {
    const found = productionFiles(root).flatMap(path => violations(
      relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'),
    ))
    expect(found).toEqual([])
  })

  it.each([
    ["apiFetch('/api/users/profile')", 1],
    ['apiFetch("/api/admin/users")', 1],
    ['apiFetch(`/api/hof/${id}`)', 1],
    ["// '/api/hof'\n/* '/api/users' */", 0],
    ["const asset = 'https://cdn.example/model'; apiFetch('/api/hof')", 1],
    ["import { x } from '../api/creators.js'; fetch('/wasm/id/fingerprint.json')", 0],
    ["const text = \"escaped \\\" quote\"; apiFetch('/api/hof')", 1],
  ])('检查 literal 并跳过注释/资源：%s', (source, expected) => {
    expect(violations('utils/nested/example.ts', source)).toHaveLength(expected)
  })

  it('检查 Vue script 与精确例外，不豁免其它 utils 文件', () => {
    const source = '<template><div title="text" /></template><script setup>fetch("/api/hof")</script>'
    expect(violations('components/Nested/Page.vue', source)).toHaveLength(1)
    expect(violations('api/hall-of-fame.ts', "fetch('/api/hof')")).toEqual([])
    expect(violations('utils/http.ts', "['/api/hof', Feature.HALL_OF_FAME]")).toEqual([])
    expect(violations('utils/http-other.ts', "fetch('/api/hof')")).toHaveLength(1)
  })
})
