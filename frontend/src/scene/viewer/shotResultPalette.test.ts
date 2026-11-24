// 装甲结果语义色单源：角色映射、标定色相与受控亮变体、调试标注调色板。
// 色相偏差 ≤10°：亮变体只允许提高明度/彩度，不能漂移语义色相。
import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_COLORS, RESULT_CSS_VAR, RICOCHET_HEATMAP_HUE_COLOR, SCENE_RESULT_COLORS,
  cssHex, layerResultRole, resultRoleForCardDisplay, resultRoleForChance, resultRoleForHitPoint,
  resultRoleForOutcome, sceneResultColor,
} from './shotResultPalette.js'

/** sRGB hex → HSL 色相（度）。 */
function hueOf(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255
  const g = ((hex >> 8) & 0xff) / 255
  const b = (hex & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (h * 60 + 360) % 360
}

function circularDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

describe('shotResultPalette · 角色映射', () => {
  it('结果串 → 角色：未知/SPLASH 走橙色，ERROR 走红色', () => {
    expect(resultRoleForOutcome('PENETRATION')).toBe('PENETRATION')
    expect(resultRoleForOutcome('RICOCHET')).toBe('RICOCHET')
    expect(resultRoleForOutcome('BLOCKED')).toBe('BLOCKED')
    expect(resultRoleForOutcome('ERROR')).toBe('ERROR')
    expect(resultRoleForOutcome('SPLASH')).toBe('SPLASH')
    expect(resultRoleForOutcome('')).toBe('SPLASH')
  })

  it('累计概率 → 角色：0 红、1–99 黄、100 绿', () => {
    expect(resultRoleForChance(0)).toBe('BLOCKED')
    expect(resultRoleForChance(0.004)).toBe('MAY_PENETRATE')
    expect(resultRoleForChance(0.996)).toBe('MAY_PENETRATE')
    expect(resultRoleForChance(1)).toBe('PENETRATION')
  })

  it('层角色：卡片行与 3D 接触点共用同一映射', () => {
    const role = (layer: Parameters<typeof layerResultRole>[0]['layer'], probabilityMode: boolean, extra = {}) =>
      layerResultRole({ layer, probabilityMode, ...extra })
    expect(role({ penetrated: true }, false)).toBe('PENETRATION')
    expect(role({ ricochet: true }, false)).toBe('RICOCHET')
    expect(role({}, false)).toBe('BLOCKED')
    // 概率模式：接触点表达当前层自身状态，不继承前层累计概率。
    expect(role({ layerChance: 0 }, true)).toBe('BLOCKED')
    expect(role({ layerChance: 0.5 }, true)).toBe('MAY_PENETRATE')
    expect(role({ layerChance: 1 }, true)).toBe('PENETRATION')
    expect(role({ chance: 0.5, layerChance: 1 }, true)).toBe('PENETRATION')
    // 跳弹层优先于概率（跳弹紫不能被累计/局部概率染成黄/绿）。
    expect(role({ ricochet: true, layerChance: 1 }, true)).toBe('RICOCHET')
    // 未到达层中性灰（与卡片行同优先级；未到达不冒充跳弹/挡下）。
    expect(role({ reached: false, layerChance: 1 }, true)).toBe('UNREACHED')
    expect(role({ reached: false, penetrated: true }, false)).toBe('UNREACHED')
    expect(role({ reached: false, ricochet: true }, false)).toBe('UNREACHED')
    // 无主装甲门禁 / 续飞局部概率：与卡片行同口径。
    expect(role({ penetrated: true }, false, { blockedNoPrimary: true })).toBe('BLOCKED')
    expect(role({}, false, { partialChance: 0.5 })).toBe('MAY_PENETRATE')
    // 缺 layerChance 时兼容旧输入（累计 chance）。
    expect(role({ chance: 0 }, true)).toBe('BLOCKED')
  })

  it('卡片 CSS 变量与 3D 亮变体覆盖全部结果档', () => {
    for (const role of ['PENETRATION', 'MAY_PENETRATE', 'RICOCHET', 'SPLASH', 'BLOCKED', 'UNREACHED', 'ERROR'] as const) {
      expect(RESULT_CSS_VAR[role]).toMatch(/^var\(--(green|yellow|orange|purple|red|muted)\)$/)
      expect(sceneResultColor(role)).toBe(SCENE_RESULT_COLORS[role])
      expect(cssHex(sceneResultColor(role))).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(RESULT_CSS_VAR.RICOCHET).toBe('var(--purple)')
    expect(RESULT_CSS_VAR.SPLASH).toBe('var(--orange)')
    expect(RESULT_CSS_VAR.UNREACHED).toBe('var(--muted)')
    expect(RESULT_CSS_VAR.ERROR).toBe(RESULT_CSS_VAR.BLOCKED)
    expect(SCENE_RESULT_COLORS.ERROR).toBe(SCENE_RESULT_COLORS.BLOCKED)
  })
})

describe('shotResultPalette · 标定色相', () => {
  it('3D 亮变体与语义 token 的色相偏差 ≤10°（只提亮，不换色相）', () => {
    // token 取深色场景档（color.css 的 --color-success/warning/danger）。
    expect(circularDelta(hueOf(SCENE_RESULT_COLORS.PENETRATION), hueOf(0x5cc280))).toBeLessThanOrEqual(10)
    expect(circularDelta(hueOf(SCENE_RESULT_COLORS.MAY_PENETRATE), hueOf(0xf5ca76))).toBeLessThanOrEqual(10)
    expect(circularDelta(hueOf(SCENE_RESULT_COLORS.BLOCKED), hueOf(0xf2786d))).toBeLessThanOrEqual(10)
    // 跳弹紫与热力图跳弹高亮同色相（#ff00ff = 300°），只提亮不换色相。
    expect(circularDelta(
      hueOf(SCENE_RESULT_COLORS.RICOCHET),
      hueOf(RICOCHET_HEATMAP_HUE_COLOR),
    )).toBeLessThanOrEqual(10)
    expect(circularDelta(hueOf(RICOCHET_HEATMAP_HUE_COLOR), 300)).toBeLessThanOrEqual(1)
    // HE 溅射橙落在 warning(≈40°) 与 danger(≈5°) 之间（跳弹紫已独立，不再复用它）。
    expect(circularDelta(hueOf(SCENE_RESULT_COLORS.SPLASH), hueOf(0xff9b3d))).toBeLessThanOrEqual(1)
    const splash = hueOf(SCENE_RESULT_COLORS.SPLASH)
    expect(splash).toBeGreaterThan(hueOf(0xf2786d))
    expect(splash).toBeLessThan(hueOf(0xf5ca76))
  })

  it('五个主角色色互不相同且为不透明数值色', () => {
    const values = [
      SCENE_RESULT_COLORS.PENETRATION, SCENE_RESULT_COLORS.MAY_PENETRATE,
      SCENE_RESULT_COLORS.RICOCHET, SCENE_RESULT_COLORS.SPLASH, SCENE_RESULT_COLORS.BLOCKED,
    ]
    expect(new Set(values).size).toBe(5)
    for (const v of values) expect(v).toBeGreaterThanOrEqual(0)
  })
})

describe('shotResultPalette · 卡片展示结果与命中点角色', () => {
  const base = {
    result: 'PENETRATION', heInfo: null, heChance: 0,
    probabilityMode: false, overallChance: null, chancePartial: false,
  }

  it('HE：溅射橙 / 可能黄 / 击穿绿 / 未穿红 / 采样不可用红', () => {
    expect(resultRoleForCardDisplay({ ...base, heInfo: { splash_avg: 0 }, heChance: 0 })).toBe('BLOCKED')
    expect(resultRoleForCardDisplay({ ...base, heInfo: { splash_avg: 110 }, heChance: 0 })).toBe('SPLASH')
    expect(resultRoleForCardDisplay({ ...base, heInfo: { splash_avg: 110 }, heChance: 0.5 })).toBe('MAY_PENETRATE')
    expect(resultRoleForCardDisplay({ ...base, heInfo: { splash_avg: 110 }, heChance: 1 })).toBe('PENETRATION')
    expect(resultRoleForCardDisplay({ ...base, heInfo: { unavailable: true, splash_avg: 0 }, heChance: 0 })).toBe('ERROR')
  })

  it('续飞 1–99% 走黄；概率模式按总体概率；其余按最终段', () => {
    expect(resultRoleForCardDisplay({ ...base, result: 'RICOCHET → BLOCKED', chancePartial: true })).toBe('MAY_PENETRATE')
    expect(resultRoleForCardDisplay({ ...base, result: 'RICOCHET → BLOCKED', chancePartial: false })).toBe('BLOCKED')
    expect(resultRoleForCardDisplay({ ...base, probabilityMode: true, overallChance: 1 })).toBe('PENETRATION')
    expect(resultRoleForCardDisplay({ ...base, probabilityMode: true, overallChance: 0.5 })).toBe('MAY_PENETRATE')
    expect(resultRoleForCardDisplay({ ...base, probabilityMode: true, overallChance: 0 })).toBe('BLOCKED')
  })

  it('命中点跟随首层角色：双层首层可穿、整体挡下时为绿', () => {
    expect(resultRoleForHitPoint({
      layerRoles: ['PENETRATION', 'BLOCKED'],
      resultRole: 'BLOCKED',
      hasPerLayerDisplay: true,
    })).toBe('PENETRATION')
    expect(resultRoleForHitPoint({
      layerRoles: ['RICOCHET', 'PENETRATION'],
      resultRole: 'PENETRATION',
      hasPerLayerDisplay: true,
    })).toBe('RICOCHET')
    expect(resultRoleForHitPoint({
      layerRoles: ['MAY_PENETRATE', 'BLOCKED'],
      resultRole: 'BLOCKED',
      hasPerLayerDisplay: true,
    })).toBe('MAY_PENETRATE')
  })

  it('HE / 无逐层展示时命中点回退最终展示结果', () => {
    expect(resultRoleForHitPoint({
      layerRoles: ['BLOCKED'],
      resultRole: 'SPLASH',
      hasPerLayerDisplay: false,
    })).toBe('SPLASH')
    expect(resultRoleForHitPoint({
      layerRoles: [],
      resultRole: 'BLOCKED',
      hasPerLayerDisplay: true,
    })).toBe('BLOCKED')
    expect(resultRoleForHitPoint({
      resultRole: 'ERROR',
      hasPerLayerDisplay: true,
    })).toBe('ERROR')
  })
})

describe('shotResultPalette · 调试标注调色板', () => {
  it('与既有标记白名单一致（避免 3D 材质与图例文本漂移）', () => {
    expect(cssHex(ANNOTATION_COLORS.launch)).toBe('#ff6622')
    expect(cssHex(ANNOTATION_COLORS.velocity)).toBe('#00ccff')
    expect(cssHex(ANNOTATION_COLORS.chord)).toBe('#00ff00')
    expect(cssHex(ANNOTATION_COLORS.endpoint)).toBe('#ffcc00')
    expect(cssHex(ANNOTATION_COLORS.bounce)).toBe('#ffaa00')
    expect(cssHex(ANNOTATION_COLORS.impact)).toBe('#ff2222')
    expect(cssHex(ANNOTATION_COLORS.shooterAnchor)).toBe('#00aaff')
    expect(cssHex(ANNOTATION_COLORS.victimAnchor)).toBe('#00ffcc')
    expect(cssHex(ANNOTATION_COLORS.trackHeading)).toBe('#33ff66')
    expect(cssHex(ANNOTATION_COLORS.turn)).toBe('#ffdd33')
    expect(cssHex(ANNOTATION_COLORS.breech)).toBe('#cc66ff')
    expect(cssHex(ANNOTATION_COLORS.deviation)).toBe('#ffffff')
  })
})
