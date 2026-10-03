/**
 * 伤害飘字（3D 回放）的呈现参数与动画曲线：纯函数，绘制与渲染留在 playbackScene.js。
 *
 * 尺寸**不是固定世界尺度**：与名牌标签同式（playbackScene 的 LABEL_FRAC），按"视口高恒定
 * 占比"反算世界高度——拉远看全场时固定世界尺度的数字会小到读不出；屏幕占比恒定保证任何
 * 缩放下都可读。
 *
 * 不透明度是"先保持、后淡出"而非全程线性：线性淡出会让高速交火里的数字来不及读完。
 */

/** 贴图画布 2:1；字号按容纳 5 字符（如 `-1234`）标定，见 spawnFloatDmg */
export const DMG_TEX_W = 384
export const DMG_TEX_H = 192
export const DMG_ASPECT = DMG_TEX_W / DMG_TEX_H

/** 屏上高度 = 视口高 × DMG_FRAC（数字像素高约为视口高 1.6%，约名牌文字的两倍） */
export const DMG_FRAC = 0.03

/** 出生弹出：生命周期前 18% 内 0.72 → 1.0（三次缓出） */
const POP_FRAC = 0.18
/** 不透明度：生命周期前 50% 保持全不透明，其后线性淡出到 0 */
const HOLD_FRAC = 0.5

/**
 * 屏幕占比恒定的世界高度：`d · 2tan(fov/2) · DMG_FRAC`。
 * 该式保证 `世界高度 / 该距离处的视口世界高度` 恒为 DMG_FRAC（与距离无关）；
 * `Math.max` 仅防 d→0 时的退化，与标签 `Math.max(0.05, …)` 同款。
 */
export function dmgWorldHeight(distance, fovDeg) {
  const k = 2 * Math.tan((fovDeg * Math.PI) / 360) * DMG_FRAC
  return Math.max(0.05, distance * k)
}

/**
 * 生命周期参数 k（0 = 出生，1 = 消亡）→ 动画量。
 * @param {number} k
 * @returns {{ pop: number, opacity: number }} pop = 相对基准尺寸的缩放
 */
export function floatDmgAnim(k) {
  const t = Math.max(0, Math.min(1, k))
  const u = Math.min(1, t / POP_FRAC)
  const pop = 0.72 + 0.28 * (1 - Math.pow(1 - u, 3))
  const opacity = t < HOLD_FRAC ? 1 : Math.max(0, (1 - t) / (1 - HOLD_FRAC))
  return { pop, opacity }
}
