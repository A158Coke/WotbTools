/**
 * 地图阵营语义色（唯一规则：ALLY=GREEN，ENEMY=RED）。
 *
 * 业务规则（2026-08）：所有 replay map / battle playback / map overview 统一
 * 己方=绿色、敌方=红色；旧的「friendly per-map blue|green」「friendly=amber / enemy=cyan」
 * 一律视为 obsolete，不再保留（无 backward-compat 分支）。
 *
 * semantic tokens（Battle Playback 局部定义；命名友好，不锁 HEX 语义）：
 * text = label 文字色；outline = 整车轮廓（近扩散）；glow = 外围光晕（远扩散）。
 */
export const TEAM_TOKENS = Object.freeze({
  green: Object.freeze({ text: '#4ade80', outline: 'rgba(74, 222, 128, 0.9)', glow: 'rgba(74, 222, 128, 0.5)' }),
  red: Object.freeze({ text: '#f87171', outline: 'rgba(248, 113, 113, 0.9)', glow: 'rgba(248, 113, 113, 0.5)' }),
})

/** 阵营语义映射：ALLY=GREEN、ENEMY=RED（一切地图 consumer 共用）。 */
export const ReplayMapFactionStyle = Object.freeze({
  ALLY: TEAM_TOKENS.green,
  ENEMY: TEAM_TOKENS.red,
})

/** BattlePlayback 根元素需要的 team CSS vars（friendly 恒定 green、enemy 固定 red）。 */
export function teamCssVars(_mapCode) {
  const f = TEAM_TOKENS.green
  const e = TEAM_TOKENS.red
  return {
    '--pb-team-text': f.text,
    '--pb-team-outline': f.outline,
    '--pb-team-glow': f.glow,
    '--pb-enemy-text': e.text,
    '--pb-enemy-outline': e.outline,
    '--pb-enemy-glow': e.glow,
  }
}
