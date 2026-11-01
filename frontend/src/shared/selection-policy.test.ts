import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 选择控件（design-language §7.1 DC-SEL-02）：2 项互斥选择不用下拉。
// 只扫描静态 <option> 全部写在模板里的 <select>；v-for 选项的候选数要到运行时才知道，由人工审查。
const SRC = fileURLToPath(new URL('../', import.meta.url))

// 存量例外，只减不增：值是该文件命中的 <select> 数量，页面迁移到 Choice Group 时减少或删除。
const BASELINE: Record<string, number> = {
  // 身份来源切换
  'components/AdminUsersPage.vue': 1,
  // 规则配置表单的固定配置项
  'components/TournamentPointsConfigPage.vue': 4,
}

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return vueFiles(path)
    return path.endsWith('.vue') ? [path] : []
  })
}

function smallStaticSelects(source: string) {
  const template = source.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '')
  return [...template.matchAll(/<select\b[\s\S]*?<\/select>/g)].filter(([block]) => {
    const options = block.match(/<option\b[^>]*>/g) ?? []
    // 没有 <option> 的 <select> 由 JS 填充（装甲查看器内核），同样要到运行时才知道候选数
    return options.length > 0 && options.length <= 2 && !options.some(option => option.includes('v-for'))
  }).length
}

describe('selection control policy', () => {
  const found = Object.fromEntries(vueFiles(SRC)
    .map(path => [relative(SRC, path).split(sep).join('/'), smallStaticSelects(readFileSync(path, 'utf8'))] as const)
    .filter(([, count]) => count > 0))

  it('counts only static selects with at most two options', () => {
    const scan = (body: string) => smallStaticSelects(`<template>${body}</template>`)
    expect(scan('<select><option>a</option><option>b</option></select>')).toBe(1)
    expect(scan('<select><option>a</option><option>b</option><option>c</option></select>')).toBe(0)
    expect(scan('<select><option value="">a</option><option v-for="x in xs">{{ x }}</option></select>')).toBe(0)
    expect(scan('<select id="filled-by-js"></select>')).toBe(0)
  })

  it('has no two-option dropdown outside the shrinking baseline', () => {
    expect(found).toEqual(BASELINE)
  })
})
