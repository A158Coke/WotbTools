import { SCENE_RESULT_COLORS } from './shotResultPalette.js'

export const THICKNESS_UNKNOWN_COLOR = 0x666666

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
