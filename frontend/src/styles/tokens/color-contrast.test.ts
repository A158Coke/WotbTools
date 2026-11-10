import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

/**
 * 四季主题对比度（design-language §2 / §3，WCAG 2.2 AA）：直接读取 tokens/color.css 的主题块，
 * 每个文字 / UI 色在该主题各层表面上的**最差**对比度都必须达标。改 token 而不满足 AA 即失败。
 *
 * 全站环境背景上线后，页面级面板使用半透明玻璃表面。这里除了玻璃色与 canvas 的等效混合，
 * 还对实际提交的 wide / portrait 背景图逐像素合成当前使用的玻璃表面，取合成后亮度的
 * 最小 / 最大像素参与最差值计算；因此背景图或遮罩改动后，这个测试会重新计算而不是沿用旧数值。
 * 目前只有 surface-1-glass 实际用于页面级面板；2/3 档位未应用，仍校验 alpha 与 canvas 混合。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(HERE, 'color.css'), 'utf8')
const BACKDROP_DIR = resolve(HERE, '../../assets/theme')

type Rgba = { r: number; g: number; b: number; a: number }
type Rgb = [number, number, number]

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

function channels(hex: string): Rgb {
  return (hex.slice(1).match(/../g) ?? []).map(part => parseInt(part, 16)) as Rgb
}

function rgbToHex(rgb: Rgb): string {
  return '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('')
}

function compositeChannels(glass: Rgba, backdrop: Rgb): Rgb {
  return [glass.r, glass.g, glass.b].map((fg, index) => Math.round(fg * glass.a + backdrop[index] * (1 - glass.a))) as Rgb
}

/** 半透明表面按 alpha 叠在 canvas 上，得到不依赖图片内容的等效不透明色。 */
function composite(glass: Rgba, canvas: string): string {
  return rgbToHex(compositeChannels(glass, channels(canvas)))
}

function luminanceRgb(rgb: Rgb): number {
  const [r, g, b] = rgb.map(channel => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function luminance(hex: string): number {
  return luminanceRgb(channels(hex))
}

function scrimStops(selector: string): Rgba[] {
  const value = rawBlock(selector).match(/--theme-backdrop-scrim:\s*([^;]+);/)?.[1]
  if (!value) throw new Error(`${selector} 缺少 --theme-backdrop-scrim`)
  return [...value.matchAll(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/g)].map(match => ({
    r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4]),
  }))
}

/**
 * 实际背景图逐像素与遮罩、玻璃色合成后的亮度极值。wide 与 portrait 都取，保证横竖屏构图
 * 不同、坦克/天空位置不同时，最差像素仍被覆盖。
 */
