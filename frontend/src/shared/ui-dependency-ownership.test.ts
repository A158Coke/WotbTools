import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 第三方 UI primitive 只允许出现在 WotbTools 组件边界内（design-language：Reka/motion 不泄漏成页面层的新 design system API）。
const SRC = fileURLToPath(new URL('../', import.meta.url))

const OWNERS: Record<string, string[]> = {
  'reka-ui': [
    'components/AppDialog.vue',
    'components/AppSheet.vue',
    'components/AppTooltip.vue',
    'components/BattlePicker.vue',
    'components/MenuButton.vue',
    'components/SegmentedControl.vue',
  ],
  'motion-v': [
    'App.vue',
    'components/AgentTankopedia.vue',
    'components/FilterChips.vue',
    'components/SegmentedControl.vue',
  ],
}

// breakpoint 归 useBreakpoint()，持久化归现有 owner：这些 VueUse composable 不得引入第二个 owner。
const FORBIDDEN_VUEUSE = ['useStorage', 'useLocalStorage', 'useSessionStorage', 'useBreakpoints']

function productionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return productionFiles(path)
    return /\.(js|ts|vue|mjs)$/.test(name) && !/\.test\.|\.spec\./.test(name) ? [path] : []
  })
}

function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function importers(pkg: string): string[] {
  const specifier = /['"]([^'"]+)['"]/g
  const imports = /\b(?:from|import)\s*\(?\s*['"][^'"]+['"]/g
  return productionFiles(SRC)
    .filter(path => [...strip(readFileSync(path, 'utf8')).matchAll(imports)]
      .some(([statement]) => {
        const name = [...statement.matchAll(specifier)][0][1]
        return name === pkg || name.startsWith(`${pkg}/`)
      }))
    .map(path => relative(SRC, path).split(sep).join('/'))
    .sort()
}

describe('UI dependency ownership', () => {
  for (const [pkg, owners] of Object.entries(OWNERS)) {
    it(`${pkg} 只在 WotbTools 组件边界内被 import`, () => {
      const outside = importers(pkg).filter(file => !owners.includes(file))
      expect(outside).toEqual([])
    })
  }

  it('@vueuse/core 不接管 breakpoint 与持久化 owner', () => {
    const offenders = productionFiles(SRC).flatMap((path) => {
      const source = strip(readFileSync(path, 'utf8'))
      const imported = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@vueuse\/core['"]/g)].flatMap(match => match[1].split(','))
      return imported.map(name => name.trim().split(/\s+as\s+/)[0]).filter(name => FORBIDDEN_VUEUSE.includes(name)).map(() => relative(SRC, path))
    })
    expect(offenders).toEqual([])
  })
})
