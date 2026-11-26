
export interface MarkerSourceCard {
  player: string
  tank: string
  target?: string
}

const TANK_NAME_PLACEHOLDER = /^tank_\d+$/

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

