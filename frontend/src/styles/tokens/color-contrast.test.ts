import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 四季主题对比度（design-language §2 / §3，WCAG 2.2 AA）：直接读取 tokens/color.css 的主题块，
 * 每个文字 / UI 色在该主题四层表面上的**最差**对比度都必须达标。改 token 而不满足 AA 即失败。
 */
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'color.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`color.css 缺少主题块 ${selector}`)
  const body = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(match => [match[1], match[2]]))
}

function luminance(hex: string): number {
  const [r, g, b] = (hex.slice(1).match(/../g) ?? []).map(part => {
    const value = parseInt(part, 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT = ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-accent-text',
  '--color-success', '--color-danger', '--color-warning', '--color-info', '--color-team-1', '--color-team-2']
const UI = ['--color-border-strong', '--color-accent', '--color-team-enemy-cb']
const SURFACES = ['--color-canvas', '--color-surface-1', '--color-surface-2', '--color-surface-3']

const THEMES = {
  summer: ':root,\n  :root[data-ui-profile="summer"]',
  spring: ':root[data-ui-profile="spring"]',
  autumn: ':root[data-ui-profile="autumn"]',
  winter: ':root[data-ui-profile="winter"]',
}

describe('theme token contrast (WCAG 2.2 AA)', () => {
  for (const [name, selector] of Object.entries(THEMES)) {
    it(`${name}: 文字 ≥ 4.5、UI ≥ 3、强调色上的文字 ≥ 4.5`, () => {
      const tokens = block(selector)
      const failures: string[] = []
      const worst = (token: string) => Math.min(...SURFACES.map(surface => ratio(tokens[token], tokens[surface])))
      for (const token of SURFACES) expect(tokens[token], `${name} ${token}`).toMatch(/^#/)
      for (const token of TEXT) if (worst(token) < 4.5) failures.push(`${token} ${worst(token).toFixed(2)}`)
      for (const token of UI) if (worst(token) < 3) failures.push(`${token} ${worst(token).toFixed(2)}`)
      const onAccent = ratio(tokens['--color-on-accent'], tokens['--color-accent'])
      if (onAccent < 4.5) failures.push(`--color-on-accent ${onAccent.toFixed(2)}`)
      expect(failures).toEqual([])
    })
  }

  it('寒冬是唯一的浅色主题，场景外壳在寒冬下仍是深色玻璃且同样达标', () => {
    expect(css).toMatch(/:root\[data-ui-profile="winter"\] \{\s*color-scheme: light;/)
    for (const name of ['spring', 'autumn']) expect(css).toMatch(new RegExp(`:root\\[data-ui-profile="${name}"\\] \\{\\s*color-scheme: dark;`))
    const scene = block(':root[data-ui-profile="winter"] [data-scene-surface]')
    for (const token of ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-accent-text']) {
      expect(Math.min(...SURFACES.map(surface => ratio(scene[token], scene[surface]))), token).toBeGreaterThanOrEqual(4.5)
    }
  })
})
