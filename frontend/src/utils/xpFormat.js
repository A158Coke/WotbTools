/**
 * XP 研发成本的紧凑显示（UI 徽标/卡片角标用）。
 *
 * 客户端节点只有 64×64，写全 "101,500 XP" 会被截断成省略号；这里按 k 缩写：
 * - < 1000 原样（"500"）
 * - 千位：保留 1 位小数、去掉尾随 .0（"2.5k"、"31k"、"101.5k"）
 *
 * 只是**展示**口径：tooltip / aria-label 仍给完整数字（`toLocaleString`），
 * 不用于任何计算或比较。
 */
const UNIT = 1000

export function formatXpCompact(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < UNIT) return String(Math.round(n))
  const k = Math.round((n / UNIT) * 10) / 10
  return `${k}k`
}
