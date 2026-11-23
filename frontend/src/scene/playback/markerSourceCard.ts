// 标记来源卡解析（从 markerRuntime.ts 拆出，2026-11-20 行数预算 500）：
// 0x2e/0x2f 联册命中的名册 def → 玩家 + 车型两行；车型名纪律与 playbackEventStream
// 的 tankNameOf 同一套（tankNames 表优先，`tank_<id>` 占位名不上 UI，两行全空不出卡）。

export interface MarkerSourceCard {
  player: string
  tank: string
  target?: string
}

const TANK_NAME_PLACEHOLDER = /^tank_\d+$/

/**
 * 来源卡解析：0x2e 联到的名册 def / 0x2f 指令联册命中的 def → 玩家 + 车型两行。
 * 车型名解析与 `playbackEventStream.tankNameOf` 同一纪律：tankNames 表（tank_cache）
 * 优先；facet `tank_<id>` 是**占位名**，不得上 UI（enrichPlayback 只补空值，占位名会
 * 原样透出）——占位名回落到无车型行；两行全空 → null（不出卡）。
 */
export function markerSourceCard(
  entity: { nickname?: string | null; tank_name?: string | null; tank_id?: number | null } | null | undefined,
  tankNameOf?: (tankId: number) => string | undefined,
): MarkerSourceCard | null {
  const player = (entity?.nickname || '').trim()
  const fromTable = typeof entity?.tank_id === 'number' ? tankNameOf?.(entity.tank_id) : undefined
  const raw = (entity?.tank_name || '').trim()
  const tank = fromTable || (raw && !TANK_NAME_PLACEHOLDER.test(raw) ? raw : '')
  if (!player && !tank) return null
  return { player, tank }
}

/** 本模块用到的车辆位姿查询面（宿主经 vehicles.posAt 提供；查不到 / 不可见返回 false）。 */
