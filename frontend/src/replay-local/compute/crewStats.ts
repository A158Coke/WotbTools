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

/**
 * 需要战斗事件、敌方距离/数量、剩余血量或概率触发的技能。
 * 客户端 type=continuous 也包含这些技能，不能作为常驻效果判据。
 * 修复/灭火等专属参数的常驻修正不属于临时属性增益；概率技能仅展示说明。
 */
const CONDITIONAL_CREW_SKILLS = new Set([
  'surrounded_by_enemy', 'battle_rage', 'desperado', 'deadly_accuracy', 'close_combat_master',
  'lucky_shot', 'skilled_ranging', 'armour_piercing', 'sniper',
])

export function isConditionalCrewSkill(id: string): boolean {
  return CONDITIONAL_CREW_SKILLS.has(id)
}
