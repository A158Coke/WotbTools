import { SCENE_RESULT_COLORS } from './shotResultPalette.js'

export const THICKNESS_UNKNOWN_COLOR = 0x666666

/** 厚度视图的类别：主装甲 / 间隙甲 / 外部模块（履带、负重轮、炮管）。 */
export type ThicknessClass = 'primary' | 'spaced' | 'external'

/** 间隙甲透明度归一厚度（mm）：BlitzKit static armor 的 thicknessRange 固定语义。 */
const SPACED_FULL_MM = 200
/** 间隙甲最低不透明度：0mm 时仍能看见屏幕板，且透出后面的主装甲。 */
const SPACED_MIN_OPACITY = 0.5
/** 外部模块不透明度：BlitzKit external = 1/8（不写深度，只作上下文）。 */
export const THICKNESS_EXTERNAL_OPACITY = 1 / 8

/**
 * 类别 + 名义厚度 → 厚度视图表面不透明度。
 * 语义与 BlitzKit StaticArmorSceneComponent 一致：primary 1、spaced
 * `clamp(t/range + 0.5, 0.5, 1)`、external 1/8；未知厚度按 0mm 处理，不猜成薄板绿。
 */
export function thicknessSurfaceOpacity(kind: ThicknessClass, t: number | null | undefined): number {
  if (kind === 'primary') return 1
  if (kind === 'external') return THICKNESS_EXTERNAL_OPACITY
  const mm = t != null && Number.isFinite(t) ? Math.max(0, t) : 0
  return Math.min(1, Math.max(SPACED_MIN_OPACITY, mm / SPACED_FULL_MM + SPACED_MIN_OPACITY))
}

/** 外部模块不写深度（避免半透明履带遮住主装甲）；primary/spaced 维持深度写入。 */
export function thicknessDepthWrite(kind: ThicknessClass): boolean {
  return kind !== 'external'
}

/**
 * 类别 + 板色 → 勾线色。BlitzKit：spaced 提亮 ×4、其余压暗 ×0.5；
 * 结果按 8 位通道 clamp，避免 HDR 色在 line material 上溢出。
 */
export function thicknessOutlineColor(kind: ThicknessClass, color: number): number {
  const scale = kind === 'spaced' ? 4 : 0.5
  const channel = (shift: number): number => Math.min(255, Math.round(((color >> shift) & 0xff) * scale))
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/**
 * 厚度视图的连续渐变标尺（2026-11-28：替代原 5 档固定色）。
 *
 * 锚点沿用击穿结果的语义色与同一组阈值（30/60/100/200mm），相邻锚点之间做线性
 * RGB 插值——不再出现档位色块，厚度差一点颜色就连着变一点。两端保持语义平段：
 * <30mm 维持"标定绿"（校准口径），≥320mm 维持深红（远超口径）。
 * 标尺是**绝对域**：同一厚度在任何坦克、版本对比的两侧都映射到同一颜色，
 * 版本对比视图因此可以直接共用这份着色。
 */
export const THICKNESS_STOPS = Object.freeze([
  { minMm: 30, color: SCENE_RESULT_COLORS.PENETRATION },
  { minMm: 60, color: SCENE_RESULT_COLORS.MAY_PENETRATE },
  { minMm: 100, color: SCENE_RESULT_COLORS.SPLASH },
  { minMm: 200, color: SCENE_RESULT_COLORS.BLOCKED },
  { minMm: 320, color: 0xb8322a },
] as const)

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff]
}

function rgbToHex(rgb: [number, number, number]): number {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
  const [r, g, b] = rgb.map(clamp) as [number, number, number]
  return (r << 16) | (g << 8) | b
}

function lerpColor(a: number, b: number, ratio: number): number {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  return rgbToHex([
    ca[0] + (cb[0] - ca[0]) * ratio,
    ca[1] + (cb[1] - ca[1]) * ratio,
    ca[2] + (cb[2] - ca[2]) * ratio,
  ])
}

/**
 * 名义厚度（mm）→ 厚度视图材质色（连续渐变）。
 * @param t 名义厚度；null/undefined/NaN 返回中性灰。
 */
export function thicknessToColor(t: number | null | undefined): number {
  if (t == null || !Number.isFinite(t)) return THICKNESS_UNKNOWN_COLOR
  if (t < THICKNESS_STOPS[0].minMm) return THICKNESS_STOPS[0].color
  for (let i = 0; i < THICKNESS_STOPS.length - 1; i += 1) {
    const low = THICKNESS_STOPS[i]
    const high = THICKNESS_STOPS[i + 1]
    if (t < high.minMm) {
      const ratio = (t - low.minMm) / (high.minMm - low.minMm)
      return lerpColor(low.color, high.color, ratio)
    }
  }
  return THICKNESS_STOPS[THICKNESS_STOPS.length - 1].color
}