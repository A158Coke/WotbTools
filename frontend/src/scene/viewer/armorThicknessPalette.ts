/**
 * 装甲厚度视图色阶（唯一 owner）。
 *
 * 厚度模式是“固定 5 档”的产品契约（按钮 tooltip：<30 / 30–60 / 60–100 /
 * 100–200 / ≥200 mm），本模块只统一**颜色语言**，不改阈值：
 * 薄 → 绿、30–60 → 黄、60–100 → 橙、100–200 → 红、≥200 → 深红。
 *
 * 色值与热力图/判定结果共用同一套标定语义色（`shotResultPalette` 的 3D
 * 亮变体；≥200 用 color.css 的 red-700），避免厚度视图继续使用森林绿/
 * 金色/暗红这套网页色，与热力图色带、结果卡/图例脱节。
 *
 * 方向与热力图一致：绿 = 薄/易穿，红 = 厚/难穿；厚度模式不做判定，颜色
 * 只表达名义厚度分档。
 */
import { SCENE_RESULT_COLORS } from './shotResultPalette.js'

/** 无厚度数据（null/undefined/NaN）：中性灰，不冒充“薄板绿”。 */
export const THICKNESS_UNKNOWN_COLOR = 0x666666

/** 降序分档；调用方按 `t >= minMm` 取第一档。 */
export const THICKNESS_BANDS = Object.freeze([
  { minMm: 200, color: 0xb8322a }, // ≥200：深红（比 danger 更深，表示最厚档）
  { minMm: 100, color: SCENE_RESULT_COLORS.BLOCKED }, // 100–200：标定红
  { minMm: 60, color: SCENE_RESULT_COLORS.SPLASH }, // 60–100：标定橙
  { minMm: 30, color: SCENE_RESULT_COLORS.MAY_PENETRATE }, // 30–60：标定黄
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
