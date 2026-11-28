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

export const THICKNESS_BANDS = Object.freeze([
  { minMm: 200, color: 0xb8322a },
  { minMm: 100, color: SCENE_RESULT_COLORS.BLOCKED },
  { minMm: 60, color: SCENE_RESULT_COLORS.SPLASH },
  { minMm: 30, color: SCENE_RESULT_COLORS.MAY_PENETRATE },
  { minMm: Number.NEGATIVE_INFINITY, color: SCENE_RESULT_COLORS.PENETRATION }, // <30：标定绿
] as const)

/**
 * 名义厚度（mm）→ 厚度视图材质色。
 * @param t 名义厚度；null/undefined/NaN 返回中性灰。
 */
export function thicknessToColor(t: number | null | undefined): number {
  if (t == null || !Number.isFinite(t)) return THICKNESS_UNKNOWN_COLOR
  for (const band of THICKNESS_BANDS) {
    if (t >= band.minMm) return band.color
  }
  return THICKNESS_UNKNOWN_COLOR
}
