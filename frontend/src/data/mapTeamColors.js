/**
 * PR3 §19/§20 —— 地图友好阵营色调显式配置 + team 视觉 token（Battle Playback 局部定义）。
 *
 * §19 契约：
 * - enemy 所有地图固定 red（--pb-enemy-*）；
 * - friendly 每张地图显式配置 green 或 blue（与地图主基色避免混淆）；
 * - **不是 runtime 自动取色**；新增地图未配置 → CI FAIL（mapTeamColors.test.js）。
 *
 * 色调为视觉初值（按地图主基色印象分配，避免与底图混淆）；后续人工视觉 QA
 * 可按 §19 原则调整（改本文件即可，CI 只保证"存在且合法"，不锁死具体色调）。
 */
export const MAP_FRIENDLY_TONE = Object.freeze({
  // 主基色印象 → friendly 对比色调（绿色系底图用 blue，蓝/白/灰/暖色底图用 green）
  amigosville: 'blue', // 暖黄褐小镇
  canal: 'blue', // 运河绿岸
  canyon: 'green', // 红岩峡谷
  desert_train: 'blue', // 黄沙
  erlenberg: 'blue', // 荷兰绿镇
  faust: 'blue', // 工业灰蓝
  forgecity: 'green', // 港口工业
  fort: 'blue', // 土黄要塞
  himmelsdorf: 'green', // 城市灰
  holland: 'blue', // 绿原野
  idle: 'green', // 雪地
  italy: 'blue', // 葡萄园绿
  karieri: 'blue', // 采石场黄褐
  karelia: 'blue', // 岩灰绿
  lagoon: 'blue', // 丛林绿
  lumber: 'blue', // 林场绿棕
  malinovka: 'green', // 雪地
  medvedkovo: 'green', // 雪/工业
  milbase: 'green', // 海港
  mountain: 'blue', // 山影灰蓝
  neptune: 'green', // 海滩海蓝
  pliego: 'blue', // 西班牙黄褐
  plant: 'green', // 工厂灰
  port: 'green', // 海港
  rift: 'green', // 白墙蓝海
  rock: 'blue', // 丛林
  savanna: 'blue', // 草原绿
  skit: 'green', // 海战
})

/** 地图 key → friendly tone（供 BattlePlayback 根元素设置 CSS vars）。
 * §19 禁止默认色 silent fallback：CI（mapTeamColors.test.js）强制 mapImages 每 key 显式配置，
 * 此处未配置属数据 bug——显式 console.error 报错后仅作防御性兜底（不静默）。 */
export function friendlyToneForMap(mapCode) {
  const tone = MAP_FRIENDLY_TONE[mapCode]
  if (!tone) console.error('[mapTeamColors] 未配置 friendly tone 的地图 mapCode=' + mapCode + '（§19 CI 应拦截）')
  return tone || 'green'
}

/**
 * §20 semantic tokens（Battle Playback 局部定义；命名友好，不锁 HEX 语义）：
 * text = label 文字色；outline = 整车轮廓（近扩散）；glow = 外围光晕（远扩散）。
 */
export const TEAM_TOKENS = Object.freeze({
  green: Object.freeze({ text: '#4ade80', outline: 'rgba(74, 222, 128, 0.9)', glow: 'rgba(74, 222, 128, 0.5)' }),
  blue: Object.freeze({ text: '#60a5fa', outline: 'rgba(96, 165, 250, 0.9)', glow: 'rgba(96, 165, 250, 0.5)' }),
  red: Object.freeze({ text: '#f87171', outline: 'rgba(248, 113, 113, 0.9)', glow: 'rgba(248, 113, 113, 0.5)' }),
})

/** BattlePlayback 根元素需要的 team CSS vars（friendly 按地图 tone、enemy 固定 red）。 */
export function teamCssVars(mapCode) {
  const f = TEAM_TOKENS[friendlyToneForMap(mapCode)]
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
