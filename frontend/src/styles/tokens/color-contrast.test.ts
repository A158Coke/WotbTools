import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 四季主题对比度（design-language §2 / §3，WCAG 2.2 AA）：直接读取 tokens/color.css 的主题块，
 * 每个文字 / UI 色在该主题各层表面上的**最差**对比度都必须达标。改 token 而不满足 AA 即失败。
 *
 * 全站环境背景上线后，页面级面板使用半透明玻璃表面；这里把玻璃色按 alpha 与 canvas 混合成
 * 等效不透明色，再和纯色表面一起参与最差值计算（背景图始终被 canvas 色遮罩压住，取最保守的
 * 纯 canvas 混合）。玻璃 alpha 必须在 82%–90%，过低会让文字直接落在不可控的图片上。
 */
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'color.css'), 'utf8')

type Rgba = { r: number; g: number; b: number; a: number }

function rawBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`color.css 缺少主题块 ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

function block(selector: string): Record<string, string> {
  return Object.fromEntries([...rawBlock(selector).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(match => [match[1], match[2]]))
}

function glassTokens(selector: string): Record<string, Rgba> {
  const matches = rawBlock(selector).matchAll(/(--[\w-]+):\s*rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)\s*;/gi)
  return Object.fromEntries([...matches].map(match => [match[1], {
    r: Number(match[2]),
    g: Number(match[3]),
    b: Number(match[4]),
    a: Number(match[5]),
  }]))
}

function channels(hex: string): [number, number, number] {
  return (hex.slice(1).match(/../g) ?? []).map(part => parseInt(part, 16)) as [number, number, number]
}

/** 半透明表面按 alpha 叠在 canvas 上，得到不依赖图片内容的等效不透明色。 */
function composite(glass: Rgba, canvas: string): string {
  const [cr, cg, cb] = channels(canvas)
  const mix = (fg: number, bg: number) => Math.round(fg * glass.a + bg * (1 - glass.a))
  return '#' + [mix(glass.r, cr), mix(glass.g, cg), mix(glass.b, cb)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(channel => {
    const value = channel / 255
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
const GLASS_SURFACES = ['--color-surface-1-glass', '--color-surface-2-glass', '--color-surface-3-glass']

const THEMES = {
  summer: ':root,\n  :root[data-ui-profile="summer"]',
  spring: ':root[data-ui-profile="spring"]',
  autumn: ':root[data-ui-profile="autumn"]',
  winter: ':root[data-ui-profile="winter"]',
}

describe('theme token contrast (WCAG 2.2 AA)', () => {
  for (const [name, selector] of Object.entries(THEMES)) {
    it(`${name}: 文字 ≥ 4.5、UI ≥ 3、强调色上的文字 ≥ 4.5（含玻璃表面等效色）`, () => {
      const tokens = block(selector)
      const glass = glassTokens(selector)
      const canvas = tokens['--color-canvas']
      const glassSurfaces = GLASS_SURFACES.map(token => {
        expect(glass[token], `${name} ${token}`).toBeDefined()
        expect(glass[token].a, `${name} ${token} alpha`).toBeGreaterThanOrEqual(0.82)
        expect(glass[token].a, `${name} ${token} alpha`).toBeLessThanOrEqual(0.9)
        return composite(glass[token], canvas)
      })
      const surfaces = [...SURFACES.map(token => tokens[token]), ...glassSurfaces]
      const failures: string[] = []
      const worst = (token: string) => Math.min(...surfaces.map(surface => ratio(tokens[token], surface)))
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
    const sceneGlass = glassTokens(':root[data-ui-profile="winter"] [data-scene-surface]')
    const glassSurfaces = GLASS_SURFACES.map(token => composite(sceneGlass[token], scene['--color-canvas']))
    for (const token of ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-accent-text']) {
      const surfaces = [...SURFACES.map(surface => scene[surface]), ...glassSurfaces]
      expect(Math.min(...surfaces.map(surface => ratio(scene[token], surface))), token).toBeGreaterThanOrEqual(4.5)
    }
  })
})
