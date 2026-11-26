
export function degressiveStat(crew: number): number {
  return 0.875 / (0.00375 * 100 * crew + 0.5) - 1
}

export function progressiveStat(crew: number): number {
  return (0.00375 * 100 * crew + 0.5) / 0.875 - 1
}

const CONDITIONAL_CREW_SKILLS = new Set([
  'surrounded_by_enemy', 'battle_rage', 'desperado', 'deadly_accuracy', 'close_combat_master',
  'lucky_shot', 'skilled_ranging', 'armour_piercing', 'sniper',
])

export function isConditionalCrewSkill(id: string): boolean {
  return CONDITIONAL_CREW_SKILLS.has(id)
}
