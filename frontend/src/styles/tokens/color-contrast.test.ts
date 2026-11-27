import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(HERE, 'color.css'), 'utf8').replace(/\r\n/g, '\n')
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

function srgbToLinear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function linearToSrgbChannel(value: number): number {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, c)) * 255)
}

function oklabOf(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(srgbToLinear)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ]
}

function oklabToRgb([L, a, b]: [number, number, number]): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    linearToSrgbChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgbChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgbChannel(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ]
}

function oklabMix(fg: string, bg: string, alpha: number): string {
  const [l1, a1, b1] = oklabOf(channels(fg))
  const [l2, a2, b2] = oklabOf(channels(bg))
  return rgbToHex(oklabToRgb([
    l1 * alpha + l2 * (1 - alpha),
    a1 * alpha + a2 * (1 - alpha),
    b1 * alpha + b2 * (1 - alpha),
  ]))
}

const TEXT = ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-accent-text',
  '--color-success', '--color-danger', '--color-warning', '--color-info', '--color-team-1', '--color-team-2']
const UI = ['--color-border-strong', '--color-accent', '--color-team-enemy-cb']
const SURFACES = ['--color-canvas', '--color-surface-1', '--color-surface-2', '--color-surface-3']
const GLASS_SURFACES = ['--color-surface-1-glass', '--color-surface-2-glass', '--color-surface-3-glass']
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

  it('四季出生侧分段条：danger / border-strong / info 对 track ≥ 3、ring 对行底 ≥ 3', () => {
    const failures: string[] = []
    for (const [name, selector] of Object.entries(THEMES)) {
      const tokens = block(selector)
      const track = tokens['--color-surface-3']
      const row = tokens['--color-surface-1']
      expect(track, `${name} --color-surface-3`).toMatch(/^#/)
      expect(row, `${name} --color-surface-1`).toMatch(/^#/)
      for (const fill of ['--color-danger', '--color-border-strong', '--color-info']) {
        const value = ratio(tokens[fill], track)
        if (value < 3) failures.push(`${name} ${fill} vs track ${value.toFixed(2)}`)
      }
      const ring = ratio(tokens['--color-border-strong'], row)
      if (ring < 3) failures.push(`${name} border-strong vs row ${ring.toFixed(2)}`)
    }
    expect(failures).toEqual([])
  })


  it('寒冬是唯一的浅色主题，场景外壳在寒冬下仍是深色玻璃且同样达标', () => {
    expect(css).toMatch(/:root\[data-ui-profile="winter"\] \{\s*color-scheme: light;/)
    for (const name of ['spring', 'autumn']) expect(css).toMatch(new RegExp(`:root\\[data-ui-profile="${name}"\\] \\{\\s*color-scheme: dark;`))
    const scene = block(':root[data-ui-profile="winter"] [data-scene-surface]')
    expect(css).toMatch(/:root\[data-ui-profile="winter"\] \[data-scene-surface\] \{[\s\S]*?color-scheme: dark;[\s\S]*?color: var\(--color-text-primary\);/)
    const sceneGlass = glassTokens(':root[data-ui-profile="winter"] [data-scene-surface]')
    const glassSurfaces = GLASS_SURFACES.map(token => composite(sceneGlass[token], scene['--color-canvas']))
    for (const token of ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-accent-text']) {
      const surfaces = [...SURFACES.map(surface => scene[surface]), ...glassSurfaces]
      expect(Math.min(...surfaces.map(surface => ratio(scene[token], surface))), token).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('坦克卡片高级/收藏底色：车名对 36%/46% 语义底 ≥ 3（用户裁示例外）、属性标签 ≥ 4.5、语义 pill 对自绘 16% 底 ≥ 4.5', () => {
    const component = readFileSync(resolve(HERE, '../../components/TankCatalogMenu.vue'), 'utf8')
    const style = component.slice(component.indexOf('<style'))
    const nameRules = [...style.matchAll(
      /\.tp-card\.is-(premium|collector(?::not\(\.is-premium\))?) \.tp-card-name[^{]*\{[^}]*color:\s*color-mix\(in oklab,\s*var\((--color-[\w-]+)\)\s*(\d+(?:\.\d+)?)%,\s*var\(--color-text-primary\)\)/g,
    )].map(match => ({ card: match[1], semantic: match[2], mix: Number(match[3]) / 100 }))
    expect(nameRules.map(rule => rule.semantic).sort(), '车名语义色规则缺失或形态漂移')
      .toEqual(['--color-info', '--color-warning'])
    for (const rule of nameRules) expect(rule.mix, '车名语义混色比例').toBeGreaterThan(0)
    const nameColorDecls = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(match => match[1].includes('.tp-card-name') && /(?:^|[^-])color\s*:/.test(match[2]))
    expect(nameColorDecls.length, '.tp-card-name 颜色声明数量（应为 2 条染色卡规则）').toBe(2)
    const labelTokens = [...style.matchAll(/\.tp-card\.is-(?:premium|collector(?::not\(\.is-premium\))?) \.tp-stat-label[^{]*\{[^}]*color:\s*var\((--color-[\w-]+)\)/g)].map(match => match[1])
    expect(labelTokens, '染色卡属性标签覆写规则缺失').toEqual(['--color-text-primary'])
    const failures: string[] = []
    for (const [name, selector] of Object.entries(THEMES)) {
      const tokens = block(selector)
      for (const semantic of ['--color-warning', '--color-info']) {
        for (const alpha of [0.36, 0.46]) {
          const bg = oklabMix(tokens[semantic], tokens['--color-surface-1'], alpha)
          const rule = nameRules.find(candidate => candidate.semantic === semantic)
          if (!rule) continue
          const nameColor = oklabMix(tokens[semantic], tokens['--color-text-primary'], rule.mix)
          const name_ = ratio(nameColor, bg)
          if (name_ < 3) failures.push(`${name} ${semantic} ${Math.round(alpha * 100)}% name ${name_.toFixed(2)}`)
          for (const labelToken of labelTokens) {
            const value = ratio(tokens[labelToken], bg)
            if (value < 4.5) failures.push(`${name} ${semantic} ${Math.round(alpha * 100)}% ${labelToken} ${value.toFixed(2)}`)
          }
        }
      }
    }
    const identityStyle = readFileSync(resolve(HERE, '../../components/tank-catalog-identity.css'), 'utf8')
    const pillCombos = [...identityStyle.matchAll(/\.tp-pill[\w.:-]*\s*\{[^}]*background:\s*color-mix\(in oklab,\s*var\((--color-[\w-]+)\)\s*16%,\s*var\(--color-surface-1\)\);\s*color:\s*var\((--color-[\w-]+)\);/g)]
      .map(match => [match[2], match[1]] as const)
    expect(pillCombos.length, '语义 pill 组合提取数量').toBeGreaterThanOrEqual(4)
    for (const [textToken, bgToken] of pillCombos) {
      for (const [name, selector] of Object.entries(THEMES)) {
        const tokens = block(selector)
        const value = ratio(tokens[textToken], oklabMix(tokens[bgToken], tokens['--color-surface-1'], 0.16))
        if (value < 4.5) failures.push(`${name} pill ${textToken} on 16% ${bgToken} ${value.toFixed(2)}`)
      }
    }
    expect(failures).toEqual([])
  })
})
