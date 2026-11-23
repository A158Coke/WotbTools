/**
 * 地图/回放阵营语义色（唯一规则：ALLY=GREEN，ENEMY=RED；unknown≠enemy）。
 *
 * 本文件是 Playback 阵营语义色的唯一事实源（SSOT）：
 * - 2D Playback 通过 teamCssVars() 在 playback root 注入 CSS 变量；
 * - 3D Playback 通过 scene/playback/palette.ts 的数值 adapter 消费同一组角色；
 * - 全站四季主题仍由 styles/tokens/color.css 管理，本文件只负责 Playback 作用域的
 *   阵营/目标色覆盖，不改 Success/Danger 或其他页面的语义。
 *
 * 一个角色（friendly/enemy/neutral/objective）拥有同一语义下的多个用途变体：
 * base = 权威基础色；text = 标签文字；outline = 近扩散轮廓；glow = 外围光晕；
 * tracer = 细长高动态炮线（材质 toneMapped=false，需字面亮度）；vehicle = 车辆 tint
 * （深色板，避免明亮地表上刺眼/显脏）。变体不是独立阵营色板，Renderer 不得自行重选。
 */
export const PLAYBACK_ROLES = Object.freeze({
  friendly: Object.freeze({
    base: '#86efac',
    text: '#86efac',
    outline: 'rgba(134, 239, 172, 0.9)',
    glow: 'rgba(134, 239, 172, 0.5)',
    tracer: '#3ee08a',
    vehicle: '#26794a',
  }),
  enemy: Object.freeze({
    base: '#f87171',
    text: '#f87171',
    outline: 'rgba(248, 113, 113, 0.9)',
    glow: 'rgba(248, 113, 113, 0.5)',
    tracer: '#ff5a45',
    vehicle: '#98322a',
  }),
  neutral: Object.freeze({
    base: '#f5f5f5',
    text: '#f5f5f5',
    outline: 'rgba(245, 245, 245, 0.9)',
    glow: 'rgba(245, 245, 245, 0.5)',
    tracer: '#f5f5f5',
    vehicle: '#f5f5f5',
  }),
  objective: Object.freeze({
    base: '#ffc24b',
    text: '#ffc24b',
    outline: 'rgba(255, 194, 75, 0.9)',
    glow: 'rgba(255, 194, 75, 0.5)',
    tracer: '#ffc24b',
    vehicle: '#ffc24b',
  }),
})

/** 中性底板上的文字/描边色（与 neutral.base 成对使用）。 */
export const PLAYBACK_ON_NEUTRAL = '#1c1f1d'

/** 物理队伍号 + 录像者 friendly_team → 录像者视角角色；未知/非法队伍一律 neutral。 */
export function teamRoleOf(team, friendlyTeam) {
  if ((team !== 1 && team !== 2) || (friendlyTeam !== 1 && friendlyTeam !== 2)) return 'neutral'
  return team === friendlyTeam ? 'friendly' : 'enemy'
}

/** 车辆/事件的 recorder-relative friendly 标记 → 角色；null/undefined 不落 enemy。 */
export function friendlyRoleOf(friendly) {
  if (friendly === true) return 'friendly'
  if (friendly === false) return 'enemy'
  return 'neutral'
}

/** 2D / 3D 共用的炮线语义色（同一角色的 tracer 变体）。 */
export function playbackTracerColor(friendly) {
  return PLAYBACK_ROLES[friendlyRoleOf(friendly)].tracer
}

/** 兼容既有 2D 消费方：green/red 是 friendly/enemy 的 text/outline/glow 别名。 */
export const TEAM_TOKENS = Object.freeze({
  green: Object.freeze({
    text: PLAYBACK_ROLES.friendly.text,
    outline: PLAYBACK_ROLES.friendly.outline,
    glow: PLAYBACK_ROLES.friendly.glow,
  }),
  red: Object.freeze({
    text: PLAYBACK_ROLES.enemy.text,
    outline: PLAYBACK_ROLES.enemy.outline,
    glow: PLAYBACK_ROLES.enemy.glow,
  }),
})

/** 阵营语义映射：ALLY=GREEN、ENEMY=RED（一切地图 consumer 共用）。 */
export const ReplayMapFactionStyle = Object.freeze({
  ALLY: TEAM_TOKENS.green,
  ENEMY: TEAM_TOKENS.red,
})

/** BattlePlayback / Replay3D 根元素需要的 Playback 语义 CSS vars。 */
export function teamCssVars(_mapCode) {
  const f = PLAYBACK_ROLES.friendly
  const e = PLAYBACK_ROLES.enemy
  return {
    '--pb-team-text': f.text,
    '--pb-team-outline': f.outline,
    '--pb-team-glow': f.glow,
    '--pb-enemy-text': e.text,
    '--pb-enemy-outline': e.outline,
    '--pb-enemy-glow': e.glow,
    // Playback root 作用域覆盖：子组件/HUD/roster/labels 消费全局 token 名，
    // 但有效值必须来自 Playback SSOT，不能被页面根或 Winter scene-surface 作用域分叉。
    '--color-team-ally': f.base,
    '--color-team-enemy': e.base,
    '--color-team-neutral': PLAYBACK_ROLES.neutral.base,
    '--color-objective': PLAYBACK_ROLES.objective.base,
    '--color-on-team-neutral': PLAYBACK_ON_NEUTRAL,
  }
}
