/**
 * 乘员熟练度曲线（BK degressiveStat/progressiveStat，crew=1.0 时均为 0）。
 * 独立成模块供 golden 测试直接断言曲线值。
 */

/** 乘员 >100% 部分的收益（负值，乘在装填/瞄准/散布/阻力上）。 */
export function degressiveStat(crew: number): number {
  return 0.875 / (0.00375 * 100 * crew + 0.5) - 1
}

/** 乘员 >100% 部分的收益（正值，乘在视野/炮塔转速上）。 */
export function progressiveStat(crew: number): number {
  return (0.00375 * 100 * crew + 0.5) / 0.875 - 1
}