async function glassBackdropExtrema(season: string, glass: Rgba, canvas: Rgb, scrims: Rgba[]): Promise<[string, string]> {
  let min: Rgb = [0, 0, 0]
  let max: Rgb = [0, 0, 0]
  let minLuminance = Number.POSITIVE_INFINITY
  let maxLuminance = Number.NEGATIVE_INFINITY
  for (const variant of ['wide', 'portrait']) {
    const file = resolve(BACKDROP_DIR, `backdrop-${season}-${variant}.webp`)
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    for (let offset = 0; offset < data.length; offset += info.channels) {
      const image: Rgb = [data[offset], data[offset + 1], data[offset + 2]]
      // 遮罩渐变两端的 alpha 是实际可能取到的边界；逐端合成后再叠玻璃，取整段渐变的最坏值。
      for (const scrim of scrims) {
        const scrimmed = image.map((channel, index) => channel * (1 - scrim.a) + canvas[index] * scrim.a) as Rgb
        const composed = compositeChannels(glass, scrimmed)
        const value = luminanceRgb(composed)
        if (value < minLuminance) {
          minLuminance = value
          min = composed
        }
        if (value > maxLuminance) {
          maxLuminance = value
          max = composed
        }
      }
    }
  }
  return [rgbToHex(min), rgbToHex(max)]
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
// 目前实际应用的只有页面级 .surface-glass-1（见 app-shell.css 与各页面 class）；
// 2/3 档位保留但未落到元素上，不参与真实背景图的逐像素最差值。
const ACTIVE_GLASS_SURFACES = ['--color-surface-1-glass']

const THEMES = {
  summer: ':root,\n  :root[data-ui-profile="summer"]',
  spring: ':root[data-ui-profile="spring"]',
  autumn: ':root[data-ui-profile="autumn"]',
  winter: ':root[data-ui-profile="winter"]',
}

describe('theme token contrast (WCAG 2.2 AA)', () => {
  for (const [name, selector] of Object.entries(THEMES)) {
    it(`${name}: 文字 ≥ 4.5、UI ≥ 3、强调色上的文字 ≥ 4.5（含真实背景图上的玻璃表面）`, async () => {
      const tokens = block(selector)
      const glass = glassTokens(selector)
      const canvas = tokens['--color-canvas']
      const canvasGlassSurfaces = GLASS_SURFACES.map(token => {
        expect(glass[token], `${name} ${token}`).toBeDefined()
        expect(glass[token].a, `${name} ${token} alpha`).toBeGreaterThanOrEqual(0.82)
        expect(glass[token].a, `${name} ${token} alpha`).toBeLessThanOrEqual(0.9)
        return composite(glass[token], canvas)
      })
      const backdropGlassSurfaces: string[] = []
      const canvasRgb = channels(canvas)
      const scrims = scrimStops(selector)
      for (const token of ACTIVE_GLASS_SURFACES) {
        const [min, max] = await glassBackdropExtrema(name, glass[token], canvasRgb, scrims)
        backdropGlassSurfaces.push(min, max)
      }
      const surfaces = [...SURFACES.map(token => tokens[token]), ...canvasGlassSurfaces, ...backdropGlassSurfaces]
      const failures: string[] = []
      const worst = (token: string) => Math.min(...surfaces.map(surface => ratio(tokens[token], surface)))
      for (const token of SURFACES) expect(tokens[token], `${name} ${token}`).toMatch(/^#/)
      for (const token of TEXT) if (worst(token) < 4.5) failures.push(`${token} ${worst(token).toFixed(2)}`)
      for (const token of UI) if (worst(token) < 3) failures.push(`${token} ${worst(token).toFixed(2)}`)
      const onAccent = ratio(tokens['--color-on-accent'], tokens['--color-accent'])
      if (onAccent < 4.5) failures.push(`--color-on-accent ${onAccent.toFixed(2)}`)
      expect(failures).toEqual([])
    }, 30_000)
  }

  it('寒冬是唯一的浅色主题，场景外壳在寒冬下仍是深色玻璃且同样达标', () => {
    expect(css).toMatch(/:root\[data-ui-profile="winter"\] \{\s*color-scheme: light;/)
    for (const name of ['spring', 'autumn']) expect(css).toMatch(new RegExp(`:root\\[data-ui-profile="${name}"\\] \\{\\s*color-scheme: dark;`))
    const scene = block(':root[data-ui-profile="winter"] [data-scene-surface]')
    // 场景子树的文字色必须在场景根落定：页面层已按浅色主题把 computed color 写成深蓝，
    // 缺这行时未显式设置 color 的后代（Display 面板选项行等）继承它落在暗色表面上
    // （实测对比度 1.03:1，2026-11-10 反馈）。变量换成暗色值不够——继承的是祖先的 computed color。
    expect(css).toMatch(/:root\[data-ui-profile="winter"\] \[data-scene-surface\] \{[\s\S]*?color-scheme: dark;[\s\S]*?color: var\(--color-text-primary\);/)
    const sceneGlass = glassTokens(':root[data-ui-profile="winter"] [data-scene-surface]')
    const glassSurfaces = GLASS_SURFACES.map(token => composite(sceneGlass[token], scene['--color-canvas']))
    for (const token of ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-accent-text']) {
      const surfaces = [...SURFACES.map(surface => scene[surface]), ...glassSurfaces]
      expect(Math.min(...surfaces.map(surface => ratio(scene[token], surface))), token).toBeGreaterThanOrEqual(4.5)
    }
  })
})
