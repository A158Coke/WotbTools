// UI Profile 防业务 fork 门禁（frontend/AGENTS.md §30/§41）。
// 硬约定：UI Profile 只改变 Presentation 层视觉，业务组件/状态/API 不得按 Profile fork；
// 禁止用 :key="uiProfile" 触发组件重建（会丢 AI streaming / Replay / HoF 表单状态）。
// 这是一组 source-contract 断言：任何 .vue 出现以下模式即失败。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const componentsRoot = fileURLToPath(new URL('./components', import.meta.url))

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : (name.endsWith('.vue') ? [p] : [])
  })
}

const vueFiles = walk(componentsRoot)
const sources = vueFiles.map((f) => ({ file: f, src: readFileSync(f, 'utf8') }))

const FORBIDDEN = [
  /:key="uiProfile"/, /:key='uiProfile'/,
  /(ReplayClassic|ReplayShowcase|HoFClassic|HoFShowcase|ProfileClassic|ProfileShowcase|ClassicApp|ShowcaseApp|HomePageClassic|ReplayPageClassic)\.vue/,
  /(classic|showcase)\/[A-Za-z].*\.vue/,
]

describe('UI Profile 防业务 fork 门禁（§30/§41）', () => {
  it('.vue 不得按 Profile fork 业务组件 / 用 :key="uiProfile" 触发重建', () => {
    const hits = []
    for (const { file, src } of sources) {
      for (const re of FORBIDDEN) {
        const m = src.match(re)
        if (m) hits.push(file + ' → ' + m[0])
      }
    }
    expect(hits).toEqual([])
  })
})
