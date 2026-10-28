/**
 * 等级（tier / 模块 level）的展示口径：统一罗马数字（客户端同构，2026-10-27 用户要求）。
 *
 * 客户端科技树 LevelCell 绑定 `roman(level)`，模块格与坦克卡片也都标 I..XI。
 * 这里只做**展示**转换；数据里仍是整数，筛选/排序/URL 一律用整数。
 */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']

/** 1..11 → 'I'..'XI'；非法/缺省返回 ''（不显示假等级）。 */
export function romanLevel(level) {
  const n = Number(level)
  if (!Number.isInteger(n) || n < 1) return ''
  return ROMAN[n - 1] || String(n)
}
